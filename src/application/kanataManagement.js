// @ts-check
import { useAuthStore } from '../stores/auth.js'
import { useProtectedAccessStore } from '../stores/protectedAccess.js'
import { useKanataStore } from '../features/chat/kanataStore.js'
import { instantiateWorldPreset } from '../features/chat/domain/presetCore.js'
import { createKanataWorld, renameKanataWorld, archiveKanataWorld, copyKanataWorld, updateKanataIdentity, addKanataCharacter,
  importKanataCard, archiveKanataCard, updateKanataCard, updateKanataCharacter, syncKanataCard, createKanataGroup } from '../features/chat/domain/kanataManagementCore.js'
import { saveKanataLoreEntry, attachKanataCardLore } from '../features/chat/lorebook/kanataLorebook.js'
import { getBuiltinKanataPreset } from '../features/chat/presets/presetCatalog.js'

/** Session-owned facade. Old page/file/confirmation callbacks cannot enter a newer session.
 * @param {{store?:ReturnType<typeof useKanataStore>,access?:ReturnType<typeof useProtectedAccessStore>,auth?:ReturnType<typeof useAuthStore>,
 * clock?:()=>number,timeZone?:()=>string,idFactory?:(kind:string,key:string)=>string,keyFactory?:()=>string}} [adapters]
 */
export function createKanataManagement(adapters = {}) {
  const store = adapters.store || useKanataStore(), access = adapters.access || useProtectedAccessStore(), auth = adapters.auth || useAuthStore()
  const ownerRevision = auth.sessionRevision
  const clock = adapters.clock || Date.now, timeZone = adapters.timeZone || (() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const keyFactory = adapters.keyFactory || (() => crypto.randomUUID())
  const idFactory = adapters.idFactory || ((kind, _key) => kind + '-' + crypto.randomUUID())
  const options = () => ({ key: keyFactory(), now: clock(), timeZone: timeZone(), idFactory })
  /** @template T @param {()=>Promise<T>} action */
  const perform = async action => {
    if (ownerRevision !== auth.sessionRevision) throw new Error('KANATA_SESSION_EXPIRED')
    const result = await access.runOperation(['chat'], async () => {
      if (ownerRevision !== auth.sessionRevision) throw new Error('KANATA_SESSION_EXPIRED')
      return action()
    })
    if (result === false) throw new Error('KANATA_OPERATION_CANCELLED')
    return result
  }
  /** @param {(data:import('../features/chat/domain/kanataTypes').KanataData)=>import('../features/chat/domain/kanataTypes').KanataData} transform */
  const execute = transform => perform(() => store.update(data => { Object.assign(data, transform(data)) }))
  return {
    retrySave: () => perform(() => store.retrySave()),
    /** @param {{name:string,rules:string,displayName:string,background:string}} fields */
    createWorld: fields => execute(data => createKanataWorld(data, fields, options())),
    /** @param {string} worldId @param {string} name */
    renameWorld: (worldId, name) => execute(data => renameKanataWorld(data, worldId, name)),
    /** @param {string} worldId @param {boolean} archived */
    archiveWorld: (worldId, archived) => execute(data => archiveKanataWorld(data, worldId, archived)),
    /** @param {string} worldId @param {string} name */
    copyWorld: (worldId, name) => execute(data => copyKanataWorld(data, worldId, name, options())),
    /** @param {string} worldId @param {{title:string,instanceIds:string[]}} fields */
    createGroup: (worldId, fields) => execute(data => createKanataGroup(data,worldId,fields,options())),
    /** @param {string} presetId */
    createPresetWorld: presetId => execute(data => { const o = options(); return instantiateWorldPreset(data, getBuiltinKanataPreset(presetId), { initializationKey: 'manual-preset-' + o.key, now: o.now, timeZone: o.timeZone, idFactory }) }),
    /** @param {string} worldId @param {{displayName:string,background:string}} fields */
    updateIdentity: (worldId, fields) => execute(data => updateKanataIdentity(data, worldId, fields)),
    /** @param {string} worldId @param {string} cardId */
    addCharacter: (worldId, cardId) => execute(data => addKanataCharacter(data, worldId, cardId, options())),
    /** @param {import('../features/chat/cards/characterCardTypes').ParsedCharacterCard} parsed */
    importCard: parsed => execute(data => importKanataCard(data, parsed, options())),
    /** @param {string} cardId @param {boolean} archived */
    archiveCard: (cardId, archived) => execute(data => archiveKanataCard(data, cardId, archived)),
    /** @param {string} cardId @param {import('../features/chat/domain/kanataTypes').CharacterDefinition} definition @param {string} expectedVersionId */
    updateCard: (cardId, definition, expectedVersionId) => execute(data => updateKanataCard(data, cardId, definition, expectedVersionId, options())),
    /** @param {string} instanceId @param {Partial<import('../features/chat/domain/kanataTypes').CharacterDefinition>} overrides */
    updateCharacter: (instanceId, overrides) => execute(data => updateKanataCharacter(data, instanceId, overrides)),
    /** @param {string} cardId @param {ReturnType<typeof import('../features/chat/domain/kanataManagementCore.js').previewKanataCardSync>} selected */
    syncCard: (cardId, selected) => execute(data => syncKanataCard(data, cardId, selected)),
    /** @param {import('../features/chat/domain/kanataTypes').LorebookEntry} entry @param {number|null} expectedRevision */
    saveLore: (entry, expectedRevision = null) => execute(data => saveKanataLoreEntry(data, entry, expectedRevision)),
    /** @param {string} instanceId @param {boolean} skipConflicts */
    attachCardLore: (instanceId, skipConflicts) => execute(data => attachKanataCardLore(data, instanceId, { skipConflicts, idFactory }))
  }
}
