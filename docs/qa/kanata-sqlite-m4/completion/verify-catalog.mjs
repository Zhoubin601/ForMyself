import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { memoryRows, memoryEdges, eventRows, eventEdges } from './fixture.mjs'

const path = process.argv[2]
const catalog = JSON.parse(readFileSync(path, 'utf8'))
assert.equal(catalog.version, 4)
for (const sql of [memoryRows, memoryEdges, eventRows, eventEdges]) {
  const id = createHash('sha256').update(sql).digest('hex')
  assert(!Object.hasOwn(catalog.statements, id), 'Completion synthetic seed is in default catalog')
}
console.log(JSON.stringify({ schema: catalog.version, completionSeedsAbsent: true }))
