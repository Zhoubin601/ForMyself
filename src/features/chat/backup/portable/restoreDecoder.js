// @ts-check
// Bounded streaming KPB1 restore decoder built on M6-01 frozen containerCodec.
// Never buffers the entire backup file into JS memory; never publishes unauthenticated data;
// never leaks passwords, keys, or row plaintext in errors.

import {
  PORTABLE_ERROR_CODES,
  PORTABLE_FOOTER_TABLE_COUNT,
  PortableBackupError,
  requirePortable,
} from './constants.js'
import { PORTABLE_BUSINESS_TABLES } from './catalog.js'
import { decodePortableContainer } from './containerCodec.js'

/** @type {ReadonlySet<string>} */
const STABLE_CODES = new Set(Object.values(PORTABLE_ERROR_CODES))

/**
 * Normalize any failure from KPB1 decoding into a stable PortableBackupError
 * without leaking secrets, passwords, or record contents.
 * @param {unknown} error
 * @param {string} [fallbackStage]
 * @returns {PortableBackupError}
 */
export function normalizePortableRestoreError(error, fallbackStage = 'restore-decode') {
  if (error instanceof PortableBackupError && STABLE_CODES.has(error.code)) {
    return error
  }
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (STABLE_CODES.has(code)) {
    const stage = error && typeof error === 'object' && 'stage' in error && typeof error.stage === 'string'
      ? error.stage
      : fallbackStage
    return new PortableBackupError(code, stage)
  }
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
    return new PortableBackupError(PORTABLE_ERROR_CODES.CANCELLED, 'cancelled')
  }
  return new PortableBackupError(PORTABLE_ERROR_CODES.IO_FAILED, fallbackStage)
}

/**
 * Wrap a Blob/File or AsyncIterable<Uint8Array> into a bounded chunk stream (default 64 KiB)
 * so JS never loads an entire backup file into memory at once.
 * @param {Uint8Array | AsyncIterable<Uint8Array> | Iterable<Uint8Array> | Blob} input
 * @param {number} [chunkBytes]
 * @returns {AsyncIterable<Uint8Array>}
 */
export function createBoundedBackupSource(input, chunkBytes = 65536) {
  requirePortable(
    Number.isInteger(chunkBytes) && chunkBytes >= 1024 && chunkBytes <= 65536,
    PORTABLE_ERROR_CODES.RESOURCE_LIMIT,
    'source-chunk-limit',
  )
  if (input instanceof Uint8Array) {
    return {
      async *[Symbol.asyncIterator]() {
        for (let offset = 0; offset < input.byteLength; offset += chunkBytes) {
          yield input.subarray(offset, Math.min(offset + chunkBytes, input.byteLength))
        }
      },
    }
  }
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return {
      async *[Symbol.asyncIterator]() {
        const size = input.size
        for (let offset = 0; offset < size; offset += chunkBytes) {
          const slice = input.slice(offset, Math.min(offset + chunkBytes, size))
          const buf = await slice.arrayBuffer()
          yield new Uint8Array(buf)
        }
      },
    }
  }
  if (input && typeof input === 'object' && (Symbol.asyncIterator in input || Symbol.iterator in input)) {
    return {
      async *[Symbol.asyncIterator]() {
        for await (const chunk of /** @type {AsyncIterable<Uint8Array>} */ (input)) {
          if (!(chunk instanceof Uint8Array)) {
            throw new PortableBackupError(PORTABLE_ERROR_CODES.IO_FAILED, 'source-chunk-type')
          }
          if (chunk.byteLength === 0) {
            yield chunk
            continue
          }
          for (let offset = 0; offset < chunk.byteLength; offset += chunkBytes) {
            yield chunk.subarray(offset, Math.min(offset + chunkBytes, chunk.byteLength))
          }
        }
      },
    }
  }
  throw new PortableBackupError(PORTABLE_ERROR_CODES.IO_FAILED, 'unsupported-source')
}

