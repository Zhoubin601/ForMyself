// @ts-check
import {
  asciiBytes,
  bytesEqual,
  concatBytes,
  constantTimeEqual,
  encodePasswordBytes,
  expectExactBytes,
  hexToBytes,
  readU16BE,
  readU32BE,
  readU64BE,
  writeU16BE,
  writeU32BE,
  writeU64BE,
  zeroize,
} from './bytes.js'
import {
  KANATA_SCHEMA_005_FINGERPRINT,
  PORTABLE_FOOTER_TABLES,
} from './catalog.js'
import {
  PORTABLE_APPLICATION_ID,
  PORTABLE_BACKUP_ID_SIZE,
  PORTABLE_CIPHER_SUITE,
  PORTABLE_DIGEST_SIZE,
  PORTABLE_DOMAIN,
  PORTABLE_ENVELOPE_SIZE,
  PORTABLE_ERROR_CODES,
  PORTABLE_FORMAT_VERSION,
  PORTABLE_FRAME_FLAG,
  PORTABLE_FRAME_HEADER_SIZE,
  PORTABLE_FRAME_LIMIT,
  PORTABLE_FRAME_NONCE_SIZE,
  PORTABLE_FRAME_TYPE,
  PORTABLE_HEADER_SIZE,
  PORTABLE_KEY_SIZE,
  PORTABLE_LIMITS,
  PORTABLE_MAGIC,
  PORTABLE_MANIFEST_SIZE,
  PORTABLE_PAYLOAD_LOGICAL_V1,
  PORTABLE_PREFIX_SIZE,
  PORTABLE_SALT_SIZE,
  PORTABLE_SCHEMA_VERSION,
  PORTABLE_SCOPE_KANATA_SINGLE,
  PORTABLE_STREAM_ID,
  PORTABLE_SYNTHETIC_ITERATIONS,
  PORTABLE_SYNTHETIC_PROFILE,
  PORTABLE_TAG_SIZE,
  PORTABLE_TASK_POLICY_PAUSE_SENDING_V1,
  PORTABLE_WRAP_NONCE_SIZE,
  PORTABLE_FOOTER_SIZE,
  PORTABLE_FOOTER_TABLE_COUNT,
  PORTABLE_FOOTER_VERIFIER_SIZE,
  PortableBackupError,
  requirePortable,
} from './constants.js'
import { createLogicalStreamDecoder, encodeLogicalStreamChunks } from './logicalCodec.js'

const EXPECTED_SCHEMA_FINGERPRINT = hexToBytes(KANATA_SCHEMA_005_FINGERPRINT)
const KEK_SALT_PREFIX = asciiBytes(PORTABLE_DOMAIN.KEK)
const WRAP_INFO_PREFIX = asciiBytes(PORTABLE_DOMAIN.WRAP)
const FRAME_INFO_PREFIX = asciiBytes(PORTABLE_DOMAIN.FRAME)
const TRANSCRIPT_PREFIX = asciiBytes(PORTABLE_DOMAIN.TRANSCRIPT)

let kdfInFlight = false

/** @param {AbortSignal | undefined} signal */
function checkCancelled(signal) {
  if (signal?.aborted) {
    throw new PortableBackupError(PORTABLE_ERROR_CODES.CANCELLED, 'cancelled')
  }
}

/**
 * Encode 64-byte public header P.
 * @param {{ salt: Uint8Array, backupId: Uint8Array, profile?: number, iterations?: number, frameLimit?: number }} params
 * @returns {Uint8Array}
 */
export function encodePublicHeader({
  salt,
  backupId,
  profile = PORTABLE_SYNTHETIC_PROFILE,
  iterations = PORTABLE_SYNTHETIC_ITERATIONS,
  frameLimit = PORTABLE_FRAME_LIMIT,
}) {
  expectExactBytes(salt, PORTABLE_SALT_SIZE, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'header-salt')
  expectExactBytes(backupId, PORTABLE_BACKUP_ID_SIZE, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'header-backup-id')
  requirePortable(profile === PORTABLE_SYNTHETIC_PROFILE, PORTABLE_ERROR_CODES.UNSUPPORTED_FORMAT, 'header-profile')
  requirePortable(iterations === PORTABLE_SYNTHETIC_ITERATIONS, PORTABLE_ERROR_CODES.UNSUPPORTED_FORMAT, 'header-iterations')
  requirePortable(frameLimit === PORTABLE_FRAME_LIMIT, PORTABLE_ERROR_CODES.UNSUPPORTED_FORMAT, 'header-frame-limit')

  const header = new Uint8Array(PORTABLE_HEADER_SIZE)
  header.set(PORTABLE_MAGIC, 0)
  writeU16BE(header, 8, PORTABLE_FORMAT_VERSION)
  writeU16BE(header, 10, PORTABLE_CIPHER_SUITE)
  writeU16BE(header, 12, profile)
  writeU16BE(header, 14, 0)
  writeU32BE(header, 16, iterations)
  header.set(salt, 20)
  header.set(backupId, 36)
  header[52] = PORTABLE_SCOPE_KANATA_SINGLE
  header[53] = PORTABLE_PAYLOAD_LOGICAL_V1
  writeU32BE(header, 54, frameLimit)
  return header
}

/**
 * Decode and strictly validate 64-byte public header P before any KDF.
 * @param {Uint8Array} header
 * @returns {import('./contracts').PortablePublicHeader}
 */
