// Loaded only into the isolated M0 Android QA app.
import {Capacitor,registerPlugin} from '@capacitor/core'
import {CapacitorSQLite} from '@capacitor-community/sqlite'
import {Filesystem,Directory} from '@capacitor/filesystem'
import {createPinia} from 'pinia'
import {createKanataStore} from '../../../src/features/chat/kanataStore.js'
import {createKanataRepository} from '../../../src/features/chat/storage/kanataRepository.js'
import {header,dataset,message,scopes,fixtureVersion} from './dataset.mjs'

const check=(ok,code)=>{if(!ok)throw Error(code)}
const database='m0_target_benchmark'
const options={database,readonly:false}
const query=async(statement,values=[])=> (await CapacitorSQLite.query({...options,statement,values})).values
const execute=statements=>CapacitorSQLite.execute({...options,statements,transaction:false})
const run=(statement,values)=>CapacitorSQLite.run({...options,statement,values,transaction:true})
const insert='INSERT INTO qa_messages VALUES(?,?,?,?,?);'
const bindings=m=>[m.id,m.worldId,m.conversationId,m.createdAt,JSON.stringify(m)]
const scopeSql='world_id=? AND conversation_id=?'
const pageSql='SELECT payload FROM qa_messages WHERE '+scopeSql
const order=' ORDER BY created_at DESC,id DESC LIMIT 50;'

async function archiveBytes(){
  const {files}=await Filesystem.readdir({directory:Directory.Data,path:'formyself'})
  let bytes=0
  for(const file of files){
    const path='formyself/'+file.name
    if(file.type==='file')bytes+=file.size
    else if(file.name==='kanata-pages-v1'){
      const pages=await Filesystem.readdir({directory:Directory.Data,path})
      bytes+=pages.files.reduce((sum,page)=>sum+page.size,0)
    }
  }
  return bytes
}

