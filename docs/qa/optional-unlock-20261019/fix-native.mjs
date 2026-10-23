import fs from 'node:fs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import CryptoJS from 'crypto-js'
import crypto from 'node:crypto'
import { connect, pause, store, uiSet } from './recheck-cdp.mjs'

const adb = args => execFileSync('E:/Android/Sdk/platform-tools/adb.exe', ['-s', 'emulator-5586', ...args], { encoding: 'utf8', windowsHide: true })
const results = { date: '2026-10-19', artifact: '20261019-ForMyself-optional-unlock-v2-debug.apk', tests: [], errors: [], cleanup: {} }
const record = (name, details = {}) => { results.tests.push({ name, passed: true, ...details }); console.log('PASS ' + name) }
const password = 'Independent-Synthetic-Recheck'
let user, c, backupCipher
const port = '9366'
const click = selector => c.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
const shot = async name => {
  const r = await c.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(new URL(name, import.meta.url), Buffer.from(r.data, 'base64'))
}
const launch = async () => {
  for (let i = 0; i < 30; i++) {
    try { adb(['shell', 'am', 'start', '--user', user, '-n', 'com.yubin.formyself/.MainActivity']); return } catch { await pause(500) }
  }
  throw new Error('Test-user activity did not become available')
}
const reconnect = async () => {
  c?.close()
  for (let i = 0; i < 40; i++) {
    try {
      const line = adb(['shell', 'ps', '-A', '-o', 'USER,PID,NAME']).split('\n').find(x => x.startsWith(`u${user}_`) && / com\.yubin\.formyself\s*$/.test(x))
      if (line) {
        adb(['forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${line.trim().split(/\s+/)[1]}`])
        process.env.QA_CDP_PORT = port
        c = await connect()
        await c.until(`!!${store('settings')}?.isDataLoaded && !!${store('auth')}?.isDataLoaded`)
        return
      }
    } catch {}
    await pause(250)
  }
  throw new Error('Native reconnection failed')
}
const coldStart = async () => {
  c.close()
  adb(['shell', 'am', 'force-stop', '--user', user, 'com.yubin.formyself'])
  await launch()
  await reconnect()
}
const enterPassword = async (value = password) => {
  await c.until(`!!document.querySelector('.feedback-input[type=password]')`)
  await c.evaluate(uiSet('.feedback-input', value))
  await click('.feedback-confirm')
}
const chooseBackup = async text => {
  await c.evaluate(`${store('settings')}.openGeneralSettingsSection('data')`)
  await c.until(`!!document.querySelector('.backup-type-button')`)
  await click('.backup-type-button')
  await c.until(`!!document.querySelector('.settings-picker')`)
  await c.evaluate(`Array.from(document.querySelectorAll('.settings-picker > button')).find(x=>x.textContent.includes(${JSON.stringify(text)})).click()`)
}
const cancelShare = async () => {
  let focus = ''
  for (let i = 0; i < 60; i++) {
    focus = adb(['shell', 'dumpsys', 'window']).split('\n').find(x=>x.includes('mCurrentFocus')) || ''
    if (/Chooser|Resolver|Sharesheet/i.test(focus)) break
    if (await c.evaluate(`!!document.querySelector('.feedback-overlay')`)) break
    await pause(100)
  }
  results.shareFocus = focus
  if (/Chooser|Resolver|Sharesheet/i.test(focus)) adb(['shell', 'input', 'keyevent', '4'])
  await pause(500)
  if (await c.evaluate(`!!document.querySelector('.feedback-overlay')`)) await click('.feedback-confirm')
}
const readBackup = async label => {
  await c.evaluate(`Array.from(document.querySelectorAll('.ios-list button')).find(x=>x.textContent.includes('导出')).click()`)
  let entry
  for (let i = 0; i < 50; i++) {
    const list = await c.evaluate(`window.Capacitor.Plugins.Filesystem.readdir({directory:'CACHE',path:''}).then(r=>r.files.map(x=>x.name))`)
    entry = list.find(x => x.includes(label) && x.endsWith('.json'))
    if (entry) break
    await pause(100)
  }
  assert.ok(entry, 'Export must create an actual encrypted cache file')
  const cipher = await c.evaluate(`window.Capacitor.Plugins.Filesystem.readFile({directory:'CACHE',path:${JSON.stringify(entry)},encoding:'utf8'}).then(r=>r.data)`)
  const data = JSON.parse(CryptoJS.AES.decrypt(cipher, password).toString(CryptoJS.enc.Utf8))
  // Close the Android share sheet without sending the file anywhere.
  await cancelShare()
  return { cipher, data }
}

const installFaults = () => c.evaluate(`(()=>{
  window.__restoreFixBridge?.();
  const cap=window.Capacitor, original=cap.nativePromise;
  window.__fixFault={key:'',remaining:0,fileWrites:false,hits:0};
  cap.nativePromise=function(plugin,method,options){
    const f=window.__fixFault;
    if(plugin==='Preferences'&&method==='set'&&options?.key===f.key&&f.remaining>0){f.remaining--;f.hits++;return Promise.reject(new Error('INJECTED_NATIVE_PREFERENCE_FAILURE'))}
    if(plugin==='Filesystem'&&method==='writeFile'&&options?.path==='formyself/warm-home-v1.tmp'&&f.fileWrites){f.hits++;return Promise.reject(new Error('INJECTED_NATIVE_FILESYSTEM_FAILURE'))}
    return original.call(cap,plugin,method,options);
  };
  window.__restoreFixBridge=()=>{cap.nativePromise=original};
})()`)
const fillPasswordChange = async (nextPassword) => {
  await c.evaluate(`${store('settings')}.openGeneralSettingsSection('security')`)
  await c.until(`!!document.querySelector('#require-app-unlock')`)
  if(!await c.evaluate(`!!document.querySelector('input[placeholder="原主密码"]')`)) {
    await c.evaluate(`Array.from(document.querySelectorAll('.list-item')).find(x=>x.textContent.includes('传统密码验证修改')).click()`)
  }
  await c.evaluate(uiSet('input[placeholder="原主密码"]',password))
  await c.evaluate(uiSet('input[placeholder="新主密码"]',nextPassword))
  await c.evaluate(uiSet('input[placeholder="确认新主密码"]',nextPassword))
  await c.evaluate(`Array.from(document.querySelectorAll('.store-utility-card .button-primary')).find(x=>x.textContent.includes('保存')).click()`)
}

try {
  assert.equal(adb(['shell', 'am', 'get-current-user']).trim(), '0')
  const installedPath = adb(['shell', 'pm', 'path', 'com.yubin.formyself']).trim().replace('package:', '')
  const hash = adb(['shell', 'sha256sum', installedPath]).split(/\s/)[0].toUpperCase()
  assert.equal(hash, crypto.createHash('sha256').update(fs.readFileSync('android/app/build/outputs/apk/debug/app-debug.apk')).digest('hex').toUpperCase())
  record('installed package exactly matches delivered APK', { sha256: hash })
  user = adb(['shell', 'pm', 'create-user', 'Codex-Unlock-Fix-QA']).match(/id (\d+)/)?.[1]
  assert.ok(user)
  results.user = user
  adb(['shell', 'settings', '--user', user, 'put', 'secure', 'user_setup_complete', '1'])
  adb(['shell', 'settings', '--user', user, 'put', 'system', 'screen_off_timeout', '1800000'])
  adb(['shell', 'am', 'switch-user', user])
  for (let i = 0; i < 50 && adb(['shell', 'am', 'get-current-user']).trim() !== user; i++) await pause(200)
  await pause(1000)
  adb(['shell', 'cmd', 'package', 'install-existing', '--user', user, '--wait', 'com.yubin.formyself'])
  adb(['shell', 'input', 'keyevent', '224'])
  await pause(600)
  adb(['shell', 'wm', 'dismiss-keyguard'])
  await launch()
  await reconnect()
  assert.equal(await c.evaluate(`${store('auth')}.hasMasterPassword`), false)
  await c.evaluate(uiSet('.lock-screen input', password))
  await click('.lock-btn')
  await c.until(`${store('protectedAccess')}.status.passwords === 'ready' && ${store('protectedAccess')}.status.chat === 'ready'`)
  record('fresh installation sets a master password and unified mode decrypts both modules')
  await c.evaluate(`${store('passwordVault')}.addRecord({appName:'Independent Synthetic Vault',account:'test',password:'synthetic-secret',category:'QA'}); ${store('chat')}.appendMessage('user','Independent synthetic chat')`)
  await c.evaluate(`${store('chat')}.flush()`)
  await c.evaluate(`${store('settings')}.openGeneralSettingsSection('security')`)
  await c.until(`!!document.querySelector('#require-app-unlock')`)
  await click('#require-app-unlock')
  await enterPassword()
  await c.until(`${store('settings')}.requireAppUnlock === false`)
  if (!process.argv.includes('--backup-only')) {
  await coldStart()
  assert.equal(await c.evaluate(`${store('auth')}.isLocked`), false)
  assert.equal(await c.evaluate(`${store('auth')}.savedMasterPwd`), '')
  assert.deepEqual(await c.evaluate(`JSON.parse(JSON.stringify(${store('protectedAccess')}.status))`), { passwords: 'idle', chat: 'idle' })
  record('mode 2 cold start enters home with no master password in memory and both modules idle')
  for (const view of ['todo', 'schedule', 'mood', 'weight', 'settings']) {
    await c.evaluate(`${store('settings')}.switchView('${view}')`)
    await pause(200)
  }
  assert.deepEqual(await c.evaluate(`JSON.parse(JSON.stringify(${store('protectedAccess')}.status))`), { passwords: 'idle', chat: 'idle' })
  record('ordinary pages do not decrypt either module')
  await c.evaluate(`${store('settings')}.switchView('passwords')`)
  await enterPassword()
  await c.until(`!!document.querySelector('.vault-view')`)
  assert.equal(await c.evaluate(`${store('protectedAccess')}.status.chat`), 'idle')
  assert.equal(await c.evaluate(`${store('passwordVault')}.records[0].appName`), 'Independent Synthetic Vault')
  record('vault independently decrypts the persisted synthetic record')
  await c.evaluate(`${store('settings')}.switchView('chat')`)
  await c.until(`!!document.querySelector('.warm-home')`)
  assert.equal(await c.evaluate(`${store('chat')}.messages.some(x=>x.content==='Independent synthetic chat')`), true)
  assert.equal(await c.evaluate(`!!document.querySelector('.feedback-overlay')`), false)
  record('chat loads through the existing authenticated session')
  await c.evaluate(`window.__reviewLifecycle=[]; window.Capacitor.Plugins.App.addListener('appStateChange', state=>window.__reviewLifecycle.push({state,at:Date.now()}))`)
  adb(['shell', 'input', 'keyevent', '3'])
  await pause(800)
  results.backgroundBeforeResume = {
    focus: adb(['shell', 'dumpsys', 'window']).split('\n').find(x=>x.includes('mCurrentFocus')),
    activity: await c.evaluate(`window.Capacitor.Plugins.App.getState()`)
  }
  await launch()
  await pause(500)
  results.backgroundAfterResume = await c.evaluate(`({events:window.__reviewLifecycle,mode:${store('settings')}.requireAppUnlock,delay:${store('settings')}.autoLockDelaySeconds,sessionRevision:${store('auth')}.sessionRevision,hasPassword:!!${store('auth')}.savedMasterPwd,status:JSON.parse(JSON.stringify(${store('protectedAccess')}.status)),messageCount:${store('chat')}.messages.length})`)
  if (results.backgroundAfterResume.status.chat === 'idle') {
    assert.equal(await c.evaluate(`${store('auth')}.isLocked`), false)
    assert.equal(await c.evaluate(`${store('chat')}.messages.length`), 0)
    record('actual Android background lifecycle releases sensitive data while ordinary pages remain accessible')
  } else {
    results.errors.push('Android background lifecycle did not expire the protected session; see background diagnostics')
  }
  }

  // Exercise the real UI and production transaction; inject errors at the native storage boundary only.
  await installFaults()
  for(const key of ['my_password_vault_categories_encrypted','my_password_vault_encrypted']) {
    await c.evaluate(`window.__fixFault.key=${JSON.stringify(key)};window.__fixFault.remaining=1;window.__fixFault.hits=0`)
    await fillPasswordChange('Synthetic-Native-Attempted-New')
    await c.until(`document.querySelector('.feedback-message')?.textContent.includes('主密码修改失败')`)
    assert.equal(await c.evaluate(`window.__fixFault.hits`),1)
    assert.equal(await c.evaluate(`${store('protectedAccess')}.recoveryRequired`),false)
    await click('.feedback-confirm')
    const ciphertexts=await c.evaluate(`Promise.all(['my_password_vault_encrypted','my_password_vault_categories_encrypted'].map(key=>window.Capacitor.Plugins.Preferences.get({key}).then(x=>x.value)))`)
    const records=JSON.parse(CryptoJS.AES.decrypt(ciphertexts[0],password).toString(CryptoJS.enc.Utf8))
    const categories=JSON.parse(CryptoJS.AES.decrypt(ciphertexts[1],password).toString(CryptoJS.enc.Utf8))
    assert.equal(records[0].appName,'Independent Synthetic Vault');assert.ok(categories.includes('QA'))
    assert.equal(await c.evaluate(`${store('auth')}.savedMasterPwd`),password)
    record('native password-change failure rolls both ciphertexts back to original password',{failedKey:key})
  }
  await coldStart()
  await c.evaluate(`${store('settings')}.switchView('passwords')`)
  await enterPassword()
  await c.until(`!!document.querySelector('.vault-view')`)
  assert.equal(await c.evaluate(`${store('passwordVault')}.records[0].appName`),'Independent Synthetic Vault')
  record('rolled-back vault remains readable after actual process restart')
  await c.evaluate(`${store('settings')}.switchView('chat')`)
  await c.until(`!!document.querySelector('.warm-home')`)
  await installFaults()
  await c.evaluate(`window.__fixFault.fileWrites=true;${store('chat')}.appendMessage('user','Synthetic native failed-save recovery');${store('chat')}.flush().catch(()=>{})`)
  await c.until(`!!${store('chat')}.saveError && !!document.querySelector('.chat-warning[role=alert]')`)
  await shot('fix-native-save-warning.png')
  const journal=await c.evaluate(`window.Capacitor.Plugins.Preferences.get({key:'my_chat_recovery_encrypted_v1'}).then(x=>x.value)`)
  assert.ok(journal && !journal.includes('Synthetic native failed-save recovery') && !journal.includes(password))
  record('native failed chat save displays warning and journals encrypted recovery data')
  adb(['shell','input','keyevent','3']);await pause(800);await launch()
  await c.until(`${store('protectedAccess')}.status.chat==='idle'`)
  assert.equal(await c.evaluate(`${store('auth')}.savedMasterPwd`),'')
  assert.equal(await c.evaluate(`${store('chat')}.messages.length`),0)
  record('failed-save lock still clears plaintext and master password')
  await coldStart()
  await c.evaluate(`${store('settings')}.switchView('chat')`)
  await enterPassword()
  await c.until(`!!document.querySelector('.warm-home')`)
  assert.equal(await c.evaluate(`${store('chat')}.messages.some(x=>x.content==='Synthetic native failed-save recovery')`),true)
  assert.equal(await c.evaluate(`${store('chat')}.saveError`),'')
  const restoredFile=await c.evaluate(`window.Capacitor.Plugins.Filesystem.readFile({path:'formyself/warm-home-v1.enc',directory:'DATA',encoding:'utf8'}).then(x=>x.data)`)
  assert.ok(JSON.parse(CryptoJS.AES.decrypt(restoredFile,password).toString(CryptoJS.enc.Utf8)).messages.some(x=>x.content==='Synthetic native failed-save recovery'))
  record('actual process restart restores failed-save message from journal and saves it successfully')
  await shot('fix-native-recovered-chat.png')
  await installFaults()
  await c.evaluate(`window.__fixFault.fileWrites=true;${store('chat')}.appendMessage('user','Synthetic native retry button');${store('chat')}.flush().catch(()=>{})`)
  await c.until(`!!document.querySelector('.chat-warning[role=alert] button')`)
  await click('.chat-warning[role=alert] button')
  await c.until(`document.querySelector('.chat-warning[role=alert] button')?.textContent.includes('重试保存')`)
  assert.notEqual(await c.evaluate(`${store('chat')}.saveError`),'')
  await c.evaluate(`window.__fixFault.fileWrites=false`)
  await click('.chat-warning[role=alert] button')
  await c.until(`!${store('chat')}.saveError && !document.querySelector('.chat-warning[role=alert]')`)
  record('native retry button keeps warning on failure and clears it after successful save')

  await chooseBackup('完整数据')
  await c.evaluate(`Array.from(document.querySelectorAll('.ios-list button')).find(x=>x.textContent.includes('导出')).click()`)
  if (!await c.evaluate(`!!${store('auth')}.savedMasterPwd`)) await enterPassword()
  // The real export is in progress. Wait for the native cache file and inspect its bytes.
  let files = [], fullFile
  for (let i = 0; i < 80; i++) {
    files = await c.evaluate(`window.Capacitor.Plugins.Filesystem.readdir({directory:'CACHE',path:''}).then(r=>r.files.map(x=>x.name))`)
    fullFile = files.find(x=>x.includes('Full') && x.endsWith('.json'))
    if (fullFile) break
    await pause(150)
  }
  assert.ok(fullFile, JSON.stringify(files))
  backupCipher = await c.evaluate(`window.Capacitor.Plugins.Filesystem.readFile({directory:'CACHE',path:${JSON.stringify(fullFile)},encoding:'utf8'}).then(r=>r.data)`)
  const full = JSON.parse(CryptoJS.AES.decrypt(backupCipher, password).toString(CryptoJS.enc.Utf8))
  assert.equal(full.version, 12)
  assert.equal(full.settings.requireAppUnlock, false)
  assert.equal(full.data.passwords[0].appName, 'Independent Synthetic Vault')
  assert.equal(full.data.chat.messages.some(x=>x.content==='Independent synthetic chat'), true)
  record('actual full export file decrypts and contains both modules plus the v12 setting')
  await cancelShare()
  await chooseBackup('密码库数据')
  const single = await readBackup('Passwords')
  assert.equal(single.data[0].appName, 'Independent Synthetic Vault')
  record('actual single-vault export file decrypts and contains the saved record')
  await c.evaluate(`${store('passwordVault')}.replaceRecords([])`)
  await c.evaluate(`(()=>{const input=document.querySelector('input[type=file][accept=".json"]');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(single.cipher)}],'synthetic-import.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await c.until(`!!document.querySelector('.feedback-overlay')`)
  await click('.feedback-confirm')
  await c.until(`${store('passwordVault')}.records.some(x=>x.appName==='Independent Synthetic Vault')`)
  record('actual FileReader import and confirmation restore the single-vault backup')
  await chooseBackup('完整数据')
  await c.evaluate(`${store('chat')}.clearMessages(); ${store('chat')}.flush()`)
  await c.evaluate(`(()=>{const input=document.querySelector('input[type=file][accept=".json"]');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(backupCipher)}],'synthetic-full.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await c.until(`!!document.querySelector('.feedback-overlay')`)
  await click('.feedback-confirm')
  await c.until(`${store('chat')}.messages.some(x=>x.content==='Independent synthetic chat')`)
  record('actual complete backup import restores the deleted chat record')
  await fillPasswordChange('Synthetic-Native-Final-New')
  await c.until(`${store('auth')}.savedMasterPwd==='Synthetic-Native-Final-New'`)
  assert.equal(await c.evaluate(`${store('auth')}.unlockWithPassword(${JSON.stringify(password)},{unlockApp:false})`),false)
  assert.equal(await c.evaluate(`${store('auth')}.unlockWithPassword('Synthetic-Native-Final-New',{unlockApp:false})`),true)
  record('successful real UI password change rejects old password and accepts new password')
  await c.evaluate(`${store('settings')}.openGeneralSettingsSection('security')`)
  await c.until(`!!document.querySelector('#require-app-unlock')`)
  await click('#require-app-unlock')
  await c.until(`${store('settings')}.requireAppUnlock === true`)
  await coldStart()
  assert.equal(await c.evaluate(`${store('auth')}.isLocked`), true)
  await shot('fix-native-lock.png')
  record('re-enabled unified mode restores the native cold-start lock screen')
  results.runtimeErrors = c.events.filter(x=>x.method==='Runtime.exceptionThrown').map(x=>x.params.exceptionDetails.text)
} catch (error) {
  results.errors.push(error.stack)
  try {
    results.failureState = await c.evaluate(`({body:document.body.innerText.slice(-1500),backupType:document.querySelector('.settings-container')?.__vueParentComponent?.setupState.context?.exportDataType,status:JSON.parse(JSON.stringify(${store('protectedAccess')}?.status)),hasPassword:!!${store('auth')}?.savedMasterPwd})`)
    results.failureFocus = adb(['shell','dumpsys','window']).split('\n').find(x=>x.includes('mCurrentFocus'))
  } catch {}
  console.error(error.stack)
  process.exitCode = 1
} finally {
  c?.close()
  if (user) {
    try {
      adb(['shell', 'am', 'switch-user', '0'])
      for (let i = 0; i < 50 && adb(['shell', 'am', 'get-current-user']).trim() !== '0'; i++) await pause(200)
      results.cleanup.currentUser = adb(['shell', 'am', 'get-current-user']).trim()
      adb(['shell', 'am', 'stop-user', '-w', '-f', user])
      results.cleanup.removedUser = adb(['shell', 'pm', 'remove-user', user]).trim()
    } catch (error) { results.cleanup.error = error.message }
  }
  try { adb(['forward', '--remove', `tcp:${port}`]) } catch {}
  results.cleanup.forwarding = adb(['forward', '--list']).trim()
  fs.writeFileSync(new URL('fix-native-results.json', import.meta.url), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
}
