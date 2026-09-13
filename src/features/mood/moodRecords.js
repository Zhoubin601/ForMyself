export const DEFAULT_MOOD_TAG = '学习'
export const BUILT_IN_MOOD_TAGS = ['工作', '学习', '家庭', '睡眠']
export const MOOD_BACKUP_TYPE = 'formyself-mood-backup'
export const MOOD_BACKUP_VERSION = 2

export const DEFAULT_MOOD_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'great', emoji: '🤩', label: '超赞', color: '#34C759', order: 0, displayPriority: 50, archived: false, isDefault: false }),
  Object.freeze({ id: 'good', emoji: '🙂', label: '开心', color: '#75C86B', order: 1, displayPriority: 40, archived: false, isDefault: false }),
  Object.freeze({ id: 'normal', emoji: '😐', label: '一般', color: '#FFCC00', order: 2, displayPriority: 30, archived: false, isDefault: true }),
  Object.freeze({ id: 'bad', emoji: '😔', label: '低落', color: '#FF9500', order: 3, displayPriority: 20, archived: false, isDefault: false }),
  Object.freeze({ id: 'terrible', emoji: '😫', label: '极差', color: '#FF3B30', order: 4, displayPriority: 10, archived: false, isDefault: false })
])

const MAX_TAG_LENGTH = 12
const MAX_TAGS_PER_RECORD = 8
const MAX_MOOD_LABEL_LENGTH = 12
const DEFAULT_UNKNOWN_COLOR = '#8E8E93'
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/
const EMOJI_PATTERN = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3)/u
const cloneJson = value => JSON.parse(JSON.stringify(value))
const graphemes = value => {
  const text = String(value || '')
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(text)].map(item => item.segment)
  }
  return Array.from(text)
}

export function normalizeMoodId(value) {
  const id = String(value || '').trim().slice(0, 64)
  return id && !/[\u0000-\u001F\u007F]/u.test(id) ? id : ''
}

export function normalizeMoodLabel(value) {
  const compact = String(value || '').trim().replace(/\s+/g, ' ')
  return graphemes(compact).slice(0, MAX_MOOD_LABEL_LENGTH).join('')
}

export function normalizeMoodEmoji(value) {
  const parts = graphemes(String(value || '').trim())
  return parts.length === 1 && EMOJI_PATTERN.test(parts[0]) ? parts[0] : ''
}

export function normalizeMoodColor(value, fallback = DEFAULT_UNKNOWN_COLOR) {
  const color = String(value || '').trim().toUpperCase()
  return HEX_COLOR_PATTERN.test(color) ? color : fallback
}

export function normalizeMoodTag(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH)
}

export function normalizeMoodTags(value) {
  const source = Array.isArray(value) ? value : value ? [value] : []
  const tags = [...new Set(source.map(normalizeMoodTag).filter(Boolean))]
  return (value == null ? [DEFAULT_MOOD_TAG] : tags).slice(0, MAX_TAGS_PER_RECORD)
}

const defaultIdFactory = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export function normalizeMoodRecord(record = {}, idFactory = defaultIdFactory, defaultMoodId = 'normal') {
  const { tag: _legacyTag, ...canonicalRecord } = record
  return {
    ...canonicalRecord,
    id: String(record.id || idFactory()),
    date: String(record.date || ''),
    mood: normalizeMoodId(record.mood) || normalizeMoodId(defaultMoodId) || 'normal',
    note: String(record.note || ''),
    tags: record.autoFilled ? [] : normalizeMoodTags(record.tags ?? record.tag)
  }
}

export function normalizeMoodRecords(records = [], idFactory = defaultIdFactory, defaultMoodId = 'normal') {
  if (!Array.isArray(records)) return []
  const usedIds = new Set()
  return records.filter(record => record && typeof record === 'object' && record.date).map(record => {
    const normalized = normalizeMoodRecord(record, idFactory, defaultMoodId)
    while (usedIds.has(normalized.id)) normalized.id = String(idFactory())
    usedIds.add(normalized.id)
    return normalized
  })
}

