import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { stringActionSql } from '../src/features/chat/storage/sqlite/kanataActionSql.js'
import { actionCases } from './helpers/kanataEventCompatibilityOracle.js'

test('E SQL action spread preserves UTF-16 units, escapes and long original lexemes',()=>{
  const db=new DatabaseSync(':memory:')
  try{
    const sql=db.prepare(`SELECT ${stringActionSql} AS body FROM (SELECT ? AS extensions_json) e`)
    const inputs=[...actionCases.filter(([,value])=>typeof value==='string').map(([,value])=>value),
      '\u0000\b\f\n\r\t"\\/','\\u1234',String.fromCharCode(...Array.from({length:256},(_,i)=>i)),
      'x😀界\ud800y\udc00'.repeat(1000),'a'.repeat(10000)]
    for(const value of inputs){
      const raw=JSON.stringify({action:value})
      const {body}=sql.get(raw)
      assert.deepEqual(JSON.parse(body),{...value})
      assert.equal(JSON.stringify(JSON.parse(body)),JSON.stringify({...value}))
      // Equivalent escaped/literal JSON must not depend on SQLite's decoder.
      const escaped=raw.replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))
      assert.deepEqual(JSON.parse(sql.get(escaped).body),{...value})
    }
  }finally{db.close()}
})
