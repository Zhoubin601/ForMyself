import { DatabaseSync } from 'node:sqlite'
import { migrateKanataSchema } from '../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { kanataSchemaAdapter } from '../../src/features/chat/storage/sqlite/kanataSchemaAdapter.js'
import { createKanataSqliteDomains } from '../../src/features/chat/storage/sqlite/kanataSqliteDomains.js'
import { m2Fixture,m2FixtureCommands } from './kanataSqliteM2Fixture.js'

export async function eventCompatFixture(){
  const db=new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  let sequence=0
  const tx={query:async(sql,args=[])=>db.prepare(sql).all(...args),
    execute:async(sql,args=[])=>({affectedRows:Number(db.prepare(sql).run(...args).changes)})}
  const operation={transaction:async action=>{
    db.exec('BEGIN IMMEDIATE')
    try{const result=await action(tx);db.exec('COMMIT');return result}
    catch(error){db.exec('ROLLBACK');throw error}
  }}
  await migrateKanataSchema(kanataSchemaAdapter(operation))
  const fixture=m2Fixture()
  await operation.transaction(async tx=>{for(const {sql,parameters} of m2FixtureCommands(fixture))await tx.execute(sql,parameters)})
  const domains=createKanataSqliteDomains(operation,{id:()=>`er1-${String(++sequence).padStart(5,'0')}`,clock:()=>1800000})
  const {worldId,id:instanceId}=fixture.instances[0]
  const fields={worldId,participantIds:[instanceId],sourceRefs:[],causedByEventIds:[],
    visibility:'private',summary:'ER1 合成事件',effectiveAt:1500,kind:'note',causality:'explicit'}
  return {db,tx,operation,domains,fixture,worldId,instanceId,fields,close:()=>db.close()}
}
