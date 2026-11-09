import { kanataFixtureCommands, kanataSqliteFixture } from './kanataSqliteFixture.js'
import { validateKanataData } from '../../src/features/chat/domain/kanataValidation.js'

export function m2Fixture() {
  const data = kanataSqliteFixture()
  const [message] = data.messages
  message.deleted = false
  message.syntheticExtra = { nested: ['保留', 7] }
  Object.assign(data.messageAudits[0].previous, { syntheticExtra: message.syntheticExtra })
  Object.assign(data.messageAudits[0].next, { syntheticExtra: message.syntheticExtra, deleted: false })
  const root = data.events[0]
  root.syntheticExtra = { retained: true }
  const relation = data.relationships.find(row => row.worldId === root.worldId)
  const instance = data.instances.find(row => row.id === data.effects[0].targetId)
  data.events.push(
    { ...root, id: 'event-dependent', sourceRefs: [], causedByEventIds: [root.id], effectiveAt: 1001, lifeSources: [] },
    { ...root, id: 'event-independent', sourceRefs: [], causedByEventIds: [], effectiveAt: 1002, lifeSources: [] },
    { ...root, id: 'event-revoked', status: 'revoked', sourceRefs: [], causedByEventIds: ['event-dependent'], effectiveAt: 1003, lifeSources: [] },
  )
  const effect = data.effects[0]
  Object.assign(effect, { value: '合成覆盖' })
  data.effects.push(
    { ...effect, id: 'effect-independent', eventId: 'event-independent', value: '保留独立效果' },
    { ...effect, id: 'effect-revoked', eventId: 'event-revoked', targetType: 'relationship', targetId: relation.id,
      path: 'dimensions.trust', operation: 'increment', value: 0.03 },
  )
  data.effectBaselines.push({ id: 'baseline-revoked', worldId: root.worldId, targetType: 'relationship',
    targetId: relation.id, path: 'dimensions.trust', value: relation.dimensions.trust })
  instance.state.mood = '保留独立效果'
  Object.assign(data.tasks[0], { state: 'running', leaseUntil: 1300 })
  return validateKanataData(data)
}

export const auditInspection = Object.freeze({
  messages: 'SELECT id,previous_json,next_json FROM message_audits WHERE world_id=? ORDER BY id LIMIT 100',
  events: 'SELECT id,previous_json,next_json FROM event_audits WHERE world_id=? ORDER BY id LIMIT 100',
  eventRows: 'SELECT id,status,revision FROM world_events WHERE world_id=? ORDER BY id LIMIT 100',
  memories: 'SELECT id,status,revision FROM memories WHERE world_id=? ORDER BY id LIMIT 100',
  instances: 'SELECT id,mood,revision FROM character_instances WHERE world_id=? ORDER BY id LIMIT 100',
  relationships: 'SELECT id,trust,revision FROM relationships WHERE world_id=? ORDER BY id LIMIT 100',
  tasks: 'SELECT id,state,lease_until,error_code FROM background_tasks WHERE world_id=? ORDER BY id LIMIT 100',
})

export const fixtureWrites = Object.freeze({
  message: 'UPDATE messages SET deleted=?,revision=revision+1,extensions_json=? WHERE id=? AND revision=?',
  messageExtensions: 'UPDATE messages SET extensions_json=? WHERE id=?',
  event: 'UPDATE world_events SET causality=?,kind=?,extensions_json=? WHERE id=?',
  deferredCommit: 'INSERT INTO card_versions(id,card_id,revision,definition_json,raw_data_json,source) VALUES(?,?,?,?,?,?)',
})
export const futureSchema = 'PRAGMA user_version = 999'

export function m2FixtureCommands(data = m2Fixture()) {
  // Keep the historic structural fixture writer intact. This projection writes the
  // optional fields and order hints exercised by the M2 parity and fault cases.
  const commands = kanataFixtureCommands(data)
  for (const command of commands) {
    if (command.sql.startsWith('INSERT INTO messages(')) {
      const message = data.messages.find(row => row.id === command.parameters[0])
      command.sql = command.sql.replace('reply_to_revision)', 'reply_to_revision,deleted,extensions_json)')
        .replace(/\)$/, ',?,?)')
      command.parameters.push(message.deleted === undefined ? null : Number(message.deleted), JSON.stringify({
        ...(message.lifeSources !== undefined && { lifeSources: message.lifeSources }),
        ...(message.syntheticExtra !== undefined && { syntheticExtra: message.syntheticExtra }),
      }))
    }
    if (command.sql.startsWith('INSERT INTO world_events(')) {
      const event = data.events.find(row => row.id === command.parameters[0])
      command.sql = command.sql.replace('revision)', 'revision,causality,kind,extensions_json)')
        .replace(/\)$/, ',?,?,?)')
      command.parameters.push(event.causality ?? null, event.kind ?? null, JSON.stringify({
        participantIds: event.participantIds, sourceRefs: event.sourceRefs, causedByEventIds: event.causedByEventIds,
        ...(event.lifeSources !== undefined && { lifeSources: event.lifeSources }),
        ...(event.syntheticExtra !== undefined && { syntheticExtra: event.syntheticExtra }),
      }))
    }
  }
  return commands
}
