import fs from 'node:fs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { connect, pause, store, uiSet } from './cdp.mjs'

const device = 'emulator-5586'
const port = '9371'
const app = 'com.yubin.formyself'
const server = 'com.yubin.formyself.ai-api-key.v1'
const marker = 'SYNTHETIC-ANDROID-QA-NOT-A-REAL-KEY'
const password = 'Synthetic-QA-Only-20261023'
const adb = args => execFileSync('E:/Android/Sdk/platform-tools/adb.exe', ['-s', device, ...args], { encoding: 'utf8', windowsHide: true })
const results = { date: '2026-10-23', device, tests: [], cleanup: {} }
const settings = store('settings')
const auth = store('auth')
let user, c, originalUser
const record = name => { results.tests.push({ name, passed: true }); console.log('PASS ' + name) }
const clickText = text => c.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})?.click()`)
const screenshot = async name => {
  const r = await c.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(new URL(name, import.meta.url), Buffer.from(r.data, 'base64'))
}
async function launch() {
  for (let i = 0; i < 30; i++) {
    try {
      const output = adb(['shell', 'am', 'start', '--user', user, '-n', app + '/.MainActivity'])
      if (!output.includes('Error')) return
    } catch {}
    await pause(300)
  }
  throw new Error('Unable to launch isolated test user')
}
async function reconnect() {
  c?.close()
  for (let i = 0; i < 60; i++) {
    try {
      const line = adb(['shell', 'ps', '-A', '-o', 'USER,PID,NAME']).split('\n').find(x => x.startsWith(`u${user}_`) && / com\.yubin\.formyself\s*$/.test(x))
      if (line) {
        adb(['forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${line.trim().split(/\s+/)[1]}`])
        process.env.QA_CDP_PORT = port
        c = await connect()
        await c.until(`!!${settings}?.isDataLoaded && !!${auth}?.isDataLoaded`)
        return
      }
    } catch {}
    await pause(250)
  }
  throw new Error('Unable to connect to isolated WebView')
}
async function unlock() {
  if (await c.evaluate(`${auth}.isLocked`)) {
    await c.until(`!!document.querySelector('.lock-screen input')`)
    await c.evaluate(uiSet('.lock-screen input', password))
    await c.evaluate(`document.querySelector('.lock-btn').click()`)
    await c.until(`!${auth}.isLocked`)
  }
}
async function coldStart() {
  c?.close()
  adb(['shell', 'am', 'force-stop', '--user', user, app])
  await launch()
  await reconnect()
  await unlock()
}
async function openAI() {
  await c.evaluate(`${settings}.openGeneralSettingsSection('ai')`)
  await c.until(`!!document.querySelector('#ai-api-key')`)
}
const credentialEquals = expected => c.evaluate(`window.Capacitor.Plugins.NativeBiometric.getCredentials({server:${JSON.stringify(server)}}).then(x=>x.password===${JSON.stringify(expected)}&&x.username==='formyself')`)
const setKey = async value => {
  await c.evaluate(uiSet('#ai-api-key', value))
  await c.until(`${settings}.apiKeyStorageStatus==='saved' || ${settings}.apiKeyStorageStatus==='empty'`)
}
async function waitForLegacyFixtureOnDisk(value) {
  // Preferences.set resolves after apply(), before its disk write necessarily finishes.
  // Verify the injected historical fixture exists on disk before testing migration.
  for (let i = 0; i < 30; i++) {
    try {
      const xml = adb(['shell', 'run-as', app, '--user', user, 'cat', 'shared_prefs/CapacitorStorage.xml'])
      if (xml.includes('my_ai_settings') && xml.includes(value)) return
    } catch {}
    await pause(50)
  }
  throw new Error('Synthetic legacy fixture did not reach disk before migration test')
}
async function installFaults() {
  await c.evaluate(`(()=>{
    window.__apiKeyFault={write:false,read:false,check:false,writes:0,requests:0};
    const cap=window.Capacitor, original=cap.nativePromise;
    cap.nativePromise=function(plugin,method,options){
      const f=window.__apiKeyFault;
      if(plugin==='NativeBiometric'&&options?.server===${JSON.stringify(server)}){
        if(method==='setCredentials')f.writes++;
        if((method==='setCredentials'&&f.write)||(method==='getCredentials'&&f.read)||(method==='isCredentialsSaved'&&f.check))return Promise.reject(new Error('SYNTHETIC_NATIVE_FAULT'));
      }
      return original.call(cap,plugin,method,options);
    };
    window.__restoreApiKeyBridge=()=>{cap.nativePromise=original};
  })()`)
}

