// Return only this explicitly marked synthetic test device to its verified pre-capacity image.
import {readFile,writeFile} from 'node:fs/promises'
import {connectNativeCapacity} from './native-capacity-support.mjs'
import {decryptPassphraseAes} from '../../../../src/shared/crypto/passphraseAes.js'
import {PASSWORD} from '../p3/management-scenarios.mjs'
const backup=JSON.parse(decryptPassphraseAes(await readFile(new URL('native-before-capacity.enc',import.meta.url),'utf8'),PASSWORD))
if(backup.data.chat.messages.length!==608||backup.data.chat.messages.find(m=>m.id==='p7-history-26')?.revision!==2)throw Error('INVALID_SYNTHETIC_BASELINE')
const native=await connectNativeCapacity(),page=native.page
page.setDefaultTimeout(600000)
const result={status:'RUNNING',at:new Date().toISOString(),syntheticOnly:true,apkSha256:native.build.apkSha256,aiRequests:0,pageErrors:[]}
page.on('pageerror',error=>result.pageErrors.push(error.message))
await page.route('https://api.deepseek.com/**',route=>{result.aiRequests++;return route.abort()})
try{
  const asset=native.build.resources.find(r=>/^assets\/fullBackupRuntime-.*\.js$/.test(r.path)).path
  result.value=await page.evaluate(async({backup,password,asset})=>{
    const stores=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s,store=stores.get('kanata'),access=stores.get('protectedAccess')
    const ids=[...store.snapshot.messages,...(store.snapshot.messageArchives||[]).flatMap(p=>p.messages)].map(m=>m.id)
    if(!ids.every(id=>id.startsWith('web-capacity-message-')))throw Error('NOT_SYNTHETIC_CAPACITY_GRAPH')
    const module=await import('/'+asset),namespace=Object.values(module).find(v=>v&&typeof v==='object'&&typeof v.createFullBackupRuntime==='function'),runtime=namespace.createFullBackupRuntime()
    await access.runOperation(access.moduleIds,()=>runtime.restore(backup,password))
    const after=await access.runOperation(access.moduleIds,()=>runtime.exportFull()),expected=new Map(backup.data.chat.messages.map(m=>[m.id,m]))
    if(after.data.chat.messages.length!==608||after.data.chat.messages.some(m=>JSON.stringify(m)!==JSON.stringify(expected.get(m.id)))||JSON.stringify(after.data.chat.messageAudits)!==JSON.stringify(backup.data.chat.messageAudits))throw Error('SYNTHETIC_BASELINE_RESTORE_PROOF_MISMATCH')
    return{actualCoordinator:true,restoredMessages:608,exactOriginals:true,exactAudits:true,saveError:store.saveError,hasPendingSave:store.hasPendingSave}
  },{backup,password:PASSWORD,asset})
  result.memory=await native.memory()
  if(result.aiRequests||result.pageErrors.length||result.value.saveError||result.value.hasPendingSave)throw Error('UNEXPECTED_NATIVE_BASELINE_STATE')
  result.status='PASS'
}catch(error){result.status='FAIL';result.error=error.message;process.exitCode=1}
finally{await writeFile(new URL('native-capacity-baseline-restored.json',import.meta.url),JSON.stringify(result,null,2)+'\n');await native.close()}
process.exit(process.exitCode||0)
