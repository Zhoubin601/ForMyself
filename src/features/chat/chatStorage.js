import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import CryptoJS from 'crypto-js'
import { normalizeChatData } from './chatRecords.js'

export const CHAT_DATA_DIRECTORY = 'formyself'
export const CHAT_DATA_PATH = `${CHAT_DATA_DIRECTORY}/warm-home-v1.enc`
export const CHAT_TEMP_PATH = `${CHAT_DATA_DIRECTORY}/warm-home-v1.tmp`
export const CHAT_BACKUP_PATH = `${CHAT_DATA_DIRECTORY}/warm-home-v1.bak`

const isMissingFileError = error => /(?:not found|does not exist|不存在|ENOENT)/i.test(String(error?.message || error))

export function encryptChatData(value, password) {
  if (!password) throw new Error('MISSING_ENCRYPTION_PASSWORD')
  return CryptoJS.AES.encrypt(JSON.stringify(normalizeChatData(value)), password).toString()
}

export function decryptChatData(value, password) {
  if (!password) throw new Error('MISSING_ENCRYPTION_PASSWORD')
  let plaintext = ''
  try {
    plaintext = CryptoJS.AES.decrypt(String(value || ''), password).toString(CryptoJS.enc.Utf8)
  } catch {
    throw new Error('CHAT_DECRYPT_FAILED')
  }
  if (!plaintext) throw new Error('CHAT_DECRYPT_FAILED')
  try {
    return normalizeChatData(JSON.parse(plaintext))
  } catch {
    throw new Error('CHAT_DATA_CORRUPTED')
  }
}

export function createChatStorage(filesystem = Filesystem, directory = Directory.Data) {
  const readEncrypted = async path => {
    const result = await filesystem.readFile({ path, directory, encoding: Encoding.UTF8 })
    return String(result.data || '')
  }

  const exists = async path => {
    try {
      await filesystem.stat({ path, directory })
      return true
    } catch (error) {
      if (isMissingFileError(error)) return false
      throw error
    }
  }

  const removeIfExists = async path => {
    if (await exists(path)) await filesystem.deleteFile({ path, directory })
  }

  const load = async password => {
    let primaryError = null
    for (const [path, recovered] of [
      [CHAT_DATA_PATH, false],
      [CHAT_BACKUP_PATH, true],
      [CHAT_TEMP_PATH, true]
    ]) {
      try {
        if (!await exists(path)) continue
        return { data: decryptChatData(await readEncrypted(path), password), recovered }
      } catch (error) {
        if (!recovered) primaryError = error
      }
    }
    if (primaryError) throw primaryError
    return { data: normalizeChatData(), recovered: false }
  }

  const save = async (value, password) => {
    const encrypted = encryptChatData(value, password)
    await filesystem.mkdir({ path: CHAT_DATA_DIRECTORY, directory, recursive: true }).catch(error => {
      if (!/exist/i.test(String(error?.message || error))) throw error
    })
    await filesystem.writeFile({
      path: CHAT_TEMP_PATH,
      data: encrypted,
      directory,
      encoding: Encoding.UTF8
    })
    decryptChatData(await readEncrypted(CHAT_TEMP_PATH), password)

    const hadPrimary = await exists(CHAT_DATA_PATH)
    if (hadPrimary) {
      await removeIfExists(CHAT_BACKUP_PATH)
      await filesystem.rename({
        from: CHAT_DATA_PATH,
        to: CHAT_BACKUP_PATH,
        directory,
        toDirectory: directory
      })
    }

    try {
      await filesystem.rename({
        from: CHAT_TEMP_PATH,
        to: CHAT_DATA_PATH,
        directory,
        toDirectory: directory
      })
    } catch (error) {
      if (hadPrimary && await exists(CHAT_BACKUP_PATH) && !await exists(CHAT_DATA_PATH)) {
        await filesystem.rename({
          from: CHAT_BACKUP_PATH,
          to: CHAT_DATA_PATH,
          directory,
          toDirectory: directory
        }).catch(() => {})
      }
      throw error
    }
    return normalizeChatData(value)
  }

  return { load, save }
}
