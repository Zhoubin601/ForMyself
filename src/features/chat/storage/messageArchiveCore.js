import { cloneKanataJson, requireKanata } from '../domain/kanataJson.js'

export const ARCHIVE_PAGE_SIZE = 50
export const ARCHIVE_BLOOM_BITS = 4096
const check = (ok, code = 'KANATA_ARCHIVE_INVALID') => requireKanata(ok, code, 'messageArchives')
export const messageOrder = (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
export const normalizeArchiveQuery = value => String(value).normalize('NFKC').toLowerCase()
const hash = (text, seed) => {
  let result = seed
  for (let i = 0; i < text.length; ++i) result = Math.imul(result ^ text.charCodeAt(i), 16777619)
  return result >>> 0
}
const positions = token => [hash(token, 2166136261) % ARCHIVE_BLOOM_BITS, hash(token, 2246822519) % ARCHIVE_BLOOM_BITS]
const tokens = text => {
  const chars = Array.from(normalizeArchiveQuery(text)), result = new Set(chars)
  for (let size = 2; size <= 4; ++size) for (let i = size; i <= chars.length; ++i) result.add(chars.slice(i-size,i).join(''))
  return result
}
export function createArchiveIndex(messages) {
  const bits = new Uint8Array(ARCHIVE_BLOOM_BITS / 8)
  for (const message of messages) {
    const content=normalizeArchiveQuery(message.content)
    for (let start=0;start<content.length;) {
      let first=2166136261,second=2246822519
      let next=start
      for (let size=0,end=start;size<4&&end<content.length;++size) {
        const unit=content.charCodeAt(end++)
        first=Math.imul(first^unit,16777619);second=Math.imul(second^unit,16777619)
        if (unit>=0xd800&&unit<=0xdbff&&end<content.length&&content.charCodeAt(end)>=0xdc00&&content.charCodeAt(end)<=0xdfff) {
          const low=content.charCodeAt(end++)
          first=Math.imul(first^low,16777619);second=Math.imul(second^low,16777619)
        }
        if (size===0) next=end
        const firstPosition=first & (ARCHIVE_BLOOM_BITS-1),secondPosition=second & (ARCHIVE_BLOOM_BITS-1)
        bits[firstPosition >>> 3] |= 1 << (firstPosition & 7)
        bits[secondPosition >>> 3] |= 1 << (secondPosition & 7)
      }
      start=next
    }
  }
  return Array.from(bits, byte => byte.toString(16).padStart(2, '0')).join('')
}
/** A negative answer skips a disk read; a positive answer always requires exact text matching. */
export function archiveMayMatch(index, query) {
  check(typeof index === 'string' && /^[a-f0-9]{1024}$/.test(index))
  for (const token of tokens(query)) for (const position of positions(token)) {
    if (!(parseInt(index.slice((position >>> 3) * 2, (position >>> 3) * 2 + 2), 16) & (1 << (position & 7)))) return false
  }
  return true
}

/** Validate a header without loading historical bodies. Reference closure stays in the active graph. */
export function validateMessageArchives(data) {
  const archives = data.messageArchives ?? []
  check(Array.isArray(archives))
  check(data.version === 2 || archives.length === 0, 'KANATA_ARCHIVE_VERSION_REQUIRED')
  if (!archives.length) return archives
  const entities = new Set(['worlds','cards','cardVersions','identities','instances','conversations','messages','lorebookEntries','memories','relationships','events','effects','tasks','lifeGrants','presetApplications'].flatMap(key => data[key].map(row => row.id)))
  for (const key of ['usageEvents','effectBaselines','eventAudits','messageAudits','virtualSchedules']) if (Array.isArray(data[key])) for (const row of data[key]) entities.add(row?.id)
  const pages = new Set(), conversations = new Map(data.conversations.map(c => [c.id, c]))
  for (const page of archives) {
    check(page && typeof page === 'object' && !Array.isArray(page))
    check(page.version === 1, 'UNSUPPORTED_KANATA_ARCHIVE_VERSION')
    check(typeof page.key === 'string' && /^[a-f0-9]{64}$/.test(page.key))
    check(!pages.has(page.key), 'KANATA_ARCHIVE_DUPLICATE_PAGE'); pages.add(page.key)
    check(conversations.has(page.conversationId) && conversations.get(page.conversationId).worldId === page.worldId, 'KANATA_ARCHIVE_SCOPE_DENIED')
    check(Array.isArray(page.messages) && page.messages.length > 0 && page.messages.length <= ARCHIVE_PAGE_SIZE)
    check(Number.isSafeInteger(page.bytes) && page.bytes > 0)
    check(typeof page.index === 'string' && /^[a-f0-9]{1024}$/.test(page.index))
    let previous = null
    for (const row of page.messages) {
      check(typeof row.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.id), 'INVALID_ID')
      check(!entities.has(row.id), 'KANATA_ARCHIVE_DUPLICATE_MESSAGE'); entities.add(row.id)
      check(Number.isSafeInteger(row.revision) && row.revision > 0 && Number.isSafeInteger(row.createdAt) && row.createdAt >= 0)
      check(!previous || messageOrder(previous, row) < 0, 'KANATA_ARCHIVE_ORDER_INVALID'); previous = row
    }
  }
  return archives
}

