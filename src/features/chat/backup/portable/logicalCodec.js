// @ts-check
import {
  asciiBytes,
  compareUnsignedBytes,
  concatBytes,
  decodeStrictUtf8,
  encodeStrictUtf8,
  readF64BE,
  readI64BE,
  readU16BE,
  readU32BE,
  readU64BE,
  writeF64BE,
  writeI64BE,
  writeU16BE,
  writeU32BE,
  writeU64BE,
} from './bytes.js'
import {
  PORTABLE_BUSINESS_TABLES,
  PORTABLE_DERIVED_TABLES,
  PORTABLE_TABLES_BY_ID,
} from './catalog.js'
import {
  PORTABLE_DIGEST_SIZE,
  PORTABLE_DOMAIN,
  PORTABLE_ERROR_CODES,
  PORTABLE_FRAME_LIMIT,
  PORTABLE_LIMITS,
  PortableBackupError,
  requirePortable,
} from './constants.js'

const SENDING_TASK_KINDS = new Set(['reply', 'proactive', 'followup'])
const CANCELLED_ON_PAUSE_STATES = new Set(['pending', 'running', 'failed'])
const JSON_OBJECT_COLUMNS = new Set([
  'extensions_json',
  'definition_json',
  'overrides_json',
  'metadata_json',
  'previous_json',
  'next_json',
  'imported_json',
])
const JSON_ARRAY_COLUMNS = new Set(['keys_json', 'secondary_keys_json'])
const JSON_ANY_COLUMNS = new Set(['raw_data_json', 'value_json', 'cursor_json'])

/**
 * Validate JSON syntax and container shape without altering original UTF-8 text.
 * @param {string} columnName
 * @param {string} value
 */
function assertJsonColumnText(columnName, value) {
  const mustObject = JSON_OBJECT_COLUMNS.has(columnName)
  const mustArray = JSON_ARRAY_COLUMNS.has(columnName)
  const mustAny = JSON_ANY_COLUMNS.has(columnName)
  if (!mustObject && !mustArray && !mustAny) return
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'json-column')
  }
  if (mustObject) {
    requirePortable(
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed),
      PORTABLE_ERROR_CODES.INVALID_LOGICAL,
      'json-object-column',
    )
  } else if (mustArray) {
    requirePortable(Array.isArray(parsed), PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'json-array-column')
  }
}

/**
 * Normalize integer column input into exact i64 BigInt.
 * @param {unknown} value
 * @param {string} [stage]
 * @returns {bigint}
 */
export function toI64BigInt(value, stage = 'integer') {
  if (typeof value === 'bigint') {
    requirePortable(
      value >= PORTABLE_LIMITS.MIN_I64 && value <= PORTABLE_LIMITS.MAX_I64,
      PORTABLE_ERROR_CODES.INVALID_LOGICAL,
      stage,
    )
    return value
  }
  if (typeof value === 'number') {
    requirePortable(Number.isSafeInteger(value), PORTABLE_ERROR_CODES.INVALID_LOGICAL, stage)
    return BigInt(value)
  }
  throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_LOGICAL, stage)
}

/**
 * Normalize non-negative ordinal for 005 array-ordered tables.
 * @param {unknown} value
 * @returns {bigint}
 */
export function toValidOrdinal(value) {
  const n = toI64BigInt(value, 'ordinal')
  requirePortable(n >= 0n && n <= PORTABLE_LIMITS.MAX_ORDINAL, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'ordinal')
  return n
}

/**
 * Project a background_tasks row with pause-sending-v1 without mutating the input object.
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function projectTaskPauseSendingV1(row) {
  requirePortable(row && typeof row === 'object' && !Array.isArray(row), PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'task')
  const kind = row.kind
  const state = row.state
  let nextState = state
  if (typeof kind === 'string' && typeof state === 'string') {
    if (SENDING_TASK_KINDS.has(kind) && CANCELLED_ON_PAUSE_STATES.has(state)) {
      nextState = 'cancelled'
    } else if (state === 'running') {
      nextState = 'pending'
    }
  }
  return {
    ...row,
    lease_until: 0n,
    state: nextState,
  }
}

/**
 * Verify a background_tasks row complies with pause-sending-v1.
 * @param {Record<string, unknown>} row
 */
