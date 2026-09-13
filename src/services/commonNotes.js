export const normalizeNote = value => String(value ?? '').trim()
export function normalizeCommonNotes(value = {}) {
  const list = items => [...new Set((Array.isArray(items) ? items : []).map(normalizeNote).filter(Boolean))]
  return { savings: list(value?.savings), weight: list(value?.weight) }
}
