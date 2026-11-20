import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'
import { openSyntheticEnvelope, sealSyntheticEnvelope } from '../docs/qa/kanata-sqlite-m6/portable/envelope.mjs'

const password = ' 合成📦 e\u0301 \u0000\ufeff '
const bytesFrom = (start, length) => Buffer.from(Array.from({ length }, (_, index) => start + index))
const material = {
  salt: bytesFrom(0, 16),
  backupId: bytesFrom(16, 16),
  wrapNonce: bytesFrom(32, 12),
  bek: bytesFrom(64, 32),
}

// Independent vector generated with Python hashlib/hmac/struct and cryptography AESGCM.
const vector = Buffer.from(
  '4b414e415441310000010001ff010000000927c0000102030405060708090a0b0c0d0e0f' +
  '101112131415161718191a1b1c1d1e1f010100010000000000000000202122232425262728292a2b' +
  '88e56998aad8074b19569c29ccd9d0c5fe7643df9a8f85183ea8af3c814886f49c00b6bba656aa4af2fd5fb1e0160bfd',
  'hex'
)
const errorMessage = message => ({ message })

test('synthetic envelope matches fixed header, UTF-8 KDF and AES-GCM vector', async () => {
  const exported = await sealSyntheticEnvelope(password, { material })
  assert.deepEqual(exported.prefix, vector)
  assert.deepEqual(exported.bek, material.bek)
  assert.deepEqual(await openSyntheticEnvelope(password, vector), material.bek)

  const { subtle } = webcrypto
  const encoded = new TextEncoder().encode(password)
  assert.equal(Buffer.from(encoded).toString('hex'), '20e59088e68890f09f93a62065cc812000efbbbf20')
  const raw = await subtle.importKey('raw', encoded, 'PBKDF2', false, ['deriveBits'])
  const base = await subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', iterations: 600000,
    salt: Buffer.concat([Buffer.from('KPB1/KEK\0'), material.salt, material.backupId]),
  }, raw, 256)
  assert.equal(Buffer.from(base).toString('hex'), '5367e77e1ddbb77bfb49f80f1eb28f3a111f5ac009f575e4233cb0aa76ed53b7')
  const ikm = await subtle.importKey('raw', base, 'HKDF', false, ['deriveBits'])
  const header = vector.subarray(0, 64)
  const wrap = await subtle.deriveBits({
    name: 'HKDF', hash: 'SHA-256', salt: material.backupId,
    info: Buffer.concat([Buffer.from('KPB1/wrap\0'), header]),
  }, ikm, 256)
  assert.equal(Buffer.from(wrap).toString('hex'), '65782e93ddb6aacb3798924d699bceb634fa557754c93a5fd69fdcb85bdc1816')
  const aes = await subtle.importKey('raw', wrap, 'AES-GCM', false, ['encrypt'])
  const wrapped = await subtle.encrypt({
    name: 'AES-GCM', iv: material.wrapNonce, additionalData: header, tagLength: 128,
  }, aes, material.bek)
  assert.deepEqual(Buffer.from(wrapped), vector.subarray(76))
})

test('synthetic reader denies malformed headers and resource claims before key derivation', async () => {
  for (const offset of [0, 9, 11, 13, 15, 52, 53, 57, 63]) {
    const bad = Buffer.from(vector)
    bad[offset] ^= 1
    await assert.rejects(openSyntheticEnvelope('', bad), errorMessage('UNSUPPORTED_FORMAT'))
  }
  for (const claimedIterations of [0, 600001, 0xffffffff]) {
    const bad = Buffer.from(vector)
    bad.writeUInt32BE(claimedIterations, 16)
    await assert.rejects(openSyntheticEnvelope('', bad), errorMessage('UNSUPPORTED_FORMAT'))
  }
  const productionProfile = Buffer.from(vector)
  productionProfile.writeUInt16BE(1, 12)
  await assert.rejects(openSyntheticEnvelope('', productionProfile), errorMessage('UNSUPPORTED_FORMAT'))
  for (const length of [0, 63, 64, 75, 123, 125]) {
    await assert.rejects(openSyntheticEnvelope(password, Buffer.alloc(length)), errorMessage('INVALID_CONTAINER'))
  }
})

test('synthetic reader denies wrong passwords, malformed Unicode and authenticated field mutations', async () => {
  for (const input of ['', '\ud800', '\udc00', '合'.repeat(342)]) {
    await assert.rejects(openSyntheticEnvelope(input, vector), errorMessage('INVALID_PASSWORD_INPUT'))
  }
  for (const input of ['wrong', password.normalize('NFC'), password.trim()]) {
    await assert.rejects(openSyntheticEnvelope(input, vector), errorMessage('AUTH_FAILED'))
  }
  for (const offset of [20, 36, 64, 76, 123]) {
    const tampered = Buffer.from(vector)
    tampered[offset] ^= 1
    await assert.rejects(openSyntheticEnvelope(password, tampered), errorMessage('AUTH_FAILED'))
  }
})

test('synthetic KDF is bounded to one operation, discards cancelled work and permits a new attempt', async () => {
  const controller = new AbortController()
  const pending = openSyntheticEnvelope(password, vector, { signal: controller.signal })
  await assert.rejects(openSyntheticEnvelope(password, vector), errorMessage('RESOURCE_LIMIT'))
  controller.abort()
  await assert.rejects(pending, errorMessage('CANCELLED'))
  await assert.rejects(openSyntheticEnvelope(password, vector, { signal: controller.signal }), errorMessage('CANCELLED'))
  assert.deepEqual(await openSyntheticEnvelope(password, vector), material.bek)
})

test('synthetic exports use fresh random material by default', async () => {
  const a = await sealSyntheticEnvelope(password)
  const b = await sealSyntheticEnvelope(password)
  assert.notDeepEqual(a.prefix.subarray(20, 52), b.prefix.subarray(20, 52))
  assert.notDeepEqual(a.prefix.subarray(64, 76), b.prefix.subarray(64, 76))
  assert.notDeepEqual(a.bek, b.bek)
  assert.deepEqual(await openSyntheticEnvelope(password, a.prefix), a.bek)
  assert.deepEqual(await openSyntheticEnvelope(password, b.prefix), b.bek)
})