export function assertTaskPauseSendingV1(row) {
  requirePortable(row && typeof row === 'object' && !Array.isArray(row), PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'task')
  const leaseUntil = toI64BigInt(row.lease_until, 'task-lease')
  requirePortable(leaseUntil === 0n, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'task-lease')
  const kind = row.kind
  const state = row.state
  requirePortable(typeof kind === 'string' && typeof state === 'string', PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'task-state')
  if (SENDING_TASK_KINDS.has(kind)) {
    requirePortable(!CANCELLED_ON_PAUSE_STATES.has(state), PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'task-state')
  } else {
    requirePortable(state !== 'running', PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'task-state')
  }
}

/**
 * Tracks strictly ascending primary key / (world_id, ordinal) order in O(1) memory.
 * @param {(typeof import('./catalog.js').PORTABLE_TABLES)[number]} tableDef
 */
export function createRowOrderTracker(tableDef) {
  /** @type {{ worldIdBytes: Uint8Array, ordinal: bigint } | null} */
  let prevOrdered = null
  /** @type {(Uint8Array | bigint | number)[] | null} */
  let prevPk = null

  return {
    /**
     * Validate that (row, ordinal) strictly follows the previous row.
     * @param {Record<string, unknown>} row
     * @param {bigint | null} [ordinal]
     * @param {Map<string, Uint8Array>} [encodedTextCache]
     */
    accept(row, ordinal = null, encodedTextCache = undefined) {
      if (tableDef.hasOrdinal) {
        const ord = toValidOrdinal(ordinal)
        const worldId = row.world_id
        const worldIdBytes =
          encodedTextCache?.get('world_id') ?? encodeStrictUtf8(worldId, 'order-world-id')
        if (!prevOrdered) {
          requirePortable(ord === 0n, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'ordinal-start')
        } else {
          const cmp = compareUnsignedBytes(prevOrdered.worldIdBytes, worldIdBytes)
          requirePortable(cmp <= 0, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'ordinal-world-order')
          if (cmp === 0) {
            requirePortable(ord === prevOrdered.ordinal + 1n, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'ordinal-sequence')
          } else {
            requirePortable(ord === 0n, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'ordinal-start')
          }
        }
        prevOrdered = { worldIdBytes, ordinal: ord }
        return
      }

      /** @type {(Uint8Array | bigint | number)[]} */
      const currentPk = []
      for (const pkColName of tableDef.pkColumns) {
        const col = tableDef.columnsByName[pkColName]
        const raw = row[pkColName]
        if (col.type === 'TEXT') {
          currentPk.push(encodedTextCache?.get(pkColName) ?? encodeStrictUtf8(raw, 'pk-text'))
        } else if (col.type === 'INTEGER') {
          currentPk.push(toI64BigInt(raw, 'pk-int'))
        } else {
          requirePortable(
            typeof raw === 'number' && Number.isFinite(raw),
            PORTABLE_ERROR_CODES.INVALID_LOGICAL,
            'pk-real',
          )
          currentPk.push(Object.is(raw, -0) ? 0 : raw)
        }
      }

      if (prevPk) {
        let cmp = 0
        for (let i = 0; i < currentPk.length; i++) {
          const a = prevPk[i]
          const b = currentPk[i]
          if (a instanceof Uint8Array && b instanceof Uint8Array) {
            cmp = compareUnsignedBytes(a, b)
          } else if (a !== b) {
            cmp = a < b ? -1 : 1
          }
          if (cmp !== 0) break
        }
        requirePortable(cmp < 0, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'pk-order')
      }
      prevPk = currentPk
    },
  }
}

/**
 * Encode one table row body (excluding the 4-byte bodyLength prefix) according to kanata-logical-v1.
 * @param {(typeof import('./catalog.js').PORTABLE_TABLES)[number]} tableDef
 * @param {Record<string, unknown>} rawRow
 * @param {{ ordinal?: bigint | number | null, applyTaskPolicy?: boolean, validateJson?: boolean }} [options]
 * @returns {{ body: Uint8Array, row: Record<string, unknown>, ordinal: bigint | null, encodedTexts: Map<string, Uint8Array> }}
 */