const nextUniqueLabel = (base, usedLabels) => {
  const normalizedBase = normalizeMoodLabel(base) || '历史心情'
  if (!usedLabels.has(normalizedBase)) return normalizedBase
  for (let index = 2; index < 1000; index++) {
    const suffix = String(index)
    const candidate = `${graphemes(normalizedBase).slice(0, MAX_MOOD_LABEL_LENGTH - suffix.length).join('')}${suffix}`
    if (!usedLabels.has(candidate)) return candidate
  }
  return `历史${Date.now().toString(36).slice(-6)}`
}

export function normalizeMoodDefinitions(value, records = []) {
  const supplied = Array.isArray(value) && value.length ? value : DEFAULT_MOOD_DEFINITIONS
  const defaultPriorities = new Map(DEFAULT_MOOD_DEFINITIONS.map(item => [item.id, item.displayPriority]))
  // Upgrade the previous release's untouched, all-zero built-in priorities.
  const migrateZeroDefaults = DEFAULT_MOOD_DEFINITIONS.every(base => supplied.some(item => item?.id === base.id && Number(item.displayPriority ?? 0) === 0 && item.priorityDefaultsVersion !== 1))
  const byId = new Map()
  const usedLabels = new Set()
  supplied.map((definition, index) => ({ definition, index }))
    .filter(({ definition }) => definition && typeof definition === 'object' && !Array.isArray(definition))
    .sort((a, b) => {
      const left = Number(a.definition.order)
      const right = Number(b.definition.order)
      return (Number.isFinite(left) ? left : a.index) - (Number.isFinite(right) ? right : b.index) || a.index - b.index
    })
    .forEach(({ definition }) => {
      const id = normalizeMoodId(definition.id)
      const emoji = normalizeMoodEmoji(definition.emoji)
      const baseLabel = normalizeMoodLabel(definition.label)
      if (!id || !emoji || !baseLabel || byId.has(id)) return
      const label = nextUniqueLabel(baseLabel, usedLabels)
      usedLabels.add(label)
      byId.set(id, {
        id, emoji, label,
        color: normalizeMoodColor(definition.color),
        displayPriority: normalizeMoodPriority((definition.displayPriority == null || migrateZeroDefaults) && defaultPriorities.has(id) ? defaultPriorities.get(id) : definition.displayPriority),
        order: byId.size,
        archived: definition.archived === true,
        isDefault: definition.isDefault === true
      })
    })

  if (!byId.size) DEFAULT_MOOD_DEFINITIONS.forEach(item => {
    byId.set(item.id, { ...item })
    usedLabels.add(item.label)
  })

  ;(Array.isArray(records) ? records : []).forEach(record => {
    const id = normalizeMoodId(record?.mood)
    if (!id || byId.has(id)) return
    const label = nextUniqueLabel(`历史心情 ${id}`, usedLabels)
    usedLabels.add(label)
    byId.set(id, { id, emoji: '❔', label, color: DEFAULT_UNKNOWN_COLOR, order: byId.size, archived: true, isDefault: false })
  })

  let definitions = [...byId.values()]
  let active = definitions.filter(item => !item.archived)
  if (!active.length) {
    const fallback = definitions.find(item => item.id === 'normal') || definitions[0]
    fallback.archived = false
    active = [fallback]
  }
  const defaultDefinition = active.find(item => item.isDefault) || active.find(item => item.id === 'normal') || active[0]
  definitions = definitions.map((item, order) => ({ ...item, priorityDefaultsVersion: 1, displayPriority: normalizeMoodPriority(item.displayPriority), order, isDefault: item.id === defaultDefinition.id }))
  return definitions
}

export function getDefaultMoodDefinition(definitions = []) {
  const normalized = normalizeMoodDefinitions(definitions)
  return normalized.find(item => item.isDefault && !item.archived) || normalized.find(item => !item.archived) || normalized[0]
}

export function resolveMoodDefinition(definitions = [], id = '') {
  const normalized = normalizeMoodDefinitions(definitions)
  return normalized.find(item => item.id === id) || getDefaultMoodDefinition(normalized)
}

export function mergeMoodDefinitions(current = [], incoming = [], records = []) {
  const merged = new Map(normalizeMoodDefinitions(current, records).map(item => [item.id, item]))
  normalizeMoodDefinitions(incoming, records).forEach(item => {
    if (!merged.has(item.id)) merged.set(item.id, { ...item, isDefault: false })
  })
  return normalizeMoodDefinitions([...merged.values()], records)
}

