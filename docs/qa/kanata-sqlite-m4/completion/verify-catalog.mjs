import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { eventRevocationQueries, eventRevocationWrites } from '../../../../src/features/chat/storage/sqlite/kanataEventRevocation.js'
import { memoryRows, memoryEdges, memoryWideSources, eventRows, eventEdges, eventFanout, replayEventRows, replayEffectRows,
  fanoutAnalyze, fanoutClearStats, fanoutReloadStats, fanoutCyclePlan, fanoutAuditInspection,
  grantOriginActors, grantOrigins, grantMessageTags } from './fixture.mjs'

const path = process.argv[2]
const catalog = JSON.parse(readFileSync(path, 'utf8'))
assert.equal(catalog.version, 4)
const plans = [...eventRevocationQueries.slice(1,6), ...eventRevocationWrites].map(sql => 'EXPLAIN QUERY PLAN ' + sql)
for (const sql of [memoryRows, memoryEdges, memoryWideSources, eventRows, eventEdges, eventFanout, replayEventRows, replayEffectRows,
  fanoutAnalyze, fanoutClearStats, fanoutReloadStats, fanoutCyclePlan, fanoutAuditInspection, grantOriginActors, grantOrigins, grantMessageTags, ...plans]) {
  const id = createHash('sha256').update(sql).digest('hex')
  assert(!Object.hasOwn(catalog.statements, id), 'Synthetic completion statement is in default catalog')
}
console.log(JSON.stringify({ schema: catalog.version, completionSeedsAbsent: true }))