export function decodePublicHeader(header) {
  expectExactBytes(header, PORTABLE_HEADER_SIZE, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'header-size')
  const reservedNonZero = header.subarray(58, 64).some(byte => byte !== 0)
  if (
    !bytesEqual(header.subarray(0, 8), PORTABLE_MAGIC) ||
    readU16BE(header, 8) !== PORTABLE_FORMAT_VERSION ||
    readU16BE(header, 10) !== PORTABLE_CIPHER_SUITE ||
    readU16BE(header, 12) !== PORTABLE_SYNTHETIC_PROFILE ||
    readU16BE(header, 14) !== 0 ||
    readU32BE(header, 16) !== PORTABLE_SYNTHETIC_ITERATIONS ||
    header[52] !== PORTABLE_SCOPE_KANATA_SINGLE ||
    header[53] !== PORTABLE_PAYLOAD_LOGICAL_V1 ||
    readU32BE(header, 54) !== PORTABLE_FRAME_LIMIT ||
    reservedNonZero
  ) {
    throw new PortableBackupError(PORTABLE_ERROR_CODES.UNSUPPORTED_FORMAT, 'header')
  }
  return {
    format: 1,
    suite: 1,
    profile: 0xff01,
    iterations: 600000,
    salt: header.subarray(20, 36),
    backupId: header.subarray(36, 52),
    scope: 1,
    payload: 1,
    frameLimit: 65536,
  }
}

/**
 * Encode 20-byte frame header F.
 * @param {{ streamId: number, type: number, flags: number, index: bigint, plaintextLen: number, ciphertextLen: number }} frame
 * @returns {Uint8Array}
 */
export function encodeFrameHeader({ streamId, type, flags, index, plaintextLen, ciphertextLen }) {
  const buf = new Uint8Array(PORTABLE_FRAME_HEADER_SIZE)
  writeU16BE(buf, 0, streamId)
  buf[2] = type
  buf[3] = flags
  writeU64BE(buf, 4, index)
  writeU32BE(buf, 12, plaintextLen)
  writeU32BE(buf, 16, ciphertextLen)
  return buf
}

/**
 * Decode 20-byte frame header F.
 * @param {Uint8Array} buf
 */
export function decodeFrameHeader(buf) {
  expectExactBytes(buf, PORTABLE_FRAME_HEADER_SIZE, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'frame-header-size')
  return {
    streamId: readU16BE(buf, 0),
    type: buf[2],
    flags: buf[3],
    index: readU64BE(buf, 4),
    plaintextLen: readU32BE(buf, 12),
    ciphertextLen: readU32BE(buf, 16),
  }
}

/**
 * Encode 40-byte MANIFEST payload.
 * @param {{ applicationId?: number, schema?: number, schemaFingerprint?: Uint8Array, taskPolicy?: number, profileReserved?: number }} [manifest]
 * @returns {Uint8Array}
 */
export function encodeManifestPayload({
  applicationId = PORTABLE_APPLICATION_ID,
  schema = PORTABLE_SCHEMA_VERSION,
  schemaFingerprint = EXPECTED_SCHEMA_FINGERPRINT,
  taskPolicy = PORTABLE_TASK_POLICY_PAUSE_SENDING_V1,
  profileReserved = 0,
} = {}) {
  expectExactBytes(schemaFingerprint, PORTABLE_DIGEST_SIZE, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'manifest-fp')
  const out = new Uint8Array(PORTABLE_MANIFEST_SIZE)
  writeU32BE(out, 0, applicationId)
  writeU16BE(out, 4, schema)
  out.set(schemaFingerprint, 6)
  out[38] = taskPolicy
  out[39] = profileReserved
  return out
}

/**
 * Decode and verify 40-byte MANIFEST payload.
 * @param {Uint8Array} buf
 * @returns {import('./contracts').PortableManifest}
 */
export function decodeManifestPayload(buf) {
  requirePortable(buf.byteLength === PORTABLE_MANIFEST_SIZE, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'manifest-size')
  const applicationId = readU32BE(buf, 0)
  const schema = readU16BE(buf, 4)
  const schemaFingerprint = buf.subarray(6, 38)
  const taskPolicy = buf[38]
  const profileReserved = buf[39]
  requirePortable(
    applicationId === PORTABLE_APPLICATION_ID &&
      schema === PORTABLE_SCHEMA_VERSION &&
      taskPolicy === PORTABLE_TASK_POLICY_PAUSE_SENDING_V1 &&
      profileReserved === 0,
    PORTABLE_ERROR_CODES.UNSUPPORTED_FORMAT,
    'manifest-format',
  )
  requirePortable(
    constantTimeEqual(schemaFingerprint, EXPECTED_SCHEMA_FINGERPRINT),
    PORTABLE_ERROR_CODES.INVALID_LOGICAL,
    'manifest-schema-fingerprint',
  )
  return {
    applicationId: 0x4b4e5441,
    schema: 5,
    schemaFingerprint: schemaFingerprint.slice(),
    taskPolicy: 1,
    profileReserved: 0,
  }
}

/**
 * Encode 2152-byte FOOTER payload.
 * @param {{
 *   dataFrameCount: number,
 *   totalPlaintextBytes: bigint,
 *   totalCiphertextBytes: bigint,
 *   transcript: Uint8Array,
 *   verifiers: readonly { tableId: number, rowCount: bigint, digest: Uint8Array }[]
 * }} footer
 * @returns {Uint8Array}
 */
export function encodeFooterPayload({
  dataFrameCount,
  totalPlaintextBytes,
  totalCiphertextBytes,
  transcript,
  verifiers,
}) {
  expectExactBytes(transcript, PORTABLE_DIGEST_SIZE, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'footer-transcript')
  requirePortable(
    verifiers.length === PORTABLE_FOOTER_TABLE_COUNT,
    PORTABLE_ERROR_CODES.INVALID_LOGICAL,
    'footer-verifier-count',
  )
  const out = new Uint8Array(PORTABLE_FOOTER_SIZE)
  writeU32BE(out, 0, dataFrameCount)
  writeU64BE(out, 4, totalPlaintextBytes)
  writeU64BE(out, 12, totalCiphertextBytes)
  out.set(transcript, 20)

  let offset = 52
  for (let i = 0; i < PORTABLE_FOOTER_TABLE_COUNT; i++) {
    const expectedTable = PORTABLE_FOOTER_TABLES[i]
    const entry = verifiers[i]
    requirePortable(entry && entry.tableId === expectedTable.tableId, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'footer-table-order')
    expectExactBytes(entry.digest, PORTABLE_DIGEST_SIZE, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'footer-table-digest')
    writeU16BE(out, offset, entry.tableId)
    writeU64BE(out, offset + 2, entry.rowCount)
    out.set(entry.digest, offset + 10)
    offset += PORTABLE_FOOTER_VERIFIER_SIZE
  }
  return out
}