/**
 * Stream-decode and authenticate a KPB1 backup package into an isolated staging sink.
 * Unauthenticated records can only flow into stagingSink; on ANY error stagingSink.abort()
 * is invoked and never committed.
 *
 * @param {{
 *   source: Uint8Array | AsyncIterable<Uint8Array> | Iterable<Uint8Array> | Blob,
 *   password: string,
 *   stagingSink: import('./contracts').PortableStagingSink,
 *   cryptoProvider: import('./contracts').PortableCryptoProvider,
 *   signal?: AbortSignal,
 *   chunkBytes?: number,
 *   onProgress?: (progress: {
 *     phase: 'reading_kpb1' | 'authenticating' | 'staging_import' | 'verifying_staging' | 'staging_ready',
 *     tablesDone: number,
 *     totalTables: number,
 *     rowsDecoded: number,
 *     bytesRead: number,
 *     percent: number,
 *   }) => void,
 * }} options
 */
export async function decodeKpb1ToStaging({
  source,
  password,
  stagingSink,
  cryptoProvider,
  signal,
  chunkBytes = 65536,
  onProgress,
}) {
  if (signal?.aborted) {
    throw new PortableBackupError(PORTABLE_ERROR_CODES.CANCELLED, 'cancelled')
  }
  if (typeof password !== 'string' || password.length === 0) {
    throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_PASSWORD_INPUT, 'password-empty')
  }

  let bytesRead = 0
  let tablesDone = 0
  let rowsDecoded = 0
  const totalTables = PORTABLE_BUSINESS_TABLES.length
  let currentPhase = /** @type {'reading_kpb1' | 'authenticating' | 'staging_import' | 'verifying_staging' | 'staging_ready'} */ ('reading_kpb1')

  const emit = (/** @type {typeof currentPhase} */ phase, percent) => {
    currentPhase = phase
    onProgress?.({
      phase: currentPhase,
      tablesDone,
      totalTables,
      rowsDecoded,
      bytesRead,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
    })
  }

  emit('reading_kpb1', 2)

  const bounded = createBoundedBackupSource(source, chunkBytes)
  /** @type {AsyncIterable<Uint8Array>} */
  const meteredSource = {
    async *[Symbol.asyncIterator]() {
      let emittedAuth = false
      for await (const chunk of bounded) {
        if (signal?.aborted) {
          throw new PortableBackupError(PORTABLE_ERROR_CODES.CANCELLED, 'cancelled')
        }
        bytesRead += chunk.byteLength
        if (!emittedAuth && bytesRead >= 124) {
          emittedAuth = true
          emit('authenticating', 10)
        }
        yield chunk
      }
    },
  }

  /** @type {import('./contracts').PortableStagingSink} */
  const trackedSink = {
    async beginTable(table, rowCount) {
      if (tablesDone === 0) emit('staging_import', 15)
      await stagingSink.beginTable(table, rowCount)
    },
    async writeRow(table, row, ordinal) {
      rowsDecoded++
      await stagingSink.writeRow(table, row, ordinal)
    },
    async finishTable(table, rowCount, digest) {
      await stagingSink.finishTable(table, rowCount, digest)
      tablesDone++
      const pct = 15 + (tablesDone / totalTables) * 70
      emit('staging_import', pct)
    },
    async verify(verifiers, context) {
      emit('verifying_staging', 90)
      requirePortable(
        verifiers.length === PORTABLE_FOOTER_TABLE_COUNT,
        PORTABLE_ERROR_CODES.INVALID_LOGICAL,
        'footer-verifier-count',
      )
      await stagingSink.verify(verifiers, context)
    },
    async commit() {
      await stagingSink.commit()
      emit('staging_ready', 100)
    },
    async abort() {
      await stagingSink.abort()
    },
  }

  try {
    const result = await decodePortableContainer({
      source: meteredSource,
      password,
      stagingSink: trackedSink,
      cryptoProvider,
      signal,
    })
    return {
      ...result,
      metrics: {
        bytesRead,
        tablesDecoded: tablesDone,
        rowsDecoded,
        dataFrameCount: result.footer.dataFrameCount,
        totalPlaintextBytes: result.footer.totalPlaintextBytes,
        totalCiphertextBytes: result.footer.totalCiphertextBytes,
      },
    }
  } catch (error) {
    throw normalizePortableRestoreError(error)
  }
}
