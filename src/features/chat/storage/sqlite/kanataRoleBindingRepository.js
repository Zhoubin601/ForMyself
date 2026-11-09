// @ts-check
import { validateId } from '../../domain/kanataValidation.js'
import { requireSqliteValue as need } from './kanataRepositoryValues.js'

/** @typedef {import('../../domain/kanataTypes').LifeModule} LifeModule */
/** @typedef {import('../../domain/kanataTypes').RoleBinding} Binding */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
const scopes = ['global','home','mood','weight','savings','schedule','todo','reports']
const state = 'SELECT revision FROM role_binding_state WHERE singleton=1'
const read = 'SELECT scope,world_id,instance_id FROM role_bindings ORDER BY scope'
const available = `SELECT 1 FROM character_instances i JOIN worlds w ON w.id=i.world_id
  WHERE i.world_id=? AND i.id=? AND coalesce(w.archived,0)=0`
const createState = 'INSERT INTO role_binding_state(singleton,revision) VALUES(1,1)'
const increment = 'UPDATE role_binding_state SET revision=revision+1 WHERE singleton=1 AND revision=?'
const put = `INSERT INTO role_bindings(scope,world_id,instance_id) VALUES(?,?,?)
  ON CONFLICT(scope) DO UPDATE SET world_id=excluded.world_id,instance_id=excluded.instance_id`
const remove = 'DELETE FROM role_bindings WHERE scope=?'
export const bindingQueries = [state, read, available]
export const bindingWrites = [createState, increment, put, remove]

/** @param {Tx} tx */
async function readBinding(tx) {
  const [row] = await tx.query(state)
  /** @type {Partial<Record<LifeModule,Binding|null>>} */
  const modules = {}
  /** @type {Binding|null} */
  let global = null
  for (const item of await tx.query(read)) {
    const value = item.world_id == null ? null : { worldId: String(item.world_id), instanceId: String(item.instance_id) }
    if (item.scope === 'global') global = value
    else modules[/** @type {LifeModule} */ (item.scope)] = value
  }
  return { revision: Number(row?.revision ?? 0), global, modules }
}

/** @param {Operation} operation */
export function createKanataRoleBindingRepository(operation) {
  return {
    read: () => operation.transaction(readBinding),
    /** @param {LifeModule} moduleId */
    resolve: moduleId => operation.transaction(async tx => {
      need(scopes.includes(moduleId), 'KANATA_BINDING_SCOPE_INVALID')
      const record = await readBinding(tx)
      const binding = Object.hasOwn(record.modules, moduleId) ? record.modules[moduleId] : record.global
      if (!binding) return { status: /** @type {const} */ ('unselected'), binding:null, revision:record.revision }
      const [allowed] = await tx.query(available, [binding.worldId,binding.instanceId])
      return { status: allowed ? /** @type {const} */ ('ready') : /** @type {const} */ ('unavailable'), binding, revision:record.revision }
    }),
    /** @param {LifeModule|'global'} scope @param {Binding|null|'inherit'} selection @param {number} revision */
    set: (scope, selection, revision) => operation.transaction(async tx => {
      need(scopes.includes(scope) && !(scope === 'global' && selection === 'inherit'), 'KANATA_BINDING_SCOPE_INVALID')
      if (selection && selection !== 'inherit') {
        validateId(selection.worldId, 'worldId')
        validateId(selection.instanceId, 'instanceId')
        need((await tx.query(available, [selection.worldId,selection.instanceId])).length === 1, 'BINDING_UNAVAILABLE')
      }
      const [previous] = await tx.query(state)
      need(Number(previous?.revision ?? 0) === revision, 'KANATA_BINDING_REVISION_CONFLICT')
      const updated = previous ? await tx.execute(increment, [revision]) : await tx.execute(createState)
      need(updated.affectedRows === 1, 'KANATA_BINDING_REVISION_CONFLICT')
      if (selection === 'inherit') await tx.execute(remove, [scope])
      else await tx.execute(put, [scope,selection?.worldId??null,selection?.instanceId??null])
      return readBinding(tx)
    }),
  }
}
