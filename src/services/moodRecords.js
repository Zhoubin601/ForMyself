export const DEFAULT_MOOD_TAG = '学习'
export const BUILT_IN_MOOD_TAGS = ['工作', '学习', '家庭', '睡眠']

const VALID_MOODS = new Set(['great', 'good', 'normal', 'bad', 'terrible'])
const MAX_TAG_LENGTH = 12
const MAX_TAGS_PER_RECORD = 8

export function normalizeMoodTag(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_TAG_LENGTH)
}

export function normalizeMoodTags(value) {
  const source = Array.isArray(value) ? value : value ? [value] : []
  const tags = [...new Set(source.map(normalizeMoodTag).filter(Boolean))]
  return (tags.length ? tags : [DEFAULT_MOOD_TAG]).slice(0, MAX_TAGS_PER_RECORD)
}

const defaultIdFactory = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export function normalizeMoodRecord(record = {}, idFactory = defaultIdFactory) {
  const { tag: _legacyTag, ...canonicalRecord } = record
  return {
    ...canonicalRecord,
    id: String(record.id || idFactory()),
    date: String(record.date || ''),
    mood: VALID_MOODS.has(record.mood) ? record.mood : 'normal',
    note: String(record.note || ''),
    tags: normalizeMoodTags(record.tags ?? record.tag)
  }
}

export function normalizeMoodRecords(records = [], idFactory = defaultIdFactory) {
  if (!Array.isArray(records)) return []
  const usedIds = new Set()

  return records
    .filter(record => record && typeof record === 'object' && record.date)
    .map(record => {
      const normalized = normalizeMoodRecord(record, idFactory)
      while (usedIds.has(normalized.id)) normalized.id = String(idFactory())
      usedIds.add(normalized.id)
      return normalized
    })
}

export function getCustomMoodTags(records = [], savedTags = []) {
  const allTags = [
    ...(Array.isArray(savedTags) ? savedTags : []),
    ...records.flatMap(record => normalizeMoodTags(record.tags ?? record.tag))
  ]
  return [...new Set(allTags.map(normalizeMoodTag).filter(Boolean))]
    .filter(tag => !BUILT_IN_MOOD_TAGS.includes(tag))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

export function compareMoodRecordsNewestFirst(a, b) {
  const dateCompare = String(b.date || '').localeCompare(String(a.date || ''))
  if (dateCompare) return dateCompare
  const createdCompare = Number(b.createdAt || 0) - Number(a.createdAt || 0)
  if (createdCompare) return createdCompare
  return String(b.id || '').localeCompare(String(a.id || ''))
}
