import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { KANATA_SCHEMA_MIGRATIONS } from '../../../../src/features/chat/storage/sqlite/kanataSchema.js'
import { requireLifeSources } from '../../../../src/features/chat/storage/sqlite/kanataProvenance.js'
import { canUseKanataLifeSources } from '../../../../src/features/chat/experience/kanataKnowledge.js'
import { m2Fixture, m2FixtureCommands } from '../../../../tests/helpers/kanataSqliteM2Fixture.js'

const db = new DatabaseSync(':memory:')
try {
  for (const migration of KANATA_SCHEMA_MIGRATIONS) {
    for (const sql of migration.statements) db.exec(sql)
  }
  const fixture = m2Fixture()
  const originActor = fixture.instances[0]
  const worldId = originActor.worldId
  const peer = fixture.instances.find(actor => actor.worldId === worldId && actor.id !== originActor.id)
  const otherWorld = fixture.worlds.find(world => world.id !== worldId)
  db.exec('BEGIN')
  for (const { sql, parameters } of m2FixtureCommands(fixture)) db.prepare(sql).run(...parameters)
  db.exec('COMMIT')
  const origin = db.prepare("SELECT id,revision FROM life_grants WHERE world_id=? AND instance_id=? AND module_id='todo'")
    .get(worldId, originActor.id)
  const peerGrantId = 'qa-peer-grant'
  db.prepare("INSERT INTO life_grants(id,world_id,instance_id,module_id,revision,can_read,can_remember,can_share) VALUES(?,?,?,'todo',1,0,0,0)")
    .run(peerGrantId, worldId, peer.id)
  const update = db.prepare('UPDATE life_grants SET can_read=?,can_remember=?,can_share=? WHERE id=?')
  const tag = { grantId: origin.id, instanceId: originActor.id, moduleId: 'todo', revision: origin.revision, fingerprint: 'b'.repeat(64) }
  const flags = mask => ({ read: Boolean(mask & 1), remember: Boolean(mask & 2), share: Boolean(mask & 4) })
  const tx = { async query(sql, args) { return db.prepare(sql).all(...args) } }
  const grant = (id, instanceId, revision, permissions) => ({ id, worldId, instanceId, moduleId: 'todo', revision, ...permissions })
  const modes = Array.from({ length: 8 }, (_, mask) => ({
    group: Boolean(mask & 1), remember: Boolean(mask & 2), share: Boolean(mask & 4),
  }))
  let compared = 0
  for (let sourceFlags = 0; sourceFlags < 8; sourceFlags++) {
    for (let receiverFlags = 0; receiverFlags < 8; receiverFlags++) {
      const left = flags(sourceFlags), right = flags(receiverFlags)
      update.run(...Object.values(left).map(Number), origin.id)
      update.run(...Object.values(right).map(Number), peerGrantId)
      const lifeGrants = [grant(origin.id, originActor.id, origin.revision, left), grant(peerGrantId, peer.id, 1, right)]
      for (const instanceId of [originActor.id, peer.id]) {
        for (const mode of modes) {
          const scope = { worldId, instanceId, ...mode }
          const expected = (!scope.share || left.share) && canUseKanataLifeSources({ lifeGrants }, [tag], scope)
          if (expected) await requireLifeSources(tx, [tag], scope)
          else await assert.rejects(requireLifeSources(tx, [tag], scope), /KANATA_LIFE_PERMISSION_DENIED/)
          compared++
        }
      }
    }
  }
  const scope = { worldId, instanceId: peer.id, group: false, remember: true, share: true }
  for (const wrong of [{ ...tag, revision: origin.revision + 1 }, { ...tag, instanceId: peer.id }, { ...tag, moduleId: 'home' }, { ...tag, grantId: 'absent' }]) {
    await assert.rejects(requireLifeSources(tx, [wrong], scope), /KANATA_LIFE_PERMISSION_DENIED/)
  }
  await assert.rejects(requireLifeSources(tx, [tag], { ...scope, worldId: otherWorld.id }), /KANATA_LIFE_PERMISSION_DENIED/)
  console.log(JSON.stringify({ flagCombinationsCompared: compared, wrongIdentityRevisionAndWorldRejected: 5, exit: 0 }))
} finally {
  db.close()
}
