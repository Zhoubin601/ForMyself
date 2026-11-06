import {DatabaseSync} from 'node:sqlite'

/** Real SQLite adapter implementing the M1 exclusive transaction contract. Test-only. */
export function schemaHarness(path=':memory:', options={}) {
  const db=new DatabaseSync(path), writes=[]
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=50')
  const tx={
    execute:async(sql,parameters=[])=>{
      writes.push(sql)
      options.beforeExecute?.(sql,parameters)
      db.prepare(sql).run(...parameters)
    },
    query:async(sql,parameters=[])=>db.prepare(sql).all(...parameters)
  }
  const connection={transaction:async operation=>{
    db.exec('BEGIN IMMEDIATE')
    try {
      const result=await operation(tx)
      options.beforeCommit?.(db)
      db.exec('COMMIT')
      return result
    } catch(error) {
      db.exec('ROLLBACK')
      throw error
    }
  }}
  return {db,tx,connection,writes,close:()=>db.close()}
}
