import { encryptKanataData, KANATA_DATA_PATH, KANATA_RECOVERY_KEY } from '../../../src/features/chat/storage/kanataRepository.js'
import { sha256Text } from '../../../src/shared/crypto/sha256Text.js'
import { kanataSqliteEncryptedLegacySource } from '../../../tests/helpers/kanataSqliteEncryptedLegacySource.js'

export const seed = 'm5-06-v1'
export const causalEventId = 'm5-06-causal-event'
export const eventCausesDigestSql = 'SELECT rowid AS __rowid,world_id,event_id,cause_event_id FROM event_causes WHERE rowid>? ORDER BY rowid LIMIT 50'
export const inspectSql = {
  archive: "SELECT cursor_json,imported_count,state FROM data_migrations WHERE collection='messages.archive'",
  manifest: "SELECT state,extensions_json FROM data_migrations WHERE collection='__manifest__'",
  first: 'SELECT content,extensions_json FROM messages WHERE id=?',
  dataset: 'SELECT count(*) AS count FROM dataset_metadata',
  marks: 'SELECT count(*) AS count FROM archived_message_marks',
  messages: 'SELECT count(*) AS count FROM messages',
  lifeSources: 'SELECT count(*) AS count FROM message_life_sources',
  recent: 'SELECT id,created_at FROM messages WHERE world_id=? AND conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 50',
  older: 'SELECT id,created_at FROM messages WHERE world_id=? AND conversation_id=? AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT 50',
}
const nativePragmas = new Map([
  ['PRAGMA user_version', 'SELECT user_version FROM pragma_user_version'],
  ['PRAGMA application_id', 'SELECT application_id FROM pragma_application_id'],
  ['PRAGMA foreign_keys', 'SELECT foreign_keys FROM pragma_foreign_keys'],
  ['PRAGMA foreign_key_check', 'SELECT * FROM pragma_foreign_key_check'],
  ['PRAGMA integrity_check', 'SELECT integrity_check FROM pragma_integrity_check'],
])
// The frozen native catalog uses literal PRAGMAs in its separate schema phase.
// Equivalent table-valued queries give the QA import its own business-phase IDs.
export const nativeQuery = sql => nativePragmas.get(sql) ?? sql

export async function encryptedFixture(data, count, password) {
  const legacy = kanataSqliteEncryptedLegacySource()
  const template = data.messages[0]
  const { worldId, conversationId } = template
  const cause = data.events[0]
  data.events.push({ ...cause, id: causalEventId, causedByEventIds: [cause.id], sourceRefs: [], lifeSources: [] })
  data.version = 2
  data.messageArchives = []
  template.m5Extension = { seed, nested: ['保存🚀', false, null] }
  const archivedCount = count - data.messages.length
  for (let start = 0; start < archivedCount; start += 50) {
    const messages = Array.from({ length: Math.min(50, archivedCount - start) }, (_, index) => {
      const position = start + index
      return { ...template, id: 'm5-history-' + String(position).padStart(6, '0'),
        createdAt: 1 + Math.floor(900 * position / archivedCount),
        content: '合成历史🚀 Caf\u00e9 ' + (position % 23), revision: 1,
        ...(position < 3 ? {} : { lifeSources: [] }) }
    })
    data.messageArchives.push(await legacy.repository.archives.write(messages, password, { worldId, conversationId }))
  }
  const ciphertext = encryptKanataData(data, password)
  legacy.files.set(KANATA_DATA_PATH, ciphertext)
  const primaryHash = sha256Text(ciphertext)
  legacy.values.set(KANATA_RECOVERY_KEY, JSON.stringify({
    type: 'kanata-recovery', version: 1, baseFingerprint: primaryHash, ciphertext,
  }))
  return { legacy, primaryHash, scope: { worldId, conversationId },
    causalEdge: [cause.worldId, causalEventId, cause.id] }
}

export function unpackFixture({ files, journal }, mutate) {
  const legacy = kanataSqliteEncryptedLegacySource()
  for (const [path, value] of files) legacy.files.set(path, value)
  legacy.values.set(KANATA_RECOVERY_KEY, journal)
  mutate?.(legacy.files, legacy.values)
  return legacy
}
