import test from 'node:test'
import assert from 'node:assert/strict'
import { VAULT_ACCESS_RESULT, verifyVaultSecretAccess } from '../src/services/vaultAccessGuard.js'

test('生物识别不可用时拒绝访问且不调用验证弹窗', async () => {
  let verifyCalls = 0
  const result = await verifyVaultSecretAccess({
    checkAvailability: async () => ({ isAvailable: false, errorCode: 3 }),
    verifyIdentity: async () => { verifyCalls++ }
  })
  assert.equal(result.granted, false)
  assert.equal(result.code, VAULT_ACCESS_RESULT.BIOMETRIC_UNAVAILABLE)
  assert.equal(result.biometricErrorCode, 3)
  assert.equal(verifyCalls, 0)
})

test('只有生物识别验证成功才授予密码访问', async () => {
  let verifyCalls = 0
  const result = await verifyVaultSecretAccess({
    checkAvailability: async () => ({ isAvailable: true }),
    verifyIdentity: async () => { verifyCalls++ }
  })
  assert.equal(result.granted, true)
  assert.equal(result.code, VAULT_ACCESS_RESULT.GRANTED)
  assert.equal(verifyCalls, 1)
})

test('用户取消或验证失败时拒绝密码访问', async () => {
  const result = await verifyVaultSecretAccess({
    checkAvailability: async () => ({ isAvailable: true }),
    verifyIdentity: async () => { throw new Error('USER_CANCEL') }
  })
  assert.equal(result.granted, false)
  assert.equal(result.code, VAULT_ACCESS_RESULT.BIOMETRIC_REJECTED)
})

test('插件检查异常时按生物识别不可用处理', async () => {
  const result = await verifyVaultSecretAccess({
    checkAvailability: async () => { throw new Error('PLUGIN_UNAVAILABLE') },
    verifyIdentity: async () => {}
  })
  assert.equal(result.granted, false)
  assert.equal(result.code, VAULT_ACCESS_RESULT.BIOMETRIC_UNAVAILABLE)
})