window.qaTargetBenchmark=async(engine,count)=>{
  check(Capacitor.getPlatform()==='android'&&Capacitor.isPluginAvailable('ArchiveFileBatch'),'QA_NATIVE_PLATFORM_REQUIRED')
  check(['json-archive','sqlcipher'].includes(engine)&&[1000,10000,100000].includes(count),'QA_SAMPLE_DENIED')
  const sql=engine==='sqlcipher', records=[], base=header(), scope=scopes(base)[0]
  const scopeArgs=[scope.worldId,scope.conversationId]
  const secret=crypto.randomUUID()+crypto.randomUUID()
  const store=sql?null:createKanataStore(createKanataRepository(),'m0-target')(createPinia())
  let plan
  const measure=async(name,fn)=>{
    window.qaTargetStage=name
    const start=performance.now(),result=await fn()
    records.push({name,ms:performance.now()-start,heapPointBytes:performance.memory?.usedJSHeapSize??null})
    return result
  }
  const open=async()=>{
    if(sql)await CapacitorSQLite.open(options)
    else check(await store.load(secret),'QA_STORE_LOAD_FAILED')
  }
  const close=()=>sql?CapacitorSQLite.close(options):store.release()
  const select=async(after)=>{
    if(!sql)return store.readHistory({...scope,limit:50,cursor:after?.cursor})
    const cursor=after?.messages.at(-1)
    const rows=await query(pageSql+(cursor?' AND (created_at,id)<(?,?)':'')+order,
      cursor?[...scopeArgs,cursor.createdAt,cursor.id]:scopeArgs)
    return {messages:rows.map(row=>JSON.parse(row.payload))}
  }
  try{
    if(sql){
      check(!(await CapacitorSQLite.isSecretStored()).result,'QA_EXISTING_SECRET_REFUSE')
      await CapacitorSQLite.setEncryptionSecret({passphrase:secret})
      await CapacitorSQLite.createConnection({...options,encrypted:true,mode:'secret',version:1})
    }
    await measure('initial_open',open)
    if(sql){
      window.qaTargetStage='sqlite_configuration'
      check((await query('PRAGMA cipher_version;'))[0].cipher_version.startsWith('4.17.'),'QA_CIPHER_NOT_ENABLED')
      check((await query('PRAGMA journal_mode=WAL;'))[0].journal_mode==='wal','QA_WAL_REQUIRED')
      await execute('PRAGMA synchronous=FULL;')
      await execute('PRAGMA cache_size=-2048;')
      check((await query('PRAGMA wal_autocheckpoint=1000;'))[0].wal_autocheckpoint===1000,'QA_CHECKPOINT_REQUIRED')
      check((await query('PRAGMA synchronous;'))[0].synchronous===2,'QA_SYNC_REQUIRED')
      await execute('CREATE TABLE qa_messages(id TEXT PRIMARY KEY,world_id TEXT NOT NULL,conversation_id TEXT NOT NULL,created_at INTEGER NOT NULL,payload TEXT NOT NULL);')
      await execute('CREATE INDEX qa_scope_time ON qa_messages(world_id,conversation_id,created_at DESC,id DESC);')
    }
    window.qaTargetStage='fixture'
    let fixture=sql?null:dataset(count)
    await measure('bulk_write',async()=>{
      if(!sql){await store.restoreSnapshot(fixture);await store.flush();return}
      for(let start=0;start<count;start+=256){
        const set=Array.from({length:Math.min(count-start,256)},(_,j)=>({statement:insert,values:bindings(message(start+j,base))}))
        await CapacitorSQLite.executeSet({...options,set,transaction:true})
      }
    })
    fixture=null
    let nearIds,olderIds
    for(let repeat=0;repeat<5;repeat++){
      const near=await measure('recent_50',()=>select())
      const older=await measure('history_page_50',()=>select(near))
      check(near.messages.length===50&&older.messages.length===50,'QA_PAGE_LENGTH')
      check(new Set([...near.messages,...older.messages].map(m=>m.id)).size===100,'QA_PAGE_DUPLICATE')
      check([...near.messages,...older.messages].every(m=>m.worldId===scope.worldId&&m.conversationId===scope.conversationId),'QA_SCOPE')
      check([...near.messages,...older.messages].every(m=>JSON.stringify(m)===JSON.stringify(message(Number(m.id.slice(-9)),base))),'QA_PAYLOAD_MISMATCH')
      nearIds=near.messages.map(m=>m.id);olderIds=older.messages.map(m=>m.id)
      if(sql&&repeat===0){
        const cursor=near.messages.at(-1)
        plan=(await query('EXPLAIN QUERY PLAN '+pageSql+' AND (created_at,id)<(?,?)'+order,[...scopeArgs,cursor.createdAt,cursor.id])).map(row=>row.detail)
        check(plan.some(detail=>detail.includes('SEARCH')&&detail.includes('qa_scope_time')),'QA_INDEX_REQUIRED')
      }
      const extra=message(count+2*repeat,base)
      await measure('single_write',async()=>{
        if(sql)await run(insert,bindings(extra))
        else{await store.update(data=>{data.messages.push(extra)});await store.flush()}
      })
      await measure('single_update',async()=>{
        if(sql)await run('UPDATE qa_messages SET payload=? WHERE id=? AND '+scopeSql+';',[JSON.stringify({...extra,content:'QA edit',revision:2}),extra.id,extra.worldId,extra.conversationId])
        else{await store.update(data=>{const m=data.messages.find(m=>m.id===extra.id);m.content='QA edit';m.revision++});await store.flush()}
      })
      await measure('single_delete',async()=>{
        if(sql)await run('DELETE FROM qa_messages WHERE id=? AND '+scopeSql+';',[extra.id,extra.worldId,extra.conversationId])
        else{await store.update(data=>{data.messages=data.messages.filter(m=>m.id!==extra.id)});await store.flush()}
      })
    }
    await measure('close',close)
    await measure('same_process_reopen',open)
    check(JSON.stringify((await select()).messages.map(m=>m.id))===JSON.stringify(nearIds),'QA_REOPEN_DATA_CHANGED')
    if(sql)check((await query('SELECT count(*) AS n FROM qa_messages;'))[0].n===count,'QA_ROW_COUNT')
    await close()
    const bytes=sql?null:await archiveBytes()
    return {status:'PASS_TARGET_SAMPLE',engine,count,fixtureVersion,records,nearIds,olderIds,plan,bytes}
  }catch(error){
    return {status:'FAIL_TARGET_SAMPLE',engine,count,fixtureVersion,records,plan,stage:window.qaTargetStage,code:/^QA_[A-Z_]+$/.test(error.message)?error.message:'QA_OPERATION_FAILED'}
  }
}