export function encodeLogicalRowBody(tableDef, rawRow, options = {}) {
  requirePortable(rawRow && typeof rawRow === 'object' && !Array.isArray(rawRow), PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'row')
  const applyTaskPolicy = options.applyTaskPolicy !== false
  const validateJson = options.validateJson !== false

  let row = rawRow
  if (tableDef.name === 'background_tasks') {
    if (applyTaskPolicy) {
      row = projectTaskPauseSendingV1(rawRow)
    } else {
      assertTaskPauseSendingV1(rawRow)
    }
  }

  /** @type {bigint | null} */
  let ordinal = null
  /** @type {Uint8Array[]} */
  const parts = []
  let totalBytes = 0
  /** @type {Map<string, Uint8Array>} */
  const encodedTexts = new Map()

  if (tableDef.hasOrdinal) {
    const rawOrdinal = options.ordinal !== undefined ? options.ordinal : row.ordinal
    ordinal = toValidOrdinal(rawOrdinal)
    const ordBuf = new Uint8Array(8)
    writeU64BE(ordBuf, 0, ordinal)
    parts.push(ordBuf)
    totalBytes += 8
  }

  for (const col of tableDef.columns) {
    const val = row[col.name]
    if (val === null || val === undefined) {
      requirePortable(!col.notnull, PORTABLE_ERROR_CODES.INVALID_LOGICAL, `notnull:${tableDef.name}.${col.name}`)
      parts.push(new Uint8Array([0]))
      totalBytes += 1
      continue
    }

    if (col.type === 'INTEGER') {
      const n = toI64BigInt(val, `col:${tableDef.name}.${col.name}`)
      const buf = new Uint8Array(9)
      buf[0] = 1
      writeI64BE(buf, 1, n)
      parts.push(buf)
      totalBytes += 9
    } else if (col.type === 'REAL') {
      requirePortable(
        typeof val === 'number' && Number.isFinite(val),
        PORTABLE_ERROR_CODES.INVALID_LOGICAL,
        `col:${tableDef.name}.${col.name}`,
      )
      const buf = new Uint8Array(9)
      buf[0] = 1
      writeF64BE(buf, 1, val, `col:${tableDef.name}.${col.name}`)
      parts.push(buf)
      totalBytes += 9
    } else {
      const utf8 = encodeStrictUtf8(val, `col:${tableDef.name}.${col.name}`)
      if (validateJson) assertJsonColumnText(col.name, /** @type {string} */ (val))
      if (col.pk > 0 || (tableDef.hasOrdinal && col.name === 'world_id')) {
        encodedTexts.set(col.name, utf8)
      }
      const prefix = new Uint8Array(5)
      prefix[0] = 1
      writeU32BE(prefix, 1, utf8.byteLength)
      parts.push(prefix, utf8)
      totalBytes += 5 + utf8.byteLength
    }
    requirePortable(totalBytes <= PORTABLE_LIMITS.MAX_ROW_BODY_BYTES, PORTABLE_ERROR_CODES.RESOURCE_LIMIT, 'row-body-size')
  }

  const body = concatBytes(...parts)
  return { body, row, ordinal, encodedTexts }
}

/**
 * Decode one table row body (excluding the 4-byte bodyLength prefix) and verify all column/row invariants.
 * @param {(typeof import('./catalog.js').PORTABLE_TABLES)[number]} tableDef
 * @param {Uint8Array} body
 * @param {{ validateJson?: boolean }} [options]
 * @returns {{ row: Record<string, string | bigint | number | null>, ordinal: bigint | null, encodedTexts: Map<string, Uint8Array> }}
 */
