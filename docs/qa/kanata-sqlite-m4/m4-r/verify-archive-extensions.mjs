import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createKanataConversationRepository } from '../../../../src/features/chat/storage/sqlite/kanataConversationRepository.js'
import { createKanataMessageRepository } from '../../../../src/features/chat/storage/sqlite/kanataMessageRepository.js'
import { KANATA_SCHEMA_MIGRATIONS } from '../../../../src/features/chat/storage/sqlite/kanataSchema.js'
import { planMessageArchive } from '../../../../src/features/chat/storage/messageArchiveCore.js'
import { m2Fixture, m2FixtureCommands } from '../../../../tests/helpers/kanataSqliteM2Fixture.js'
import { growthSeedSql } from '../fixture.mjs'

for (const size of [1000, 10000]) {
  const db = new DatabaseSync(':memory:')
  let maxRows = 0
  try {
    for (const migration of KANATA_SCHEMA_MIGRATIONS) for (const sql of migration.statements) db.exec(sql)
    const fixture = m2Fixture()
    const old = fixture.conversations[0]
    const identity = fixture.identities.find(value => value.worldId === old.worldId)
    const conversation = { ...old, id:'g4-archive-conversation' }
    const scope = { worldId:old.worldId, conversationId:conversation.id }
    const operation = { async transaction(work) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = await work({
          async query(sql, parameters = []) {
            const rows = db.prepare(sql).all(...parameters)
            maxRows = Math.max(maxRows, rows.length)
            return rows
          },
          async execute(sql, parameters = []) { return { affectedRows:db.prepare(sql).run(...parameters).changes } },
        })
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    } }
    await operation.transaction(async tx => {
      for (const {sql,parameters} of m2FixtureCommands(fixture)) await tx.execute(sql,parameters)
    })
    await createKanataConversationRepository(operation).create(conversation)
    db.prepare(growthSeedSql).run(size,'g4-archive',scope.worldId,scope.conversationId,identity.id)
    const raw = db.prepare('SELECT id,world_id AS worldId,conversation_id AS conversationId,created_at AS createdAt FROM messages WHERE conversation_id=? ORDER BY created_at,id')
      .all(scope.conversationId)
    assert.equal(raw.length,size)
    const legacyExtension = { nested:[{ arbitrary:raw[0].id },{ other:raw[1].id }] }
    db.prepare("UPDATE worlds SET extensions_json=json_set(extensions_json,'$.legacyExtension',json(?)) WHERE id=?")
      .run(JSON.stringify(legacyExtension),scope.worldId)
    const oracle = planMessageArchive({ conversations:[conversation], messages:raw, legacyExtension },scope)
    const repository = createKanataMessageRepository(operation,{ clock:()=>1,id:()=> 'g4-archive-audit' })
    maxRows = 0
    const preview = await repository.previewArchive(scope)
    await repository.confirmArchive(scope,preview,'g4-archive-command')
    const marked = db.prepare('SELECT message_id FROM archived_message_marks WHERE conversation_id=? ORDER BY message_id')
      .all(scope.conversationId).map(row=>row.message_id)
    assert.deepEqual(marked,oracle.pages.flat().map(row=>row.id).sort())
    assert.equal(preview.count,size-202)
    assert.ok(maxRows<=50)
    console.log(JSON.stringify({size,archived:preview.count,exactLegacySet:true,maxRows}))
  } finally {
    db.close()
  }
}