try {
  originalUser = adb(['shell', 'am', 'get-current-user']).trim()
  assert.equal(originalUser, '0', 'Only run when the original owner is active')
  results.android = adb(['shell', 'getprop', 'ro.build.version.release']).trim()
  user = adb(['shell', 'pm', 'create-user', 'Codex-API-Key-QA-20261023']).match(/id (\d+)/)?.[1]
  assert.ok(user && user !== originalUser)
  results.testUser = user
  adb(['shell', 'settings', '--user', user, 'put', 'secure', 'user_setup_complete', '1'])
  adb(['shell', 'settings', '--user', user, 'put', 'system', 'screen_off_timeout', '1800000'])
  adb(['shell', 'am', 'switch-user', user])
  await pause(1500)
  adb(['shell', 'cmd', 'package', 'install-existing', '--user', user, '--wait', app])
  adb(['shell', 'input', 'keyevent', '224'])
  adb(['shell', 'wm', 'dismiss-keyguard'])
  await launch()
  await reconnect()
  assert.equal(await c.evaluate(`${auth}.hasMasterPassword`), false)
  await unlock()
  await openAI()

  await setKey(marker)
  assert.equal(await credentialEquals(marker), true)
  assert.equal(await c.evaluate(`window.Capacitor.Plugins.Preferences.get({key:'my_ai_provider_settings_v1'}).then(x=>!JSON.parse(x.value||'{}').key)`), true)
  record('actual UI save is verified against Android encrypted credentials; ordinary preferences exclude Key')

  await coldStart()
  assert.equal(await c.evaluate(`${settings}.aiApiKey===${JSON.stringify(marker)}`), true)
  assert.equal(await credentialEquals(marker), true)
  await openAI()
  assert.equal(await c.evaluate(`document.querySelector('#ai-key-storage-status').textContent.includes('已安全保存')`), true)
  record('force-stop and cold start restore Key from actual Android storage')

  for (let i = 0; i < 3; i++) {
    const value = marker + '-DURABLE-' + i
    await setKey(value)
    await coldStart()
    assert.equal(await c.evaluate(`${settings}.aiApiKey===${JSON.stringify(value)}`), true)
    await openAI()
  }
  await setKey(marker)
  record('three consecutive verified saves survive immediate force-stop and cold start')

  await installFaults()
  await c.evaluate(uiSet('input[placeholder="deepseek-chat / gpt-4o-mini"]', 'synthetic-model'))
  await c.evaluate(`${settings}.saveAiSettings()`)
  assert.equal(await c.evaluate('window.__apiKeyFault.writes'), 0)
  assert.equal(await credentialEquals(marker), true)
  record('model-only edits never write or clear credentials')

  await c.evaluate('window.__apiKeyFault.write=true')
  await c.evaluate(uiSet('#ai-api-key', marker + '-RETRY'))
  await c.until(`${settings}.apiKeyStorageStatus==='save-error'`)
  assert.equal(await c.evaluate(`document.querySelector('#ai-key-storage-status').textContent.includes('保存失败')`), true)
  await screenshot('native-save-error.png')
  await c.evaluate('window.__apiKeyFault.write=false')
  await clickText('重试保存 API Key')
  await c.until(`${settings}.apiKeyStorageStatus==='saved'`)
  assert.equal(await credentialEquals(marker + '-RETRY'), true)
  record('native write failure is visible and retry saves retained input without retyping')

  await coldStart()
  assert.equal(await c.evaluate(`${settings}.aiApiKey===${JSON.stringify(marker + '-RETRY')}`), true)
  record('retried Key survives actual process restart')
  await openAI()
  await installFaults()

  await c.evaluate(`window.__apiKeyFault.read=true; ${settings}.loadSettings()`)
  assert.equal(await c.evaluate(`${settings}.apiKeyStorageStatus`), 'load-error')
  assert.equal(await c.evaluate(`document.querySelector('#ai-api-key').disabled`), true)
  await c.evaluate(uiSet('input[placeholder="deepseek-chat / gpt-4o-mini"]', 'changed-during-read-error'))
  await pause(400)
  assert.equal(await c.evaluate('window.__apiKeyFault.writes'), 0)
  await c.evaluate('window.__apiKeyFault.read=false')
  assert.equal(await credentialEquals(marker + '-RETRY'), true)
  await clickText('重试读取 API Key')
  await c.until(`${settings}.apiKeyStorageStatus==='saved'`)
  assert.equal(await c.evaluate(`${settings}.aiModel`), 'changed-during-read-error')
  record('actual startup loader with injected read failure preserves credentials; model edit cannot overwrite; retry recovers')

  await c.evaluate(`window.__apiKeyFault.check=true; ${settings}.loadSettings()`)
  assert.equal(await c.evaluate(`${settings}.apiKeyStorageStatus`), 'load-error')
  await c.evaluate('window.__apiKeyFault.check=false')
  await clickText('重试读取 API Key')
  await c.until(`${settings}.apiKeyStorageStatus==='saved'`)
  record('credential existence-check errors remain visible and retryable')

  await c.evaluate(`window.__apiKeyFault.write=true;
    window.fetch=async()=>{window.__apiKeyFault.requests++;throw new Error('SYNTHETIC_REQUEST_BLOCKED')}`)
  await c.evaluate(uiSet('#ai-api-key', marker + '-HANDSHAKE'))
  await c.until(`${settings}.apiKeyStorageStatus==='save-error'`)
  await clickText('⚡ 测试 AI 握手')
  await c.until(`!!document.querySelector('.feedback-overlay')`)
  assert.equal(await c.evaluate(`document.querySelector('.feedback-overlay').textContent.includes('保存失败')`), true)
  assert.equal(await c.evaluate('window.__apiKeyFault.requests'), 0)
  await c.evaluate(`document.querySelector('.feedback-confirm').click()`)
  await c.evaluate('window.__apiKeyFault.write=false')
  await clickText('重试保存 API Key')
  await c.until(`${settings}.apiKeyStorageStatus==='saved'`)
  await c.evaluate(`window.fetch=async()=>{
    if(${settings}.apiKeyStorageStatus!=='saved')throw new Error('REQUEST_BEFORE_SAVE');
    window.__apiKeyFault.requests++;
    return new Response(JSON.stringify({choices:[{message:{content:'连接成功！'}}]}),{status:200,headers:{'Content-Type':'application/json'}})
  }`)
  await clickText('⚡ 测试 AI 握手')
  await c.until(`!!document.querySelector('.feedback-overlay')`)
  assert.equal(await c.evaluate(`document.querySelector('.feedback-overlay').textContent.includes('握手成功')`), true)
  assert.equal(await c.evaluate('window.__apiKeyFault.requests'), 1)
  await c.evaluate(`document.querySelector('.feedback-confirm').click()`)
  record('handshake sends no request on save failure; mock response succeeds only after verified persistence')

  await setKey('')
  assert.equal(await credentialEquals(''), true)
  await coldStart()
  assert.equal(await c.evaluate(`${settings}.aiApiKey`), '')
  assert.equal(await c.evaluate(`${settings}.apiKeyStorageStatus`), 'empty')
  record('explicit clear persists across cold start')

  await c.evaluate(`window.Capacitor.Plugins.Preferences.set({key:'my_ai_settings',value:JSON.stringify({key:${JSON.stringify(marker)},model:'legacy-synthetic-model'})})`)
  await waitForLegacyFixtureOnDisk(marker)
  await coldStart()
  results.migrationObservation = await c.evaluate(`Promise.all([
    window.Capacitor.Plugins.Preferences.get({key:'my_ai_settings'}).then(x=>({legacyPresent:x.value!==null,legacyMatches:JSON.parse(x.value||'{}').key===${JSON.stringify(marker)}})),
    window.Capacitor.Plugins.NativeBiometric.getCredentials({server:${JSON.stringify(server)}}).then(x=>({nativeMatches:x.password===${JSON.stringify(marker)},nativeEmpty:x.password===''})).catch(()=>({nativeReadError:true}))
  ]).then(parts=>Object.assign({status:${settings}.apiKeyStorageStatus,loadedMatches:${settings}.aiApiKey===${JSON.stringify(marker)}},...parts))`)
  assert.equal(await c.evaluate(`${settings}.aiApiKey===${JSON.stringify(marker)}`), true)
  assert.equal(await credentialEquals(marker), true)
  assert.equal(await c.evaluate(`window.Capacitor.Plugins.Preferences.get({key:'my_ai_settings'}).then(x=>x.value===null)`), true)
  record('cold-start legacy migration writes verified native credentials before removing legacy preference')

  await openAI()
  await setKey('')
  await installFaults()
  await c.evaluate(`window.Capacitor.Plugins.Preferences.set({key:'my_ai_settings',value:JSON.stringify({key:${JSON.stringify(marker + '-MIGRATION')}})})`)
  await c.evaluate(`window.__apiKeyFault.write=true; ${settings}.loadSettings()`)
  assert.equal(await c.evaluate(`${settings}.apiKeyStorageStatus`), 'load-error')
  assert.equal(await c.evaluate(`window.Capacitor.Plugins.Preferences.get({key:'my_ai_settings'}).then(x=>JSON.parse(x.value||'{}').key===${JSON.stringify(marker + '-MIGRATION')})`), true)
  await c.evaluate('window.__apiKeyFault.write=false')
  await clickText('重试读取 API Key')
  await c.until(`${settings}.apiKeyStorageStatus==='saved'`)
  assert.equal(await credentialEquals(marker + '-MIGRATION'), true)
  record('failed native migration preserves legacy Key until explicit retry succeeds')

  await c.evaluate(uiSet('#ai-api-key', marker + '-QUICK-CLOSE'))
  adb(['shell', 'input', 'keyevent', '3'])
  await pause(250)
  await coldStart()
  assert.equal(await c.evaluate(`${settings}.aiApiKey===${JSON.stringify(marker + '-QUICK-CLOSE')}`), true)
  await openAI()
  await screenshot('native-saved.png')
  record('paste then immediate HOME and close retains Key after native background flush and cold start')
} catch (error) {
  results.error = error.message
  console.error(error)
  process.exitCode = 1
} finally {
  c?.close()
  try { adb(['forward', '--remove', `tcp:${port}`]); results.cleanup.forwardRemoved = true } catch {}
  if (user && user !== originalUser) {
    try {
      adb(['shell', 'am', 'switch-user', originalUser])
      for (let i = 0; i < 30 && adb(['shell', 'am', 'get-current-user']).trim() !== originalUser; i++) await pause(200)
      adb(['shell', 'am', 'stop-user', '-w', '-f', user])
      adb(['shell', 'pm', 'remove-user', user])
      results.cleanup.currentUser = adb(['shell', 'am', 'get-current-user']).trim()
      results.cleanup.testUserRemoved = !adb(['shell', 'pm', 'list', 'users']).includes(`UserInfo{${user}:`)
    } catch (error) { results.cleanup.error = error.message; process.exitCode = 1 }
  }
  fs.writeFileSync(new URL('native-results.json', import.meta.url), JSON.stringify(results, null, 2))
}