export function decodeLogicalRowBody(tableDef, body, options = {}) {
  requirePortable(body instanceof Uint8Array, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'row-body')
  requirePortable(body.byteLength <= PORTABLE_LIMITS.MAX_ROW_BODY_BYTES, PORTABLE_ERROR_CODES.RESOURCE_LIMIT, 'row-body-size')
  const validateJson = options.validateJson !== false

  let offset = 0
  /** @type {bigint | null} */
  let ordinal = null
  if (tableDef.hasOrdinal) {
    requirePortable(offset + 8 <= body.byteLength, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'row-ordinal-truncated')
    ordinal = readU64BE(body, offset)
    requirePortable(ordinal <= PORTABLE_LIMITS.MAX_ORDINAL, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'row-ordinal-range')
    offset += 8
  }

  /** @type {Record<string, string | bigint | number | null>} */
  const row = {}
  /** @type {Map<string, Uint8Array>} */
  const encodedTexts = new Map()

  for (const col of tableDef.columns) {
    requirePortable(offset + 1 <= body.byteLength, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'col-flag-truncated')
    const nullFlag = body[offset++]
    if (nullFlag === 0) {
      requirePortable(!col.notnull, PORTABLE_ERROR_CODES.INVALID_LOGICAL, `notnull:${tableDef.name}.${col.name}`)
      row[col.name] = null
      continue
    }
    requirePortable(nullFlag === 1, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'col-null-flag')

    if (col.type === 'INTEGER') {
      requirePortable(offset + 8 <= body.byteLength, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'col-int-truncated')
      row[col.name] = readI64BE(body, offset)
      offset += 8
    } else if (col.type === 'REAL') {
      requirePortable(offset + 8 <= body.byteLength, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'col-real-truncated')
      row[col.name] = readF64BE(body, offset, `col:${tableDef.name}.${col.name}`)
      offset += 8
    } else {
      requirePortable(offset + 4 <= body.byteLength, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'col-text-len-truncated')
      const len = readU32BE(body, offset)
      offset += 4
      requirePortable(len <= PORTABLE_LIMITS.MAX_TEXT_FIELD_BYTES, PORTABLE_ERROR_CODES.RESOURCE_LIMIT, 'col-text-limit')
      requirePortable(offset + len <= body.byteLength, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'col-text-truncated')
      const slice = body.subarray(offset, offset + len)
      offset += len
      const text = decodeStrictUtf8(slice, `col:${tableDef.name}.${col.name}`)
      if (validateJson) assertJsonColumnText(col.name, text)
      if (col.pk > 0 || (tableDef.hasOrdinal && col.name === 'world_id')) {
        encodedTexts.set(col.name, slice.slice())
      }
      row[col.name] = text
    }
  }

  requirePortable(offset === body.byteLength, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'row-trailing-bytes')
  if (tableDef.name === 'background_tasks') {
    assertTaskPauseSendingV1(row)
  }
  return { row, ordinal, encodedTexts }
}

/**
 * Create incremental table digest calculator: SHA256("KPB1/table\0" || u16(tableId) || concat(u32(bodyLen) || body)).
 * @param {() => { update(chunk: Uint8Array): void; digest(): Uint8Array }} createSha256
 * @param {number} tableId
 */
export function createTableDigestHasher(createSha256, tableId) {
  const hasher = createSha256()
  const prefix = new Uint8Array(PORTABLE_DOMAIN.TABLE.length + 2)
  prefix.set(asciiBytes(PORTABLE_DOMAIN.TABLE), 0)
  writeU16BE(prefix, PORTABLE_DOMAIN.TABLE.length, tableId)
  hasher.update(prefix)
  return {
    /**
     * @param {Uint8Array} lenBytes4
     * @param {Uint8Array} body
     */
    addRow(lenBytes4, body) {
      hasher.update(lenBytes4)
      hasher.update(body)
    },
    digest() {
      const d = hasher.digest()
      requirePortable(d.byteLength === PORTABLE_DIGEST_SIZE, PORTABLE_ERROR_CODES.IO_FAILED, 'table-digest')
      return d
    },
  }
}

/**
 * Normalize a table row source (Array or `{ rowCount, rows }` streaming descriptor).
 * @param {readonly Record<string, unknown>[] | { rowCount: number | bigint, rows: Iterable<Record<string, unknown>> | AsyncIterable<Record<string, unknown>> }} source
 * @returns {{ expectedCount: bigint, rows: Iterable<Record<string, unknown>> | AsyncIterable<Record<string, unknown>> }}
 */
function resolveTableRowSource(source) {
  if (Array.isArray(source)) {
    return { expectedCount: BigInt(source.length), rows: source }
  }
  if (source && typeof source === 'object' && 'rowCount' in source && 'rows' in source) {
    const count = typeof source.rowCount === 'bigint' ? source.rowCount : BigInt(source.rowCount)
    requirePortable(count >= 0n && count <= PORTABLE_LIMITS.MAX_BUSINESS_ROWS, PORTABLE_ERROR_CODES.RESOURCE_LIMIT, 'row-count')
    return { expectedCount: count, rows: source.rows }
  }
  throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'table-source')
}

