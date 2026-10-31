// Actual production Store + repository on owned Node disk. Device acceptance is recorded separately.
import fs from 'node:fs/promises'
import {resolve,sep} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createPinia,setActivePinia} from 'pinia'
import {createKanataStore} from '../../../../src/features/chat/kanataStore.js'
import {createKanataRepository,KANATA_DATA_PATH} from '../../../../src/features/chat/storage/kanataRepository.js'
import {archiveData} from '../../../../tests/helpers/kanataArchiveFixture.js'
const output=new URL('./',import.meta.url),password='synthetic-p7-archive-password',nextPassword='synthetic-p7-archive-next-password'
if(!process.argv.includes('--worker')){
  const result={status:'RUNNING',kind:'actual-store-node-disk',syntheticOnly:true,noForcedGC:true,deviceAcceptance:false,fullProductRestoreCoordinator:false,samples:[]}
  for(const size of [1000,10000,100000]){
    const entry={count:size,phases:[]};result.samples.push(entry)
    let root=''
    for(const phase of ['prepare','cold-page-save','backup-restore','reencrypt']){
      const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',phase,String(size),root],{encoding:'utf8',timeout:240000,maxBuffer:1024*1024})
      if(child.status!==0){entry.phases.push({phase,status:'FAIL',error:child.error?.code||'WORKER_FAILED',stderr:child.stderr?.slice(-1500),stdout:child.stdout?.slice(-1500)});result.status='FAIL';break}
      const value=JSON.parse(child.stdout);root=value.root;entry.phases.push(value)
      await fs.writeFile(new URL('node-archive-results.json',output),JSON.stringify(result,null,2)+'\n');console.log('MEASURED',size,phase)
    }
    if(result.status==='FAIL')break
  }
  if(result.status!=='FAIL')result.status='MEASURED_NOT_DEVICE_ACCEPTED'
  await fs.writeFile(new URL('node-archive-results.json',output),JSON.stringify(result,null,2)+'\n');if(result.status==='FAIL')process.exitCode=1
}else{
  const phase=process.argv[3],count=Number(process.argv[4]);if(![1000,10000,100000].includes(count))throw Error('BAD_SYNTHETIC_SIZE')
  const root=process.argv[5]||await fs.mkdtemp(resolve(tmpdir(),'kanata-p7-archive-synthetic-'))
  if(!root.startsWith(resolve(tmpdir(),'kanata-p7-archive-synthetic-')))throw Error('UNOWNED_ROOT')
  const path=relative=>{const target=resolve(root,relative);if(!target.startsWith(root+sep))throw Error('PATH_ESCAPED');return target}
  const filesystem={stat:async o=>{const s=await fs.stat(path(o.path));return{type:s.isFile()?'file':'directory',size:s.size}},readFile:async o=>({data:await fs.readFile(path(o.path),'utf8')}),writeFile:async o=>fs.writeFile(path(o.path),o.data,'utf8'),mkdir:async o=>fs.mkdir(path(o.path),{recursive:true}),deleteFile:async o=>fs.unlink(path(o.path)),rename:async o=>fs.rename(path(o.from),path(o.to)),readdir:async o=>({files:(await fs.readdir(path(o.path),{withFileTypes:true})).map(f=>({name:f.name,type:f.isFile()?'file':'directory'}))})}
  const journal={get:async()=>{try{return{value:await fs.readFile(path('journal.enc'),'utf8')}}catch(e){if(e.code==='ENOENT')return{value:null};throw e}},set:async o=>fs.writeFile(path('journal.enc'),o.value,'utf8'),remove:async()=>{try{await fs.unlink(path('journal.enc'))}catch(e){if(e.code!=='ENOENT')throw e}}}
  setActivePinia(createPinia());const repository=createKanataRepository({filesystem,journal,directory:'NODE'}),store=createKanataStore(repository,'capacity-store')()
  const result={phase,count,root,metrics:{},status:'MEASURED',fullProductRestoreCoordinator:false}
  const measure=async(name,action)=>{const start=performance.now(),value=await action();result.metrics[name]={ms:Math.round((performance.now()-start)*10)/10,heapUsedBytes:process.memoryUsage().heapUsed,peakProcessRssKiB:process.resourceUsage().maxRSS};return value}
  if(phase==='prepare'){
    let data=archiveData(count)
    data.messages.forEach((m,n)=>{m.content=('合成容量正文'+n+'，不含真实资料。').padEnd(128,'测')})
    const c=data.conversations.find(c=>c.type==='private'),instance=data.instances.find(i=>c.participantIds.includes(i.id))
    data.memories=Array.from({length:20},(_,n)=>({id:'capacity-memory-'+n,worldId:c.worldId,ownerType:'character',ownerId:instance.id,layer:'L3',key:'合成偏好'+n,content:'有来源的合成记忆'+n,sourceRefs:[{messageId:data.messages[n].id,revision:1}],status:'active',revision:1,visibility:'private'}))
    if(!await store.load(password))throw Error(store.loadError)
    await measure('portableStoreImport',()=>store.restoreSnapshot(data));data=null
    result.archive=await measure('archiveConversion',()=>store.archiveHistory({worldId:c.worldId,conversationId:c.id,keepRecent:200}))
    await store.flush()
    await fs.writeFile(path('owned.json'),JSON.stringify({syntheticOnly:true,count,scope:{worldId:c.worldId,conversationId:c.id},passwordIsSynthetic:true}))
  }else{
    const marker=JSON.parse(await fs.readFile(path('owned.json'),'utf8'));if(marker.syntheticOnly!==true||marker.count!==count)throw Error('BAD_MARKER')
    const scope=marker.scope
    if(!await measure('coldStoreLoad',()=>store.load(password)))throw Error(store.loadError)
    if(phase==='cold-page-save'){
      let cursor
      for(let page=0;page<4;page++)cursor=(await store.readHistory({...scope,cursor})).cursor
      const first=await measure('diskPage50',()=>store.readHistory({...scope,cursor})),second=await measure('olderDiskPage50',()=>store.readHistory({...scope,cursor:first.cursor})),found=await measure('indexedExactSearch',()=>store.readHistory({...scope,text:'合成容量正文777，'}))
      if(!first.pagesRead||!second.pagesRead)throw Error('NOT_A_DISK_PAGE')
      if(first.messages.length!==50||second.messages.length!==50||found.messages.length!==1||found.messages[0].id!=='synthetic-message-777')throw Error('PAGE_SEARCH_MISMATCH')
      result.io={first:{pages:first.pagesRead,bytes:first.bytesRead},second:{pages:second.pagesRead,bytes:second.bytesRead},search:{pages:found.pagesRead,bytes:found.bytesRead}}
      await measure('saveHeader',()=>store.update(d=>{d.worlds[0].name+=' · 合成容量'}));await store.flush()
    }else if(phase==='backup-restore'){
      await measure('hydrateBackupBodies',()=>store.prepareBackup())
      let portable=await measure('portableCapture',async()=>store.backupSnapshot())
      if(portable.messages.length!==count||portable.messageArchives)throw Error('PORTABLE_COUNT_MISMATCH')
      await measure('restoreStoreNotCoordinator',()=>store.restoreSnapshot(portable));portable=null;await store.flush()
      await measure('rearchiveAfterRestore',()=>store.archiveHistory({...scope,keepRecent:200}))
    }else if(phase==='reencrypt'){
      await measure('pageReencrypt',()=>store.reencrypt(nextPassword));await store.flush()
      await store.release();if(!await store.load(nextPassword))throw Error('NEW_PASSWORD_READ_FAILED')
      const found=await store.readHistory({...scope,text:'合成容量正文777，'});if(found.messages.length!==1)throw Error('REKEY_COUNT_MISMATCH')
      await store.release();if(await store.load(password))throw Error('OLD_PASSWORD_ACCEPTED')
      result.oldPasswordRejected=true
    }else throw Error('UNKNOWN_PHASE')
  }
  result.mainBytes=(await fs.stat(path(KANATA_DATA_PATH))).size;result.peakProcessRssKiB=process.resourceUsage().maxRSS
  console.log(JSON.stringify(result))
}