// Two separate App processes exercise rollback of an interrupted plugin transaction.
window.qaTargetCrash=async phase=>{
  const crashOptions={database:'m0_target_crash',readonly:false}
  const sql=statements=>CapacitorSQLite.execute({...crashOptions,statements,transaction:false})
  const rows=async statement=>(await CapacitorSQLite.query({...crashOptions,statement,values:[]})).values
  try{
    const staged=phase==='stage'
    check(staged||phase==='resume','QA_PHASE_DENIED')
    check((await CapacitorSQLite.isSecretStored()).result===!staged,'QA_CRASH_SECRET_STATE')
    if(staged)await CapacitorSQLite.setEncryptionSecret({passphrase:crypto.randomUUID()+crypto.randomUUID()})
    await CapacitorSQLite.createConnection({...crashOptions,encrypted:true,mode:'secret',version:1})
    await CapacitorSQLite.open(crashOptions)
    if(staged){
      check((await rows('PRAGMA journal_mode=WAL;'))[0].journal_mode==='wal','QA_WAL_REQUIRED')
      await sql('PRAGMA synchronous=FULL;')
      await sql('CREATE TABLE qa_crash(id INTEGER PRIMARY KEY);')
      await sql('INSERT INTO qa_crash VALUES (1);')
      await CapacitorSQLite.beginTransaction(crashOptions)
      await CapacitorSQLite.run({...crashOptions,statement:'INSERT INTO qa_crash VALUES (?);',values:[2],transaction:false})
      check((await rows('SELECT COUNT(*) AS n FROM qa_crash;'))[0].n===2,'QA_TRANSACTION_NOT_STAGED')
      return {status:'PASS_CRASH_STAGE',committedId:1,uncommittedId:2}
    }
    const ids=(await rows('SELECT id FROM qa_crash ORDER BY id;')).map(row=>row.id)
    check(ids.length===1&&ids[0]===1,'QA_CRASH_ROLLBACK_FAILED')
    check((await rows('PRAGMA integrity_check;'))[0].integrity_check==='ok','QA_CRASH_INTEGRITY_FAILED')
    check((await rows('PRAGMA cipher_integrity_check;')).length===0,'QA_CRASH_CIPHER_INTEGRITY_FAILED')
    await CapacitorSQLite.close(crashOptions)
    await CapacitorSQLite.deleteDatabase(crashOptions)
    await CapacitorSQLite.closeConnection(crashOptions)
    await CapacitorSQLite.clearEncryptionSecret()
    return {status:'PASS_CRASH_RESUME',ids,integrity:'ok',cipherIntegrity:[]}
  }catch(error){
    return {status:'FAIL_CRASH_SAMPLE',phase,code:/^QA_[A-Z_]+$/.test(error.message)?error.message:'QA_CRASH_OPERATION_FAILED'}
  }
}

const direct=registerPlugin('M0Direct')
const domain=new TextEncoder().encode('ForMyself/Kanata/KEK/v1\u0000')
const rowFor=m=>({id:m.id,world:m.worldId,conversation:m.conversationId,time:m.createdAt,payload:JSON.stringify(m)})
const rejectCode=async(promise,code)=>{
  try{await promise}catch(error){check(error.message===code,'QA_UNEXPECTED_REJECTION');return}
  throw Error('QA_EXPECTED_REJECTION')
}
async function deriveKek(password,encodedSalt){
  const passwordBytes=new TextEncoder().encode(password)
  const salt=new Uint8Array(domain.length+16)
  salt.set(domain)
  salt.set(Uint8Array.from(atob(encodedSalt),character=>character.charCodeAt(0)),domain.length)
  try{
    const key=await crypto.subtle.importKey('raw',passwordBytes,'PBKDF2',false,['deriveBits'])
    return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},key,256))
  }finally{passwordBytes.fill(0)}
}

