// @ts-check
/** @param {import('./contracts').BackupParticipant[]} participants */
export function createBackupRegistry(participants) {
  /** @type {Map<string, import('./contracts').BackupParticipant>} */
  const entries = new Map()
  for (const p of participants) {
    if (!p.id || entries.has(p.id) || [p.export, p.restore, p.flush, p.ready].some(method => typeof method !== 'function')) throw new Error('INVALID_BACKUP_PARTICIPANT')
    entries.set(p.id, p)
  }
  const list = Object.freeze([...entries.values()])
  const get = (/** @type {string} */ id) => { const p = entries.get(id); if (!p) throw new Error('UNKNOWN_BACKUP_PARTICIPANT'); return p }
  const assertReady = (/** @type {string} */ id) => { if (!get(id).ready()) throw new Error(`BACKUP_PARTICIPANT_NOT_READY:${id}`) }
  const flush = async (ids = [...entries.keys()]) => {
    ids.forEach(assertReady)
    const results = await Promise.allSettled(ids.map(id => Promise.resolve().then(() => get(id).flush())))
    const failure = results.find(result => result.status === 'rejected')
    if (failure) throw failure.reason
  }
  return {
    list, get, flush,
    async initialize() {
      const results = await Promise.allSettled(list.map(p => Promise.resolve().then(() => p.initialize?.())))
      const failed = results.find(result => result.status === 'rejected')
      if (failed) throw failed.reason
      list.forEach(p => assertReady(p.id))
    },
    exportAll() {
      list.forEach(p => assertReady(p.id))
      return JSON.parse(JSON.stringify(Object.fromEntries(list.map(p => [p.id, p.export()]))))
    },
    async restoreAll(/** @type {Record<string, import('./contracts').BackupPart>} */ parts) {
      Object.keys(parts).forEach(get)
      list.forEach(p => { if (!p.optional && !Object.hasOwn(parts, p.id)) throw new Error(`MISSING_BACKUP_PARTICIPANT:${p.id}`) })
      const selected = Object.keys(parts)
      // Validate every participant before the first write.
      selected.forEach(id => get(id).validate?.(parts[id]))
      const results = await Promise.allSettled(selected.map(id => Promise.resolve().then(() => get(id).restore(parts[id]))))
      const flushed = await Promise.allSettled(selected.map(id => Promise.resolve().then(() => get(id).flush())))
      const failure = [...results, ...flushed].find(result => result.status === 'rejected')
      if (failure) throw failure.reason
    },
    singleExport(/** @type {string} */ id) { assertReady(id); const p = get(id); return p.singleExport ? p.singleExport() : p.export().data },
    async singleImport(/** @type {string} */ id, /** @type {unknown} */ value, /** @type {{overwrite: boolean}} */ options) {
      assertReady(id); const p = get(id)
      if (!p.import) throw new Error('SINGLE_IMPORT_NOT_SUPPORTED')
      await p.import(value, options); await p.flush()
      await p.synchronize?.()
    }
  }
}