/**
 * Decode 2152-byte FOOTER payload and validate ascending 50-table order.
 * @param {Uint8Array} buf
 */
export function decodeFooterPayload(buf) {
  requirePortable(buf.byteLength === PORTABLE_FOOTER_SIZE, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'footer-size')
  const dataFrameCount = readU32BE(buf, 0)
  const totalPlaintextBytes = readU64BE(buf, 4)
  const totalCiphertextBytes = readU64BE(buf, 12)
  const transcript = buf.subarray(20, 52).slice()

  /** @type {{ tableId: number, rowCount: bigint, digest: Uint8Array }[]} */
  const verifiers = []
  let offset = 52
  for (let i = 0; i < PORTABLE_FOOTER_TABLE_COUNT; i++) {
    const tableId = readU16BE(buf, offset)
    const rowCount = readU64BE(buf, offset + 2)
    const digest = buf.subarray(offset + 10, offset + 42).slice()
    requirePortable(
      tableId === PORTABLE_FOOTER_TABLES[i].tableId,
      PORTABLE_ERROR_CODES.INVALID_LOGICAL,
      'footer-table-order',
    )
    verifiers.push({ tableId, rowCount, digest })
    offset += PORTABLE_FOOTER_VERIFIER_SIZE
  }
  return {
    dataFrameCount,
    totalPlaintextBytes,
    totalCiphertextBytes,
    transcript,
    verifiers,
  }
}

/**
 * Build 12-byte frame nonce: u16(streamId) || u8(type) || 0x00 || u64(index).
 * @param {number} streamId
 * @param {number} type
 * @param {bigint} index
 * @returns {Uint8Array}
 */
export function buildFrameNonce(streamId, type, index) {
  const nonce = new Uint8Array(PORTABLE_FRAME_NONCE_SIZE)
  writeU16BE(nonce, 0, streamId)
  nonce[2] = type
  nonce[3] = 0
  writeU64BE(nonce, 4, index)
  return nonce
}

/**
 * Build frame HKDF info: "KPB1/frame\0" || u16(streamId) || u8(type).
 * @param {number} streamId
 * @param {number} type
 * @returns {Uint8Array}
 */
export function buildFrameKeyInfo(streamId, type) {
  const info = new Uint8Array(FRAME_INFO_PREFIX.byteLength + 3)
  info.set(FRAME_INFO_PREFIX, 0)
  writeU16BE(info, FRAME_INFO_PREFIX.byteLength, streamId)
  info[FRAME_INFO_PREFIX.byteLength + 2] = type
  return info
}

/**
 * Compute wrapKey with bounded single-flight KDF guard and cancellation support.
 * Transfers wrapKey ownership to the caller only on normal return; zeroizes on error or cancellation.
 * @param {string} password
 * @param {Uint8Array} header
 * @param {Uint8Array} salt
 * @param {Uint8Array} backupId
 * @param {number} iterations
 * @param {import('./contracts').PortableCryptoProvider} cryptoProvider
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<Uint8Array>}
 */
export async function deriveWrapKey(password, header, salt, backupId, iterations, cryptoProvider, signal) {
  checkCancelled(signal)
  if (kdfInFlight) {
    throw new PortableBackupError(PORTABLE_ERROR_CODES.RESOURCE_LIMIT, 'kdf-concurrency')
  }
  const passBytes = encodePasswordBytes(password)
  kdfInFlight = true
  /** @type {Uint8Array | undefined} */
  let baseKey
  /** @type {Uint8Array | undefined} */
  let wrapKey
  let transferred = false
  try {
    const domainSalt = concatBytes(KEK_SALT_PREFIX, salt, backupId)
    baseKey = await cryptoProvider.pbkdf2Sha256(passBytes, domainSalt, iterations, PORTABLE_KEY_SIZE)
    checkCancelled(signal)
    const wrapInfo = concatBytes(WRAP_INFO_PREFIX, header)
    wrapKey = await cryptoProvider.hkdfSha256(baseKey, backupId, wrapInfo, PORTABLE_KEY_SIZE)
    expectExactBytes(wrapKey, PORTABLE_KEY_SIZE, PORTABLE_ERROR_CODES.IO_FAILED, 'wrap-key-length')
    checkCancelled(signal)
    transferred = true
    return wrapKey
  } finally {
    kdfInFlight = false
    zeroize(passBytes, baseKey, transferred ? undefined : wrapKey)
  }
}

/**
 * Compute SHA-256 of prefix bytes `P || wrapNonce || W`.
 * @param {import('./contracts').PortableCryptoProvider} cryptoProvider
 * @param {Uint8Array} prefixBytes
 * @returns {Uint8Array}
 */
export function computeEnvelopeDigest(cryptoProvider, prefixBytes) {
  const h = cryptoProvider.createSha256()
  h.update(prefixBytes)
  const d = h.digest()
  expectExactBytes(d, PORTABLE_DIGEST_SIZE, PORTABLE_ERROR_CODES.IO_FAILED, 'envelope-digest')
  return d
}

/**
 * Create incremental transcript SHA-256 hasher:
 * SHA256("KPB1/transcript\0" || envelopeDigest || concat(F || ciphertextAndTag)).
 * @param {import('./contracts').PortableCryptoProvider} cryptoProvider
 * @param {Uint8Array} envelopeDigest
 */
export function createTranscriptHasher(cryptoProvider, envelopeDigest) {
  const hasher = cryptoProvider.createSha256()
  hasher.update(TRANSCRIPT_PREFIX)
  hasher.update(envelopeDigest)
  return {
    /**
     * @param {Uint8Array} frameHeader
     * @param {Uint8Array} ciphertextAndTag
     */
    addFrame(frameHeader, ciphertextAndTag) {
      hasher.update(frameHeader)
      hasher.update(ciphertextAndTag)
    },
    digest() {
      const d = hasher.digest()
      expectExactBytes(d, PORTABLE_DIGEST_SIZE, PORTABLE_ERROR_CODES.IO_FAILED, 'transcript-digest')
      return d
    },
  }
}