/**
 * Compute table verifier (rowCount, digest) for any table (business or derived) without loading all rows at once.
 * @param {(typeof import('./catalog.js').PORTABLE_TABLES)[number]} tableDef
 * @param {Iterable<Record<string, unknown>> | AsyncIterable<Record<string, unknown>>} rows
 * @param {() => { update(chunk: Uint8Array): void; digest(): Uint8Array }} createSha256
 * @param {{ applyTaskPolicy?: boolean, validateJson?: boolean }} [options]
 * @returns {Promise<{ tableId: number, rowCount: bigint, digest: Uint8Array }>}
 */
export async function computeTableVerifier(tableDef, rows, createSha256, options = {}) {
  const hasher = createTableDigestHasher(createSha256, tableDef.tableId)
  const orderTracker = createRowOrderTracker(tableDef)
  let rowCount = 0n
  for await (const rawRow of rows) {
    const { body, row, ordinal, encodedTexts } = encodeLogicalRowBody(tableDef, rawRow, options)
    orderTracker.accept(row, ordinal, encodedTexts)
    const lenBuf = new Uint8Array(4)
    writeU32BE(lenBuf, 0, body.byteLength)
    hasher.addRow(lenBuf, body)
    rowCount += 1n
    requirePortable(rowCount <= PORTABLE_LIMITS.MAX_BUSINESS_ROWS, PORTABLE_ERROR_CODES.RESOURCE_LIMIT, 'table-row-count')
  }
  return { tableId: tableDef.tableId, rowCount, digest: hasher.digest() }
}

/**
 * Compute verifiers for all 5 derived tables in ascending tableId order.
 * @param {(tableDef: (typeof import('./catalog.js').PORTABLE_TABLES)[number]) => Iterable<Record<string, unknown>> | AsyncIterable<Record<string, unknown>>} getRows
 * @param {() => { update(chunk: Uint8Array): void; digest(): Uint8Array }} createSha256
 * @returns {Promise<{ tableId: number, rowCount: bigint, digest: Uint8Array }[]>}
 */
export async function computeDerivedTableVerifiers(getRows, createSha256) {
  /** @type {{ tableId: number, rowCount: bigint, digest: Uint8Array }[]} */
  const verifiers = []
  for (const tableDef of PORTABLE_DERIVED_TABLES) {
    verifiers.push(await computeTableVerifier(tableDef, getRows(tableDef), createSha256))
  }
  return verifiers
}

/**
 * Streamingly encode the 45 business tables into bounded plaintext chunks (<= frameLimit bytes)
 * while accumulating table verifiers in O(1) row memory.
 *
 * @param {(tableDef: (typeof import('./catalog.js').PORTABLE_TABLES)[number]) => readonly Record<string, unknown>[] | { rowCount: number | bigint, rows: Iterable<Record<string, unknown>> | AsyncIterable<Record<string, unknown>> }} getTableSource
 * @param {() => { update(chunk: Uint8Array): void; digest(): Uint8Array }} createSha256
 * @param {{
 *   frameLimit?: number,
 *   applyTaskPolicy?: boolean,
 *   validateJson?: boolean,
 *   onBusinessVerifiers?: (verifiers: { tableId: number, rowCount: bigint, digest: Uint8Array }[]) => void
 * }} [options]
 * @returns {AsyncGenerator<Uint8Array, { tableId: number, rowCount: bigint, digest: Uint8Array }[], void>}
 */
