import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { sha256Text } from '../../shared/crypto/sha256Text.js'
import {encodeRestorePayload,decodeRestorePayload} from './restorePayloadCodec.js'

export const RESTORE_PATH = 'formyself/restore-v1.enc'
const COMMIT_PATH = 'formyself/restore-v1.commit'
const TEMP_PATH = 'formyself/restore-v1.tmp'
const missing = e => /(?:not found|does not exist|不存在|ENOENT)/i.test(String(e?.message || e))
const base64 = bytes => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(text)
}
const bytes = value => Uint8Array.from(atob(value), ch => ch.charCodeAt(0))
const derive = async (password, salt) => {
  if (!password) throw new Error('RESTORE_PASSWORD_REQUIRED')
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
export async function sealRestoreRecord(value, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await derive(password, salt)
  const payload=await encodeRestorePayload(value)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload))
  return JSON.stringify({ version: 1, salt: base64(salt), iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) })
}
export async function openRestoreRecord(value, password) {
  const envelope = JSON.parse(value)
  if (envelope.version !== 1) throw new Error('UNSUPPORTED_RESTORE_RECORD')
  const key = await derive(password, bytes(envelope.salt))
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv) }, key, bytes(envelope.ciphertext))
  return decodeRestorePayload(new TextDecoder().decode(plaintext))
}
export function createRestoreJournal(filesystem = Filesystem) {
  const options = path => ({ path, directory: Directory.Data, encoding: Encoding.UTF8 })
  const read = async path => {
    try { return String((await filesystem.readFile(options(path))).data) }
    catch (e) { if (missing(e)) return null; throw e }
  }
  const remove = async path => { try { await filesystem.deleteFile(options(path)) } catch (e) { if (!missing(e)) throw e } }
  const writeVerified = async (path, data) => {
    await filesystem.writeFile({ ...options(path), data, recursive: true })
    if (await read(path) !== data) throw new Error('RESTORE_JOURNAL_WRITE_FAILED')
  }
  const inspect = async () => {
    const encrypted = await read(RESTORE_PATH)
    if (encrypted === null) {
      // No business writes can start until the final journal exists.
      await remove(COMMIT_PATH); await remove(TEMP_PATH)
      return null
    }
    const marker = await read(COMMIT_PATH)
    const digest = sha256Text(encrypted)
    if (marker !== null && JSON.parse(marker).digest !== digest) throw new Error('RESTORE_COMMIT_MISMATCH')
    return { encrypted, committed: marker !== null, digest }
  }
  return {
    inspect,
    async prepare(record, password) {
      if (await inspect()) throw new Error('RESTORE_ALREADY_PENDING')
      const encrypted = await sealRestoreRecord(record, password)
      await writeVerified(TEMP_PATH, encrypted)
      await filesystem.rename({ from: TEMP_PATH, to: RESTORE_PATH, directory: Directory.Data, toDirectory: Directory.Data })
      if (await read(RESTORE_PATH) !== encrypted) throw new Error('RESTORE_JOURNAL_VERIFY_FAILED')
      // Bind later compensation to the exact bytes this call verified, never a replacement
      // record that happened to appear between preparation and the coordinator's inspection.
      return {digest:sha256Text(encrypted)}
    },
    async commit() {
      const record = await inspect()
      if (!record) throw new Error('RESTORE_RECORD_MISSING')
      await writeVerified(COMMIT_PATH, JSON.stringify({ digest: record.digest }))
    },
    async clear() {
      // Removing the prepared record first prevents a committed restore becoming an uncommitted rollback on restart.
      await remove(RESTORE_PATH); await remove(COMMIT_PATH); await remove(TEMP_PATH)
    }
  }
}
export const restoreJournal = createRestoreJournal()
