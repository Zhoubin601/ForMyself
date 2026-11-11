// @ts-check
import { validateId } from '../../domain/kanataValidation.js'
import { requireSqliteValue as need, pageLimit, safeInteger } from './kanataRepositoryValues.js'
import { KANATA_ARRAY_TABLES, arrayOrderMissing } from './kanataSchemaArrayOrder.js'

const orderRequired = `WITH scope(world) AS (VALUES(?)) SELECT 1 AS missing FROM scope WHERE ${arrayOrderMissing('scope.world')} LIMIT 1`
const pages = KANATA_ARRAY_TABLES.map(({ order }) =>
  `SELECT entity_id AS id,ordinal FROM ${order} WHERE world_id=? AND ordinal>? ORDER BY ordinal LIMIT ?`)
export const arrayOrderQueries = Object.freeze([orderRequired, ...pages])

/** No history is inferred or repaired here. Only a bounded diagnostic marker
 * crosses the bridge; the caller retains the existing operation/owner lease.
 * @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} tx
 * @param {string} worldId */
export async function assertDomainArrayOrder(tx, worldId) {
  validateId(worldId, 'worldId')
  need((await tx.query(orderRequired, [worldId])).length === 0, 'KANATA_DOMAIN_ARRAY_ORDER_REQUIRED')
}

/** Internal ordinal keyset for streaming signatures/plans, never a full DTO.
 * @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} tx
 * @param {'events'|'effects'|'baselines'} kind @param {string} worldId
 * @param {number} [after] @param {number} [limit] */
export async function domainArrayOrderPage(tx, kind, worldId, after = -1, limit = 50) {
  const index = ['events', 'effects', 'baselines'].indexOf(kind)
  need(index >= 0 && (after === -1 || safeInteger(after)), 'KANATA_DOMAIN_ARRAY_CURSOR_INVALID')
  await assertDomainArrayOrder(tx, worldId)
  return tx.query(pages[index], [worldId, after, pageLimit(limit)])
}