export function getCustomMoodTags(records = [], savedTags = [], builtInTags = BUILT_IN_MOOD_TAGS) {
  const allTags = [...(Array.isArray(savedTags) ? savedTags : []), ...records.flatMap(record => normalizeMoodTags(record.tags ?? record.tag))]
  return [...new Set(allTags.map(normalizeMoodTag).filter(Boolean))]
    .filter(tag => !builtInTags.includes(tag))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

export function buildMoodBackupSnapshot({ records = [], trackingStartDate = '', customTags = [], definitions = [], builtInTags = BUILT_IN_MOOD_TAGS, defaultTags = [DEFAULT_MOOD_TAG] } = {}, createdAt = new Date().toISOString()) {
  builtInTags = normalizeMoodTagCatalog(builtInTags)
  const baseDefinitions = normalizeMoodDefinitions(definitions)
  const defaultMoodId = getDefaultMoodDefinition(baseDefinitions).id
  const normalizedRecords = normalizeMoodRecords(records, undefined, defaultMoodId)
  return {
    type: MOOD_BACKUP_TYPE,
    version: MOOD_BACKUP_VERSION,
    createdAt: String(createdAt),
    data: { records: cloneJson(normalizedRecords) },
    metadata: {
      trackingStartDate: /^\d{4}-\d{2}-\d{2}$/.test(String(trackingStartDate || '')) ? String(trackingStartDate) : '',
      customTags: getCustomMoodTags(normalizedRecords, customTags, builtInTags),
      builtInTags: normalizeMoodTagCatalog(builtInTags),
      defaultTags: normalizeMoodTags(defaultTags),
      definitions: cloneJson(normalizeMoodDefinitions(definitions, normalizedRecords))
    }
  }
}

export function normalizeMoodBackupSnapshot(value, fallbackDefinitions = []) {
  if (Array.isArray(value)) return buildMoodBackupSnapshot({ records: value, definitions: fallbackDefinitions })
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_MOOD_BACKUP')
  if (value.type !== MOOD_BACKUP_TYPE) throw new Error('INVALID_MOOD_BACKUP_TYPE')
  if (![1, MOOD_BACKUP_VERSION].includes(value.version)) throw new Error('UNSUPPORTED_MOOD_BACKUP_VERSION')
  if (!value.data || !Array.isArray(value.data.records)) throw new Error('INVALID_MOOD_BACKUP_RECORDS')
  const snapshot = buildMoodBackupSnapshot({
    records: value.data.records,
    trackingStartDate: value.metadata?.trackingStartDate,
    customTags: value.metadata?.customTags,
    builtInTags: value.metadata?.builtInTags,
    defaultTags: value.metadata?.defaultTags,
    definitions: Array.isArray(value.metadata?.definitions) && value.metadata.definitions.length
      ? value.metadata.definitions
      : fallbackDefinitions
  }, value.createdAt)
  if (!snapshot.createdAt || Number.isNaN(Date.parse(snapshot.createdAt))) throw new Error('INVALID_MOOD_BACKUP_DATE')
  return snapshot
}

export function compareMoodRecordsNewestFirst(a, b) {
  const dateCompare = String(b.date || '').localeCompare(String(a.date || ''))
  if (dateCompare) return dateCompare
  const createdCompare = Number(b.createdAt || 0) - Number(a.createdAt || 0)
  if (createdCompare) return createdCompare
  return String(b.id || '').localeCompare(String(a.id || ''))
}

export function normalizeMoodPriority(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(999, Math.trunc(number))) : 0
}

export function normalizeMoodTagCatalog(value = BUILT_IN_MOOD_TAGS) {
  return [...new Set((Array.isArray(value) ? value : BUILT_IN_MOOD_TAGS).map(normalizeMoodTag).filter(Boolean))]
}

export function compareMoodDayRecords(a, b, definitions = []) {
  const manual = Number(Boolean(a.autoFilled)) - Number(Boolean(b.autoFilled))
  const priority = id => normalizeMoodPriority(definitions.find(item => item.id === id)?.displayPriority)
  return manual || priority(b.mood) - priority(a.mood)
    || Number(b.createdAt || 0) - Number(a.createdAt || 0)
    || String(b.id || '').localeCompare(String(a.id || ''))
}