/**
 * Draw random material safely; aborts immediately on CSPRNG failure.
 * @param {import('./contracts').PortableCryptoProvider} cryptoProvider
 * @param {{ salt: Uint8Array, backupId: Uint8Array, wrapNonce: Uint8Array, bek: Uint8Array } | undefined} material
 */
function resolveExportMaterial(cryptoProvider, material) {
  if (material) {
    return {
      salt: expectExactBytes(material.salt, PORTABLE_SALT_SIZE, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'material-salt').slice(),
      backupId: expectExactBytes(material.backupId, PORTABLE_BACKUP_ID_SIZE, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'material-id').slice(),
      wrapNonce: expectExactBytes(material.wrapNonce, PORTABLE_WRAP_NONCE_SIZE, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'material-nonce').slice(),
      bek: expectExactBytes(material.bek, PORTABLE_KEY_SIZE, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'material-bek').slice(),
    }
  }
  const draw = (size, label) => {
    let bytes
    try {
      bytes = cryptoProvider.randomBytes(size)
    } catch {
      throw new PortableBackupError(PORTABLE_ERROR_CODES.IO_FAILED, `rng:${label}`)
    }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size) {
      throw new PortableBackupError(PORTABLE_ERROR_CODES.IO_FAILED, `rng:${label}`)
    }
    return bytes
  }
  const salt = draw(PORTABLE_SALT_SIZE, 'salt')
  const backupId = draw(PORTABLE_BACKUP_ID_SIZE, 'backupId')
  const wrapNonce = draw(PORTABLE_WRAP_NONCE_SIZE, 'wrapNonce')
  const bek = draw(PORTABLE_KEY_SIZE, 'bek')
  return { salt, backupId, wrapNonce, bek }
}

/**
 * Wrap any supported binary input (`Uint8Array`, `AsyncIterable<Uint8Array>`, or `{ read() }` pull function)
 * into a bounded exact-read reader with short-read coalescing and zero-progress detection.
 *
 * @param {Uint8Array | AsyncIterable<Uint8Array> | Iterable<Uint8Array> | (() => Promise<Uint8Array | null> | Uint8Array | null)} source
 * @param {AbortSignal | undefined} signal
 */
export function createBoundedByteReader(source, signal) {
  /** @type {AsyncIterator<Uint8Array> | Iterator<Uint8Array> | null} */
  let iterator = null
  let iteratorDone = false
  /** @type {(() => Promise<Uint8Array | null> | Uint8Array | null) | null} */
  let pullFn = null
  /** @type {Uint8Array | null} */
  let leftover = null
  let eofReached = false

  if (source instanceof Uint8Array) {
    leftover = source
    eofReached = true
  } else if (typeof source === 'function') {
    pullFn = source
  } else if (source && typeof source === 'object' && Symbol.asyncIterator in source) {
    iterator = source[Symbol.asyncIterator]()
  } else if (source && typeof source === 'object' && Symbol.iterator in source) {
    iterator = source[Symbol.iterator]()
  } else {
    throw new PortableBackupError(PORTABLE_ERROR_CODES.IO_FAILED, 'reader-source')
  }

  async function nextChunk() {
    checkCancelled(signal)
    if (eofReached) return null
    let zeroReads = 0
    while (true) {
      let chunk = null
      try {
        if (pullFn) {
          chunk = await pullFn()
        } else if (iterator) {
          const step = await iterator.next()
          if (step.done) {
            iteratorDone = true
            chunk = null
          } else {
            chunk = step.value
          }
        }
      } catch (error) {
        if (error instanceof PortableBackupError) throw error
        throw new PortableBackupError(PORTABLE_ERROR_CODES.IO_FAILED, 'reader-io')
      }
      checkCancelled(signal)
      if (chunk === null || chunk === undefined) {
        eofReached = true
        return null
      }
      requirePortable(chunk instanceof Uint8Array, PORTABLE_ERROR_CODES.IO_FAILED, 'reader-chunk-type')
      if (chunk.byteLength > 0) {
        return chunk
      }
      zeroReads += 1
      requirePortable(
        zeroReads < PORTABLE_LIMITS.MAX_ZERO_PROGRESS_READS,
        PORTABLE_ERROR_CODES.IO_FAILED,
        'reader-zero-progress',
      )
    }
  }

  return {
    /**
     * Read exactly `length` bytes, coalescing short reads without buffering extra chunks.
     * @param {number} length
     * @returns {Promise<Uint8Array>}
     */
    async readExact(length) {
      checkCancelled(signal)
      if (length === 0) return new Uint8Array(0)
      if (leftover && leftover.byteLength >= length) {
        const out = leftover.subarray(0, length)
        leftover = leftover.byteLength > length ? leftover.subarray(length) : null
        return out
      }

      const out = new Uint8Array(length)
      let filled = 0
      if (leftover && leftover.byteLength > 0) {
        out.set(leftover, 0)
        filled = leftover.byteLength
        leftover = null
      }

      while (filled < length) {
        const chunk = await nextChunk()
        if (!chunk) {
          throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'unexpected-eof')
        }
        const need = length - filled
        if (chunk.byteLength <= need) {
          out.set(chunk, filled)
          filled += chunk.byteLength
        } else {
          out.set(chunk.subarray(0, need), filled)
          filled = length
          leftover = chunk.subarray(need)
        }
      }
      return out
    },

    /**
     * Verify exact EOF; rejects even a single trailing byte or concatenated second package.
     */
    async assertEof() {
      checkCancelled(signal)
      if (leftover && leftover.byteLength > 0) {
        throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'trailing-data')
      }
      const extra = await nextChunk()
      if (extra !== null) {
        throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'trailing-data')
      }
    },

    /**
     * Release any underlying iterator resource when closing early or finishing.
     */
    async close() {
      leftover = null
      if (iterator && !iteratorDone && typeof iterator.return === 'function') {
        iteratorDone = true
        try {
          await iterator.return()
        } catch {
          // Best-effort iterator cleanup; preserve original error.
        }
      }
    },
  }
}

