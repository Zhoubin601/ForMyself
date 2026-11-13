import {createKanataMessageRepository} from '../../../../../../src/features/chat/storage/sqlite/kanataMessageRepository.js'
import {messageSnapshotWrites} from '../../../../../../src/features/chat/storage/sqlite/kanataMessageSnapshot.js'

export const messageAuditSummary=`SELECT count(*) AS audits,
  sum(CASE WHEN (previous_json -> '$.lifeSources')=(m.extensions_json -> '$.lifeSources')
    AND (next_json -> '$.lifeSources')=(m.extensions_json -> '$.lifeSources') THEN 1 ELSE 0 END) AS exact_tags,
  sum(CASE WHEN (previous_json -> '$.syntheticExtra')=json(?) AND (next_json -> '$.syntheticExtra')=json(?) THEN 1 ELSE 0 END) AS exact_extensions,
  max(next_revision) AS revision FROM message_audits a JOIN messages m ON m.world_id=a.world_id AND m.id=a.message_id
  WHERE a.world_id=? AND a.message_id=?`
export const messageAuditCount='SELECT count(*) AS audits FROM message_audits WHERE world_id=? AND message_id=?'
const seedLinks=`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<?)
  INSERT INTO message_life_sources(world_id,message_id,grant_id,instance_id,module_id,grant_revision,fingerprint)
  SELECT ?,?,?,?,?,?,printf('%064x',n) FROM seq`
const seedHint=`UPDATE messages SET extensions_json=json_set(extensions_json,'$.lifeSources',json((
  SELECT json_group_array(json(tag)) FROM (SELECT json_object('grantId',l.grant_id,'instanceId',l.instance_id,
    'moduleId',l.module_id,'revision',l.grant_revision,'fingerprint',l.fingerprint) AS tag
    FROM message_life_sources l WHERE l.world_id=messages.world_id AND l.message_id=messages.id ORDER BY l.fingerprint DESC)
))) WHERE world_id=? AND id=?`
const seedDistinct=`UPDATE messages SET extensions_json=json_insert(extensions_json,'$.lifeSources[#]',
  json_set(extensions_json -> '$.lifeSources[0]','$.extra','same normalized link, distinct original record')) WHERE world_id=? AND id=?`
export const messageFixtureWrites=[seedLinks,seedHint,seedDistinct]
const check=(condition,code)=>{if(!condition)throw Error(code)}
async function rejects(action,code){try{await action()}catch(error){check((error.code??error.message).includes(code),'UNEXPECTED_'+(error.code??error.message));return}throw Error('EXPECTED_'+code)}

