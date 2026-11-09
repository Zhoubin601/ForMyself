// @ts-check
import { sha256Text } from '../../../../shared/crypto/sha256Text.js'
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'
import { extensionObject, requireSqliteValue as need } from './kanataRepositoryValues.js'

/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {import('./kanataSchemaTypes').KanataSqlRow} Row */
/** @typedef {import('./kanataSchemaTypes').KanataSqlValue} Value */

/** Build fixed INSERT/SELECT/CAS statements exclusively from source-defined column maps.
 * @template T
 * @param {string} table
 * @param {Record<string, string>} fields
 * @param {readonly string[]} keys
 * @param {string[]} relationalFields
 */
export function domainTable(table, fields, keys, relationalFields = []) {
  const columns = Object.keys(fields)
  const stored = columns.join(',')
  const scope = keys.map(key => key + '=?').join(' AND ')
  const mutable = columns.filter(column => !keys.includes(column))
  const revision = columns.includes('revision')
  const get = `SELECT ${stored},extensions_json FROM ${table} WHERE ${scope}`
  const insert = `INSERT INTO ${table}(${stored},extensions_json) VALUES(${columns.map(() => '?').join(',')},?)`
  const update = revision
    ? `UPDATE ${table} SET ${mutable.map(column => column + '=?').join(',')},extensions_json=? WHERE ${scope} AND revision=?`
    : null
  const writeStatements = update ? [insert, update] : [insert]
  const known = [...Object.values(fields).map(field => field.split(':')[0]), ...relationalFields]
  /** @param {T} dto @param {string[]} selected */
  function bindings(dto, selected) {
    const record = /** @type {Record<string, unknown>} */ (cloneKanataJson(dto))
    const values = selected.map(column => {
      const [field, format] = fields[column].split(':')
      const value = record[field]
      if (value === undefined) return null
      if (format === 'json') return JSON.stringify(value)
      if (format === 'flag') {
        need(typeof value === 'boolean', 'KANATA_DOMAIN_INVALID_FLAG')
        return Number(value)
      }
      need(typeof value === 'number' || typeof value === 'string' || value === null, 'KANATA_DOMAIN_INVALID_VALUE')
      return /** @type {Value} */ (value)
    })
    for (const key of known) delete record[key]
    return [...values, JSON.stringify(record)]
  }
  /** @param {Row} row @returns {T} */
  function decode(row) {
    const dto = extensionObject(row.extensions_json)
    for (const key of known) delete dto[key]
    for (const [column, mapping] of Object.entries(fields)) {
      const [field, format] = mapping.split(':')
      const value = row[column]
      if (value !== null) dto[field] = format === 'json' ? JSON.parse(String(value)) : format === 'flag' ? value === 1 : value
    }
    return /** @type {T} */ (dto)
  }
  return {
    get, stored: stored + ',extensions_json', writeStatements, decode,
    /** @param {Tx} tx @param {Value[]} id */
    async read(tx, id) {
      const [row] = await tx.query(get, id)
      return row ? decode(row) : null
    },
    /** @param {Tx} tx @param {T} dto */
    create: (tx, dto) => writeOne(tx, insert, bindings(dto, columns)),
    /** @param {Tx} tx @param {T} dto @param {Value[]} id @param {number} expected */
    replace(tx, dto, id, expected) {
      if (!update) throw new Error('KANATA_DOMAIN_IMMUTABLE')
      return writeOne(tx, update, [...bindings(dto, mutable), ...id, expected])
    },
  }
}

/** @param {Tx} tx @param {string} sql @param {readonly Value[]} values */
export async function writeOne(tx, sql, values) {
  need((await tx.execute(sql, values)).affectedRows === 1, 'KANATA_DOMAIN_CONFLICT')
}

export const receiptQuery = 'SELECT fingerprint,result_id FROM domain_command_receipts WHERE command_key=?'
export const receiptWrite = 'INSERT INTO domain_command_receipts(command_key,fingerprint,result_id) VALUES(?,?,?)'

/** @param {unknown} value @returns {unknown} */
function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, sortedJson(item)]))
}

/** Replay resolves the original result identity, even after a later edit.
 * @param {Tx} tx @param {string[]} scope @param {unknown} request
 * @param {() => Promise<string>} perform
 */
export async function executeOnce(tx, scope, request, perform) {
  const key = JSON.stringify(scope)
  const fingerprint = sha256Text(JSON.stringify(sortedJson(cloneKanataJson(request))))
  const [previous] = await tx.query(receiptQuery, [key])
  if (previous) {
    need(previous.fingerprint === fingerprint, 'KANATA_DOMAIN_IDEMPOTENCY_CONFLICT')
    return String(previous.result_id)
  }
  const id = await perform()
  validateId(id, 'command.result')
  await writeOne(tx, receiptWrite, [key, fingerprint, id])
  return id
}

/** @template T @param {T|null|undefined} value @param {string} code @returns {T} */
export function found(value, code) {
  if (value == null) throw Object.assign(new Error(code), { code })
  return value
}
