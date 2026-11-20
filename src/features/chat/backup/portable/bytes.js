// @ts-check
import { PORTABLE_ERROR_CODES, PORTABLE_LIMITS, PortableBackupError, requirePortable } from './constants.js'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/**
 * Encode ASCII domain string into bytes.
 * @param {string} value
 * @returns {Uint8Array}
 */
export function asciiBytes(value) {
  const out = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    requirePortable(code <= 0x7f, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'ascii')
    out[i] = code
  }
  return out
}

/**
 * Check that a string contains no lone UTF-16 surrogates (ES2022-compatible).
 * @param {string} value
 * @returns {boolean}
 */
export function isWellFormedString(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= value.length) return false
      const next = value.charCodeAt(i + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      i += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

/**
 * Validate and encode password string to strict UTF-8 bytes without normalization or trimming.
 * @param {unknown} password
 * @returns {Uint8Array}
 */
export function encodePasswordBytes(password) {
  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > PORTABLE_LIMITS.MAX_PASSWORD_CHARS ||
    !isWellFormedString(password)
  ) {
    throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_PASSWORD_INPUT, 'password')
  }
  const encoded = textEncoder.encode(password)
  if (encoded.byteLength === 0 || encoded.byteLength > PORTABLE_LIMITS.MAX_PASSWORD_BYTES) {
    encoded.fill(0)
    throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_PASSWORD_INPUT, 'password')
  }
  return encoded
}

/**
 * Validate and encode strict UTF-8 text preserving spaces, NUL, BOM and Unicode normalization.
 * @param {unknown} value
 * @param {string} [stage]
 * @returns {Uint8Array}
 */
export function encodeStrictUtf8(value, stage = 'utf8') {
  requirePortable(typeof value === 'string' && isWellFormedString(value), PORTABLE_ERROR_CODES.INVALID_LOGICAL, stage)
  const encoded = textEncoder.encode(value)
  requirePortable(encoded.byteLength <= PORTABLE_LIMITS.MAX_TEXT_FIELD_BYTES, PORTABLE_ERROR_CODES.RESOURCE_LIMIT, stage)
  return encoded
}

/**
 * Decode strict UTF-8 bytes without stripping BOM.
 * @param {Uint8Array} bytes
 * @param {string} [stage]
 * @returns {string}
 */
export function decodeStrictUtf8(bytes, stage = 'utf8') {
  requirePortable(bytes instanceof Uint8Array, PORTABLE_ERROR_CODES.INVALID_LOGICAL, stage)
  requirePortable(bytes.byteLength <= PORTABLE_LIMITS.MAX_TEXT_FIELD_BYTES, PORTABLE_ERROR_CODES.RESOURCE_LIMIT, stage)
  try {
    return textDecoder.decode(bytes)
  } catch {
    throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_LOGICAL, stage)
  }
}

/**
 * Require exact Uint8Array with expected byteLength.
 * @param {unknown} value
 * @param {number} length
 * @param {string} code
 * @param {string} [stage]
 * @returns {Uint8Array}
 */
export function expectExactBytes(value, length, code, stage = 'bytes') {
  requirePortable(value instanceof Uint8Array && value.byteLength === length, code, stage)
  return value
}

/**
 * Constant-time equality check for equal-length byte buffers.
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {boolean}
 */
export function constantTimeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.byteLength !== b.byteLength) return false
  let diff = 0
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/**
 * Byte-by-byte equality check.
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {boolean}
 */
export function bytesEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Lexicographical unsigned byte comparison (<0, 0, >0).
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {number}
 */
export function compareUnsignedBytes(a, b) {
  const len = Math.min(a.byteLength, b.byteLength)
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return a.byteLength === b.byteLength ? 0 : a.byteLength < b.byteLength ? -1 : 1
}

/**
 * Concatenate Uint8Array slices into one contiguous Uint8Array.
 * @param {...Uint8Array} parts
 * @returns {Uint8Array}
 */
export function concatBytes(...parts) {
  let total = 0
  for (const part of parts) total += part.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

/**
 * Best-effort zeroization for mutable secret byte buffers.
 * @param {...(Uint8Array | null | undefined)} buffers
 */
export function zeroize(...buffers) {
  for (const buf of buffers) {
    if (buf instanceof Uint8Array) buf.fill(0)
  }
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {number}
 */
export function readU16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} value
 */
export function writeU16BE(bytes, offset, value) {
  bytes[offset] = (value >>> 8) & 0xff
  bytes[offset + 1] = value & 0xff
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {number}
 */
export function readU32BE(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} value
 */
export function writeU32BE(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {bigint}
 */
export function readU64BE(bytes, offset) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
  return dv.getBigUint64(0, false)
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {bigint} value
 */
export function writeU64BE(bytes, offset, value) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
  dv.setBigUint64(0, value, false)
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {bigint}
 */
export function readI64BE(bytes, offset) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
  return dv.getBigInt64(0, false)
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {bigint} value
 */
export function writeI64BE(bytes, offset, value) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
  dv.setBigInt64(0, value, false)
}

/**
 * Read IEEE 754 binary64 BE; rejects -0 and non-finite numbers.
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {string} [stage]
 * @returns {number}
 */
export function readF64BE(bytes, offset, stage = 'real') {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
  const value = dv.getFloat64(0, false)
  requirePortable(Number.isFinite(value) && !Object.is(value, -0), PORTABLE_ERROR_CODES.INVALID_LOGICAL, stage)
  return value
}

/**
 * Write IEEE 754 binary64 BE; rejects non-finite numbers and normalizes -0 to +0.
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} value
 * @param {string} [stage]
 */
export function writeF64BE(bytes, offset, value, stage = 'real') {
  requirePortable(typeof value === 'number' && Number.isFinite(value), PORTABLE_ERROR_CODES.INVALID_LOGICAL, stage)
  const normalized = Object.is(value, -0) ? 0 : value
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
  dv.setFloat64(0, normalized, false)
}

/**
 * Convert Uint8Array to lowercase hex string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToHex(bytes) {
  let out = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

/**
 * Convert even-length hex string to Uint8Array.
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  requirePortable(typeof hex === 'string' && hex.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(hex), PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'hex')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}
