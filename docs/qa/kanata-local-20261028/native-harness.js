// Built only by scripts/build-kanata-native-qa.mjs, never imported by product code.
// All operations require the marker written by the driver on its newly created AVD.
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Preferences } from '@capacitor/preferences'
import { LocalNotifications } from '@capacitor/local-notifications'
import CryptoJS from 'crypto-js'
import { nextTick } from 'vue'
import { useAuthStore } from '../../../src/stores/auth.js'
import { useSettingsStore } from '../../../src/stores/settings.js'
import { useProtectedAccessStore } from '../../../src/stores/protectedAccess.js'
import { useKanataStore } from '../../../src/features/chat/kanataStore.js'
import { useWeightStore } from '../../../src/stores/weight.js'
import { usePasswordVaultStore } from '../../../src/stores/passwordVault.js'
import { createKanataRuntime } from '../../../src/application/kanataRuntime.js'
import { createFullBackupRuntime } from '../../../src/application/fullBackupRuntime.js'
import { restoreJournal } from '../../../src/platform/storage/restoreJournal.js'
import { restoreState } from '../../../src/platform/storage/restoreState.js'
import { preferenceStorage } from '../../../src/platform/storage/preferences.js'
import { changeMasterPasswordTransaction } from '../../../src/services/masterPasswordChange.js'
import { createKanataRepository, encryptKanataData } from '../../../src/features/chat/storage/kanataRepository.js'
import { createLegacyChatCleanup } from '../../../src/features/chat/legacy/legacyChatCleanup.js'
import { useChatStore } from '../../../src/features/chat/chatStore.js'
import { createEmptyKanataData } from '../../../src/features/chat/domain/kanataCore.js'
import { buildKanataChatBackupSnapshot, readKanataChatBackupSnapshot, captureKanataRestoreSnapshot } from '../../../src/features/chat/backup/kanataBackup.js'
import { CHAT_PROACTIVE_CHANNEL_ID, CHAT_PROACTIVE_NOTIFICATION_MIN } from '../../../src/features/chat/chatProactive.js'

export const originalPassword = 'Synthetic-Kanata-local-original'
export const changedPassword = 'Synthetic-Kanata-local-changed'
const copy = value => JSON.parse(JSON.stringify(value))
const assert = (condition, label) => { if (!condition) throw Error('QA_ASSERT:' + label) }
const file = (path, directory = Directory.Data) => ({ path, directory, encoding: Encoding.UTF8 })
const read = async (path, directory) => (await Filesystem.readFile(file(path, directory))).data
const write = (path, data, directory) => Filesystem.writeFile({ ...file(path, directory), data, recursive: true })
const absent = async (path, directory) => {
  try { await Filesystem.stat(file(path, directory)); return false }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'OS-PLUG-FILE-0008' || ['File does not exist.', 'Entry does not exist.'].includes(error.message)) return true
    throw error
  }
}
const expectError = async (action, code) => {
  try { await action() } catch (error) {
    assert(!code || error.code === code || error.message === code, 'expected ' + code + ', got ' + (error.code || error.message))
    return error.code || error.message
  }
  throw Error('QA_EXPECTED_FAILURE:' + code)
}
const guarded = async () => {
  assert(Capacitor.getPlatform() === 'android', 'native Android required')
  assert(await read('kanata-qa-isolation.txt') === 'KanataP2Synthetic34:20261028:new-empty-avd', 'isolated synthetic device marker')
}
const counts = () => {
  const d = useKanataStore().snapshot
  return { worlds: d.worlds.length, instances: d.instances.length,
    private: d.conversations.filter(c => c.type === 'private').length,
    group: d.conversations.filter(c => c.type === 'group').length,
    messages: d.messages.length, memories: d.memories.length, events: d.events.length }
}