export async function* encodeLogicalStreamChunks(getTableSource, createSha256, options = {}) {
  const frameLimit = options.frameLimit ?? PORTABLE_FRAME_LIMIT
  requirePortable(
    Number.isInteger(frameLimit) && frameLimit >= 1 && frameLimit <= PORTABLE_FRAME_LIMIT,
    PORTABLE_ERROR_CODES.UNSUPPORTED_FORMAT,
    'frame-limit',
  )

  let outBuf = new Uint8Array(frameLimit)
  let outOffset = 0

  /** @param {Uint8Array} slice */
  async function* emitBytes(slice) {
    let srcOffset = 0
    while (srcOffset < slice.byteLength) {
      const avail = frameLimit - outOffset
      const take = Math.min(avail, slice.byteLength - srcOffset)
      outBuf.set(slice.subarray(srcOffset, srcOffset + take), outOffset)
      outOffset += take
      srcOffset += take
      if (outOffset === frameLimit) {
        yield outBuf
        outBuf = new Uint8Array(frameLimit)
        outOffset = 0
      }
    }
  }

  /** @type {{ tableId: number, rowCount: bigint, digest: Uint8Array }[]} */
  const verifiers = []
  let totalBusinessRows = 0n

  for (const tableDef of PORTABLE_BUSINESS_TABLES) {
    const { expectedCount, rows } = resolveTableRowSource(getTableSource(tableDef))
    totalBusinessRows += expectedCount
    requirePortable(totalBusinessRows <= PORTABLE_LIMITS.MAX_BUSINESS_ROWS, PORTABLE_ERROR_CODES.RESOURCE_LIMIT, 'business-row-count')

    const tableHeader = new Uint8Array(10)
    writeU16BE(tableHeader, 0, tableDef.tableId)
    writeU64BE(tableHeader, 2, expectedCount)
    yield* emitBytes(tableHeader)

    const hasher = createTableDigestHasher(createSha256, tableDef.tableId)
    const orderTracker = createRowOrderTracker(tableDef)
    let actualCount = 0n

    for await (const rawRow of rows) {
      const { body, row, ordinal, encodedTexts } = encodeLogicalRowBody(tableDef, rawRow, options)
      orderTracker.accept(row, ordinal, encodedTexts)
      const lenBuf = new Uint8Array(4)
      writeU32BE(lenBuf, 0, body.byteLength)
      hasher.addRow(lenBuf, body)
      yield* emitBytes(lenBuf)
      yield* emitBytes(body)
      actualCount += 1n
      requirePortable(actualCount <= expectedCount, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'row-count-mismatch')
    }

    requirePortable(actualCount === expectedCount, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'row-count-mismatch')
    verifiers.push({ tableId: tableDef.tableId, rowCount: actualCount, digest: hasher.digest() })
  }

  if (outOffset > 0) {
    yield outBuf.subarray(0, outOffset)
  }
  options.onBusinessVerifiers?.(verifiers)
  return verifiers
}

/**
 * Create a bounded streaming decoder for kanata-logical-v1 plaintext frames.
 * Retains at most 1 row body (<= 4 MiB) and 1 previous order key in memory.
 *
 * @param {import('./contracts').PortableStagingSink} sink
 * @param {() => { update(chunk: Uint8Array): void; digest(): Uint8Array }} createSha256
 * @param {{ validateJson?: boolean }} [options]
 */
