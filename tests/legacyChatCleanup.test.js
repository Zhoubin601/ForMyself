import assert from 'node:assert/strict'
import test from 'node:test'
import { Directory } from '@capacitor/filesystem'
import {
  createLegacyChatCleanup, LEGACY_CHAT_CLEANUP_KEY, LEGACY_CHAT_FILES, LEGACY_CHAT_RECOVERY_KEY,
  LEGACY_CHAT_CLEANUP_WARNING
} from '../src/features/chat/legacy/legacyChatCleanup.js'

const missing = () => Object.assign(new Error('File does not exist.'), { code: 'ENOENT' })
const untouchedFilePaths = ['formyself/kanata-v1.enc', 'formyself/restore-v1.enc', 'formyself/restore-v1.commit', 'formyself/restore-v1.tmp', 'other-module.json']
const protectedKeys = ['my_master_password_verifier_v1', 'my_ai_provider_settings_v1', 'my_mood_records_data', 'my_schedule_data_v2', 'my_password_vault_encrypted', 'my_kanata_recovery_encrypted_v1']
function harness(shared = {}) {
  const files = shared.files || new Map([...LEGACY_CHAT_FILES, ...untouchedFilePaths].map(path => [path, 'synthetic:' + path]))
  const values = shared.values || new Map([LEGACY_CHAT_RECOVERY_KEY, ...protectedKeys].map(key => [key, 'synthetic:' + key]))
  const pending = shared.pending || new Set([819999999, 820000000, 822999999, 823000000, 823999999, 824000000, 9001])
  const channels = shared.channels || new Set(['formyself-warm-home-v1', 'formyself-todo-v1'])
  const calls = [], control = { authenticated: true, revision: 1, stopped: false, denied: false,
    checkpointWrites: 0, hook: async () => {}, deleteNoop: false, preferenceNoop: false, cancelNoop: false, channelNoop: false }
  const restoreState = { blocked: false, busy: false }
  const step = async (name, value) => { calls.push({ name, value }); await control.hook(name, value) }
  const options = {
    filesystem: {
      async stat({ path, directory }) { assert.equal(directory, Directory.Data); await step('stat', path); if (!files.has(path)) throw missing(); return { type: 'file' } },
      async deleteFile({ path, directory }) {
        assert.equal(directory, Directory.Data); await step('deleteFile', path)
        if (!files.has(path)) throw missing()
        if (!control.deleteNoop) files.delete(path)
        await step('afterDeleteFile', path)
      }
    },
    preferences: {
      async get({ key }) { await step('get', key); return { value: values.get(key) ?? null } },
      async set({ key, value }) { control.checkpointWrites += 1; await step('set', { key, count: control.checkpointWrites }); values.set(key, value); await step('afterSet', control.checkpointWrites) },
      async remove({ key }) { await step('remove', key); if (!control.preferenceNoop) values.delete(key) }
    },
    notifications: {
      async getPending() { await step('getPending'); return { notifications: [...pending].map(id => ({ id })) } },
      async cancel({ notifications }) { await step('cancel', notifications); if (!control.cancelNoop) notifications.forEach(({ id }) => pending.delete(id)) },
      async listChannels() { await step('listChannels'); return { channels: [...channels].map(id => ({ id })) } },
      async deleteChannel({ id }) { await step('deleteChannel', id); if (!control.channelNoop) channels.delete(id) }
    },
    protectedAccess: { async runOperation(modules, action) {
      assert.deepEqual(modules, []); await step('lease')
      if (control.denied) return false
      try { return await action('synthetic-password-not-recorded', control.revision) } finally { await step('leaseReleased') }
    } },
    restoreState,
    async inspectRestoreJournal() { await step('inspectRestore'); return control.restorePending || null },
    legacyRuntime: {
      async stop() { await step('stop'); control.stopped = true },
      async assertStopped() { await step('assertStopped'); return control.stopped }
    },
    getSessionRevision: () => control.revision,
    isAuthenticated: () => control.authenticated
  }
  const coordinator = createLegacyChatCleanup(options)
  return { coordinator, files, values, pending, channels, control, calls, options, restoreState,
    shared: { files, values, pending, channels } }
}
const confirmed = { confirm: async () => true }
const deletions = h => h.calls.filter(c => ['deleteFile', 'remove'].includes(c.name))
const checkUntouched = h => {
  for (const path of untouchedFilePaths) assert.equal(h.files.get(path), 'synthetic:' + path)
  for (const key of protectedKeys) assert.equal(h.values.get(key), 'synthetic:' + key)
  assert.ok(h.pending.has(819999999)); assert.ok(h.pending.has(824000000)); assert.ok(h.pending.has(9001))
  assert.ok(h.channels.has('formyself-todo-v1'))
}
test('P2-cleanup-01 缺少当次确认函数拒绝；取消不停止旧运行时、不写checkpoint、不删除', async () => {
  const h = harness()
  await assert.rejects(h.coordinator.run({ confirmed: true }), /LEGACY_CONFIRMATION_REQUIRED/)
  assert.deepEqual(await h.coordinator.run({ confirm: async () => false }), { status: 'cancelled' })
  assert.deepEqual(await h.coordinator.run({ confirm: async () => 'true' }), { status: 'cancelled' })
  assert.equal(deletions(h).length, 0)
  assert.equal(h.calls.filter(c => ['stop', 'set', 'cancel'].includes(c.name)).length, 0)
  assert.equal(h.values.has(LEGACY_CHAT_CLEANUP_KEY), false)
})
test('P2-cleanup-02 未认证或租约拒绝时零删除，确认弹窗不被调用', async () => {
  const h = harness(); h.control.denied = true
  assert.equal(await h.coordinator.run({ confirm: async () => { throw new Error('must not ask') } }), false)
  assert.equal(deletions(h).length, 0)
  h.control.denied = false; h.control.authenticated = false
  await assert.rejects(h.coordinator.run(confirmed), /SESSION_EXPIRED/)
  assert.equal(deletions(h).length, 0)
})
for (const state of ['blocked', 'busy', 'restorePending']) test('P2-cleanup-03 恢复门禁拒绝 ' + state, async () => {
  const h = harness()
  if (state === 'restorePending') h.control.restorePending = { encrypted: 'synthetic-journal' }
  else h.restoreState[state] = true
  await assert.rejects(h.coordinator.run(confirmed), /LEGACY_CLEANUP_RESTORE_(BLOCKED|PENDING)/)
  assert.equal(deletions(h).length, 0); assert.equal(h.values.has(LEGACY_CHAT_CLEANUP_KEY), false)
})
test('P2-cleanup-04 确认等待期间会话失效不得清理或持久化旧授权', async () => {
  const h = harness()
  await assert.rejects(h.coordinator.run({ confirm: async () => { h.control.revision += 1; return true } }), /SESSION_EXPIRED/)
  assert.equal(deletions(h).length, 0); assert.equal(h.values.has(LEGACY_CHAT_CLEANUP_KEY), false)
})
test('P2-cleanup-05 只删除源码白名单旧文件、恢复键、独占通知与频道；完整恢复日志保留', async () => {
  const h = harness()
  const result = await h.coordinator.run({ confirm: async preview => {
    assert.equal(preview.warning, LEGACY_CHAT_CLEANUP_WARNING)
    assert.deepEqual(preview.files, LEGACY_CHAT_FILES)
    assert.ok(Object.isFrozen(preview)); assert.ok(Object.isFrozen(preview.files)); return true
  } })
  assert.equal(result.status, 'complete')
  for (const path of LEGACY_CHAT_FILES) assert.equal(h.files.has(path), false)
  assert.equal(h.values.has(LEGACY_CHAT_RECOVERY_KEY), false)
  assert.deepEqual([...h.pending], [819999999, 824000000, 9001])
  assert.equal(h.channels.has('formyself-warm-home-v1'), false)
  checkUntouched(h)
  const checkpoint = JSON.parse(h.values.get(LEGACY_CHAT_CLEANUP_KEY))
  assert.equal(checkpoint.phase, 'done'); assert.equal(checkpoint.completedFiles.length, 3)
  assert.equal(JSON.stringify(checkpoint).includes('synthetic:'), false)
  assert.equal(JSON.stringify(checkpoint).includes('synthetic-password'), false)
  const firstDelete = h.calls.findIndex(c => c.name === 'deleteFile')
  assert.ok(h.calls.findIndex(c => c.name === 'stop') < firstDelete)
  assert.ok(h.calls.findIndex(c => c.name === 'cancel') < firstDelete)
  assert.ok(h.calls.findIndex(c => c.name === 'deleteChannel') < firstDelete)
})
test('P2-cleanup-06 幂等重试也必须取得新的当次确认，checkpoint不能当授权token', async () => {
  const h = harness(); let asks = 0
  await h.coordinator.run({ confirm: async () => { asks++; return true } })
  const rebuilt = harness(h.shared)
  assert.deepEqual(await rebuilt.coordinator.run({ confirm: async () => { asks++; return false } }), { status: 'cancelled' })
  assert.equal(deletions(rebuilt).length, 0)
  await rebuilt.coordinator.run({ confirm: async () => { asks++; return true } })
  assert.equal(asks, 3); checkUntouched(rebuilt)
})
for (const [failure, code] of [
  ['stop', /stop failure/], ['cancel', /cancel failure/], ['listChannels', /listChannels failure/], ['deleteChannel', /deleteChannel failure/]
]) test('P2-cleanup-07 停止与通知失败前不删除任何文件/旧恢复键：' + failure, async () => {
  const h = harness(); h.control.hook = async name => { if (name === failure) throw new Error(failure + ' failure') }
  await assert.rejects(h.coordinator.run(confirmed), code)
  assert.equal(deletions(h).length, 0); checkUntouched(h)
})
test('P2-cleanup-08 无法确认旧writer停止、取消通知/频道返回假成功均阻断删除', async () => {
  const stopped = harness(); stopped.options.legacyRuntime.assertStopped = async () => false
  await assert.rejects(stopped.coordinator.run(confirmed), /LEGACY_RUNTIME_NOT_STOPPED/)
  assert.equal(deletions(stopped).length, 0)
  const notification = harness(); notification.control.cancelNoop = true
  await assert.rejects(notification.coordinator.run(confirmed), /LEGACY_NOTIFICATION_CANCEL_UNVERIFIED/)
  assert.equal(deletions(notification).length, 0)
  const channel = harness(); channel.control.channelNoop = true
  await assert.rejects(channel.coordinator.run(confirmed), /LEGACY_CHANNEL_DELETE_UNVERIFIED/)
  assert.equal(deletions(channel).length, 0)
})
test('P2-cleanup-09 任何文件或恢复键预读失败零删除，不把权限错误当不存在', async () => {
  for (const target of [...LEGACY_CHAT_FILES, LEGACY_CHAT_RECOVERY_KEY]) {
    const h = harness()
    h.control.hook = async (name, value) => {
      if ((name === 'stat' || name === 'get') && value === target) throw Object.assign(new Error('File does not exist.'), { code: 'EACCES' })
    }
    await assert.rejects(h.coordinator.run(confirmed))
    assert.equal(deletions(h).length, 0); assert.equal(h.files.size, 8); checkUntouched(h)
  }
})
test('P2-cleanup-10 仅明确缺失可视为成功：Android错误码和Web精确缺失消息', async () => {
  for (const error of [Object.assign(new Error('native missing'), { code: 'OS-PLUG-FILE-0008' }), new Error('File does not exist.')]) {
    const h = harness(); LEGACY_CHAT_FILES.forEach(p => h.files.delete(p))
    h.control.hook = async name => { if (name === 'stat') throw error }
    assert.equal((await h.coordinator.run(confirmed)).status, 'complete'); checkUntouched(h)
  }
})
test('P2-cleanup-11 删除假成功必须读回核验；旧恢复键删除假成功也不标done', async () => {
  const h = harness(); h.control.deleteNoop = true
  await assert.rejects(h.coordinator.run(confirmed), /LEGACY_FILE_DELETE_UNVERIFIED/)
  assert.equal(JSON.parse(h.values.get(LEGACY_CHAT_CLEANUP_KEY)).phase, 'quiesced')
  h.control.deleteNoop = false; h.control.preferenceNoop = true
  await assert.rejects(h.coordinator.run(confirmed), /LEGACY_RECOVERY_KEY_DELETE_UNVERIFIED/)
  assert.equal(JSON.parse(h.values.get(LEGACY_CHAT_CLEANUP_KEY)).phase, 'files')
  h.control.preferenceNoop = false
  assert.equal((await h.coordinator.run(confirmed)).status, 'complete'); checkUntouched(h)
})
for (let point = 1; point <= 7; point++) test('P2-cleanup-12 checkpoint写入断点 ' + point + ' 重建协调器可安全恢复且只删白名单', async () => {
  const h = harness(); h.control.hook = async (name, value) => { if (name === 'set' && value.count === point) throw new Error('synthetic interrupted checkpoint') }
  await assert.rejects(h.coordinator.run(confirmed), /interrupted checkpoint/)
  checkUntouched(h)
  const resumed = harness(h.shared)
  assert.equal((await resumed.coordinator.run(confirmed)).status, 'complete')
  checkUntouched(resumed); assert.equal((await resumed.coordinator.probe()).checkpoint.phase, 'done')
})
test('P2-cleanup-13 删除已发生但checkpoint未记录时，重建不能复活旧文件或误删其他模块', async () => {
  const h = harness(); let once = true
  h.control.hook = async name => { if (name === 'afterDeleteFile' && once) { once = false; throw new Error('power loss') } }
  await assert.rejects(h.coordinator.run(confirmed), /LEGACY_FILE_DELETE_FAILED/)
  assert.equal(h.files.has(LEGACY_CHAT_FILES[0]), false)
  const resumed = harness(h.shared)
  assert.equal((await resumed.coordinator.run(confirmed)).status, 'complete')
  checkUntouched(resumed)
})
test('P2-cleanup-14 malformed/未来checkpoint或白名单外completed项拒绝，零删除', async () => {
  for (const value of ['broken json', '{"version":999}', JSON.stringify({ version: 1, phase: 'files', completedFiles: ['formyself/restore-v1.enc'], notificationsCleared: true, recoveryKeyRemoved: false })]) {
    const h = harness(); h.values.set(LEGACY_CHAT_CLEANUP_KEY, value)
    await assert.rejects(h.coordinator.run(confirmed), /LEGACY_CHECKPOINT/)
    assert.equal(deletions(h).length, 0); checkUntouched(h)
  }
})
test('P2-cleanup-15 写后读回不一致在删除前阻断', async () => {
  const h = harness(); let writes = 0
  h.options.preferences.set = async () => { writes++ }
  await assert.rejects(h.coordinator.run(confirmed), /LEGACY_CHECKPOINT_WRITE_UNVERIFIED/)
  assert.equal(writes, 1); assert.equal(deletions(h).length, 0)
})
test('P2-cleanup-16 清理并发拒绝，不共享等待中的确认', async () => {
  const h = harness(); let release
  const wait = new Promise(resolve => { release = resolve })
  const running = h.coordinator.run({ confirm: async () => { await wait; return true } })
  await assert.rejects(h.coordinator.run(confirmed), /LEGACY_CLEANUP_BUSY/)
  release(); assert.equal((await running).status, 'complete'); assert.equal(h.coordinator.busy, false)
})
test('P2-cleanup-17 等待迟到旧持久化结算再删除，清理期间恢复门禁变动中止', async () => {
  const h = harness(); let release, stopStarted
  const wait = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { stopStarted = resolve })
  h.options.legacyRuntime.stop = async () => { stopStarted(); await wait; h.files.set(LEGACY_CHAT_FILES[0], 'last synthetic pending write'); h.control.stopped = true }
  const task = h.coordinator.run(confirmed)
  await started; assert.equal(deletions(h).length, 0)
  release(); assert.equal((await task).status, 'complete')
  for (const path of LEGACY_CHAT_FILES) assert.equal(h.files.has(path), false)
  const gate = harness(); gate.control.hook = async name => { if (name === 'cancel') gate.restoreState.blocked = true }
  await assert.rejects(gate.coordinator.run(confirmed), /RESTORE_BLOCKED/)
  assert.equal(deletions(gate).length, 0)
})
