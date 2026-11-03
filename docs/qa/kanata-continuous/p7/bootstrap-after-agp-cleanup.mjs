// Restore only the guarded synthetic app after AGP's connected test runner removed it.
// The absence guard is mandatory; this must never initialize over an existing installation.
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {resolve} from 'node:path'
import {assertKanataSyntheticDevice} from '../../../../scripts/kanata-device-guard.mjs'
import {attachGuardedNative} from './attach-guarded-native.mjs'
import {initializeApp,PASSWORD} from '../p3/management-scenarios.mjs'
import {decryptPassphraseAes} from '../../../../src/shared/crypto/passphraseAes.js'
import {compareMoodBaseline} from './mood-baseline-comparison.mjs'
const execute=promisify(execFile),serial='emulator-5580',pkg='com.yubin.formyself',directory=new URL('./',import.meta.url)
const adb=async args=>(await execute('E:/Android/Sdk/platform-tools/adb.exe',['-s',serial,...args],{timeout:120000,maxBuffer:65536})).stdout.trim()
assertKanataSyntheticDevice(JSON.parse(await readFile('.kanata-device.local/isolation.json','utf8')),process.cwd(),await adb(['emu','avd','name']),serial)
const installed=await adb(['shell','pm','list','packages',pkg])
if(installed.split(/\s+/).some(name=>name==='package:'+pkg||name==='package:'+pkg+'.test'))throw Error('AGP_REMOVED_APP_ABSENCE_REQUIRED')
const build=JSON.parse(await readFile(new URL('production-build-verification.json',directory),'utf8')),apk=resolve('android/app/build/outputs/apk/debug/app-debug.apk')
if(build.status!=='PASS'||!build.qaHarnessAbsent||createHash('sha256').update(await readFile(apk)).digest('hex')!==build.apkSha256)throw Error('VERIFIED_APK_REQUIRED')
const encrypted=await readFile(new URL('native-before-capacity.enc',directory),'utf8'),backup=JSON.parse(decryptPassphraseAes(encrypted,PASSWORD))
if(backup.data.chat.messages.length!==608||backup.data.chat.messages.find(m=>m.id==='p7-history-26')?.revision!==2)throw Error('KNOWN_SYNTHETIC_BASELINE_REQUIRED')
const result={status:'RUNNING',at:new Date().toISOString(),freshInstalledAfterAgpCleanup:true,syntheticOnly:true,build:build.apkSha256,encryptedFixtureSha256:createHash('sha256').update(encrypted).digest('hex'),noUninstallOrClearRequestedByThisRecovery:true,aiRequests:0,pageErrors:[]}
const destination=new URL('native-bootstrap-after-agp-closure-20261102.json',directory),save=()=>writeFile(destination,JSON.stringify(result,null,2)+'\n')
await save()
await adb(['install','-r','-t',apk])
const localMarker=resolve('.kanata-device.local/closure-bootstrap-isolation.txt'),remoteMarker='/data/local/tmp/kanata-closure-bootstrap-'+Date.now()+'.txt'
await writeFile(localMarker,'KanataP2Synthetic34:20261028:new-empty-avd')
await adb(['push',localMarker,remoteMarker]);await adb(['shell','run-as',pkg,'mkdir','-p','files'])
await adb(['shell','run-as',pkg,'cp',remoteMarker,'files/kanata-qa-isolation.txt'])
await adb(['shell','am','start','-n',pkg+'/.MainActivity'])
const native=await attachGuardedNative(),page=native.page
page.setDefaultTimeout(180000)
page.on('pageerror',error=>result.pageErrors.push(error.message))
await page.route('https://api.deepseek.com/**',route=>{++result.aiRequests;return route.abort()})
try{
  await initializeApp(page)
  await page.exposeFunction('__compareFreshMood',compareMoodBaseline)
  const asset=build.resources.find(r=>/^assets\/fullBackupRuntime-.*\.js$/.test(r.path)).path
  result.integrity=await page.evaluate(async({asset,backup,password})=>{
    const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s,access=s.get('protectedAccess')
    const module=await import('/'+asset),ns=Object.values(module).find(v=>v&&typeof v==='object'&&typeof v.createFullBackupRuntime==='function'),runtime=ns.createFullBackupRuntime()
    const before=await access.runOperation(access.moduleIds,()=>runtime.exportFull())
    if(before.data.chat.messages.length)throw Error('FRESH_SYNTHETIC_GRAPH_NOT_EMPTY')
    const freshRevision=before.data.todos.revision
    const outcome=await access.runOperation(access.moduleIds,()=>runtime.restore(backup,password))
    if(outcome===false)throw Error('RESTORE_LEASE_NOT_GRANTED')
    const after=await access.runOperation(access.moduleIds,()=>runtime.exportFull())
    const stable=value=>JSON.stringify((function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v})(value))
    const checked=[];let todoRevision,moodRollover
    for(const name of Object.keys(backup.data)){
      let expected=backup.data[name],actual=after.data[name]
      if(name==='todos'){
        const {revision:oldRevision,...oldData}=expected,{revision:newRevision,...newData}=actual
        if(!Number.isSafeInteger(newRevision)||newRevision<=freshRevision)throw Error('FRESH_CAS_DID_NOT_ADVANCE')
        todoRevision={historicalFixture:oldRevision,freshInstallBefore:freshRevision,after:newRevision,installEpochChangedByAgp:true};expected=oldData;actual=newData
      }
      if(name==='mood'){
        const date=new Date(),today=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')
        moodRollover=await window.__compareFreshMood(expected,actual,{trackingStartDate:backup.metadata.mood.trackingStartDate,today,defaultMoodId:s.get('mood').defaultMoodDefinition.id,minimumCreatedAt:Date.parse(backup.createdAt),now:Date.now()})
      }else if(stable(expected)!==stable(actual))throw Error('SYNTHETIC_MODULE_MISMATCH:'+name)
      checked.push(name)
    }
    if(stable(backup.settings)!==stable(after.settings)||stable(backup.metadata)!==stable(after.metadata))throw Error('SYNTHETIC_SETTINGS_METADATA_MISMATCH')
    return{actualCoordinator:true,modules:checked,settings:true,metadata:true,messages:after.data.chat.messages.length,todoRevision,moodRollover,pending:s.get('kanata').hasPendingSave,saveError:s.get('kanata').saveError,archiveFileBatchAvailable:window.Capacitor.isPluginAvailable('ArchiveFileBatch')}
  },{asset,backup,password:PASSWORD})
  if(result.aiRequests||result.pageErrors.length||result.integrity.pending||result.integrity.saveError)throw Error('UNEXPECTED_BOOTSTRAP_STATE')
  result.status='PASS_SYNTHETIC_BASELINE_RESTORED_WITH_NEW_CAS_EPOCH'
}catch(error){result.status='NO_GO_PRESERVE_STATE';result.error=error.message;process.exitCode=1}
finally{await save();await native.close()}
process.exit(process.exitCode||0)
