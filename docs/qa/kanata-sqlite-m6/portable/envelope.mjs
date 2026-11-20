import { createCipheriv, createDecipheriv, hkdfSync, pbkdf2, randomBytes } from 'node:crypto'
import { promisify } from 'node:util'

// This reference accepts only the isolated synthetic profile.
const MAGIC = Buffer.from('4b414e4154413100', 'hex')
const HEADER_SIZE = 64
const WRAP_NONCE_SIZE = 12
const KEY_SIZE = 32
const TAG_SIZE = 16
const PREFIX_SIZE = HEADER_SIZE + WRAP_NONCE_SIZE + KEY_SIZE + TAG_SIZE
const PROFILE = 0xff01
const ITERATIONS = 600000
const FRAME_LIMIT = 65536
const pbkdf2Async = promisify(pbkdf2)
let deriving = false

function exactBytes(value, length, code) {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) throw new Error(code)
  return Buffer.from(value)
}

function passwordBytes(password) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 1024 || !password.isWellFormed()) {
    throw new Error('INVALID_PASSWORD_INPUT')
  }
  if (Buffer.byteLength(password, 'utf8') > 1024) throw new Error('INVALID_PASSWORD_INPUT')
  return Buffer.from(password, 'utf8')
}

function readHeader(header) {
  if (!header.subarray(0, 8).equals(MAGIC) ||
      header.readUInt16BE(8) !== 1 || header.readUInt16BE(10) !== 1 ||
      header.readUInt16BE(12) !== PROFILE || header.readUInt16BE(14) !== 0 ||
      header.readUInt32BE(16) !== ITERATIONS || header[52] !== 1 || header[53] !== 1 ||
      header.readUInt32BE(54) !== FRAME_LIMIT || header.subarray(58).some(Boolean)) {
    throw new Error('UNSUPPORTED_FORMAT')
  }
  return { salt: header.subarray(20, 36), backupId: header.subarray(36, 52) }
}

function makeHeader(salt, backupId) {
  const header = Buffer.alloc(HEADER_SIZE)
  MAGIC.copy(header)
  header.writeUInt16BE(1, 8)
  header.writeUInt16BE(1, 10)
  header.writeUInt16BE(PROFILE, 12)
  header.writeUInt32BE(ITERATIONS, 16)
  salt.copy(header, 20)
  backupId.copy(header, 36)
  header[52] = 1
  header[53] = 1
  header.writeUInt32BE(FRAME_LIMIT, 54)
  return header
}

function checkCancellation(signal) {
  if (signal?.aborted) throw new Error('CANCELLED')
}

async function deriveWrapKey(password, header, salt, backupId, signal) {
  checkCancellation(signal)
  if (deriving) throw new Error('RESOURCE_LIMIT')
  const bytes = passwordBytes(password)
  deriving = true
  let baseKey
  try {
    const domainSalt = Buffer.concat([Buffer.from('KPB1/KEK\0'), salt, backupId])
    baseKey = await pbkdf2Async(bytes, domainSalt, ITERATIONS, KEY_SIZE, 'sha256')
    checkCancellation(signal)
    const info = Buffer.concat([Buffer.from('KPB1/wrap\0'), header])
    return Buffer.from(hkdfSync('sha256', baseKey, backupId, info, KEY_SIZE))
  } finally {
    deriving = false
    bytes.fill(0)
    baseKey?.fill(0)
  }
}

function freshMaterial() {
  return {
    salt: randomBytes(16),
    backupId: randomBytes(16),
    wrapNonce: randomBytes(WRAP_NONCE_SIZE),
    bek: randomBytes(KEY_SIZE),
  }
}

// Only the QA vector test injects material. The caller owns the returned BEK.
export async function sealSyntheticEnvelope(password, { material, signal } = {}) {
  checkCancellation(signal)
  let wrapKey
  let exported = false
  const source = material ?? freshMaterial()
  const salt = exactBytes(source.salt, 16, 'INVALID_CONTAINER')
  const backupId = exactBytes(source.backupId, 16, 'INVALID_CONTAINER')
  const nonce = exactBytes(source.wrapNonce, WRAP_NONCE_SIZE, 'INVALID_CONTAINER')
  const bek = material ? exactBytes(source.bek, KEY_SIZE, 'INVALID_CONTAINER') : source.bek
  try {
    const header = makeHeader(salt, backupId)
    wrapKey = await deriveWrapKey(password, header, salt, backupId, signal)
    const cipher = createCipheriv('aes-256-gcm', wrapKey, nonce, { authTagLength: TAG_SIZE })
    cipher.setAAD(header)
    const ciphertext = Buffer.concat([cipher.update(bek), cipher.final(), cipher.getAuthTag()])
    const prefix = Buffer.concat([header, nonce, ciphertext])
    exported = true
    return { prefix, bek }
  } finally {
    wrapKey?.fill(0)
    if (!exported) bek.fill(0)
  }
}

export async function openSyntheticEnvelope(password, prefix, { signal } = {}) {
  const bytes = exactBytes(prefix, PREFIX_SIZE, 'INVALID_CONTAINER')
  const header = bytes.subarray(0, HEADER_SIZE)
  const { salt, backupId } = readHeader(header)
  const wrapKey = await deriveWrapKey(password, header, salt, backupId, signal)
  const ciphertextOffset = HEADER_SIZE + WRAP_NONCE_SIZE
  const tagOffset = ciphertextOffset + KEY_SIZE
  let plaintext
  let authenticated = false
  try {
    const nonce = bytes.subarray(HEADER_SIZE, ciphertextOffset)
    const decipher = createDecipheriv('aes-256-gcm', wrapKey, nonce, { authTagLength: TAG_SIZE })
    decipher.setAAD(header)
    decipher.setAuthTag(bytes.subarray(tagOffset))
    plaintext = decipher.update(bytes.subarray(ciphertextOffset, tagOffset))
    decipher.final()
    authenticated = true
    return plaintext
  } catch {
    throw new Error('AUTH_FAILED')
  } finally {
    wrapKey.fill(0)
    if (!authenticated) plaintext?.fill(0)
  }
}