export function createLogicalStreamDecoder(sink, createSha256, options = {}) {
  let tableIndex = 0
  /** @type {'TABLE_HEADER' | 'ROW_LENGTH' | 'ROW_BODY' | 'DONE'} */
  let state = 'TABLE_HEADER'
  const smallBuf = new Uint8Array(10)
  let smallLen = 0
  let smallTarget = 10

  /** @type {import('./contracts').PortableTableSpec | null} */
  let currentTable = null
  let currentTableRowCount = 0n
  let currentTableRowsRead = 0n
  let totalBusinessRows = 0n
  /** @type {ReturnType<typeof createTableDigestHasher> | null} */
  let currentHasher = null
  /** @type {ReturnType<typeof createRowOrderTracker> | null} */
  let currentOrderTracker = null

  /** @type {Uint8Array | null} */
  let rowBodyBuf = null
  let rowBodyOffset = 0
  const rowLenBytes = new Uint8Array(4)

  /** @type {{ tableId: number, rowCount: bigint, digest: Uint8Array }[]} */
  const businessVerifiers = []

  async function finishCurrentTable() {
    const tableDef = currentTable
    const hasher = currentHasher
    if (!tableDef || !hasher) throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'state')
    const digest = hasher.digest()
    businessVerifiers.push({ tableId: tableDef.tableId, rowCount: currentTableRowCount, digest })
    await sink.finishTable(tableDef, currentTableRowCount, digest)
    currentTable = null
    currentHasher = null
    currentOrderTracker = null
    tableIndex += 1
    if (tableIndex === PORTABLE_BUSINESS_TABLES.length) {
      state = 'DONE'
      smallLen = 0
    } else {
      state = 'TABLE_HEADER'
      smallLen = 0
      smallTarget = 10
    }
  }

  return {
    /**
     * Feed one authenticated DATA frame plaintext chunk.
     * @param {Uint8Array} chunk
     */
    async push(chunk) {
      let pos = 0
      while (pos < chunk.byteLength) {
        if (state === 'DONE') {
          throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'logical-trailing-bytes')
        }

        if (state === 'TABLE_HEADER' || state === 'ROW_LENGTH') {
          const take = Math.min(smallTarget - smallLen, chunk.byteLength - pos)
          smallBuf.set(chunk.subarray(pos, pos + take), smallLen)
          smallLen += take
          pos += take
          if (smallLen < smallTarget) continue

          if (state === 'TABLE_HEADER') {
            const tableId = readU16BE(smallBuf, 0)
            const rowCount = readU64BE(smallBuf, 2)
            const expectedTable = PORTABLE_BUSINESS_TABLES[tableIndex]
            const knownTable = PORTABLE_TABLES_BY_ID.get(tableId)
            requirePortable(Boolean(knownTable), PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'unknown-table')
            requirePortable(knownTable.category === 'business', PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'non-business-table')
            requirePortable(tableId === expectedTable.tableId, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'table-order')
            requirePortable(
              rowCount <= PORTABLE_LIMITS.MAX_BUSINESS_ROWS &&
                totalBusinessRows + rowCount <= PORTABLE_LIMITS.MAX_BUSINESS_ROWS,
              PORTABLE_ERROR_CODES.RESOURCE_LIMIT,
              'business-row-count',
            )
            totalBusinessRows += rowCount
            currentTable = expectedTable
            currentTableRowCount = rowCount
            currentTableRowsRead = 0n
            currentHasher = createTableDigestHasher(createSha256, tableId)
            currentOrderTracker = createRowOrderTracker(expectedTable)
            await sink.beginTable(expectedTable, rowCount)

            if (rowCount === 0n) {
              await finishCurrentTable()
            } else {
              state = 'ROW_LENGTH'
              smallLen = 0
              smallTarget = 4
            }
          } else {
            const bodyLen = readU32BE(smallBuf, 0)
            requirePortable(bodyLen <= PORTABLE_LIMITS.MAX_ROW_BODY_BYTES, PORTABLE_ERROR_CODES.RESOURCE_LIMIT, 'row-body-size')
            requirePortable(bodyLen >= 1, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'row-body-empty')
            rowLenBytes.set(smallBuf.subarray(0, 4))
            rowBodyBuf = new Uint8Array(bodyLen)
            rowBodyOffset = 0
            state = 'ROW_BODY'
          }
        } else if (state === 'ROW_BODY') {
          if (!rowBodyBuf || !currentTable || !currentHasher || !currentOrderTracker) {
            throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'state')
          }
          const take = Math.min(rowBodyBuf.byteLength - rowBodyOffset, chunk.byteLength - pos)
          rowBodyBuf.set(chunk.subarray(pos, pos + take), rowBodyOffset)
          rowBodyOffset += take
          pos += take
          if (rowBodyOffset < rowBodyBuf.byteLength) continue

          const completedBody = rowBodyBuf
          rowBodyBuf = null
          rowBodyOffset = 0
          currentHasher.addRow(rowLenBytes, completedBody)
          const { row, ordinal, encodedTexts } = decodeLogicalRowBody(currentTable, completedBody, options)
          currentOrderTracker.accept(row, ordinal, encodedTexts)
          await sink.writeRow(currentTable, row, ordinal)

          currentTableRowsRead += 1n
          if (currentTableRowsRead === currentTableRowCount) {
            await finishCurrentTable()
          } else {
            state = 'ROW_LENGTH'
            smallLen = 0
            smallTarget = 4
          }
        }
      }
    },

    /**
     * Assert all 45 business tables finished cleanly and return their computed verifiers.
     * @returns {{ tableId: number, rowCount: bigint, digest: Uint8Array }[]}
     */
    finish() {
      requirePortable(
        state === 'DONE' && smallLen === 0 && rowBodyBuf === null && businessVerifiers.length === PORTABLE_BUSINESS_TABLES.length,
        PORTABLE_ERROR_CODES.INVALID_LOGICAL,
        'logical-incomplete',
      )
      return businessVerifiers
    },
  }
}
