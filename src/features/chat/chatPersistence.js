import { ref } from 'vue'
import { preferenceStorage } from '../../platform/storage/preferences.js'
import { STORAGE_KEYS } from '../../platform/storage/keys.js'
import { chatCiphertextFingerprint, decryptChatData, encryptChatData } from './chatStorage.js'

// Pending work contains ciphertext only, so it can survive a session lock without its password.
export function createChatPersistence(storage, journal = preferenceStorage) {
  const saveError = ref('')
  const hasPendingSave = ref(false)
  let pending = null
  let fingerprint = ''
  let chain = Promise.resolve()

  const persistLatest = async () => {
    if (!pending) return
    const candidate = pending
    candidate.baseFingerprint = fingerprint
    let journalSaved = false
    try {
      await journal.set({ key: STORAGE_KEYS.chatRecovery, value: JSON.stringify(candidate) })
      journalSaved = true
    } catch { /* The encrypted in-memory copy remains available if both stores are unavailable. */ }
    try {
      await storage.saveEncrypted(candidate.ciphertext)
      fingerprint = chatCiphertextFingerprint(candidate.ciphertext)
      if (pending === candidate) {
        pending = null
        hasPendingSave.value = false
      } else {
        pending.baseFingerprint = fingerprint
      }
      // A stale journal is harmless: load checks its base against the actual file fingerprint.
      await journal.remove({ key: STORAGE_KEYS.chatRecovery }).catch(() => {})
      if (!pending) saveError.value = ''
    } catch (error) {
      saveError.value = journalSaved
        ? '聊天尚未保存，已保留加密恢复副本；重新验证后会自动重试。'
        : '聊天尚未保存，请重试；恢复前请勿强制结束或卸载应用。'
      throw error
    }
  }

  const retry = () => {
    const task = chain.catch(() => {}).then(persistLatest)
    chain = task
    return task
  }
  const queue = (value, password) => {
    pending = { version: 1, baseFingerprint: fingerprint, ciphertext: encryptChatData(value, password) }
    hasPendingSave.value = true
    return retry()
  }

  const load = async password => {
    await chain.catch(() => {})
    let recovery = pending
    if (!recovery) {
      try {
        const result = await journal.get({ key: STORAGE_KEYS.chatRecovery })
        const value = JSON.parse(result.value || 'null')
        if (value?.version === 1 && typeof value.ciphertext === 'string' && value.ciphertext && typeof value.baseFingerprint === 'string') recovery = value
      } catch { /* A valid primary file remains usable when the journal cannot be read. */ }
    }
    let result, primaryError
    try { result = await storage.load(password) } catch (error) { primaryError = error }
    const actualFingerprint = result?.fingerprint || ''
    if (recovery && (recovery === pending || !result || recovery.baseFingerprint === actualFingerprint || chatCiphertextFingerprint(recovery.ciphertext) === actualFingerprint)) {
      const data = decryptChatData(recovery.ciphertext, password)
      pending = recovery
      hasPendingSave.value = true
      fingerprint = actualFingerprint
      // Saving may still fail; keep the restored data visible with an explicit warning.
      await retry().catch(() => {})
      return { data, recovered: true }
    }
    if (primaryError) throw primaryError
    fingerprint = actualFingerprint
    // A newer primary file wins over an older journal whose removal previously failed.
    if (recovery) await journal.remove({ key: STORAGE_KEYS.chatRecovery }).catch(() => {})
    saveError.value = ''
    return result
  }

  const reencrypt = async (value, password) => {
    await retry()
    const ciphertext = encryptChatData(value, password)
    await storage.saveEncrypted(ciphertext)
    fingerprint = chatCiphertextFingerprint(ciphertext)
  }

  return { saveError, hasPendingSave, queue, retry, load, reencrypt, wait: () => chain }
}
