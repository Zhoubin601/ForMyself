import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {migrateKanataSchema} from '../../../../../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import {kanataSchemaAdapter} from '../../../../../../src/features/chat/storage/sqlite/kanataSchemaAdapter.js'
import {createKanataMessageRepository} from '../../../../../../src/features/chat/storage/sqlite/kanataMessageRepository.js'
import {m2Fixture,m2FixtureCommands} from '../../../../../../tests/helpers/kanataSqliteM2Fixture.js'
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON')
let maxText=0,maxRows=0
const tx={query:async(sql,args=[])=>{
  const rows=db.prepare(sql).all(...args);maxRows=Math.max(maxRows,rows.length)
  for(const row of rows)for(const value of Object.values(row))if(typeof value==='string')maxText=Math.max(maxText,Array.from(value).length)
  return rows
},execute:async(sql,args=[])=>({affectedRows:Number(db.prepare(sql).run(...args).changes)})}
const operation={transaction:async action=>{db.exec('BEGIN IMMEDIATE');try{const result=await action(tx);db.exec('COMMIT');return result}
  catch(error){db.exec('ROLLBACK');throw error}}}
try{
  await migrateKanataSchema(kanataSchemaAdapter(operation))
  const fixture=m2Fixture(),base=fixture.messages[0],scope={worldId:base.worldId,conversationId:base.conversationId}
  await operation.transaction(async tx=>{for(const {sql,parameters}of m2FixtureCommands(fixture))await tx.execute(sql,parameters)})
  const messages=createKanataMessageRepository(operation,{id:()=>crypto.randomUUID(),clock:()=>1800000})
  // Every input is below the existing Native 262144 UTF-16-unit binding cap.
  const input={...base,id:'message-text-budget',revision:1,createdAt:1800000,
    content:'甲'.repeat(63998)+'合成',senderNameSnapshot:'名'.repeat(64000)}
  await messages.insert(input)
  const results=[]
  for(const [name,action]of [
    ['window',()=>messages.recent(scope)],['quote',()=>messages.quote(scope,input.id)],
    ['search',()=>messages.searchHistory(scope,'合成')],
  ]){
    maxRows=maxText=0;await action();results.push({name,maxRows,maxText})
  }
  const sql=readFileSync(new URL('../../../../../../src/features/chat/storage/sqlite/kanataRepositorySql.js',import.meta.url))
  console.log(JSON.stringify({probe:'Existing G2/G4 message scalar display paths',sqlSourceSha256:createHash('sha256').update(sql).digest('hex'),
    inputUtf16Lengths:{body:input.content.length,name:input.senderNameSnapshot.length},results,
    note:'4096 is the proposed display/chunk bound reused from existing detail reads; failure records the actual unbounded projection, not a new product requirement or M4 task.'}))
  assert(results.every(row=>row.maxText<=4097),'Ordinary display paths must retain a bounded scalar fragment and explicit continuation, not the complete long field')
}finally{db.close()}