/**
 * Conservative first conversion: retain external references and their complete reply components.
 * Components that cannot fit a bounded page remain active. Never rewrite or invent a source.
 */
export function planMessageArchive(data, { worldId, conversationId, keepRecent = 200 } = {}) {
  check(Number.isSafeInteger(keepRecent) && keepRecent >= 50 && keepRecent <= 10000, 'KANATA_ARCHIVE_KEEP_INVALID')
  const conversation = data.conversations.find(c => c.id === conversationId && c.worldId === worldId)
  check(conversation, 'KANATA_ARCHIVE_SCOPE_DENIED')
  const messages = data.messages.filter(m => m.worldId === worldId && m.conversationId === conversationId).sort(messageOrder)
  // A compact disjoint-set forest replaces one adjacency array per message. All links
  // are local indices: no message bodies, credentials or reusable graph cache are kept.
  const count = messages.length, byId = new Map()
  const parent = new Uint32Array(count), sizes = new Uint32Array(count)
  for (let i = 0; i < count; ++i) { byId.set(messages[i].id, i); parent[i] = i; sizes[i] = 1 }
  const rootOf = index => {
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index] }
    return index
  }
  for (let i = 0; i < count; ++i) {
    const reply = byId.get(messages[i].replyToMessageId)
    if (reply === undefined) continue
    let first = rootOf(i), second = rootOf(reply)
    if (first === second) continue
    if (sizes[first] < sizes[second]) [first, second] = [second, first]
    parent[second] = first; sizes[first] += sizes[second]
  }
  const retained = new Uint8Array(count)
  for (let i = Math.max(0, count - keepRecent); i < count; ++i) retained[rootOf(i)] = 1
  // Inspect all non-message entities: sourceRefs, audits, custom imported fields, etc.
  // Unknown exact references are conservatively protected too, rather than risking data loss.
  const visit = value => {
    if (typeof value === 'string') {
      const index = byId.get(value)
      if (index !== undefined) retained[rootOf(index)] = 1
      return
    }
    if (value && typeof value === 'object') for (const child of Object.values(value)) visit(child)
  }
  for (const [key, value] of Object.entries(data)) if (key !== 'messages' && key !== 'messageArchives') visit(value)
  // Build each component's ordered linked list in one pass over the sorted rows.
  // `count` is an out-of-range sentinel, so index zero is a valid component head.
  const heads = new Uint32Array(count).fill(count), tails = new Uint32Array(count)
  const next = new Uint32Array(count).fill(count)
  for (let i = 0; i < count; ++i) {
    const root = rootOf(i)
    if (heads[root] === count) heads[root] = i
    else next[tails[root]] = i
    tails[root] = i
  }
  const pages = [], archived = new Uint8Array(count)
  let archivedCount = 0
  let current = []
  for (let i = 0; i < count; ++i) {
    const root = rootOf(i)
    // The head gives exactly the former earliest-message component traversal order.
    if (heads[root] !== i || retained[root] || sizes[root] > ARCHIVE_PAGE_SIZE) continue
    if (current.length + sizes[root] > ARCHIVE_PAGE_SIZE) { pages.push(current.sort(messageOrder)); current = [] }
    for (let index = i; index !== count; index = next[index]) {
      current.push(messages[index]); archived[index] = 1; ++archivedCount
    }
  }
  if (current.length) pages.push(current.sort(messageOrder))
  return { pages, remaining: data.messages.filter(m => {
    const index = byId.get(m.id)
    return index === undefined || !archived[index]
  }), archivedCount }
}

export function validateArchivePage(input, descriptor) {
  const value = cloneKanataJson(input)
  check(value?.type === 'kanata-message-page' && value.version === 1, 'UNSUPPORTED_KANATA_ARCHIVE_VERSION')
  check(value.worldId === descriptor.worldId && value.conversationId === descriptor.conversationId, 'KANATA_ARCHIVE_SCOPE_DENIED')
  check(Array.isArray(value.messages) && value.messages.length === descriptor.messages.length)
  const seen = new Set()
  for (let i = 0; i < value.messages.length; ++i) {
    const row = value.messages[i], meta = descriptor.messages[i]
    check(row?.id === meta.id && row.revision === meta.revision && row.createdAt === meta.createdAt)
    check(typeof row.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.id) && !seen.has(row.id)); seen.add(row.id)
    check(Number.isSafeInteger(row.revision) && row.revision > 0 && Number.isSafeInteger(row.createdAt) && row.createdAt >= 0)
    check(i === 0 || messageOrder(value.messages[i-1],row)<0, 'KANATA_ARCHIVE_ORDER_INVALID')
    check(row.worldId === descriptor.worldId && row.conversationId === descriptor.conversationId, 'KANATA_ARCHIVE_SCOPE_DENIED')
    check(typeof row.content === 'string' && ['user','assistant'].includes(row.role) && ['user','character'].includes(row.senderType))
    check(typeof row.senderId === 'string' && typeof row.senderNameSnapshot === 'string' && ['complete','stopped'].includes(row.status))
    for (const key of ['turnId','batchId']) check(typeof row[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row[key]))
  }
  check(createArchiveIndex(value.messages) === descriptor.index, 'KANATA_ARCHIVE_INDEX_MISMATCH')
  return value.messages
}
