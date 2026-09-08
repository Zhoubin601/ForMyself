import test from 'node:test'
import assert from 'node:assert/strict'
import CryptoJS from 'crypto-js'

import { createPreferenceStorage } from '../src/platform/storage/preferences.js'
import { createSecureCredentials } from '../src/platform/security/secureCredentials.js'
import {
  createMasterPasswordVerifier,
  masterPasswordVerifierEquals,
  verifyMasterPassword,
  validateNewMasterPassword
} from '../src/services/masterPasswordSecurity.js'
import { changeMasterPasswordTransaction } from '../src/services/masterPasswordChange.js'

test('主密码校验器只保存不可逆派生值', async () => {
  const verifier = await createMasterPasswordVerifier('correct horse battery staple')
  assert.equal(verifier.version, 1)
  assert.equal(verifier.algorithm, 'PBKDF2-HMAC-SHA256')
  assert.equal('password' in verifier, false)
  assert.equal(await verifyMasterPassword('correct horse battery staple', verifier), true)
  assert.equal(await verifyMasterPassword('wrong password', verifier), false)
})

test('Web Crypto 与旧 CryptoJS 验证记录保持兼容', async () => {
  const password = '中文密码🔐-compatibility'
  const salt = '00112233445566778899aabbccddeeff'
  const iterations = 12_000
  const expected = CryptoJS.PBKDF2(password, CryptoJS.enc.Hex.parse(salt), {
    keySize: 256 / 32,
    iterations,
    hasher: CryptoJS.algo.SHA256
  }).toString()
  const verifier = await createMasterPasswordVerifier(password, { salt, iterations })
  assert.equal(verifier.verifier, expected)
  assert.equal(await verifyMasterPassword(password, verifier), true)
  assert.equal(masterPasswordVerifierEquals(verifier, { ...verifier, verifier: verifier.verifier.toUpperCase() }), true)
})

test('缺少 Web Crypto 时把派生任务交给 Worker', async () => {
  const calls = []
  const expected = 'ab'.repeat(32)
  const workerFactory = () => ({
    terminate: () => calls.push('terminate'),
    postMessage(message) {
      calls.push(message)
      queueMicrotask(() => this.onmessage({ data: { verifier: expected } }))
    }
  })
  const verifier = await createMasterPasswordVerifier('worker-password', {
    salt: '11'.repeat(16),
    iterations: 1234,
    cryptoProvider: {},
    workerFactory
  })
  assert.equal(verifier.verifier, expected)
  assert.deepEqual(calls[0], {
    password: 'worker-password',
    salt: '11'.repeat(16),
    iterations: 1234
  })
  assert.equal(calls[1], 'terminate')
})

test('新主密码必须满足长度并与确认值一致', () => {
  assert.equal(validateNewMasterPassword('12345678', '12345678'), null)
  assert.match(validateNewMasterPassword('123', '123'), /至少/)
  assert.match(validateNewMasterPassword('12345678', '87654321'), /不一致/)
})

test('受保护存储迁移失败时会按反序回滚', async () => {
  const calls = []
  const first = async password => calls.push(`first:${password}`)
  const second = async password => {
    calls.push(`second:${password}`)
    throw new Error('boom')
  }

  await assert.rejects(() => changeMasterPasswordTransaction({
    currentPassword: 'old',
    newPassword: 'new',
    reencryptors: [first, second],
    commit: async () => calls.push('commit')
  }))
  assert.deepEqual(calls, [
    'first:new',
    'second:new',
    'first:old'
  ])
})

test('新验证值提交失败时也会回滚已重加密的数据', async () => {
  const calls = []
  await assert.rejects(() => changeMasterPasswordTransaction({
    currentPassword: 'old',
    newPassword: 'new',
    reencryptors: [async password => calls.push(password)],
    commit: async () => { throw new Error('commit failed') }
  }))
  assert.deepEqual(calls, ['new', 'old'])
})

test('安全凭据适配器使用不同命名空间保存主密码和 API Key', async () => {
  const calls = []
  const adapter = createSecureCredentials({
    isNative: () => true,
    biometric: {
      isCredentialsSaved: async () => ({ isSaved: true }),
      setCredentials: async options => calls.push(['set', options]),
      getSecureCredentials: async options => {
        calls.push(['get-secure', options])
        return { username: 'formyself', password: 'master' }
      },
      getCredentials: async options => {
        calls.push(['get', options])
        return { username: 'formyself', password: options.server.includes('master') ? 'master' : 'api' }
      },
      deleteCredentials: async options => calls.push(['delete', options])
    }
  })

  await adapter.storeMasterPassword('master')
  await adapter.storeApiKey('api')
  assert.equal(await adapter.getMasterPassword(), 'master')
  assert.equal(await adapter.getApiKey(), 'api')
  assert.notEqual(calls[0][1].server, calls[1][1].server)
  assert.notEqual(calls[0][1].accessControl, calls[1][1].accessControl)
  await adapter.storeApiKey('')
  assert.equal(calls.at(-1)[0], 'set')
  assert.equal(calls.at(-1)[1].password, '')
  assert.equal(calls.some(([action]) => action === 'delete'), false)
})

test('统一偏好存储会串行执行写入', async () => {
  const order = []
  const driver = {
    get: async () => ({ value: null }),
    set: async ({ value }) => {
      order.push(`start:${value}`)
      await new Promise(resolve => setTimeout(resolve, value === 'one' ? 10 : 0))
      order.push(`end:${value}`)
    },
    remove: async () => {}
  }
  const storage = createPreferenceStorage(driver)
  await Promise.all([
    storage.set({ key: 'x', value: 'one' }),
    storage.set({ key: 'x', value: 'two' })
  ])
  assert.deepEqual(order, ['start:one', 'end:one', 'start:two', 'end:two'])
})
