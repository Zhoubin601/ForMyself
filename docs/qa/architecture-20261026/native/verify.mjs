// Playwright's Android API drives the real app WebView. Only the task-created emulator is eligible.
import { writeFile, readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const modulePath = process.env.FORMYSELF_PLAYWRIGHT_MODULE || 'playwright-core'
const { _android } = await import(modulePath)
const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const pkg = 'com.yubin.formyself'
let password = 'Synthetic-P6-native-only'
const storeExpression = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
const results = { pageErrors: [] }
const devices = await _android.devices({ omitDriverInstall: true })
const device = devices.find(d => d.serial() === (process.env.FORMYSELF_DEVICE_SERIAL || 'emulator-5554'))
if (!device || !device.serial().startsWith('emulator-')) throw new Error('Only the isolated task emulator is supported')
device.setDefaultTimeout(120000)
const files = await readdir(resolve(root, 'dist/assets'))
const runtimeAsset = files.find(name => name.startsWith('fullBackupRuntime-') && name.endsWith('.js'))
const settingsAsset = files.find(name => name.startsWith('settings-') && name.endsWith('.js'))
if (!runtimeAsset || !settingsAsset) throw new Error('Missing matching production build')
const evaluate = (page, body) => page.evaluate(`(async () => { const stores = ${storeExpression}; ${body} })()`)
const waitReady = page => page.waitForFunction(`() => { const s=${storeExpression}; return ['weight','debt','mood','schedule','todo'].every(k=>s.get(k)?.isDataLoaded) }`, null, { timeout:120000 })
const waitRestoreIdle = page => page.waitForFunction(async asset => {
  const entry = await import('/assets/'+asset)
  const state = Object.values(entry).find(x => x && Object.hasOwn(x,'blocked') && Object.hasOwn(x,'busy') && Object.hasOwn(x,'syncError'))
  if (!state) throw Error('Missing actual restore state')
  return !state.blocked && !state.busy
}, settingsAsset, { polling:250 })
const attach = async () => {
  console.log('Attaching app WebView')
  await device.shell(`am start -n ${pkg}/.MainActivity`)
  const view = await device.webView({ pkg })
  const page = await view.page()
  page.setDefaultTimeout(120000)
  page.on('pageerror', error => results.pageErrors.push(error.message))
  await page.route('https://synthetic.invalid/**', route => route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'合成回复：原生验证已收到消息。'}}]}) }))
  await page.waitForFunction("document.querySelector('#app')?.__vue_app__", null, {timeout:120000})
  return page
}
const coldStart = async () => {
  await device.shell(`am force-stop ${pkg}`)
  return attach()
}
const verifyIdentity = async page => {
  if (await page.locator('.lock-screen input').isVisible()) {
    await page.locator('.lock-screen input').fill(password); await page.locator('.lock-btn').click()
  } else if (await page.getByRole('button',{name:'验证并重试恢复',exact:true}).isVisible()) {
    await page.getByRole('button',{name:'验证并重试恢复',exact:true}).click()
    await page.locator('.feedback-input').fill(password)
    await page.getByRole('button',{name:'验证',exact:true}).click()
  }
  await waitReady(page)
}
const loadRuntime = page => evaluate(page, `const module=await import('/assets/${runtimeAsset}'); window.__qaRuntime=Object.values(module).find(x=>typeof x==='function')(); return true;`)
try {
  results.deviceSerial = device.serial()
  results.scriptSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')
  results.apkSha256 = createHash('sha256').update(await readFile(resolve(root,'android/app/build/outputs/apk/debug/app-debug.apk'))).digest('hex')
  results.api = (await device.shell('getprop ro.build.version.sdk')).toString().trim()
  results.testWebViewFlags = (await device.shell('cat /data/local/tmp/webview-command-line 2>/dev/null')).toString().trim()
  results.webview = (await device.shell('dumpsys webviewupdate')).toString().match(/Current WebView package[^\n]+/)?.[0] || 'see raw device diagnostics'
  // This emulator/app was created by the task; no real device or existing user profile is cleared.
  await device.shell(`pm clear ${pkg}`)
  if (Number(results.api) >= 33) await device.shell(`pm grant ${pkg} android.permission.POST_NOTIFICATIONS`)
  let page = await attach()
  console.log('App initialized')
  await verifyIdentity(page); results.initialization = true
  await evaluate(page, `const s=stores.get('settings'); s.aiProviderUrl='https://synthetic.invalid'; s.aiApiKey='synthetic-native-key-only'; s.aiModel='synthetic'; await s.saveAiSettings();
    await stores.get('weight').restoreWeightRecords([{id:'native-original',date:'2026-10-26',weight:65}]); await s.updateRequireAppUnlock(false); await s.flushPendingSettingsWrites(); return true;`)
  page=await coldStart(); await waitReady(page)
  results.optionalEntryColdStart = await evaluate(page, `return !stores.get('auth').isLocked && !stores.get('auth').savedMasterPwd && Object.values(stores.get('protectedAccess').status).every(s=>s==='idle');`)
  results.apiKeyColdStart = await evaluate(page,"return stores.get('settings').aiApiKey==='synthetic-native-key-only';")
  console.log('Cold start and credentials checked')
  await evaluate(page,"stores.get('settings').switchView('passwords'); return true;")
  await page.locator('.feedback-input').fill(password); await page.getByRole('button',{name:'验证',exact:true}).click()
  await page.waitForFunction(`() => ${storeExpression}.get('protectedAccess').status.passwords==='ready'`)
  results.onlyRequestedModuleLoaded = await evaluate(page,"return stores.get('protectedAccess').status.chat==='idle';")
  await page.getByRole('button',{name:'添加',exact:true}).click()
  await page.getByPlaceholder('例如：微信、GitHub',{exact:true}).fill('合成原生密码记录')
  await page.getByPlaceholder('手机号、邮箱或用户名',{exact:true}).fill('synthetic-account')
  await page.getByPlaceholder('输入密码',{exact:true}).fill('Synthetic-vault-content-only')
  await page.getByRole('button',{name:'保存记录',exact:true}).click()
  await page.waitForFunction(`() => ${storeExpression}.get('passwordVault').records.some(r=>r.appName==='合成原生密码记录')`)
  await evaluate(page,"await stores.get('passwordVault').flush();return true;")
  results.vaultUiCreate = true
  await page.screenshot({path:resolve(directory,'native-vault.png')})
  await evaluate(page,"stores.get('settings').switchView('chat'); return true;")
  await page.waitForSelector('.chat-composer textarea')
  await page.locator('.chat-composer textarea').fill('合成原生测试消息'); await page.getByRole('button',{name:'发送消息',exact:true}).click()
  await page.waitForFunction(`() => { const m=${storeExpression}.get('chat').messages,u=m.filter(x=>x.role==='user'&&x.content==='合成原生测试消息').slice(-1)[0];return u&&m.some(x=>x.role==='assistant'&&x.createdAt>u.createdAt&&x.status==='complete') }`, null,{timeout:120000})
  results.chatSendReply = true; await page.screenshot({path:resolve(directory,'native-chat.png')})
  console.log('Chat checked')
  const taskId = await evaluate(page,"await stores.get('todo').add({title:'合成深链待办',startDate:'2026-10-26',recurrence:{type:'none'}});return stores.get('todo').snapshot.tasks.find(t=>t.title==='合成深链待办').id;")
  await device.shell(`am start -n ${pkg}/.MainActivity -a android.intent.action.VIEW -d 'formyself://open/todo?item=${taskId}&date=2026-10-26'`)
  await page.waitForFunction(`() => ${storeExpression}.get('settings').currentView==='todo'`)
  results.nativeDeepLink = await evaluate(page,`return stores.get('settings').todoTarget.item==='${taskId}';`)
  await evaluate(page,"stores.get('settings').autoLockDelaySeconds=0;return true;")
  await device.shell('input keyevent 3')
  await device.shell(`am start -n ${pkg}/.MainActivity`)
  await page.waitForFunction(`() => {const s=${storeExpression};return Object.values(s.get('protectedAccess').status).every(x=>x==='idle')&&!s.get('auth').savedMasterPwd&&s.get('chat').messages.length===0}`,null,{polling:500})
  results.backgroundReleasesSensitiveData = await evaluate(page,"return !stores.get('auth').isLocked&&!stores.get('auth').savedMasterPwd&&stores.get('chat').messages.length===0;")
  await evaluate(page,"stores.get('settings').switchView('chat');return true;")
  await page.locator('.feedback-input').fill(password)
  await page.getByRole('button',{name:'验证',exact:true}).click()
  await page.waitForSelector('.chat-composer textarea')
  await loadRuntime(page)
  await evaluate(page,`await stores.get('protectedAccess').ensureModules(); const target=window.__qaRuntime.createFullBackupSnapshot();target.data.weight=[{id:'native-partial',date:'2026-10-26',weight:60}];
    const participant=window.__qaRuntime.registry.get('weight'),original=participant.restore;
    participant.restore=async part=>{await original(part);window.__qaPartial=true;await new Promise(()=>{});};
    void window.__qaRuntime.restore(target,'${password}');return true;`)
  await page.waitForFunction('window.__qaPartial===true')
  page=await coldStart(); await page.getByRole('button',{name:'验证并重试恢复',exact:true}).waitFor()
  results.pendingRestoreBlocksColdStart = await evaluate(page,"return !stores.get('auth').savedMasterPwd;")
  await verifyIdentity(page)
  await page.waitForFunction(`() => ${storeExpression}.get('weight').weightRecords[0]?.id==='native-original'`)
  await waitRestoreIdle(page)
  results.uncommittedForceStopRollback = true
  console.log('Uncommitted rollback checked')
  await loadRuntime(page)
  await evaluate(page,`const entry=await import(document.querySelector('script[type=module]').src);
    const journal=Object.values(entry).find(x=>x&&Object.hasOwn(x,'inspect')&&Object.hasOwn(x,'commit')&&Object.hasOwn(x,'prepare'));
    if(!journal)throw Error('Missing actual journal');
    const target=window.__qaRuntime.createFullBackupSnapshot();target.data.weight=[{id:'native-committed',date:'2026-10-26',weight:61}];
    journal.clear=async()=>{throw Error('synthetic cleanup failure')};
    try{await window.__qaRuntime.restore(target,'${password}')}catch{}
    if(!(await journal.inspect()).committed)throw Error('Missing durable commit');return true;`)
  page=await coldStart(); await page.getByRole('button',{name:'验证并重试恢复',exact:true}).waitFor(); await verifyIdentity(page)
  await page.waitForFunction(`() => ${storeExpression}.get('weight').weightRecords[0]?.id==='native-committed'`)
  await waitRestoreIdle(page)
  results.committedForceStopRetainsTarget = true
  console.log('Committed restore checked')
  await evaluate(page,"stores.get('settings').openGeneralSettingsSection('security');return true;")
  await page.getByRole('button',{name:'传统密码验证修改',exact:true}).click()
  await page.getByPlaceholder('原主密码',{exact:true}).fill(password)
  const nextPassword = 'Synthetic-P6-native-changed'
  await page.getByPlaceholder('新主密码',{exact:true}).fill(nextPassword)
  await page.getByPlaceholder('确认新主密码',{exact:true}).fill(nextPassword)
  await page.getByRole('button',{name:'保存',exact:true}).click()
  await page.getByPlaceholder('原主密码',{exact:true}).waitFor({state:'hidden'})
  await page.getByText(/主密码已重设|主密码已更新；生物/).waitFor()
  password = nextPassword
  page = await coldStart(); await waitReady(page)
  await evaluate(page,"stores.get('settings').switchView('chat');return true;")
  await page.locator('.feedback-input').fill(password)
  await page.getByRole('button',{name:'验证',exact:true}).click()
  await page.waitForSelector('.chat-composer textarea')
  results.passwordChangeColdStartPreservesChat = await evaluate(page,"return stores.get('chat').messages.some(m=>m.role==='user'&&m.content==='合成原生测试消息');")
  results.apiKeyAfterPasswordChange = await evaluate(page,"return stores.get('settings').aiApiKey==='synthetic-native-key-only';")
  await evaluate(page,"stores.get('settings').switchView('passwords');return true;")
  await page.waitForFunction(`() => ${storeExpression}.get('protectedAccess').status.passwords==='ready'`)
  results.passwordChangeColdStartPreservesVault = await evaluate(page,"return stores.get('passwordVault').records.some(r=>r.appName==='合成原生密码记录'&&r.password==='Synthetic-vault-content-only');")
  await evaluate(page,"stores.get('settings').switchView('home');return true;")
  await page.screenshot({path:resolve(directory,'native-home.png')})
  results.measurements = await page.evaluate("performance.getEntriesByType('measure').map(x=>({name:x.name,duration:x.duration}))")
  results.executedAt = new Date().toISOString()
  if(Object.entries(results).some(([,value])=>value===false))throw Error('Native acceptance failed')
  if(results.pageErrors.length)throw Error('Native page errors: '+results.pageErrors.join('; '))
  await writeFile(resolve(directory,'playwright-results.json'),JSON.stringify(results,null,2)+'\n')
  console.log(JSON.stringify(results))
} catch(error) {
  results.error=String(error)
  await writeFile(resolve(directory,'playwright-attempt.json'),JSON.stringify(results,null,2)+'\n')
  throw error
} finally { await device.close() }