// Synthetic-only probes. Explicit input fixtures and test-only reconstruction
// sinks are separate from the observed ordinary Repository read/write path.
export async function runMessageBoundedDevice(candidate,fixture,commands,commitFault){
  return candidate.run({create:true},async operation=>{
    await operation.transaction(async tx=>{for(const {sql,parameters}of commands)await tx.execute(sql,parameters)})
    const health=await operation.health(),results=[]
    for(const size of [1000,10000]){
      const started=performance.now()
      const progress=(phase,detail={})=>{window.messageBoundedPhase={size,phase,elapsedMs:Math.round(performance.now()-started),...detail}}
      progress('prepare')
      let maxRows=0,maxText=0,phase='ordinary'
      const guarded={transaction:action=>operation.transaction(tx=>action({
        execute:tx.execute,query:async(sql,args)=>{const rows=await tx.query(sql,args)
          maxRows=Math.max(maxRows,rows.length)
          if(phase==='ordinary')for(const row of rows)for(const value of Object.values(row))
            if(typeof value==='string')maxText=Math.max(maxText,Array.from(value).length)
          return rows},
      }))}
      let sequence=0
      const tools={id:()=>`message-bounded-audit-${size}-${++sequence}`,clock:()=>2300}
      const messages=createKanataMessageRepository(guarded,tools)
      const sample=fixture.messages[0],scope={worldId:sample.worldId,conversationId:sample.conversationId}
      const source=sample.lifeSources[0]
      const tags=Array.from({length:size},(_,i)=>({grantId:source.grantId,instanceId:source.instanceId,moduleId:source.moduleId,
        revision:source.revision,fingerprint:(i+1).toString(16).padStart(64,'0')})).reverse()
      tags.push({...tags[0],extra:'same normalized link, distinct original record'})
      const extra={raw:'合成😀界\ud800'.repeat(2000),future:{retained:[false,null,7]}}
      const {lifeSources:_sampleTags,...base}=sample
      const root={...base,id:'message-bounded-root-'+size,revision:1,syntheticExtra:extra}
      const originalReply=fixture.messages.find(row=>row.replyToMessageId===sample.id)
      const {lifeSources:_replyTags,...replyBase}=originalReply
      const reply={...replyBase,id:'message-bounded-reply-'+size,revision:1,replyToMessageId:root.id,replyToRevision:1,syntheticExtra:extra}
      await messages.insertBatch([root,reply])
      check(await messages.insert(root)==='existing','MESSAGE_IDEMPOTENCY')
      // Preserve the unchanged 262144-character Native parameter cap. Wide
      // synthetic tags are seeded in SQLite, not sent as a giant input DTO.
      await operation.transaction(async tx=>{for(const message of [root,reply]){
        await tx.execute(seedLinks,[size,scope.worldId,message.id,source.grantId,source.instanceId,source.moduleId,source.revision])
        await tx.execute(seedHint,[scope.worldId,message.id]);await tx.execute(seedDistinct,[scope.worldId,message.id])
      }})
      await rejects(()=>messages.insert(root),'ID_CONFLICT')
      for(const row of [(await messages.get(scope,root.id)),...(await messages.recent(scope)).messages,
        ...(await messages.replies(scope,root.id)).messages])check(!Object.hasOwn(row,'lifeSources')&&!Object.hasOwn(row,'syntheticExtra'),'MESSAGE_FULL_DTO')
      for(const sql of [messageSnapshotWrites[0],messageSnapshotWrites[1],messageSnapshotWrites[3]]){
        const faulted=createKanataMessageRepository({transaction:action=>operation.transaction(tx=>action({query:tx.query,
          execute:async(statement,args)=>{const result=await tx.execute(statement,args);if(statement===sql)throw Error('SYNTHETIC_STAGE_FAILURE');return result},
        }))},tools)
        await rejects(()=>faulted.revise(scope,root.id,1,{content:'must rollback',deleted:false}),'SYNTHETIC_STAGE_FAILURE')
        check((await messages.state(scope,root.id)).revision===1,'MESSAGE_PARTIAL_REVISION')
      }
      const commitFaulted=createKanataMessageRepository({transaction:action=>operation.transaction(async tx=>{
        const result=await action(tx)
        await tx.execute(commitFault,['message-bounded-orphan','missing-card',1,'{}','{}','synthetic'])
        return result
      })},tools)
      await rejects(()=>commitFaulted.setStatus(scope,root.id,1,'stopped'),'TRANSACTION_FAILED')
      check((await messages.state(scope,root.id)).revision===1,'MESSAGE_COMMIT_PARTIAL')
      const first=await messages.sourcePage(scope,root.id)
      let cursor,links=0,pages=0
      progress('source-pages')
      do{const page=await messages.sourcePage(scope,root.id,cursor);check(page.rows.length<=50,'MESSAGE_SOURCE_PAGE_LIMIT')
        links+=page.rows.length;pages++;cursor=page.cursor??undefined
        if(pages%50===0)progress('source-pages',{pages})}while(cursor)
      check(links===size,'MESSAGE_SOURCE_TAIL')
      phase='chunks'
      progress('chunks')
      let text='',chunks=0,maxChunk=0,chunkCursor
      do{const page=await messages.jsonChunk(scope,root.id,{kind:'extensions'},chunkCursor)
        maxChunk=Math.max(maxChunk,Array.from(page.fragment).length);chunks++;text+=page.fragment;chunkCursor=page.cursor??undefined
        if(chunks%50===0)progress('chunks',{chunks})
      }while(chunkCursor)
      check(maxChunk<=4096,'MESSAGE_CHUNK_LIMIT')
      const reconstructed=JSON.parse(text)
      check(JSON.stringify(reconstructed.lifeSources)===JSON.stringify(tags),'MESSAGE_EXACT_TAGS')
      check(JSON.stringify(reconstructed.syntheticExtra)===JSON.stringify(extra),'MESSAGE_EXACT_EXTENSIONS')
      text=''
      const frozen=await messages.jsonChunk(scope,root.id,{kind:'extensions'})
      phase='ordinary'
      progress('revise')
      await messages.setStatus(scope,root.id,1,'stopped')
      await rejects(()=>messages.sourcePage(scope,root.id,first.cursor),'CURSOR_INVALID')
      await rejects(()=>messages.jsonChunk(scope,root.id,{kind:'extensions'},frozen.cursor),'CURSOR_INVALID')
      const receipt=await messages.revise(scope,root.id,2,{content:'合成有界修订',deleted:false})
      check(JSON.stringify(receipt)===JSON.stringify({id:root.id,revision:3}),'MESSAGE_WRITE_RECEIPT')
      check((await messages.state(scope,reply.id)).status==='stopped','MESSAGE_REPLY_INVALIDATION')
      for(const [id,count]of [[root.id,2],[reply.id,1]]){
        const [summary]=await operation.transaction(tx=>tx.query(messageAuditSummary,[JSON.stringify(extra),JSON.stringify(extra),scope.worldId,id]))
        check(summary.audits===count&&summary.exact_tags===count&&summary.exact_extensions===count,'MESSAGE_EXACT_AUDITS')
      }
      check(maxRows<=51&&maxText<=4096,'MESSAGE_BRIDGE_BOUND')
      progress('complete')
      results.push({size,pages,links,chunks,maxChunk,maxRows,maxText,elapsedMs:Math.round(performance.now()-started),stageRollback:true,realCommitRollback:true,exactAudits:true})
    }
    return {status:'PASS',health,results,realModelCalls:0}
  })
}

