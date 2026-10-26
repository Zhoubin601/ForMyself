import { ref } from 'vue'

// The driver is injected; stores share failure semantics without sharing business data.
export function createStorePersistence(isDataLoaded, driver) {
  const loadStatus = ref('idle'), loadError = ref(''), saveStatus = ref('saved'), saveError = ref('')
  const pending = new Map()
  let chain = Promise.resolve(), loading = null
  const assertReady = () => {
    if (!isDataLoaded.value) throw new Error('数据尚未安全加载，请先重试读取')
  }
  const write = options => {
    assertReady()
    const entry = { ...options }
    pending.set(entry.key, entry)
    saveStatus.value = 'saving'
    const result = chain.then(async () => {
      try {
        await driver.set(entry)
        if (pending.get(entry.key) === entry) pending.delete(entry.key)
        if (!pending.size) { saveStatus.value = 'saved'; saveError.value = '' }
      } catch (error) {
        saveStatus.value = 'error'; saveError.value = '保存失败，最新修改仍在当前应用中，请重试保存，成功前请勿关闭应用'
        throw error
      }
    })
    chain = result.catch(() => {})
    return result
  }
  const flush = async () => {
    assertReady()
    await chain
    if (pending.size) {
      // Snapshot the latest values, including edits made while a previous write failed.
      for (const entry of [...pending.values()]) await write(entry)
    }
    await chain
    if (pending.size) throw new Error(saveError.value || '数据尚未保存')
  }
  const load = (read, commit, afterLoad = async () => {}) => {
    if (loading) return loading
    loading = (async () => {
      if (pending.size) await flush() // Never replace an unsaved draft with an older disk value.
      loadStatus.value = 'loading'; loadError.value = ''; isDataLoaded.value = false
      let value
      try { value = await read() }
      catch {
        loadStatus.value = 'error'; loadError.value = '读取失败，原数据已保留，请重试读取'
        return false
      }
      commit(value)
      isDataLoaded.value = true; loadStatus.value = 'ready'
      try { await afterLoad() } catch { /* write() retains the failed value and visible status */ }
      return true
    })().finally(() => { loading = null })
    return loading
  }
  const expose = { loadStatus, loadError, saveStatus, saveError, flush, retrySave: flush }
  return { load, assertReady, write, expose, storage: { get: options => driver.get(options), set: write } }
}

export function parseStoredJson(value, fallback, kind = 'array') {
  if (value == null) return fallback
  const parsed = JSON.parse(value)
  const object = item => item && typeof item === 'object' && !Array.isArray(item)
  const valid = kind === 'records' ? Array.isArray(parsed) && parsed.every(object)
    : kind === 'array' ? Array.isArray(parsed) : object(parsed)
  if (!valid) throw new Error('INVALID_STORED_DATA')
  return parsed
}