let lastDirectLease
window.qaDirectSession=async(phase,password)=>{
  const data=header(), scope=scopes(data)[0], args={world:scope.worldId,conversation:scope.conversationId}
  const timings=[],count=100000
  let stage='authorize',lease
  async function measure(name,action){
    stage=name
    const start=performance.now(),value=await action()
    timings.push({name,ms:performance.now()-start})
    return value
  }
  async function submit(token,kek){
    try{
      return await direct.unlock({token,kek:Array.from(kek,value=>value.toString(16).padStart(2,'0')).join('')})
    }finally{kek.fill(0)}
  }
  async function unlock(create,record=true){
    const action=async()=>{
      const challenge=await direct.prepare({create})
      const derive=()=>deriveKek(password,challenge.salt)
      const kek=await (record?measure('kdf',derive):derive())
      return (await submit(challenge.token,kek)).lease
    }
    return record?measure('unlock',action):action()
  }
  const page=async(name,cursor=null)=>{
    const query={lease,...args,...(cursor?{before:cursor.id,time:String(cursor.createdAt)}:{})}
    const messages=await measure(name,async()=>(await direct.page(query)).rows.map(JSON.parse))
    check(messages.length===50,'QA_PAGE_LENGTH')
    for(let i=0;i<messages.length;i++){
      const item=messages[i],previous=messages[i-1]??cursor
      check(item.worldId===args.world&&item.conversationId===args.conversation,'QA_SCOPE')
      check(JSON.stringify(item)===JSON.stringify(message(Number(item.id.slice(-9)),data)),'QA_PAYLOAD_MISMATCH')
      if(previous)check(item.createdAt<previous.createdAt||(item.createdAt===previous.createdAt&&item.id<previous.id),'QA_PAGE_ORDER')
    }
    return messages
  }
  try{
    if(phase==='paused'){
      check(typeof lastDirectLease==='string','QA_PROCESS_NOT_REUSED')
      await rejectCode(direct.page({...args,lease:lastDirectLease}),'QA_SESSION_REVOKED')
      return {status:'PASS_DIRECT_PAUSE'}
    }
    const seed=phase==='seed'
    check(seed||phase==='resume','QA_PHASE_DENIED')
    await rejectCode(direct.page({...args,lease:'invalid'}),'QA_SESSION_REVOKED')
    lease=await unlock(seed)
    if(seed){
      await measure('bulk_write',async()=>{
        for(let start=0;start<count;start+=256){
          const rows=Array.from({length:Math.min(count-start,256)},(_,index)=>rowFor(message(start+index,data)))
          await direct.insert({lease,rows})
        }
      })
      const extra=rowFor(message(count,data))
      await rejectCode(direct.insert({lease,rows:[extra,rowFor(message(0,data))]}),'QA_INSERT_FAILED')
    }
    const near=await page('recent_50')
    await page('next_50',near.at(-1))
    await page('deep_50',message(50000,data))
    if(seed){
      for(let i=0;i<5;i++){
        const extra=rowFor(message(count+i*16,data))
        await measure('single_write',()=>direct.insert({lease,rows:[extra]}))
        const payload=JSON.stringify({...JSON.parse(extra.payload),content:'QA edited',revision:2})
        await measure('single_update',()=>direct.edit({lease,...args,id:extra.id,payload}))
        await direct.remove({lease,...args,id:extra.id})
      }
    }
    const verified=await direct.verify({lease,...args})
    check(verified.rows===count&&verified.cipher.startsWith('4.17.')&&verified.integrity,'QA_DIRECT_INTEGRITY')
    check(verified.plan.includes('SEARCH')&&verified.plan.includes('scope_time'),'QA_INDEX_REQUIRED')
    check(verified.wal==='wal'&&verified.synchronous==='2'&&verified.cacheSize==='-2048'&&verified.checkpoint==='1000','QA_DIRECT_PRAGMA')
    check(!(await CapacitorSQLite.isSecretStored()).result,'QA_DIRECT_PLUGIN_SECRET_PRESENT')
    await direct.lock()
    await rejectCode(direct.page({...args,lease}),'QA_SESSION_REVOKED')
    if(seed){
      lease=await unlock(false,false)
      check((await direct.armCrash({lease})).armed,'QA_ARM_FAILED')
    }else{
      const challenge=await direct.prepare({create:false})
      await rejectCode(submit(challenge.token,await deriveKek(password+'wrong',challenge.salt)),'QA_UNLOCK_FAILED')
      await rejectCode(submit(challenge.token,await deriveKek(password,challenge.salt)),'QA_CHALLENGE_EXPIRED')
      const retired=lease
      lease=await unlock(false,false)
      await rejectCode(direct.page({...args,lease:retired}),'QA_SESSION_REVOKED')
      lastDirectLease=lease
    }
    return {status:seed?'PASS_DIRECT_SEED':'PASS_DIRECT_RESUME',timings,verified}
  }catch(error){
    await direct.lock().catch(()=>{})
    return {status:'FAIL_DIRECT_SAMPLE',stage,code:/^QA_[A-Z_]+$/.test(error.message)?error.message:'QA_DIRECT_FAILED',timings}
  }
}
