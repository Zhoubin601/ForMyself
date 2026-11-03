import {readFile,writeFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {connectNativeCapacity} from './native-capacity-support.mjs'
import {decryptPassphraseAes} from '../../../../src/shared/crypto/passphraseAes.js'
import {PASSWORD} from '../p3/management-scenarios.mjs'
import {compareMoodBaseline} from './mood-baseline-comparison.mjs'
import {createHash} from 'node:crypto'
const allowExpectedMoodAutofill=process.argv.includes('--allow-expected-mood-autofill')
const freshAfterAgp=process.argv.includes('--fresh-synthetic-install-after-agp')
const backup=JSON.parse(decryptPassphraseAes(await readFile(new URL('native-before-capacity.enc',import.meta.url),'utf8'),PASSWORD))
if(freshAfterAgp){
  const proof=JSON.parse(await readFile(new URL('native-bootstrap-after-agp-closure-20261102.json',import.meta.url),'utf8'))
  const digest=createHash('sha256').update(await readFile(new URL('native-before-capacity.enc',import.meta.url),'utf8')).digest('hex')
  if(proof.freshInstalledAfterAgpCleanup!==true||proof.encryptedFixtureSha256!==digest||proof.syntheticOnly!==true||!proof.error?.includes('BASELINE_MOOD_ROLLOVER_MISMATCH'))throw Error('KNOWN_SYNTHETIC_AGP_BOOTSTRAP_PROOF_REQUIRED')
}
const native=await connectNativeCapacity(),page=native.page,result={status:'RUNNING',at:new Date().toISOString(),syntheticOnly:true,apkSha256:native.build.apkSha256,aiRequests:0,pageErrors:[]}
if(freshAfterAgp)result.casContinuity='NEW_INSTALL_EPOCH_AFTER_AGP_UNINSTALL; historical revision is not claimed continuous'
page.on('pageerror',error=>result.pageErrors.push(error.message))
await page.route('https://api.deepseek.com/**',route=>{result.aiRequests++;return route.abort()})
try{
  if(allowExpectedMoodAutofill)await page.exposeFunction('__qaCompareMoodBaseline',compareMoodBaseline)
  const asset=native.build.resources.find(r=>/^assets\/fullBackupRuntime-.*\.js$/.test(r.path)).path
  result.integrity=await page.evaluate(async({backup,asset,allowExpectedMoodAutofill,freshAfterAgp})=>{
    const stores=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s,access=stores.get('protectedAccess')
    const module=await import('/'+asset),namespace=Object.values(module).find(v=>v&&typeof v==='object'&&typeof v.createFullBackupRuntime==='function')
    const after=await access.runOperation(access.moduleIds,()=>namespace.createFullBackupRuntime().exportFull()),checked=[]
    const stable=value=>JSON.stringify((function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v})(value))
    let todoRevision,moodRollover
    for(const name of Object.keys(backup.data)){
      let before=backup.data[name],restored=after.data[name]
      if(name==='mood'&&allowExpectedMoodAutofill){
        const date=new Date(),today=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')
        moodRollover=await window.__qaCompareMoodBaseline(before,restored,{trackingStartDate:backup.metadata.mood.trackingStartDate,today,defaultMoodId:stores.get('mood').defaultMoodDefinition.id,minimumCreatedAt:Date.parse(backup.createdAt),now:Date.now()})
        checked.push(name);continue
      }
      if(name==='todos'){
        const {revision:oldRevision,...oldData}=before,{revision:newRevision,...newData}=restored
        // Existing Todo CAS contract: restore increments the current envelope revision; task
        // data and all other fields must remain exact. Do not overwrite/lower the native CAS.
        if(!Number.isSafeInteger(newRevision)||(freshAfterAgp?newRevision<1:newRevision<=oldRevision))throw Error('BASELINE_TODO_CAS_DID_NOT_ADVANCE')
        todoRevision=freshAfterAgp?{historicalFixture:oldRevision,after:newRevision,installEpochChangedByAgp:true,continuityPreserved:false}:{before:oldRevision,after:newRevision,advanced:true};before=oldData;restored=newData
      }
      if(stable(before)!==stable(restored))throw Error('BASELINE_MODULE_MISMATCH:'+name)
      checked.push(name)
    }
    if(stable(backup.settings)!==stable(after.settings)||stable(backup.metadata)!==stable(after.metadata))throw Error('BASELINE_SETTINGS_OR_METADATA_MISMATCH')
    return {modules:checked,settings:true,metadata:true,todoRevision,moodRollover,autoLockDelaySeconds:stores.get('settings').autoLockDelaySeconds}
  },{backup,asset,allowExpectedMoodAutofill,freshAfterAgp})
  result.expiryTriggeredExplicitly=result.integrity.autoLockDelaySeconds!==0
  if(result.expiryTriggeredExplicitly)await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('auth').expireSession())
  await promisify(execFile)('E:/Android/Sdk/platform-tools/adb.exe',['-s','emulator-5580','shell','input','keyevent','3'],{timeout:15000})
  await page.waitForFunction(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot===null,{},{polling:100,timeout:30000})
  result.backgroundPlaintextReleased=true
  if(result.aiRequests||result.pageErrors.length)throw Error('UNEXPECTED_BASELINE_EVENT')
  result.status='PASS'
}catch(error){result.status='FAIL';result.error=error.message;process.exitCode=1}
finally{if(allowExpectedMoodAutofill)await page.evaluate(()=>{delete window.__qaCompareMoodBaseline}).catch(()=>{});await writeFile(new URL(freshAfterAgp?'native-fresh-after-agp-closure-20261102.json':'native-baseline-integrity-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');await native.close()}
process.exit(process.exitCode||0)
