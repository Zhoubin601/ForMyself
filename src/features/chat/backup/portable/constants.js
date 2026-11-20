// @ts-check
// Pure protocol constants for Kanata Portable Backup (Scheme C / kanata-logical-v1).
// Synthetic-only in M6-01; must NOT be imported by production composition roots.

export const PORTABLE_MAGIC = new Uint8Array([0x4b, 0x41, 0x4e, 0x41, 0x54, 0x41, 0x31, 0x00])
export const PORTABLE_FORMAT_VERSION = 1
export const PORTABLE_CIPHER_SUITE = 1
export const PORTABLE_SYNTHETIC_PROFILE = 0xff01
export const PORTABLE_PRODUCTION_PROFILE = 0x0001
export const PORTABLE_SYNTHETIC_ITERATIONS = 600000
export const PORTABLE_SCOPE_KANATA_SINGLE = 1
export const PORTABLE_PAYLOAD_LOGICAL_V1 = 1
export const PORTABLE_FRAME_LIMIT = 65536

export const PORTABLE_HEADER_SIZE = 64
export const PORTABLE_SALT_SIZE = 16
export const PORTABLE_BACKUP_ID_SIZE = 16
export const PORTABLE_WRAP_NONCE_SIZE = 12
export const PORTABLE_FRAME_NONCE_SIZE = 12
export const PORTABLE_KEY_SIZE = 32
export const PORTABLE_DIGEST_SIZE = 32
export const PORTABLE_TAG_SIZE = 16
export const PORTABLE_ENVELOPE_SIZE = PORTABLE_KEY_SIZE + PORTABLE_TAG_SIZE
export const PORTABLE_PREFIX_SIZE = PORTABLE_HEADER_SIZE + PORTABLE_WRAP_NONCE_SIZE + PORTABLE_ENVELOPE_SIZE
export const PORTABLE_FRAME_HEADER_SIZE = 20
export const PORTABLE_MANIFEST_SIZE = 40
export const PORTABLE_FOOTER_TABLE_COUNT = 50
export const PORTABLE_FOOTER_VERIFIER_SIZE = 42
export const PORTABLE_FOOTER_SIZE = 52 + PORTABLE_FOOTER_TABLE_COUNT * PORTABLE_FOOTER_VERIFIER_SIZE

export const PORTABLE_APPLICATION_ID = 0x4b4e5441
export const PORTABLE_SCHEMA_VERSION = 5
export const PORTABLE_TASK_POLICY_PAUSE_SENDING_V1 = 1

export const PORTABLE_STREAM_ID = Object.freeze({
  CONTROL: 0,
  DATA: 1,
})

export const PORTABLE_FRAME_TYPE = Object.freeze({
  MANIFEST: 1,
  DATA: 2,
  FOOTER: 3,
})

export const PORTABLE_FRAME_FLAG = Object.freeze({
  CONTINUE: 0,
  FINAL: 1,
})

export const PORTABLE_LIMITS = Object.freeze({
  MAX_PASSWORD_CHARS: 1024,
  MAX_PASSWORD_BYTES: 1024,
  MAX_DATA_FRAMES: 65536,
  MAX_DATA_PLAINTEXT_BYTES: 4294967296n,
  MAX_PACKAGE_OVERHEAD_BYTES: 2361684n,
  MAX_PACKAGE_BYTES: 4294967296n + 2361684n,
  MAX_TEXT_FIELD_BYTES: 2097152,
  MAX_ROW_BODY_BYTES: 4194304,
  MAX_BUSINESS_ROWS: 16777216n,
  MAX_ORDINAL: 9007199254740991n,
  MIN_I64: -9223372036854775808n,
  MAX_I64: 9223372036854775807n,
  MAX_U32: 0xffffffff,
  MAX_U64: 0xffffffffffffffffn,
  MAX_ZERO_PROGRESS_READS: 8,
})

export const PORTABLE_DOMAIN = Object.freeze({
  KEK: 'KPB1/KEK\0',
  WRAP: 'KPB1/wrap\0',
  FRAME: 'KPB1/frame\0',
  TRANSCRIPT: 'KPB1/transcript\0',
  SCHEMA_005: 'KPB1/schema-005\0',
  TABLE: 'KPB1/table\0',
})

export const PORTABLE_ERROR_CODES = Object.freeze({
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  RESOURCE_LIMIT: 'RESOURCE_LIMIT',
  AUTH_FAILED: 'AUTH_FAILED',
  INVALID_CONTAINER: 'INVALID_CONTAINER',
  INVALID_LOGICAL: 'INVALID_LOGICAL',
  INVALID_PASSWORD_INPUT: 'INVALID_PASSWORD_INPUT',
  IO_FAILED: 'IO_FAILED',
  CANCELLED: 'CANCELLED',
})

/**
 * Error with stable error code and stage metadata; never includes secrets or record bodies.
 */
export class PortableBackupError extends Error {
  /**
   * @param {string} code
   * @param {string} [stage]
   */
  constructor(code, stage = 'portable') {
    super(code)
    this.name = 'PortableBackupError'
    this.code = code
    this.stage = stage
  }
}

/**
 * Throw PortableBackupError when condition is falsy.
 * @param {unknown} condition
 * @param {string} code
 * @param {string} [stage]
 * @returns {asserts condition}
 */
export function requirePortable(condition, code, stage = 'portable') {
  if (!condition) throw new PortableBackupError(code, stage)
}