export async function run(action, input = {}) {
  await guarded()
  const auth = useAuthStore(), access = useProtectedAccessStore(), chat = useKanataStore(), settings = useSettingsStore()
  if (action === 'prepare') {
    assert(!auth.hasMasterPassword, 'blank app required')
    await auth.setMasterPassword(originalPassword)
    assert(await access.ensureModule('chat'), 'load chat')
    for (const suffix of ['enc', 'tmp', 'bak']) await write('formyself/warm-home-v1.' + suffix, 'obsolete synthetic ' + suffix)
    await Preferences.set({ key: 'my_chat_recovery_encrypted_v1', value: 'obsolete synthetic recovery' })
    await write('formyself/nonchat-synthetic.txt', 'preserve-other-modules')
    settings.aiProviderUrl = 'https://api.deepseek.com'
    settings.aiApiKey = 'synthetic-not-a-real-key'
    await settings.saveAiSettings()
    const weight = useWeightStore()
    weight.addRecord({ id: 'local-weight-original', date: '2026-10-28', weight: 60 })
    await weight.flush()
    await LocalNotifications.requestPermissions()
    await LocalNotifications.createChannel({ id: CHAT_PROACTIVE_CHANNEL_ID, name: 'Synthetic old chat' })
    await LocalNotifications.createChannel({ id: 'kanata-qa-nonchat', name: 'Synthetic unrelated' })
    await LocalNotifications.schedule({ notifications: [
      { id: CHAT_PROACTIVE_NOTIFICATION_MIN, title: 'Synthetic old chat', body: 'Synthetic', channelId: CHAT_PROACTIVE_CHANNEL_ID, schedule: { at: new Date(Date.now() + 3600000) } },
      { id: 123456, title: 'Synthetic unrelated', body: 'Synthetic', channelId: 'kanata-qa-nonchat', schedule: { at: new Date(Date.now() + 3600000) } }
    ] })
    settings.switchView('chat')
    return { loaded: chat.isDataLoaded, needsInitialization: chat.needsInitialization }
  }
  if (action === 'cancel-check') {
    for (const suffix of ['enc', 'tmp', 'bak']) assert(await read('formyself/warm-home-v1.' + suffix) === 'obsolete synthetic ' + suffix, 'cancel preserves ' + suffix)
    assert(await absent('formyself/kanata-v1.enc'), 'cancel zero new file')
    assert(chat.snapshot.worlds.length === 0, 'cancel zero seed')
    return true
  }
  if (action === 'interrupt-cleanup') {
    const legacy = useChatStore()
    const cleanup = createLegacyChatCleanup({
      filesystem: { stat: o => Filesystem.stat(o), deleteFile: async o => {
        if (o.path.endsWith('.tmp')) throw Object.assign(Error('synthetic once'), { code: 'EACCES' })
        return Filesystem.deleteFile(o)
      } }, preferences: preferenceStorage, notifications: LocalNotifications,
      protectedAccess: access, restoreState, inspectRestoreJournal: () => restoreJournal.inspect(),
      legacyRuntime: { stop: () => legacy.retireForKanata(), assertStopped: () => legacy.isRetiredForKanata() },
      getSessionRevision: () => auth.sessionRevision, isAuthenticated: () => access.authenticated
    })
    await expectError(() => cleanup.run({ confirm: async () => true }), 'LEGACY_FILE_DELETE_FAILED')
    assert(await absent('formyself/warm-home-v1.enc'), 'first whitelist file deleted')
    assert(!await absent('formyself/warm-home-v1.tmp'), 'interrupted file retained')
    assert(await absent('formyself/kanata-v1.enc'), 'interrupt no seed')
    return JSON.parse((await Preferences.get({ key: 'my_kanata_legacy_cleanup_v1' })).value).phase
  }
  if (action === 'unlock') {
    assert(await auth.unlockWithPassword(input.changed ? changedPassword : originalPassword), 'unlock after force-stop')
    assert(await access.ensureModules(), 'reload protected modules')
    settings.switchView('chat')
    return { counts: counts(), aiConfigurationPreserved: settings.aiApiKey === 'synthetic-not-a-real-key', weightIds: useWeightStore().weightRecords.map(x => x.id) }
  }
  if (action === 'initialized-check') {
    const c = counts()
    assert(JSON.stringify(c) === JSON.stringify({ worlds: 1, instances: 5, private: 5, group: 1, messages: 0, memories: 0, events: 0 }), 'exact seed')
    for (const suffix of ['enc', 'tmp', 'bak']) assert(await absent('formyself/warm-home-v1.' + suffix), 'old file absent ' + suffix)
    assert((await Preferences.get({ key: 'my_chat_recovery_encrypted_v1' })).value === null, 'old recovery absent')
    assert(await read('formyself/nonchat-synthetic.txt') === 'preserve-other-modules', 'nonchat file kept')
    const pending = (await LocalNotifications.getPending()).notifications
    assert(!pending.some(n => n.id === CHAT_PROACTIVE_NOTIFICATION_MIN), 'old notification cancelled')
    assert(pending.some(n => n.id === 123456), 'other notification preserved')
    const channelIds = (await LocalNotifications.listChannels()).channels.map(c => c.id)
    assert(!channelIds.includes(CHAT_PROACTIVE_CHANNEL_ID) && channelIds.includes('kanata-qa-nonchat'), 'channel whitelist')
    for (let i = 0; i < 3; i++) assert((await createKanataRuntime().initialize({ confirm: async () => true })).status === 'already-initialized', 'idempotent initialization')
    assert(JSON.stringify(counts()) === JSON.stringify(c), 'repeat counts')
    return { counts: c, pendingIds: pending.map(n => n.id), channelIds }
  }
  if (action === 'repository-faults') {
    // Independent real native Cache files; the product graph in Data is never overwritten by this probe.
    const path = 'formyself/kanata-v1.enc', bak = 'formyself/kanata-v1.bak', tmp = 'formyself/kanata-v1.tmp'
    const journal = {
      get: () => Preferences.get({ key: 'kanata-qa-cache-recovery' }),
      set: ({ value }) => Preferences.set({ key: 'kanata-qa-cache-recovery', value }),
      remove: () => Preferences.remove({ key: 'kanata-qa-cache-recovery' })
    }
    const repo = fs => createKanataRepository({ directory: Directory.Cache, journal, ...(fs ? { filesystem: fs } : {}) })
    const empty = createEmptyKanataData('synthetic-qa-user'), results = {}
    assert((await repo().read(originalPassword)).status === 'missing', 'native missing classification')
    results.missing = true
    const future = copy(empty); future.version = 999
    const bytes = CryptoJS.AES.encrypt(JSON.stringify(future), originalPassword).toString()
    await write(path, bytes, Directory.Cache)
    results.future = await expectError(() => repo().read(originalPassword), 'UNSUPPORTED_KANATA_VERSION')
    assert(await read(path, Directory.Cache) === bytes, 'future bytes preserved')
    await write(path, encryptKanataData(empty, originalPassword), Directory.Cache)
    results.wrongPassword = await expectError(() => repo().read('synthetic-wrong'), 'KANATA_DECRYPT_FAILED')
    const invalidJson = CryptoJS.AES.encrypt('{bad json', originalPassword).toString()
    await write(path, invalidJson, Directory.Cache)
    results.parse = await expectError(() => repo().read(originalPassword), 'KANATA_DATA_CORRUPTED')
    for (const p of [path, bak, tmp]) await write(p, 'synthetic corrupt cipher', Directory.Cache)
    results.allCorrupt = await expectError(() => repo().read(originalPassword), 'KANATA_ALL_COPIES_INVALID')
    for (const p of [path, bak, tmp]) assert(await read(p, Directory.Cache) === 'synthetic corrupt cipher', 'corrupt bytes preserved')
    let fail = false
    const filesystem = new Proxy(Filesystem, { get: (target, name) => name === 'writeFile' ? async o => {
      if (fail && o.path === tmp) throw Object.assign(Error('synthetic write fault'), { code: 'EACCES' })
      return target.writeFile(o)
    } : typeof target[name] === 'function' ? target[name].bind(target) : target[name] })
    await write(path, encryptKanataData(empty, originalPassword), Directory.Cache)
    for (const p of [bak, tmp]) await Filesystem.deleteFile(file(p, Directory.Cache))
    const r = repo(filesystem); await r.read(originalPassword)
    fail = true
    await expectError(() => r.write(copy(chat.snapshot), originalPassword), 'KANATA_SAVE_FAILED')
    await expectError(() => r.flush(), 'KANATA_SAVE_FAILED')
    assert(r.getState().hasPendingSave && r.getState().saveError, 'latest pending retained')
    fail = false; await r.retry(); await r.flush(); await r.release()
    assert((await repo().read(originalPassword)).data.instances.length === 5, 'native latest retry roundtrip')
    results.writeRetry = true
    return results
  }
  if (action === 'backup-roundtrip') {
    await chat.update(d => {
      const w = d.worlds[0].id, c = d.conversations[0], who = d.instances[0].id
      d.cardVersions[0].rawData = { extensions: { unknown: { safe: ['keep', 1, null] } }, avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=' }
      d.messages.push({ id: 'native-source-message', worldId: w, conversationId: c.id, role: 'user', senderType: 'user', senderId: d.identities[0].id,
        senderNameSnapshot: '合成用户', content: '合成备份溯源', createdAt: 1000, revision: 1, status: 'complete', turnId: 'native-source-turn', batchId: 'native-source-batch' })
      const group = d.conversations.find(x => x.type === 'group')
      d.messages.push({ id: 'native-group-message', worldId: w, conversationId: group.id, role: 'assistant', senderType: 'character', senderId: who,
        senderNameSnapshot: d.cardVersions[0].definition.name, content: '合成群聊存储测试', createdAt: 1001, revision: 1, status: 'complete', turnId: 'native-group-turn', batchId: 'native-group-batch' })
      const sourceRefs = [{ messageId: 'native-source-message', revision: 1 }]
      d.memories.push({ id: 'native-memory', worldId: w, ownerType: 'character', ownerId: who, layer: 'L3', key: 'synthetic', content: '合成备份记忆', sourceRefs, status: 'active', revision: 1, visibility: 'private' })
      d.events.push({ id: 'native-event', worldId: w, participantIds: [who], sourceRefs: copy(sourceRefs), causedByEventIds: [], status: 'committed', visibility: 'private', summary: '合成事件', effectiveAt: 1000, recordedAt: 1000, revision: 1 })
      d.effects.push({ id: 'native-effect', worldId: w, eventId: 'native-event', targetType: 'instance', targetId: who, operation: 'set', path: 'state.mood', value: '平静', ruleVersion: 1 })
      d.tasks.push({ id: 'native-task', worldId: w, kind: 'memory', state: 'succeeded', idempotencyKey: 'native-source-extraction', sourceRefs: copy(sourceRefs), sourceRevision: 1, attempt: 1, notBefore: 1000, leaseUntil: 0, instanceId: who, conversationId: c.id, resultEventIds: ['native-event'] })
      d.lifeGrants.push({ id: 'native-grant', worldId: w, instanceId: who, moduleId: 'mood', read: true, remember: false, share: false, revision: 1 })
    })
    const runtime = createFullBackupRuntime(), backup = await runtime.exportFull()
    assert(backup.version === 13 && backup.data.chat.instances.length === 5, 'new full backup')
    const single = buildKanataChatBackupSnapshot(chat.snapshot)
    assert(JSON.stringify(readKanataChatBackupSnapshot(single).data) === JSON.stringify(single.data), 'new single roundtrip')
    await expectError(() => readKanataChatBackupSnapshot({ type: 'formyself-chat-backup', version: 4, data: {} }), 'LEGACY_CHAT_BACKUP_UNSUPPORTED')
    await chat.update(d => { d.worlds[0].name = 'Synthetic modified target' })
    await runtime.restore(backup, originalPassword)
    assert(JSON.stringify(chat.snapshot) === JSON.stringify(backup.data.chat), 'all populated entities new full restore')
    const before = JSON.stringify(chat.snapshot), oldVersions = []
    for (let version = 1; version <= 12; version++) {
      const old = copy(backup); old.version = version; delete old.taskPolicy
      old.data.chat = { messages: [{ id: 'obsolete', role: 'user', content: 'never import synthetic legacy', createdAt: 1 }] }
      old.data.weight = [{ id: 'old-v' + version, date: '2026-10-28', weight: 61 }]
      await expectError(() => runtime.restore(old, originalPassword), 'LEGACY_CHAT_DISCARD_CONFIRMATION_REQUIRED')
      await runtime.restore(old, originalPassword, { legacyChat: 'discard' })
      assert(useWeightStore().weightRecords[0].id === 'old-v' + version, 'old nonchat version ' + version)
      assert(JSON.stringify(chat.snapshot) === before, 'old version cannot revive chat ' + version)
      assert(await absent('formyself/warm-home-v1.enc'), 'old file never revived')
      oldVersions.push(version)
    }
    await runtime.restore(backup, originalPassword)
    return { newFull: true, newSingle: true, legacySingleRejected: true, oldVersions }
  }
  if (action === 'prepare-journal') {
    const runtime = createFullBackupRuntime(); await runtime.exportFull()
    const previous = captureKanataRestoreSnapshot(runtime.registry.exportAll()), target = copy(previous)
    target.kanata.worlds[0].name = input.committed ? 'Synthetic committed recovery' : 'Synthetic must roll back'
    await restoreJournal.prepare({ version: 1, previous, target }, originalPassword)
    if (input.committed) await restoreJournal.commit()
    const encrypted = await read('formyself/restore-v1.enc')
    assert(!encrypted.includes(originalPassword) && !encrypted.includes('Synthetic must roll back'), 'encrypted recovery journal')
    return { prepared: true, committed: Boolean(input.committed), expectedWorld: input.committed ? target.kanata.worlds[0].name : previous.kanata.worlds[0].name }
  }
  if (action === 'backup-failure') {
    const runtime = createFullBackupRuntime(), before = await runtime.exportFull(), target = copy(before)
    target.data.chat.worlds[0].name = 'Synthetic failed restore target'
    target.data.weight = [{ id: 'failed-restore-weight', date: '2026-10-28', weight: 70 }]
    const participant = runtime.registry.get('savings'), restore = participant.restore
    let attempts = 0
    participant.restore = async part => {
      await restore(part) // Fail only after actual native participant writes have happened.
      attempts++
      if (input.persistent || attempts === 1) throw Error('SYNTHETIC_AFTER_NATIVE_WRITE')
    }
    let failure
    try { await runtime.restore(target, originalPassword) } catch (error) { failure = error }
    finally { participant.restore = restore }
    assert(failure?.message === 'SYNTHETIC_AFTER_NATIVE_WRITE', 'injected participant failure observed')
    if (input.persistent) {
      assert(failure.rollbackFailed === true && restoreState.blocked, 'rollback failure retains barrier')
      assert(!await absent('formyself/restore-v1.enc'), 'rollback journal retained')
      await expectError(() => chat.update(d => { d.worlds[0].name = 'forbidden' }), '完整数据恢复尚未完成，请先恢复数据再继续修改')
    } else {
      assert(!failure.rollbackFailed && !restoreState.blocked, 'native compensation completes')
      assert(JSON.stringify(chat.snapshot) === JSON.stringify(before.data.chat), 'native compensation restores full graph')
      assert(useWeightStore().weightRecords[0].id === before.data.weight[0].id, 'native compensation restores other module')
      assert(await absent('formyself/restore-v1.enc'), 'compensation clears journal normally')
    }
    return { compensated: !input.persistent, blocked: restoreState.blocked, expectedWorld: before.data.chat.worlds[0].name }
  }
  if (action === 'recover-journal') {
    const runtime = createFullBackupRuntime()
    assert(restoreState.blocked, 'startup probe retains barrier')
    const before = await read('formyself/restore-v1.enc')
    await expectError(() => runtime.recover('synthetic-wrong'))
    assert(restoreState.blocked && await read('formyself/restore-v1.enc') === before, 'wrong password keeps journal/barrier')
    assert(await auth.unlockWithPassword(originalPassword), 'recovery authentication')
    await runtime.recover(originalPassword)
    assert(!restoreState.blocked && await absent('formyself/restore-v1.enc'), 'recovered journal cleared through coordinator')
    assert(chat.snapshot.worlds[0].name === input.expectedWorld, 'recovery chooses correct side')
    settings.switchView('chat')
    return { recovered: true, world: chat.snapshot.worlds[0].name }
  }
  if (action === 'password') {
    assert(await access.ensureModules(), 'password participants loaded')
    const vault = usePasswordVaultStore()
    vault.addRecord({ id: 'native-synthetic-vault', appName: 'Synthetic test', password: 'synthetic-entry-only' }); await vault.flush()
    await access.runOperation(['passwords', 'chat'], async () => changeMasterPasswordTransaction({
      currentPassword: originalPassword, newPassword: changedPassword, reencryptors: await access.reencryptors(), commit: auth.commitPasswordChange
    }))
    assert(auth.savedMasterPwd === changedPassword, 'verifier commit')
    auth.expireSession({ lockApp: false })
    assert(chat.snapshot === null && !chat.isDataLoaded, 'session expiry clears plaintext')
    assert(await auth.unlockWithPassword(changedPassword, { unlockApp: false }), 'new password unlock')
    assert(await access.ensureModules(), 'reencrypted modules load')
    assert(vault.records.some(r => r.id === 'native-synthetic-vault'), 'vault retained')
    const nativeCiphertext = await read('formyself/kanata-v1.enc')
    assert(!nativeCiphertext.includes('Synthetic committed recovery'), 'ciphertext at rest')
    return { reencrypted: true, plaintextReleased: true }
  }
  if (action === 'password-compensation') {
    const cases = []
    for (let failedIndex = 0; failedIndex < access.moduleIds.length; failedIndex++) {
      assert(await access.ensureModules(), 'compensation participants loaded')
      const reencryptors = await access.reencryptors(), before = JSON.stringify(chat.snapshot)
      const wrapped = reencryptors.map((reencrypt, index) => async password => {
        await reencrypt(password)
        if (index === failedIndex && password === changedPassword) throw Error('SYNTHETIC_AFTER_REENCRYPT')
      })
      let failure
      try {
        await access.runOperation(['passwords', 'chat'], () => changeMasterPasswordTransaction({
          currentPassword: originalPassword, newPassword: changedPassword, reencryptors: wrapped, commit: auth.commitPasswordChange
        }))
      } catch (error) { failure = error }
      assert(failure?.message === 'SYNTHETIC_AFTER_REENCRYPT' && !failure.rollbackFailed, 'reencrypt compensation ' + failedIndex)
      assert(auth.savedMasterPwd === originalPassword, 'verifier unchanged after compensation')
      auth.expireSession({ lockApp: false })
      assert(chat.snapshot === null, 'compensated plaintext released')
      assert(await auth.unlockWithPassword(originalPassword, { unlockApp: false }), 'compensated verifier reload')
      assert(await access.ensureModules(), 'compensated native data reload')
      assert(JSON.stringify(chat.snapshot) === before, 'compensated graph unchanged')
      cases.push(access.moduleIds[failedIndex])
    }
    return cases
  }
  if (action === 'growth') {
    const source = copy(chat.snapshot), samples = []
    for (const count of [1000, 10000]) {
      const data = copy(source), c = data.conversations[0], w = data.worlds[0]
      data.messages = [...source.messages, ...Array.from({ length: count - source.messages.length }, (_, i) => ({ id: 'native-capacity-' + i, worldId: w.id, conversationId: c.id,
        senderType: 'user', senderId: data.identities[0].id, senderNameSnapshot: '合成用户', turnId: 'turn-' + i,
        batchId: 'batch-' + i, role: 'user', content: '合成容量测量。'.repeat(24), status: 'complete', createdAt: i + 1, revision: 1 }))]
      const repo = createKanataRepository({ directory: Directory.Cache, journal: {
        get: () => Preferences.get({ key: 'kanata-qa-cache-recovery' }),
        set: ({ value }) => Preferences.set({ key: 'kanata-qa-cache-recovery', value }),
        remove: () => Preferences.remove({ key: 'kanata-qa-cache-recovery' })
      } })
      await repo.read(originalPassword)
      let start = performance.now(); await repo.write(data, originalPassword); await repo.flush(); const saveMs = performance.now() - start
      await repo.release()
      start = performance.now(); const result = await repo.read(originalPassword); const coldReadMs = performance.now() - start
      assert(result.data.messages.length === count, 'native capacity count')
      start = performance.now(); const backup = buildKanataChatBackupSnapshot(result.data); const backupMs = performance.now() - start
      samples.push({ count, jsonBytes: new Blob([JSON.stringify(data)]).size, ciphertextBytes: (await Filesystem.stat(file('formyself/kanata-v1.enc', Directory.Cache))).size,
        saveMs, coldReadMs, backupMs, backupMessages: backup.data.messages.length, heapAfter: performance.memory?.usedJSHeapSize ?? null })
    }
    return samples
  }
  if (action === 'optional-set') {
    await settings.updateRequireAppUnlock(false)
    await settings.flushPendingSettingsWrites()
    return true
  }
  if (action === 'optional-check') {
    assert(!auth.isLocked && !auth.savedMasterPwd, 'ordinary entry without protected session')
    assert(!chat.isDataLoaded && chat.snapshot === null, 'optional mode does not decrypt chat')
    assert(useWeightStore().isDataLoaded, 'ordinary data ready without private unlock')
    return true
  }
  if (action === 'optional-open') {
    settings.switchView('home'); await nextTick(); settings.switchView('chat')
    return true
  }
  if (action === 'optional-ready') {
    assert(chat.isDataLoaded && access.authenticated, 'optional protected prompt authenticated')
    assert(chat.snapshot.instances.length === 5, 'optional protected data loaded')
    await settings.updateRequireAppUnlock(true)
    await settings.flushPendingSettingsWrites()
    return true
  }
  if (action === 'state') return { counts: counts(), blocked: restoreState.blocked, loadError: chat.loadError, saveError: chat.saveError }
  throw Error('UNKNOWN_QA_ACTION')
}
