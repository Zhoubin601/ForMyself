import assert from 'node:assert/strict'
import test from 'node:test'
import {planMessageArchive, messageOrder} from '../src/features/chat/storage/messageArchiveCore.js'
import {archiveData} from './helpers/kanataArchiveFixture.js'

// Independent graph traversal oracle: expresses the original component/page semantics,
// without sharing the production disjoint-set algorithm or its indexing assumptions.
function referencePlan(data, request) {
  const messages = data.messages.filter(m => m.worldId === request.worldId && m.conversationId === request.conversationId).sort(messageOrder)
  const rows = new Map(messages.map(m => [m.id, m])), links = new Map(messages.map(m => [m.id, new Set()]))
  for (const row of messages) if (rows.has(row.replyToMessageId)) {
    links.get(row.id).add(row.replyToMessageId); links.get(row.replyToMessageId).add(row.id)
  }
  const keep = new Set(messages.slice(-request.keepRecent).map(m => m.id))
  const visit = value => {
    if (typeof value === 'string') { if (rows.has(value)) keep.add(value) }
    else if (value && typeof value === 'object') for (const child of Object.values(value)) visit(child)
  }
  for (const key of Object.keys(data)) if (!['messages', 'messageArchives'].includes(key)) visit(data[key])
  const seen = new Set(), pages = []
  let page = []
  for (const row of messages) {
    if (seen.has(row.id)) continue
    const component = [], queue = [row.id]; seen.add(row.id)
    for (let i = 0; i < queue.length; ++i) {
      const id = queue[i]; component.push(rows.get(id))
      for (const neighbour of links.get(id)) if (!seen.has(neighbour)) { seen.add(neighbour); queue.push(neighbour) }
    }
    component.sort(messageOrder)
    if (component.length > 50 || component.some(m => keep.has(m.id))) continue
    if (page.length + component.length > 50) { pages.push(page.sort(messageOrder)); page = [] }
    page.push(...component)
  }
  if (page.length) pages.push(page.sort(messageOrder))
  const ids = new Set(pages.flat().map(m => m.id))
  return {pages, remaining: data.messages.filter(m => !ids.has(m.id)), archivedCount: ids.size}
}
const requestFor = data => ({worldId: data.worlds[0].id, conversationId: data.conversations[0].id, keepRecent: 50})
const samePlan = (data, request) => {
  const before = JSON.stringify(data), actual = planMessageArchive(data, request)
  assert.deepEqual(actual, referencePlan(data, request))
  assert.equal(JSON.stringify(data), before)
  assert.equal(actual.remaining.length + actual.archivedCount, data.messages.length)
  assert.equal(new Set([...actual.remaining, ...actual.pages.flat()].map(m => m.id)).size, data.messages.length)
  for (const page of actual.pages) {
    assert(page.length <= 50)
    for (const row of page) assert.equal(row, data.messages.find(m => m.id === row.id))
  }
  return actual
}

test('P7 compact archive planning agrees with graph traversal across deterministic branched, cyclic and interleaved graphs', () => {
  for (let seed = 1; seed <= 60; ++seed) {
    let random = seed
    const next = max => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % max }
    const data = archiveData(240 + next(600)), request = requestFor(data)
    for (const row of data.messages) {
      row.createdAt = 1000 + next(300)
      delete row.replyToMessageId; delete row.replyToRevision
      if (next(4)) row.replyToMessageId = data.messages[next(data.messages.length)].id
    }
    data.extensions = {unknownOriginalRefs: [data.messages[next(data.messages.length)].id, {nested: data.messages[0].id}]}
    // Nonchronological original order must also be preserved in `remaining`.
    for (let i = data.messages.length - 1; i > 0; --i) { const j = next(i + 1); [data.messages[i], data.messages[j]] = [data.messages[j], data.messages[i]] }
    samePlan(data, request)
  }
})

test('P7 source at index zero pins its entire component, and recent descendants pin older ancestors', () => {
  const data = archiveData(400), request = requestFor(data)
  data.extensions = {nested: [null, {proof: data.messages[0].id}]}
  data.messages.at(-1).replyToMessageId = data.messages[20].id
  const plan = samePlan(data, request), kept = new Set(plan.remaining.map(m => m.id))
  for (const n of [0, 1, 20, 21, 399]) assert(kept.has('synthetic-message-' + n))
})

test('P7 exactly 50 connected messages fit a page; larger components and components crossing the recent boundary remain complete', () => {
  const data = archiveData(300), request = requestFor(data)
  for (const row of data.messages) { delete row.replyToMessageId; delete row.replyToRevision }
  for (let i = 1; i < 50; ++i) data.messages[i].replyToMessageId = data.messages[i - 1].id
  for (let i = 51; i < 101; ++i) data.messages[i].replyToMessageId = data.messages[i - 1].id
  data.messages[250].replyToMessageId = data.messages[110].id
  const plan = samePlan(data, request)
  assert.deepEqual(plan.pages[0], data.messages.slice(0, 50))
  for (let i = 50; i < 101; ++i) assert(plan.remaining.includes(data.messages[i]))
  assert(plan.remaining.includes(data.messages[110]))
})

test('P7 planning keeps other-world/conversation rows and unknown source references without fetching their history', () => {
  const data = archiveData(300), request = requestFor(data)
  data.messages.push(...data.messages.slice(0, 20).map((row, i) => ({...row, id: 'other-world-' + i, worldId: 'other-world', conversationId: 'other-conversation'})))
  data.extensions = {privateSource: data.messages[30].id}
  data.messageArchives = [{unknown: 'synthetic-message-40'}] // archive metadata does not pin active bodies
  const plan = samePlan(data, request)
  assert.equal(plan.remaining.filter(m => m.worldId === 'other-world').length, 20)
  assert(plan.remaining.includes(data.messages[30])); assert(plan.remaining.includes(data.messages[31]))
  assert(plan.pages.flat().includes(data.messages[40]))
  assert.equal(planMessageArchive({...data, messages: []}, request).archivedCount, 0)
})