/**
 * Streamingly encode a complete Scheme C portable backup container from table sources and derived verifiers.
 *
 * @param {{
 *   password: string,
 *   getTableSource: (tableDef: import('./contracts').PortableTableSpec) => import('./contracts').PortableTableRowSource,
 *   derivedVerifiers: readonly { tableId: number, rowCount: bigint, digest: Uint8Array }[],
 *   cryptoProvider: import('./contracts').PortableCryptoProvider,
 *   material?: { salt: Uint8Array, backupId: Uint8Array, wrapNonce: Uint8Array, bek: Uint8Array },
 *   signal?: AbortSignal,
 *   applyTaskPolicy?: boolean,
 *   validateJson?: boolean,
 * }} params
 * @returns {AsyncGenerator<Uint8Array, { dataFrameCount: number, totalPlaintextBytes: bigint, totalCiphertextBytes: bigint, transcript: Uint8Array, verifiers: { tableId: number, rowCount: bigint, digest: Uint8Array }[] }, void>}
 */
export async function* encodePortableContainer({
  password,
  getTableSource,
  derivedVerifiers,
  cryptoProvider,
  material,
  signal,
  applyTaskPolicy = true,
  validateJson = true,
}) {
  checkCancelled(signal)
  requirePortable(derivedVerifiers.length === 5, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'derived-verifier-count')

  const mat = resolveExportMaterial(cryptoProvider, material)
  /** @type {Uint8Array | undefined} */
  let wrapKey
  /** @type {Uint8Array | undefined} */
  let manifestKey
  /** @type {Uint8Array | undefined} */
  let dataKey
  /** @type {Uint8Array | undefined} */
  let footerKey
  /** @type {Uint8Array | null} */
  let pendingPlain = null

  try {
    const header = encodePublicHeader({ salt: mat.salt, backupId: mat.backupId })
    wrapKey = await deriveWrapKey(
      password,
      header,
      mat.salt,
      mat.backupId,
      PORTABLE_SYNTHETIC_ITERATIONS,
      cryptoProvider,
      signal,
    )
    const wrappedBek = await cryptoProvider.aesGcmEncrypt(wrapKey, mat.wrapNonce, mat.bek, header)
    expectExactBytes(wrappedBek, PORTABLE_ENVELOPE_SIZE, PORTABLE_ERROR_CODES.IO_FAILED, 'wrap-bek')
    zeroize(wrapKey)
    wrapKey = undefined
    checkCancelled(signal)

    const prefix = concatBytes(header, mat.wrapNonce, wrappedBek)
    const envelopeDigest = computeEnvelopeDigest(cryptoProvider, prefix)
    const transcriptHasher = createTranscriptHasher(cryptoProvider, envelopeDigest)

    manifestKey = await cryptoProvider.hkdfSha256(
      mat.bek,
      mat.backupId,
      buildFrameKeyInfo(PORTABLE_STREAM_ID.CONTROL, PORTABLE_FRAME_TYPE.MANIFEST),
      PORTABLE_KEY_SIZE,
    )
    checkCancelled(signal)
    dataKey = await cryptoProvider.hkdfSha256(
      mat.bek,
      mat.backupId,
      buildFrameKeyInfo(PORTABLE_STREAM_ID.DATA, PORTABLE_FRAME_TYPE.DATA),
      PORTABLE_KEY_SIZE,
    )
    checkCancelled(signal)
    footerKey = await cryptoProvider.hkdfSha256(
      mat.bek,
      mat.backupId,
      buildFrameKeyInfo(PORTABLE_STREAM_ID.CONTROL, PORTABLE_FRAME_TYPE.FOOTER),
      PORTABLE_KEY_SIZE,
    )
    checkCancelled(signal)

    yield prefix
    checkCancelled(signal)

    // 1. MANIFEST frame
    const manifestPlain = encodeManifestPayload()
    const manifestFrameHeader = encodeFrameHeader({
      streamId: PORTABLE_STREAM_ID.CONTROL,
      type: PORTABLE_FRAME_TYPE.MANIFEST,
      flags: PORTABLE_FRAME_FLAG.CONTINUE,
      index: 0n,
      plaintextLen: PORTABLE_MANIFEST_SIZE,
      ciphertextLen: PORTABLE_MANIFEST_SIZE + PORTABLE_TAG_SIZE,
    })
    checkCancelled(signal)
    const manifestCipher = await cryptoProvider.aesGcmEncrypt(
      manifestKey,
      buildFrameNonce(PORTABLE_STREAM_ID.CONTROL, PORTABLE_FRAME_TYPE.MANIFEST, 0n),
      manifestPlain,
      concatBytes(envelopeDigest, manifestFrameHeader),
    )
    checkCancelled(signal)
    transcriptHasher.addFrame(manifestFrameHeader, manifestCipher)
    yield manifestFrameHeader
    checkCancelled(signal)
    yield manifestCipher
    checkCancelled(signal)

    // 2. DATA frames with 1-block lookahead for final flag
    /** @type {{ tableId: number, rowCount: bigint, digest: Uint8Array }[]} */
    let businessVerifiers = []
    const chunkGen = encodeLogicalStreamChunks(getTableSource, () => cryptoProvider.createSha256(), {
      frameLimit: PORTABLE_FRAME_LIMIT,
      applyTaskPolicy,
      validateJson,
      onBusinessVerifiers: v => {
        businessVerifiers = v
      },
    })

    let dataFrameCount = 0
    let totalPlaintextBytes = 0n
    let totalCiphertextBytes = 0n
    let totalPackageBytes = BigInt(PORTABLE_PREFIX_SIZE + PORTABLE_FRAME_HEADER_SIZE + manifestCipher.byteLength)

    /**
     * @param {Uint8Array} plainChunk
     * @param {number} flags
     */
    const encryptAndEmitDataFrame = async (plainChunk, flags) => {
      checkCancelled(signal)
      requirePortable(dataFrameCount < PORTABLE_LIMITS.MAX_DATA_FRAMES, PORTABLE_ERROR_CODES.RESOURCE_LIMIT, 'data-frame-count')
      const index = BigInt(dataFrameCount)
      const plaintextLen = plainChunk.byteLength
      const ciphertextLen = plaintextLen + PORTABLE_TAG_SIZE
      totalPlaintextBytes += BigInt(plaintextLen)
      totalCiphertextBytes += BigInt(ciphertextLen)
      totalPackageBytes += BigInt(PORTABLE_FRAME_HEADER_SIZE + ciphertextLen)
      requirePortable(
        totalPlaintextBytes <= PORTABLE_LIMITS.MAX_DATA_PLAINTEXT_BYTES &&
          totalPackageBytes <= PORTABLE_LIMITS.MAX_PACKAGE_BYTES,
        PORTABLE_ERROR_CODES.RESOURCE_LIMIT,
        'package-size',
      )

      const frameHeader = encodeFrameHeader({
        streamId: PORTABLE_STREAM_ID.DATA,
        type: PORTABLE_FRAME_TYPE.DATA,
        flags,
        index,
        plaintextLen,
        ciphertextLen,
      })
      const ciphertextAndTag = await cryptoProvider.aesGcmEncrypt(
        dataKey,
        buildFrameNonce(PORTABLE_STREAM_ID.DATA, PORTABLE_FRAME_TYPE.DATA, index),
        plainChunk,
        concatBytes(envelopeDigest, frameHeader),
      )
      checkCancelled(signal)
      transcriptHasher.addFrame(frameHeader, ciphertextAndTag)
      dataFrameCount += 1
      return { frameHeader, ciphertextAndTag }
    }

    for await (const chunk of chunkGen) {
      checkCancelled(signal)
      if (pendingPlain !== null) {
        const frame = await encryptAndEmitDataFrame(pendingPlain, PORTABLE_FRAME_FLAG.CONTINUE)
        pendingPlain = null
        yield frame.frameHeader
        checkCancelled(signal)
        yield frame.ciphertextAndTag
        checkCancelled(signal)
      }
      pendingPlain = chunk
    }
    checkCancelled(signal)

    requirePortable(pendingPlain !== null && pendingPlain.byteLength >= 1, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'empty-data-stream')
    const finalFrame = await encryptAndEmitDataFrame(pendingPlain, PORTABLE_FRAME_FLAG.FINAL)
    pendingPlain = null
    yield finalFrame.frameHeader
    checkCancelled(signal)
    yield finalFrame.ciphertextAndTag
    checkCancelled(signal)

    // 3. FOOTER frame
    const transcript = transcriptHasher.digest()
    const mergedVerifiers = [...businessVerifiers, ...derivedVerifiers].sort((a, b) => a.tableId - b.tableId)
    const footerPlain = encodeFooterPayload({
      dataFrameCount,
      totalPlaintextBytes,
      totalCiphertextBytes,
      transcript,
      verifiers: mergedVerifiers,
    })
    const footerFrameHeader = encodeFrameHeader({
      streamId: PORTABLE_STREAM_ID.CONTROL,
      type: PORTABLE_FRAME_TYPE.FOOTER,
      flags: PORTABLE_FRAME_FLAG.CONTINUE,
      index: 0n,
      plaintextLen: PORTABLE_FOOTER_SIZE,
      ciphertextLen: PORTABLE_FOOTER_SIZE + PORTABLE_TAG_SIZE,
    })
    checkCancelled(signal)
    const footerCipher = await cryptoProvider.aesGcmEncrypt(
      footerKey,
      buildFrameNonce(PORTABLE_STREAM_ID.CONTROL, PORTABLE_FRAME_TYPE.FOOTER, 0n),
      footerPlain,
      concatBytes(envelopeDigest, footerFrameHeader),
    )
    checkCancelled(signal)
    totalPackageBytes += BigInt(PORTABLE_FRAME_HEADER_SIZE + footerCipher.byteLength)
    requirePortable(totalPackageBytes <= PORTABLE_LIMITS.MAX_PACKAGE_BYTES, PORTABLE_ERROR_CODES.RESOURCE_LIMIT, 'package-size')
    yield footerFrameHeader
    checkCancelled(signal)
    yield footerCipher
    checkCancelled(signal)

    return {
      dataFrameCount,
      totalPlaintextBytes,
      totalCiphertextBytes,
      transcript,
      verifiers: mergedVerifiers,
    }
  } finally {
    zeroize(mat.salt, mat.backupId, mat.wrapNonce, mat.bek, wrapKey, manifestKey, dataKey, footerKey, pendingPlain)
  }
}

