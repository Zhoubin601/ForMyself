import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHAT_BACKUP_PATH,
  CHAT_DATA_PATH,
  CHAT_TEMP_PATH,
  createChatStorage,
  decryptChatData,
  encryptChatData
} from '../src/services/chatStorage.js'

const missing = path => Object.assign(new Error(`File does not exist: ${path}`), { code: 'ENOENT' })

const createFakeFilesystem = () => {
  const files = new Map()
  let failNextTempRename = false
  return {
    files,
    failTempRename() {
      failNextTempRename = true
    },
    async stat({ path }) {
      if (!files.has(path)) throw missing(path)
      return { type: 'file' }
    },
    async readFile({ path }) {
      if (!files.has(path)) throw missing(path)
      return { data: files.get(path) }
    },
    async writeFile({ path, data }) {
      files.set(path, String(data))
    },
    async mkdir() {},
    async deleteFile({ path }) {
      if (!files.has(path)) throw missing(path)
      files.delete(path)
    },
    async rename({ from, to }) {
      if (from === CHAT_TEMP_PATH && failNextTempRename) {
        failNextTempRename = false
        throw new Error('simulated rename failure')
      }
      if (!files.has(from)) throw missing(from)
      files.set(to, files.get(from))
      files.delete(from)
    }
  }
}

const fixture = content => ({
  profile: { companionName: '小暖' },
  messages: [{ id: `m-${content}`, role: 'user', content, createdAt: 10 }],
  memories: []
})

test('聊天文件使用主密码加密往返，错误密码无法解密', () => {
  const encrypted = encryptChatData(fixture('你好'), 'correct-password')
  assert.equal(encrypted.includes('你好'), false)
  assert.equal(decryptChatData(encrypted, 'correct-password').messages[0].content, '你好')
  assert.throws(() => decryptChatData(encrypted, 'wrong-password'), /CHAT_DECRYPT_FAILED/)
})

test('加密聊天存储保存后可读取，并在主文件损坏时只读恢复上一版', async () => {
  const filesystem = createFakeFilesystem()
  const storage = createChatStorage(filesystem, 'DATA')
  await storage.save(fixture('第一版'), 'password')
  await storage.save(fixture('第二版'), 'password')

  filesystem.files.set(CHAT_DATA_PATH, 'corrupted-primary')
  const result = await storage.load('password')

  assert.equal(result.recovered, true)
  assert.equal(result.data.messages[0].content, '第一版')
  assert.equal(filesystem.files.get(CHAT_DATA_PATH), 'corrupted-primary')
  assert.ok(filesystem.files.has(CHAT_BACKUP_PATH))
})

test('首次保存中断时可以从已校验的临时文件恢复', async () => {
  const filesystem = createFakeFilesystem()
  filesystem.files.set(CHAT_TEMP_PATH, encryptChatData(fixture('临时恢复'), 'password'))
  const storage = createChatStorage(filesystem, 'DATA')
  const result = await storage.load('password')

  assert.equal(result.recovered, true)
  assert.equal(result.data.messages[0].content, '临时恢复')
})

test('替换主文件失败时自动恢复上一版主文件', async () => {
  const filesystem = createFakeFilesystem()
  const storage = createChatStorage(filesystem, 'DATA')
  await storage.save(fixture('稳定版本'), 'password')
  filesystem.failTempRename()

  await assert.rejects(storage.save(fixture('失败版本'), 'password'), /simulated rename failure/)
  const result = await storage.load('password')
  assert.equal(result.recovered, false)
  assert.equal(result.data.messages[0].content, '稳定版本')
})
