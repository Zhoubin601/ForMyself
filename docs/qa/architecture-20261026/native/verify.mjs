// Playwright's Android API drives the real app WebView. Only the task-created emulator is eligible.
import { writeFile, readdir, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { waitForStoreState } from './waitForStoreState.mjs'
const modulePath = process.env.FORMYSELF_PLAYWRIGHT_MODULE || 'playwright-core'
const { _android, chromium } = await import(modulePath)
const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const pkg = 'com.yubin.formyself'
let password = 'Synthetic-P6-native-only'
const storeExpression = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
const results = { pageErrors: [], startedAt: new Date().toISOString() }
let activePage
const executeFile = promisify(execFile)
const adb = process.env.ANDROID_HOME ? resolve(process.env.ANDROID_HOME,'platform-tools/adb') : 'adb'
const forwardPorts = []
const browserConnections = []
const bounded = async (operation, label, timeout=60000) => {
  let timer
  try {
    return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out: '+label)),timeout)})])
  } finally { clearTimeout(timer) }
}
const shell = command => bounded(device.shell(command),'ADB '+command)
const checkpoint = async label => {
  console.log(label,JSON.stringify(results))
  await writeFile(resolve(directory,'playwright-progress.json'),JSON.stringify({...results,checkpoint:label},null,2)+'\n')
  if (Object.values(results).some(value=>value===false)) throw Error('Native acceptance failed at '+label)
}
const devices = await _android.devices()
const device = devices.find(d => d.serial() === (process.env.FORMYSELF_DEVICE_SERIAL || 'emulator-5554'))
if (!device || !device.serial().startsWith('emulator-')) throw new Error('Only the isolated task emulator is supported')
device.setDefaultTimeout(120000)
const files = await readdir(resolve(root, 'dist/assets'))
const runtimeAsset = files.find(name => name.startsWith('fullBackupRuntime-') && name.endsWith('.js'))
const settingsAsset = files.find(name => name.startsWith('settings-') && name.endsWith('.js'))
if (!runtimeAsset || !settingsAsset) throw new Error('Missing matching production build')
const evaluate = (page, body) => bounded(page.evaluate(`(async () => { const stores = ${storeExpression}; ${body} })()`),'WebView evaluate',90000)
const waitState = (page, body, options) => waitForStoreState(page,storeExpression,body,options)
const waitReady = page => waitState(page,"return ['settings','weight','debt','mood','schedule','todo'].every(k=>stores.get(k)?.isDataLoaded)")
const waitRestoreIdle = page => page.waitForFunction(async asset => {
  const entry = await import('/assets/'+asset)
  const state = Object.values(entry).find(x => x && Object.hasOwn(x,'blocked') && Object.hasOwn(x,'busy') && Object.hasOwn(x,'syncError'))
  if (!state) throw Error('Missing actual restore state')
  return !state.blocked && !state.busy
}, settingsAsset, { polling:250 })
const attach = async () => {
  console.log('Attaching app WebView')
  await shell('input keyevent KEYCODE_WAKEUP')
  await shell('wm dismiss-keyguard')
  await shell(`am start -n ${pkg}/.MainActivity`)
  const view = await device.webView({ pkg })
  const { stdout } = await executeFile(adb,['-s',device.serial(),'forward','tcp:0',`localabstract:webview_devtools_remote_${view.pid()}`])
  const port = stdout.trim()
  if (!/^\d+$/.test(port)) throw Error('Invalid isolated ADB forwarding port')
  forwardPorts.push(port)
  const browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}/devtools/browser`,{timeout:120000,noDefaults:true})
  browserConnections.push(browser)
  const context = browser.contexts()[0]
  const page = context.pages()[0] || await context.waitForEvent('page')
  activePage = page
  page.setDefaultTimeout(120000)
  await page.emulateMedia({reducedMotion:'reduce'})
  page.on('pageerror', error => results.pageErrors.push(error.message))
  await page.route('https://synthetic.invalid/**', route => route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'合成回复：原生验证已收到消息。'}}]}) }))
  await page.waitForFunction("document.querySelector('#app')?.__vue_app__", null, {timeout:120000})
  return page
}
const coldStart = async () => {
  await shell(`am force-stop ${pkg}`)
  const deadline = Date.now()+20000
  while (device.webViews().some(view=>view.pkg()===pkg)) {
    if (Date.now()>deadline) throw Error('Previous process WebView was not removed after force-stop')
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  return attach()
}
const tapButton = async (page, name) => {
  name=name.trim()
  const button=page.getByRole('button',{name,exact:true})
  await button.waitFor({state:'visible'})
  await button.scrollIntoViewIfNeeded()
  if (!await button.isEnabled()) throw Error('Disabled native test button: '+name)
  const box=await button.boundingBox()
  if(!box)throw Error('No visible button bounds: '+name)
  const native=await bounded(device.info({pkg,clazz:'android.webkit.WebView'}),'Native WebView bounds',15000)
  const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}))
  const scaleX=native.bounds.width/viewport.width,scaleY=native.bounds.height/viewport.height
  if(Math.abs(scaleX-scaleY)>0.15)throw Error('Inconsistent WebView coordinate scale: '+JSON.stringify({native,viewport}))
  const point={x:Math.round(native.bounds.x+(box.x+box.width/2)*scaleX),y:Math.round(native.bounds.y+(box.y+box.height/2)*scaleY)}
  ;(results.uiTapTargets||=[]).push({name,point,webViewBounds:native.bounds,viewport})
  await bounded(device.input.tap(point),'Native button touch '+name,30000)
}
const captureNative = async name => {
  const png=await bounded(device.screenshot(),'Android display screenshot '+name,15000)
  await writeFile(resolve(directory,name),png)
  const {default:sharp}=await import('sharp')
  const {channels}=await sharp(png).stats()
  if(channels.slice(0,3).every(channel=>channel.max-channel.min<16))throw Error('Native screenshot contains no rendered UI: '+name)
  results.renderedScreenshotCount=(results.renderedScreenshotCount||0)+1
}
const verifyIdentity = async page => {
  if (await page.locator('.lock-screen input').isVisible()) {
    await page.locator('.lock-screen input').fill(password)
    await tapButton(page,await page.locator('.lock-btn').innerText())
  } else if (await page.getByRole('button',{name:'验证并重试恢复',exact:true}).isVisible()) {
    await tapButton(page,'验证并重试恢复')
    await page.locator('.feedback-input').fill(password)
    await tapButton(page,'验证')
  }
  await waitState(page,"return stores.get('auth').isDataLoaded&&!stores.get('auth').isLocked&&Boolean(stores.get('auth').savedMasterPwd)")
  await waitReady(page)
}
const verifyProtectedIdentity = async page => {
  const input = page.locator('.feedback-input')
  const retry = page.getByRole('button',{name:'验证并进入',exact:true})
  await input.or(retry).first().waitFor()
  if (!await input.isVisible()) await tapButton(page,'验证并进入')
  await input.fill(password)
  await tapButton(page,'验证')
}
const loadRuntime = page => evaluate(page, `const module=await import('/assets/${runtimeAsset}'); window.__qaRuntime=Object.values(module).find(x=>typeof x==='function')(); return true;`)
try {
  for (const name of ['playwright-results.json','playwright-attempt.json','playwright-progress.json','playwright-failure.png','native-home.png','native-chat.png','native-vault.png','android-display-failure.png']) await rm(resolve(directory,name),{force:true})
  results.deviceSerial = device.serial()
  results.uiInput = 'Playwright Android coordinate touch mapped from DOM button bounds to actual native WebView bounds; CDP filling/inspection and state assertions'
  results.webviewTransport = 'Isolated ADB forward + Playwright Chromium CDP'
  results.functionalTestDisplay = '480x800, density160, prefers-reduced-motion:reduce; browser QA separately uses normal motion'
  results.scriptSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')
  results.apkSha256 = createHash('sha256').update(await readFile(resolve(root,'android/app/build/outputs/apk/debug/app-debug.apk'))).digest('hex')
  results.api = (await shell('getprop ro.build.version.sdk')).toString().trim()
  results.testWebViewFlags = (await shell('cat /data/local/tmp/webview-command-line 2>/dev/null')).toString().trim()
  results.webview = (await shell('dumpsys webviewupdate')).toString().match(/Current WebView package[^\n]+/)?.[0] || 'see raw device diagnostics'
  // This emulator/app was created by the task; no real device or existing user profile is cleared.
  await shell('settings put system screen_off_timeout 2147483647')
  await shell('svc power stayon true')
  await shell('setprop debug.hwui.drawing_enabled true')
  results.hardwareDrawingEnabled=(await shell('getprop debug.hwui.drawing_enabled')).toString().trim()==='true'
  results.emulatorScreenOffTimeout = (await shell('settings get system screen_off_timeout')).toString().trim()
  await shell(`pm clear ${pkg}`)
  if (Number(results.api) >= 33) await shell(`pm grant ${pkg} android.permission.POST_NOTIFICATIONS`)
  let page = await attach()
  console.log('App initialized')
  await verifyIdentity(page); results.initialization = true
  results.masterPasswordInitialSave = await evaluate(page,`return stores.get('auth').hasMasterPassword&&stores.get('auth').savedMasterPwd==='${password}';`)
  await checkpoint('Initialization verified')
  await evaluate(page, `const s=stores.get('settings'); s.aiProviderUrl='https://synthetic.invalid'; s.aiApiKey='synthetic-native-key-only'; s.aiModel='synthetic'; await s.saveAiSettings();
    await stores.get('weight').restoreWeightRecords([{id:'native-original',date:'2026-10-26',weight:65}]); await s.flushPendingSettingsWrites(); return true;`)
  await waitState(page,"return stores.get('settings').apiKeyStorageStatus==='saved'")
  results.apiKeyInitialSave = await evaluate(page,"return stores.get('settings').aiApiKey==='synthetic-native-key-only'&&stores.get('settings').apiKeyStorageStatus==='saved';")
  await checkpoint('Native settings committed')
  page=await coldStart()
  await page.locator('.lock-screen input').waitFor()
  results.requiredEntryColdStart = await evaluate(page,"return stores.get('auth').isDataLoaded&&stores.get('auth').hasMasterPassword&&!stores.get('auth').loadError&&stores.get('auth').isLocked&&!stores.get('auth').savedMasterPwd;")
  await verifyIdentity(page)
  await evaluate(page,"await stores.get('settings').updateRequireAppUnlock(false);await stores.get('settings').flushPendingSettingsWrites();return true;")
  results.optionalEntryInitialSave = await evaluate(page,"return stores.get('settings').requireAppUnlock===false&&stores.get('auth').hasMasterPassword;")
  await checkpoint('Optional entry settings committed')
  page=await coldStart(); await waitReady(page)
  results.optionalEntryColdStart = await evaluate(page, `return stores.get('settings').requireAppUnlock===false && stores.get('auth').hasMasterPassword && !stores.get('auth').isLocked && !stores.get('auth').savedMasterPwd && Object.values(stores.get('protectedAccess').status).every(s=>s==='idle');`)
  results.apiKeyColdStart = await evaluate(page,"return stores.get('settings').aiApiKey==='synthetic-native-key-only';")
  await checkpoint('Cold start and credentials checked')
  await evaluate(page,"stores.get('settings').switchView('passwords'); return true;")
  await verifyProtectedIdentity(page)
  await waitState(page,"return stores.get('protectedAccess').status.passwords==='ready'")
  results.onlyRequestedModuleLoaded = await evaluate(page,"return stores.get('protectedAccess').status.chat==='idle';")
  await tapButton(page,'添加')
  await page.getByPlaceholder('例如：微信、GitHub',{exact:true}).fill('合成原生密码记录')
  await page.getByPlaceholder('手机号、邮箱或用户名',{exact:true}).fill('synthetic-account')
  await page.getByPlaceholder('输入密码',{exact:true}).fill('Synthetic-vault-content-only')
  await tapButton(page,'保存记录')
  await waitState(page,"return stores.get('passwordVault').records.some(r=>r.appName==='合成原生密码记录')")
  await evaluate(page,"await stores.get('passwordVault').flush();return true;")
  results.vaultUiCreate = true
  await checkpoint('Vault create checked')
  await captureNative('native-vault.png')
  await evaluate(page,"stores.get('settings').switchView('chat'); return true;")
  await page.waitForSelector('.chat-composer textarea')
  await page.locator('.chat-composer textarea').fill('合成原生测试消息'); await tapButton(page,'发送消息')
  await waitState(page,"const m=stores.get('chat').messages,index=m.findLastIndex(x=>x.role==='user'&&x.content==='合成原生测试消息');return index>=0&&m.slice(index+1).some(x=>x.role==='assistant'&&x.status==='complete'&&x.content.includes('合成回复：原生验证'))")
  results.chatSendReply = true; await captureNative('native-chat.png')
  await checkpoint('Chat checked')
  const taskId = await evaluate(page,"await stores.get('todo').add({title:'合成深链待办',startDate:'2026-10-26',recurrence:{type:'none'}});return stores.get('todo').snapshot.tasks.find(t=>t.title==='合成深链待办').id;")
  results.nativeAppProbe = await evaluate(page,`window.__qaNativeUrlEvents=[];const cap=window.Capacitor,app=cap?.Plugins?.App;
    const info={platform:cap?.getPlatform?.(),header:(cap?.PluginHeaders||[]).some(h=>h.name==='App')?'present':'missing'};
    try{window.__qaNativeUrlProbe=await app.addListener('appUrlOpen',event=>window.__qaNativeUrlEvents.push(event.url));info.listener='registered'}catch(error){info.listener=String(error)}return info;`)
  results.deepLinkCommand = (await shell(`am start -n ${pkg}/.MainActivity -a android.intent.action.VIEW -d 'formyself://open/todo?item=${taskId}&date=2026-10-26'`)).toString().trim()
  await waitState(page,`return stores.get('settings').currentView==='todo'&&stores.get('settings').todoTarget.item==='${taskId}'`,{timeout:30000})
  results.nativeDeepLink = await evaluate(page,`return stores.get('settings').todoTarget.item==='${taskId}';`)
  await checkpoint('Native deep link checked')
  await evaluate(page,"await window.__qaNativeUrlProbe?.remove();return true;")
  await evaluate(page,"stores.get('settings').autoLockDelaySeconds=0;return true;")
  results.backgroundTrigger='Separate QaBackgroundActivity in instrumentation APK; actual Android task switch'
  await shell('am start -n com.yubin.formyself.test/com.yubin.formyself.QaBackgroundActivity')
  await waitState(page,"return Object.values(stores.get('protectedAccess').status).every(x=>x==='idle')&&!stores.get('auth').savedMasterPwd&&stores.get('chat').messages.length===0",{polling:500})
  await checkpoint('Sensitive state released while backgrounded')
  await shell(`am start -n ${pkg}/.MainActivity`)
  await waitState(page,"return Object.values(stores.get('protectedAccess').status).every(x=>x==='idle')&&!stores.get('auth').savedMasterPwd&&stores.get('chat').messages.length===0",{polling:500})
  results.backgroundReleasesSensitiveData = await evaluate(page,"return !stores.get('auth').isLocked&&!stores.get('auth').savedMasterPwd&&stores.get('chat').messages.length===0;")
  await evaluate(page,"stores.get('settings').switchView('chat');return true;")
  await verifyProtectedIdentity(page)
  await page.waitForSelector('.chat-composer textarea')
  await checkpoint('Background release and reauthentication checked')
  await loadRuntime(page)
  await evaluate(page,`await stores.get('protectedAccess').ensureModules(); const target=window.__qaRuntime.createFullBackupSnapshot();target.data.weight=[{id:'native-partial',date:'2026-10-26',weight:60}];
    const participant=window.__qaRuntime.registry.get('weight'),original=participant.restore;
    participant.restore=async part=>{await original(part);window.__qaPartial=true;await new Promise(()=>{});};
    void window.__qaRuntime.restore(target,'${password}');return true;`)
  await page.waitForFunction('window.__qaPartial===true')
  page=await coldStart(); await page.getByRole('button',{name:'验证并重试恢复',exact:true}).waitFor()
  results.pendingRestoreBlocksColdStart = await evaluate(page,"return !stores.get('auth').savedMasterPwd;")
  await verifyIdentity(page)
  await waitState(page,"return stores.get('weight').weightRecords[0]?.id==='native-original'")
  await waitRestoreIdle(page)
  results.uncommittedForceStopRollback = true
  await checkpoint('Uncommitted rollback checked')
  await loadRuntime(page)
  await evaluate(page,`const entry=await import(document.querySelector('script[type=module]').src);
    const journal=Object.values(entry).find(x=>x&&Object.hasOwn(x,'inspect')&&Object.hasOwn(x,'commit')&&Object.hasOwn(x,'prepare'));
    if(!journal)throw Error('Missing actual journal');
    const target=window.__qaRuntime.createFullBackupSnapshot();target.data.weight=[{id:'native-committed',date:'2026-10-26',weight:61}];
    journal.clear=async()=>{throw Error('synthetic cleanup failure')};
    try{await window.__qaRuntime.restore(target,'${password}')}catch{}
    if(!(await journal.inspect()).committed)throw Error('Missing durable commit');return true;`)
  page=await coldStart(); await page.getByRole('button',{name:'验证并重试恢复',exact:true}).waitFor(); await verifyIdentity(page)
  await waitState(page,"return stores.get('weight').weightRecords[0]?.id==='native-committed'")
  await waitRestoreIdle(page)
  results.committedForceStopRetainsTarget = true
  await checkpoint('Committed restore checked')
  await evaluate(page,"stores.get('settings').openGeneralSettingsSection('security');return true;")
  await tapButton(page,'传统密码验证修改')
  await page.getByPlaceholder('原主密码',{exact:true}).fill(password)
  const nextPassword = 'Synthetic-P6-native-changed'
  await page.getByPlaceholder('新主密码',{exact:true}).fill(nextPassword)
  await page.getByPlaceholder('确认新主密码',{exact:true}).fill(nextPassword)
  await tapButton(page,'保存')
  await page.getByPlaceholder('原主密码',{exact:true}).waitFor({state:'hidden'})
  await page.getByText(/主密码已重设|主密码已更新；生物/).waitFor()
  password = nextPassword
  page = await coldStart(); await waitReady(page)
  await evaluate(page,"stores.get('settings').switchView('chat');return true;")
  await verifyProtectedIdentity(page)
  await page.waitForSelector('.chat-composer textarea')
  results.passwordChangeColdStartPreservesChat = await evaluate(page,"return stores.get('chat').messages.some(m=>m.role==='user'&&m.content==='合成原生测试消息');")
  results.apiKeyAfterPasswordChange = await evaluate(page,"return stores.get('settings').aiApiKey==='synthetic-native-key-only';")
  await evaluate(page,"stores.get('settings').switchView('passwords');return true;")
  await waitState(page,"return stores.get('protectedAccess').status.passwords==='ready'")
  results.passwordChangeColdStartPreservesVault = await evaluate(page,"return stores.get('passwordVault').records.some(r=>r.appName==='合成原生密码记录'&&r.password==='Synthetic-vault-content-only');")
  await evaluate(page,"stores.get('settings').switchView('home');return true;")
  await captureNative('native-home.png')
  results.nativeScreenshotsRendered=results.renderedScreenshotCount===3
  results.measurements = await page.evaluate("performance.getEntriesByType('measure').map(x=>({name:x.name,duration:x.duration}))")
  results.executedAt = new Date().toISOString()
  if(Object.entries(results).some(([,value])=>value===false))throw Error('Native acceptance failed')
  if(results.pageErrors.length)throw Error('Native page errors: '+results.pageErrors.join('; '))
  await writeFile(resolve(directory,'playwright-results.json'),JSON.stringify(results,null,2)+'\n')
  console.log(JSON.stringify(results))
} catch(error) {
  results.error=String(error)
  if (activePage && !activePage.isClosed()) {
    results.failedView = await evaluate(activePage,"return {view:stores.get('settings').currentView,requireAppUnlock:stores.get('settings').requireAppUnlock,hasMasterPassword:stores.get('auth').hasMasterPassword,authLoadError:stores.get('auth').loadError,locked:stores.get('auth').isLocked,status:stores.get('protectedAccess').status,sessionRevision:stores.get('auth').sessionRevision,credentialPresent:Boolean(stores.get('auth').savedMasterPwd),apiKeyStatus:stores.get('settings').apiKeyStorageStatus,visibility:document.visibilityState,unlockButtonDisabled:document.querySelector('.lock-btn')?.disabled,enteredPasswordMatches:document.querySelector('.lock-screen input')?.value==="+JSON.stringify(password)+",dialog:document.querySelector('[role=dialog]')?.textContent?.slice(0,250),unlockMarks:performance.getEntriesByType('mark').filter(x=>x.name.startsWith('unlock:')).map(x=>x.name),nativeUrls:window.__qaNativeUrlEvents||[]};").catch(()=>null)
    results.nativeEventDiagnostics = await evaluate(activePage, `
      const cap=window.Capacitor, root=document.querySelector('#app')._vnode?.component;
      const parsed=new URL('formyself://open/todo?item=synthetic&date=2026-10-26');
      const info={url:{protocol:parsed.protocol,host:parsed.hostname,path:parsed.pathname},rootMounted:root?.isMounted,rootUnmounted:root?.isUnmounted,mountHooks:root?.m?.length,header:cap.PluginHeaders?.find(x=>x.name==='App')};
      return info;`).catch(error=>({error:String(error)}))
    results.consoleWarnings = await activePage.consoleMessages().then(messages=>messages.filter(m=>['warning','error'].includes(m.type())).slice(-12).map(m=>m.text().slice(0,500))).catch(()=>[])
    await activePage.screenshot({path:resolve(directory,'playwright-failure.png'),timeout:5000}).catch(()=>{})
  }
  await bounded(device.screenshot({path:resolve(directory,'android-display-failure.png')}),'Native display screenshot',10000).catch(()=>{})
  const appLog = (await shell('logcat -d -v brief').catch(()=>Buffer.from(''))).toString().split('\n').filter(line=>/Capacitor.*(?:App|Console|addListener|removeListener|appUrlOpen|appStateChange)|无法监听|无法处理应用|onMounted|onBeforeUnmount/.test(line)).slice(-220).join('\n')
  console.error('Native App startup diagnostics:',appLog)
  await writeFile(resolve(directory,'app-event-diagnostics.txt'),appLog+'\n')
  const powerState=(await shell('dumpsys power').catch(()=>Buffer.from(''))).toString().split('\n').filter(line=>/mWakefulness=|mWakefulnessChanging=|Display Power:|mWakeLockSummary=/.test(line)).join('\n')
  console.error('Native display power diagnostics:',powerState)
  const crash = (await shell('logcat -b crash -d -t 120').catch(()=>Buffer.from(''))).toString()
  const summary = crash.split('\n').filter(line=>/Fatal signal|FATAL EXCEPTION|Abort message|AndroidRuntime:|Cmdline:|Renderer process/.test(line)).slice(-35).join('\n')
  await writeFile(resolve(directory,'playwright-crash-summary.txt'),summary+'\n')
  console.error('Native acceptance progress:',JSON.stringify(results))
  const processState = (await shell(`pidof ${pkg}; logcat -d -t 250`).catch(()=>Buffer.from(''))).toString().split('\n').filter(line=>/^\d/.test(line)&&(!line.includes(' ' )||/ActivityManager.*Killing|ActivityManager.*has died|Finishing|Render process|chromium.*ERROR|Capacitor.*Error/.test(line))).slice(-20).join('\n')
  console.error('Native process diagnostics:',processState)
  const intents = (await shell('dumpsys activity activities').catch(()=>Buffer.from(''))).toString().split('\n').filter(line=>line.includes(pkg)||line.includes('mIntent')).slice(-15).join('\n')
  console.error('Native intent diagnostics:',intents)
  if(summary)console.error(summary)
  await writeFile(resolve(directory,'playwright-attempt.json'),JSON.stringify(results,null,2)+'\n')
  throw error
} finally {
  for (const browser of browserConnections) await bounded(browser.close(),'CDP cleanup',20000).catch(()=>{})
  for (const port of forwardPorts) await executeFile(adb,['-s',device.serial(),'forward','--remove',`tcp:${port}`],{timeout:20000}).catch(()=>{})
  await bounded(device.close(),'Android device cleanup',20000).catch(()=>{})
}
