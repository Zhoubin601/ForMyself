export const DEFAULT_VAULT_CATEGORY = '未分类'
export const BUILT_IN_VAULT_CATEGORIES = ['社交', '工作', '学习', '财务', '购物', '娱乐', DEFAULT_VAULT_CATEGORY]

export const normalizeVaultCategoryName = value => String(value || '').trim().slice(0, 20)
const normalizeCategory = value => normalizeVaultCategoryName(value) || DEFAULT_VAULT_CATEGORY
const defaultIdFactory = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

export function normalizeVaultCategoryList(categories = []) {
  const normalized = Array.isArray(categories)
    ? categories.map(normalizeVaultCategoryName).filter(Boolean)
    : []
  return [...new Set(normalized)].filter(category => category !== DEFAULT_VAULT_CATEGORY).concat(DEFAULT_VAULT_CATEGORY)
}

export function normalizePasswordVaultRecord(item = {}, idFactory = defaultIdFactory) {
  return {
    id: String(item.id || idFactory()),
    appName: String(item.appName || '').trim(),
    account: String(item.account || ''),
    password: String(item.password || ''),
    category: normalizeCategory(item.category ?? item.group),
    favorite: item.favorite === true || item.isFavorite === true,
    extraFields: Array.isArray(item.extraFields)
      ? item.extraFields.map(field => ({
          fieldName: String(field?.fieldName || ''),
          fieldValue: String(field?.fieldValue || '')
        }))
      : []
  }
}

export function normalizePasswordVaultRecords(data, idFactory = defaultIdFactory) {
  if (!Array.isArray(data)) throw new Error('INVALID_VAULT_DATA')
  const usedIds = new Set()
  return data
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const normalized = normalizePasswordVaultRecord(item, idFactory)
      while (usedIds.has(normalized.id)) normalized.id = String(idFactory())
      usedIds.add(normalized.id)
      return normalized
    })
}

export function getVaultCategories(records = [], savedCategories) {
  const baseCategories = Array.isArray(savedCategories)
    ? normalizeVaultCategoryList(savedCategories)
    : BUILT_IN_VAULT_CATEGORIES
  const recordCategories = records.map(record => normalizeCategory(record.category))
  return normalizeVaultCategoryList([...baseCategories, ...recordCategories])
}

export function isVaultCategoryInUse(records = [], category) {
  const normalized = normalizeVaultCategoryName(category)
  return !!normalized && records.some(record => normalizeCategory(record.category) === normalized)
}

export function compareVaultRecords(a, b) {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
  const categoryCompare = String(a.category || '').localeCompare(String(b.category || ''), 'zh-CN')
  if (categoryCompare) return categoryCompare
  return String(a.appName || '').localeCompare(String(b.appName || ''), 'zh-CN')
}
