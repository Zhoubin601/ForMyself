// Production repository/crypto against actual task-owned Node disk. This is NOT Android,
// true paging, or the product full-restore coordinator. Passwords and records are synthetic.
import fs from 'node:fs/promises'
import {resolve,sep} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import preset from '../../../../src/features/chat/presets/abydos.v1.json' with {type:'json'}
import {createEmptyKanataData} from '../../../../src/features/chat/domain/kanataCore.js'
import {instantiateWorldPreset} from '../../../../src/features/chat/domain/presetCore.js'
import {createKanataRepository,KANATA_DATA_PATH} from '../../../../src/features/chat/storage/kanataRepository.js'
import {buildKanataChatBackupSnapshot,readKanataChatBackupSnapshot} from '../../../../src/features/chat/backup/kanataBackup.js'
const output=new URL('./',import.meta.url)
if(process.argv[2]!=='--worker'){
  const run={status:'RUNNING',at:new Date().toISOString(),kind:'node-repository-baseline-only',syntheticOnly:true,node:process.version,samples:[]}
  for(const size of [1000,10000,100000]){
    const child=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),'--worker',String(size)],{encoding:'utf8',timeout:240000,maxBuffer:1024*1024})
    if(child.status!==0){run.status='FAIL';let partial=null;try{partial=JSON.parse(await fs.readFile(new URL(`node-capacity-progress-${size}.json`,output),'utf8'))}catch{}run.samples.push({size,status:'FAIL',code:child.error?.code||'WORKER_FAILED',stderr:child.stderr?.slice(-1000),partial});break}
    run.samples.push(JSON.parse(child.stdout));await fs.writeFile(new URL('node-capacity-results.json',output),JSON.stringify(run,null,2)+'\n')
    console.log('MEASURED',size)
  }
  if(run.status!=='FAIL')run.status='MEASURED_NOT_ACCEPTED'
  run.p7Gate='NO_GO: current production repository has no actual paging/query/archive API; these are Node measurements, not device acceptance'
  await fs.writeFile(new URL('node-capacity-results.json',output),JSON.stringify(run,null,2)+'\n')
  process.exitCode=run.status==='FAIL'?1:0
}else{
  const count=Number(process.argv[3]);if(![1000,10000,100000].includes(count))throw Error('INVALID_SYNTHETIC_SIZE')
  const root=await fs.mkdtemp(resolve(tmpdir(),'kanata-p7-synthetic-'))
  const path=relative=>{const target=resolve(root,relative);if(!target.startsWith(root+sep))throw Error('TASK_PATH_ESCAPED');return target}
  const driver={stat:async o=>fs.stat(path(o.path)),readFile:async o=>({data:await fs.readFile(path(o.path),'utf8')}),writeFile:async o=>fs.writeFile(path(o.path),o.data,'utf8'),mkdir:async o=>fs.mkdir(path(o.path),{recursive:true}),deleteFile:async o=>fs.unlink(path(o.path)),rename:async o=>fs.rename(path(o.from),path(o.to))}
  const journal={get:async()=>{try{return{value:await fs.readFile(path('journal.enc'),'utf8')}}catch(e){if(e.code==='ENOENT')return{value:null};throw e}},set:async o=>fs.writeFile(path('journal.enc'),o.value,'utf8'),remove:async()=>{try{await fs.unlink(path('journal.enc'))}catch(e){if(e.code!=='ENOENT')throw e}}}
  const make=()=>createKanataRepository({filesystem:driver,journal,directory:'SYNTHETIC_NODE'})
  const password='synthetic-p7-baseline-password',nextPassword='synthetic-p7-baseline-next-password',now=Date.UTC(2026,9,29)
  let serial=0,data=instantiateWorldPreset(createEmptyKanataData('synthetic-p7-user'),preset,{initializationKey:'first',now,timeZone:'Asia/Shanghai',idFactory:kind=>`${kind}-${++serial}`})
  const conversation=data.conversations[0],instance=data.instances[0],identity=data.identities[0]
  data.messages=Array.from({length:count},(_,n)=>({id:`bench-message-${n}`,worldId:conversation.worldId,conversationId:conversation.id,role:n%2?'assistant':'user',senderType:n%2?'character':'user',senderId:n%2?instance.id:identity.id,senderNameSnapshot:n%2?'合成角色':'合成用户',content:('合成容量正文'+n+'，不含真实资料。').padEnd(128,'测'),createdAt:now+n,revision:1,status:'complete',turnId:`bench-turn-${Math.floor(n/2)}`,batchId:`bench-batch-${Math.floor(n/2)}`,...(n%2?{replyToMessageId:`bench-message-${n-1}`,replyToRevision:1}:{})}))
  data.memories=Array.from({length:20},(_,n)=>({id:`bench-memory-${n}`,worldId:conversation.worldId,ownerType:'character',ownerId:instance.id,layer:'L3',key:`合成偏好${n}`,content:`这是第${n}条合成记忆。`,sourceRefs:[{messageId:`bench-message-${n}`,revision:1}],status:'active',revision:1,visibility:'private'}))
  const result={status:'MEASURED',count,root,metrics:{},realPaging:false,archiveAvailable:false,fullProductRestoreCoordinator:false}
  const measure=async(name,action)=>{global.gc?.();const start=performance.now();const value=await action();result.metrics[name]={ms:Math.round((performance.now()-start)*10)/10,heapUsedBytes:process.memoryUsage().heapUsed,peakProcessRssKiB:process.resourceUsage().maxRSS};await fs.writeFile(new URL(`node-capacity-progress-${count}.json`,output),JSON.stringify({...result,lastCompleted:name},null,2)+'\n');return value}
  let repository=make();await repository.read(password)
  await measure('save',()=>repository.write(data,password));await repository.flush()
  result.ciphertextBytes=(await fs.stat(path(KANATA_DATA_PATH))).size
  data=null;await repository.release();repository=make()
  const loaded=await measure('coldRepositoryRead',()=>repository.read(password))
  if(loaded.data.messages.length!==count||loaded.data.messages.at(-1).id!==`bench-message-${count-1}`)throw Error('COUNT_MISMATCH')
  await measure('inMemorySliceNotPaging',async()=>loaded.data.messages.slice(-50))
  await measure('linearScanNotIndex',async()=>loaded.data.messages.filter(m=>m.content.includes('999')).slice(0,50))
  const backup=await measure('backupAdapterBuild',async()=>buildKanataChatBackupSnapshot(loaded.data))
  const restored=await measure('backupAdapterReadNotCoordinator',async()=>readKanataChatBackupSnapshot(backup))
  if(restored.data.messages.length!==count)throw Error('BACKUP_COUNT_MISMATCH')
  await measure('reencrypt',()=>repository.reencrypt(loaded.data,nextPassword))
  await repository.release();repository=make()
  const changed=await measure('newPasswordRead',()=>repository.read(nextPassword))
  if(changed.data.messages.length!==count)throw Error('REENCRYPT_COUNT_MISMATCH')
  await repository.release();repository=make();let oldRejected=false
  try{await repository.read(password)}catch{oldRejected=true}
  if(!oldRejected)throw Error('OLD_PASSWORD_STILL_READABLE')
  result.oldPasswordRejected=true;result.peakProcessRssKiB=process.resourceUsage().maxRSS
  console.log(JSON.stringify(result))
}