let crash='idle'
export const messageCrashState=()=>crash
export function armMessageCrash(candidate,scope){
  crash='idle'
  void candidate.run({},async operation=>{
    const guarded={transaction:action=>operation.transaction(tx=>action({query:tx.query,execute:async(sql,args)=>{
      const result=await tx.execute(sql,args)
      if(sql===messageSnapshotWrites[1]){crash='message-audit-uncommitted';await new Promise(()=>{})}
      return result
    }}))}
    const messages=createKanataMessageRepository(guarded,{id:()=>crypto.randomUUID(),clock:Date.now})
    await messages.revise(scope,'message-bounded-root-10000',3,{content:'合成强停重试',deleted:false})
  }).catch(error=>{crash=error.code??error.message})
  return 'armed'
}
export async function recoverMessageCrash(candidate,scope){
  return candidate.run({},async operation=>{
    const messages=createKanataMessageRepository(operation,{id:()=>crypto.randomUUID(),clock:Date.now})
    const id='message-bounded-root-10000'
    const before=await messages.state(scope,id)
    const [count]=await operation.transaction(tx=>tx.query(messageAuditCount,[scope.worldId,id]))
    check(before.revision===3&&count.audits===2,'MESSAGE_CRASH_ROLLBACK')
    await messages.revise(scope,id,3,{content:'合成强停重试',deleted:false})
    await rejects(()=>messages.revise(scope,id,3,{content:'合成强停重试',deleted:false}),'REVISION_CONFLICT')
    const after=await messages.state(scope,id)
    const [next]=await operation.transaction(tx=>tx.query(messageAuditCount,[scope.worldId,id]))
    check(after.revision===4&&next.audits===3,'MESSAGE_CRASH_RETRY')
    return {before:{revision:before.revision,audits:count.audits},after:{revision:after.revision,audits:next.audits},staleRetryRejected:true}
  })
}