/**
 * Verify and stream-decode a Scheme C portable backup container into a staging sink.
 * Never yields unauthenticated frame plaintext to the logical decoder and never commits before EOF + full verification.
 *
 * @param {{
 *   source: Uint8Array | AsyncIterable<Uint8Array> | Iterable<Uint8Array> | (() => Promise<Uint8Array | null> | Uint8Array | null),
 *   password: string,
 *   stagingSink: import('./contracts').PortableStagingSink,
 *   cryptoProvider: import('./contracts').PortableCryptoProvider,
 *   signal?: AbortSignal,
 *   validateJson?: boolean,
 * }} params
 */
export async function decodePortableContainer({
  source,
  password,
  stagingSink,
  cryptoProvider,
  signal,
  validateJson = true,
}) {
  /** @type {ReturnType<typeof createBoundedByteReader> | null} */
  let reader = null
  /** @type {Uint8Array | undefined} */
  let wrapKey
  /** @type {Uint8Array | undefined} */
  let bek
  /** @type {Uint8Array | undefined} */
  let manifestKey
  /** @type {Uint8Array | undefined} */
  let dataKey
  /** @type {Uint8Array | undefined} */
  let footerKey
  let committed = false
  let aborted = false

  try {
    checkCancelled(signal)
    reader = createBoundedByteReader(source, signal)

    // 1. Read fixed 124-byte prefix; validate header & password BEFORE any KDF.
    const prefix = await reader.readExact(PORTABLE_PREFIX_SIZE)
    const headerBytes = prefix.subarray(0, PORTABLE_HEADER_SIZE)
    const parsedHeader = decodePublicHeader(headerBytes)
    const wrapNonce = prefix.subarray(PORTABLE_HEADER_SIZE, PORTABLE_HEADER_SIZE + PORTABLE_WRAP_NONCE_SIZE)
    const wrappedBek = prefix.subarray(PORTABLE_HEADER_SIZE + PORTABLE_WRAP_NONCE_SIZE)

    wrapKey = await deriveWrapKey(
      password,
      headerBytes,
      parsedHeader.salt,
      parsedHeader.backupId,
      parsedHeader.iterations,
      cryptoProvider,
      signal,
    )

    checkCancelled(signal)
    try {
      bek = await cryptoProvider.aesGcmDecrypt(wrapKey, wrapNonce, wrappedBek, headerBytes)
    } catch {
      throw new PortableBackupError(PORTABLE_ERROR_CODES.AUTH_FAILED, 'envelope')
    }
    expectExactBytes(bek, PORTABLE_KEY_SIZE, PORTABLE_ERROR_CODES.AUTH_FAILED, 'bek-length')
    zeroize(wrapKey)
    wrapKey = undefined
    checkCancelled(signal)

    const envelopeDigest = computeEnvelopeDigest(cryptoProvider, prefix)
    const transcriptHasher = createTranscriptHasher(cryptoProvider, envelopeDigest)

    manifestKey = await cryptoProvider.hkdfSha256(
      bek,
      parsedHeader.backupId,
      buildFrameKeyInfo(PORTABLE_STREAM_ID.CONTROL, PORTABLE_FRAME_TYPE.MANIFEST),
      PORTABLE_KEY_SIZE,
    )
    checkCancelled(signal)
    dataKey = await cryptoProvider.hkdfSha256(
      bek,
      parsedHeader.backupId,
      buildFrameKeyInfo(PORTABLE_STREAM_ID.DATA, PORTABLE_FRAME_TYPE.DATA),
      PORTABLE_KEY_SIZE,
    )
    checkCancelled(signal)
    footerKey = await cryptoProvider.hkdfSha256(
      bek,
      parsedHeader.backupId,
      buildFrameKeyInfo(PORTABLE_STREAM_ID.CONTROL, PORTABLE_FRAME_TYPE.FOOTER),
      PORTABLE_KEY_SIZE,
    )
    checkCancelled(signal)

    /**
     * Validate frame header bounds and decode one authenticated frame.
     * @param {Uint8Array} frameHeaderBytes
     * @param {ReturnType<typeof decodeFrameHeader>} f
     * @param {Uint8Array} key
     */
    const readAndDecryptFrame = async (frameHeaderBytes, f, key) => {
      const ciphertextAndTag = await reader.readExact(f.ciphertextLen)
      checkCancelled(signal)
      let plaintext
      try {
        plaintext = await cryptoProvider.aesGcmDecrypt(
          key,
          buildFrameNonce(f.streamId, f.type, f.index),
          ciphertextAndTag,
          concatBytes(envelopeDigest, frameHeaderBytes),
        )
      } catch {
        throw new PortableBackupError(PORTABLE_ERROR_CODES.AUTH_FAILED, `frame:${f.type}:${f.index}`)
      }
      checkCancelled(signal)
      requirePortable(
        plaintext.byteLength === f.plaintextLen,
        PORTABLE_ERROR_CODES.INVALID_CONTAINER,
        'frame-plaintext-len',
      )
      return { plaintext, ciphertextAndTag }
    }

    /**
     * Check generic frame limits before reading ciphertext or allocating payload buffers.
     * @param {ReturnType<typeof decodeFrameHeader>} f
     */
    const checkFrameShapeLimits = f => {
      if (
        f.type !== PORTABLE_FRAME_TYPE.MANIFEST &&
        f.type !== PORTABLE_FRAME_TYPE.DATA &&
        f.type !== PORTABLE_FRAME_TYPE.FOOTER
      ) {
        throw new PortableBackupError(PORTABLE_ERROR_CODES.UNSUPPORTED_FORMAT, 'frame-type')
      }
      if (f.type === PORTABLE_FRAME_TYPE.DATA) {
        requirePortable(
          f.flags === PORTABLE_FRAME_FLAG.CONTINUE || f.flags === PORTABLE_FRAME_FLAG.FINAL,
          PORTABLE_ERROR_CODES.UNSUPPORTED_FORMAT,
          'frame-flags',
        )
      } else {
        requirePortable(f.flags === PORTABLE_FRAME_FLAG.CONTINUE, PORTABLE_ERROR_CODES.UNSUPPORTED_FORMAT, 'frame-flags')
      }
      requirePortable(
        f.plaintextLen <= PORTABLE_FRAME_LIMIT && f.ciphertextLen <= PORTABLE_FRAME_LIMIT + PORTABLE_TAG_SIZE,
        PORTABLE_ERROR_CODES.RESOURCE_LIMIT,
        'frame-limit',
      )
      requirePortable(
        f.ciphertextLen === f.plaintextLen + PORTABLE_TAG_SIZE,
        PORTABLE_ERROR_CODES.INVALID_CONTAINER,
        'frame-ciphertext-len',
      )
    }

    // 2. Read & authenticate MANIFEST frame
    const manifestHeaderBytes = await reader.readExact(PORTABLE_FRAME_HEADER_SIZE)
    const mf = decodeFrameHeader(manifestHeaderBytes)
    checkFrameShapeLimits(mf)
    requirePortable(
      mf.streamId === PORTABLE_STREAM_ID.CONTROL &&
        mf.type === PORTABLE_FRAME_TYPE.MANIFEST &&
        mf.index === 0n &&
        mf.plaintextLen === PORTABLE_MANIFEST_SIZE,
      PORTABLE_ERROR_CODES.INVALID_CONTAINER,
      'manifest-frame-header',
    )
    const manifestFrame = await readAndDecryptFrame(manifestHeaderBytes, mf, manifestKey)
    transcriptHasher.addFrame(manifestHeaderBytes, manifestFrame.ciphertextAndTag)
    const manifest = decodeManifestPayload(manifestFrame.plaintext)

    // 3. Read, authenticate and stream-decode DATA frames
    const logicalDecoder = createLogicalStreamDecoder(stagingSink, () => cryptoProvider.createSha256(), {
      validateJson,
    })

    let dataFrameCount = 0
    let totalPlaintextBytes = 0n
    let totalCiphertextBytes = 0n
    let totalPackageBytes = BigInt(PORTABLE_PREFIX_SIZE + PORTABLE_FRAME_HEADER_SIZE + mf.ciphertextLen)
    let seenFinalData = false

    while (!seenFinalData) {
      const dhBytes = await reader.readExact(PORTABLE_FRAME_HEADER_SIZE)
      const df = decodeFrameHeader(dhBytes)
      checkFrameShapeLimits(df)
      requirePortable(
        df.streamId === PORTABLE_STREAM_ID.DATA &&
          df.type === PORTABLE_FRAME_TYPE.DATA &&
          df.index === BigInt(dataFrameCount),
        PORTABLE_ERROR_CODES.INVALID_CONTAINER,
        'data-frame-order',
      )
      if (df.flags === PORTABLE_FRAME_FLAG.CONTINUE) {
        requirePortable(df.plaintextLen === PORTABLE_FRAME_LIMIT, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'data-frame-full-len')
      } else {
        requirePortable(df.plaintextLen >= 1, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'data-frame-empty-final')
      }

      requirePortable(dataFrameCount < PORTABLE_LIMITS.MAX_DATA_FRAMES, PORTABLE_ERROR_CODES.RESOURCE_LIMIT, 'data-frame-count')
      totalPlaintextBytes += BigInt(df.plaintextLen)
      totalCiphertextBytes += BigInt(df.ciphertextLen)
      totalPackageBytes += BigInt(PORTABLE_FRAME_HEADER_SIZE + df.ciphertextLen)
      requirePortable(
        totalPlaintextBytes <= PORTABLE_LIMITS.MAX_DATA_PLAINTEXT_BYTES &&
          totalPackageBytes <= PORTABLE_LIMITS.MAX_PACKAGE_BYTES,
        PORTABLE_ERROR_CODES.RESOURCE_LIMIT,
        'package-size',
      )

      const dataFrame = await readAndDecryptFrame(dhBytes, df, dataKey)
      transcriptHasher.addFrame(dhBytes, dataFrame.ciphertextAndTag)
      dataFrameCount += 1
      await logicalDecoder.push(dataFrame.plaintext)
      checkCancelled(signal)
      if (df.flags === PORTABLE_FRAME_FLAG.FINAL) seenFinalData = true
    }

    // 4. Read & authenticate FOOTER frame and check exact EOF
    const fhBytes = await reader.readExact(PORTABLE_FRAME_HEADER_SIZE)
    const ff = decodeFrameHeader(fhBytes)
    checkFrameShapeLimits(ff)
    requirePortable(
      ff.streamId === PORTABLE_STREAM_ID.CONTROL &&
        ff.type === PORTABLE_FRAME_TYPE.FOOTER &&
        ff.index === 0n &&
        ff.plaintextLen === PORTABLE_FOOTER_SIZE,
      PORTABLE_ERROR_CODES.INVALID_CONTAINER,
      'footer-frame-header',
    )
    totalPackageBytes += BigInt(PORTABLE_FRAME_HEADER_SIZE + ff.ciphertextLen)
    requirePortable(totalPackageBytes <= PORTABLE_LIMITS.MAX_PACKAGE_BYTES, PORTABLE_ERROR_CODES.RESOURCE_LIMIT, 'package-size')

    const footerFrame = await readAndDecryptFrame(fhBytes, ff, footerKey)
    await reader.assertEof()
    checkCancelled(signal)

    const actualTranscript = transcriptHasher.digest()
    const footer = decodeFooterPayload(footerFrame.plaintext)
    requirePortable(
      footer.dataFrameCount === dataFrameCount &&
        footer.totalPlaintextBytes === totalPlaintextBytes &&
        footer.totalCiphertextBytes === totalCiphertextBytes &&
        constantTimeEqual(footer.transcript, actualTranscript),
      PORTABLE_ERROR_CODES.INVALID_CONTAINER,
      'footer-transcript-mismatch',
    )

    // 5. Verify 45 business table digests and delegate 5 derived table verifications + commit to sink
    const businessVerifiers = logicalDecoder.finish()
    const footerById = new Map(footer.verifiers.map(v => [v.tableId, v]))
    for (const actual of businessVerifiers) {
      const expected = footerById.get(actual.tableId)
      requirePortable(
        Boolean(expected) &&
          expected.rowCount === actual.rowCount &&
          constantTimeEqual(expected.digest, actual.digest),
        PORTABLE_ERROR_CODES.INVALID_LOGICAL,
        `table-verifier:${actual.tableId}`,
      )
    }

    checkCancelled(signal)
    await stagingSink.verify(footer.verifiers, {
      header: { ...parsedHeader, salt: parsedHeader.salt.slice(), backupId: parsedHeader.backupId.slice() },
      manifest,
      footer,
    })

    checkCancelled(signal)
    await stagingSink.commit()
    committed = true
    return {
      header: parsedHeader,
      manifest,
      footer,
    }
  } finally {
    zeroize(wrapKey, bek, manifestKey, dataKey, footerKey)
    if (reader) {
      await reader.close()
    }
    if (!committed && !aborted) {
      aborted = true
      try {
        await stagingSink?.abort?.()
      } catch {
        // Preserve original validation/auth error; abort is best-effort cleanup.
      }
    }
  }
}
