import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {migrateKanataSchema} from '../../../../../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import {kanataSchemaAdapter} from '../../../../../../src/features/chat/storage/sqlite/kanataSchemaAdapter.js'
import {createKanataSqliteDomains} from '../../../../../../src/features/chat/storage/sqlite/kanataSqliteDomains.js'
import {m2Fixture,m2FixtureCommands} from '../../../../../../tests/helpers/kanataSqliteM2Fixture.js'
import {growthSeedSql} from '../../../fixture.mjs'

const db=new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys=ON')
let maxRows=0
const tx={query:async(sql,args=[])=>{const rows=db.prepare(sql).all(...args);maxRows=Math.max(maxRows,rows.length);return rows},
  execute:async(sql,args=[])=>({affectedRows:Number(db.prepare(sql).run(...args).changes)})}
const operation={transaction:async action=>{db.exec('BEGIN IMMEDIATE');try{const result=await action(tx);db.exec('COMMIT');return result}
  catch(error){db.exec('ROLLBACK');throw error}}}
try{
  await migrateKanataSchema(kanataSchemaAdapter(operation))
  const fixture=m2Fixture(),sample=fixture.messages[0],worldId=sample.worldId
  await operation.transaction(async tx=>{for(const {sql,parameters}of m2FixtureCommands(fixture))await tx.execute(sql,parameters)})
  const task=fixture.tasks.find(row=>row.worldId===worldId)
  await operation.transaction(async tx=>{
    await tx.execute(growthSeedSql,[1000,'task-bounds',worldId,sample.conversationId,sample.senderId])
    await tx.execute(`INSERT INTO task_sources(world_id,task_id,message_id,message_revision)
      SELECT world_id,?,id,revision FROM messages WHERE world_id=? AND id LIKE 'task-bounds-history-%'`,[task.id,worldId])
  })
  maxRows=0
  const domains=createKanataSqliteDomains(operation,{id:()=>crypto.randomUUID(),clock:()=>1800000})
  const page=await domains.autonomy.listTasks(worldId)
  const returned=page.tasks.find(row=>row.id===task.id)
  const report={probe:'G4 existing task DTO boundary',autonomySourceSha256:createHash('sha256').update(readFileSync(
    new URL('../../../../../../src/features/chat/storage/sqlite/kanataAutonomyRepository.js',import.meta.url))).digest('hex'),
    sourceRows:db.prepare('SELECT count(*) AS n FROM task_sources WHERE world_id=? AND task_id=?').get(worldId,task.id).n,
    maxSqlRows:maxRows,returnedSourceRefs:returned.sourceRefs?.length??0,completeSourceArray:Object.hasOwn(returned,'sourceRefs')}
  console.log(JSON.stringify(report))
  assert.equal(report.completeSourceArray,false,'A task list must not gather all source pages into a complete DTO')
}finally{db.close()}
