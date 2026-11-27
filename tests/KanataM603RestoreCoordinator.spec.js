import { webcrypto, createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, reactive, ref } from 'vue'
import { createRestoreJournal, RESTORE_PATH } from '../src/platform/storage/restoreJournal.js'
import {
  KANATA_SQLITE_APPLICATION_ID,
  KANATA_SQLITE_GENERATION_KIND,
  KANATA_SQLITE_SCHEMA_005_FINGERPRINT,
  KANATA_SQLITE_SCHEMA_VERSION,
  createKanataPortableRestoreCoordinator,
  validateKanataGenerationDescriptor,
} from '../src/application/kanataPortableRestoreCoordinator.js'
import {
  evaluateBackupCapability,
  parseWebViewMajorVersion,
  probeBackupRuntimeCapability,
} from '../src/platform/runtime/backupCapabilityProbe.js'
import { createKanataPortableRestoreRuntime } from '../src/application/kanataPortableRestoreRuntime.js'
import SettingsBackup from '../src/components/settings/SettingsBackup.vue'

const MASTER_PW = 'M603-Local-Master-Pw-Synthetic'
const BACKUP_PW = 'M603-Backup-Pw-Synthetic'

const sha256Hex = text => createHash('sha256').update(text, 'utf8').digest('hex')

function makeDescriptor(overrides = {}) {
  const payload = overrides.payload ?? 'target-db-bytes'
  return {
    kind: KANATA_SQLITE_GENERATION_KIND,
    generationId: 'gen-target-1',
    taskId: 'task-m603-1',
    absent: false,
    dbPath: '/data/no_backup/staging/target.db',
    dbSha256Hex: sha256Hex(payload),
    schemaVersion: KANATA_SQLITE_SCHEMA_VERSION,
    applicationId: KANATA_SQLITE_APPLICATION_ID,
    schemaFingerprint: KANATA_SQLITE_SCHEMA_005_FINGERPRINT,
    datasetIdentity: 'kds-0123456789abcdef',
    totalBusinessRows: 42,
    tableCount: 50,
    verified: true,
    ...overrides,
  }
}

function createHarness(options = {}) {
  const files = new Map()
  const fs = {
    readFile: vi.fn(async ({ path }) => {
      if (!files.has(path)) throw new Error('ENOENT')
      return { data: files.get(path) }
    }),
    writeFile: vi.fn(async ({ path, data }) => { files.set(path, data) }),
    rename: vi.fn(async ({ from, to }) => { files.set(to, files.get(from)); files.delete(from) }),
    deleteFile: vi.fn(async ({ path }) => { files.delete(path) }),
  }
  const journal = createRestoreJournal(fs)
  const state = reactive({ blocked: false, busy: false, message: '', syncError: '' })
  const phases = []

  // Simulated SQLite files on disk (active, staging, rollback)
  const disk = new Map()
  const prevBytes = 'previous-active-db-bytes-v1'
  const targetBytes = 'target-restored-db-bytes-v2'
  disk.set('/data/no_backup/active/kanata.db', prevBytes)
  disk.set('/data/no_backup/staging/target.db', targetBytes)

  let ownerIdentity = { ownerId: 'owner-1', sessionRevision: 1 }
  let unconfirmed = []
  let applyCount = 0
  const cleanedArtifacts = []

  const engine = {
    stageAndVerify: vi.fn(async ({ signal, onProgress }) => {
      if (signal?.aborted) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' })
      onProgress?.({ phase: 'reading_kpb1', percent: 10 })
      onProgress?.({ phase: 'staging_import', percent: 50 })
      onProgress?.({ phase: 'verifying_staging', percent: 90 })
      if (options.failStage) throw options.failStage
      const desc = makeDescriptor({ payload: targetBytes, ...(options.stagedOverrides || {}) })
      return {
        descriptor: desc,
        summary: { worldCount: 1, messageCount: 25 },
        metrics: { totalRestoreMs: 120, batchCount: 3 },
      }
    }),
    destroyStaging: vi.fn(async desc => {
      disk.delete(desc.dbPath)
    }),
    prepareWriteDrain: vi.fn(async () => {
      if (options.onPrepare) await options.onPrepare()
    }),
    capturePreviousGeneration: vi.fn(async () => {
      const current = disk.get('/data/no_backup/active/kanata.db')
      const rollbackPath = '/data/no_backup/rollback/prev.db'
      disk.set(rollbackPath, current)
      return makeDescriptor({
        generationId: 'gen-prev-1',
        taskId: 'task-prev-1',
        dbPath: rollbackPath,
        dbSha256Hex: sha256Hex(current),
        datasetIdentity: 'kds-previous-000000',
        totalBusinessRows: 10,
      })
    }),
    applyGeneration: vi.fn(async desc => {
      applyCount++
      if (options.onApply) await options.onApply(desc, applyCount)
      const active = disk.get('/data/no_backup/active/kanata.db')
      if (active && sha256Hex(active) === desc.dbSha256Hex) return // idempotent!
      const src = disk.get(desc.dbPath)
      if (!src || sha256Hex(src) !== desc.dbSha256Hex) {
        throw Object.assign(new Error('SOURCE_MISSING_OR_MISMATCH'), { code: 'IO_FAILED' })
      }
      disk.set('/data/no_backup/active/kanata.db', src)
    }),
    finalizeArtifacts: vi.fn(async artifacts => {
      cleanedArtifacts.push(artifacts)
    }),
    inspectUnconfirmed: vi.fn(async () => [...unconfirmed]),
    reverifyUnconfirmed: vi.fn(async taskId => {
      if (options.reverifyResult) {
        if (options.reverifyResult.resolved) unconfirmed = unconfirmed.filter(u => u.taskId !== taskId)
        return options.reverifyResult
      }
      unconfirmed = unconfirmed.filter(u => u.taskId !== taskId)
      return { taskId, resolved: true, outcome: 'CONFIRMED_COMMIT', reason: 'DURABILITY_VERIFIED' }
    }),
    manualCleanupUnconfirmed: vi.fn(async (taskId, opts) => {
      if (!opts.confirmed) return { taskId, resolved: false, outcome: 'REFUSED', reason: 'USER_CONFIRMATION_REQUIRED' }
      if (options.cleanupRefused) return options.cleanupRefused
      unconfirmed = unconfirmed.filter(u => u.taskId !== taskId)
      return { taskId, resolved: true, outcome: 'CLEANED_UNCOMMITTED', reason: 'NO_COMMIT_OCCURRED' }
    }),
  }

  const synchronize = vi.fn(async () => {
    if (options.failSync) throw new Error('NOTIFICATION_SYNC_FAILED')
  })

  const coordinator = createKanataPortableRestoreCoordinator({
    journal,
    state,
    engine,
    getOwnerIdentity: () => ownerIdentity,
    synchronize,
    onPhase: p => phases.push(p),
  })

  return {
    files, fs, journal, state, phases, disk, prevBytes, targetBytes, engine, synchronize, coordinator,
    cleanedArtifacts,
    setOwner: next => { ownerIdentity = next },
    setUnconfirmed: list => { unconfirmed = list },
  }
}

beforeEach(() => { vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { vi.unstubAllGlobals() })

describe('M6-03 Work Package C & D: RestoreCoordinator integration, 10 crash points, and UNCONFIRMED', () => {
  it('completes full stage -> verify -> coordinator prepare/journal/apply/commit/clear/sync pipeline', async () => {
    const h = createHarness()
    const staged = await h.coordinator.stageAndVerify({ source: new Uint8Array(16), backupPassword: BACKUP_PW })
    // Active DB must STILL be untouched after staging!
    expect(h.disk.get('/data/no_backup/active/kanata.db')).toBe(h.prevBytes)
    expect(h.files.size).toBe(0)

    const result = await h.coordinator.commitStagedRestore(staged.descriptor, MASTER_PW)
    expect(result.committed).toBe(true)
    expect(h.disk.get('/data/no_backup/active/kanata.db')).toBe(h.targetBytes)
    expect(h.state.blocked).toBe(false)
    expect(h.state.syncError).toBe('')
    expect(h.files.size).toBe(0)
    expect(h.cleanedArtifacts).toHaveLength(1)
    expect(h.phases).toContain('coordinator_prepare')
    expect(h.phases).toContain('journal_persisting')
    expect(h.phases).toContain('applying')
    expect(h.phases).toContain('committing')
    expect(h.phases).toContain('clearing_journal')
    expect(h.phases).toContain('succeeded')
  })

  it('rejects unverified staging descriptor BEFORE journal write or active DB mutation', async () => {
    const h = createHarness()
    const unverified = makeDescriptor({ verified: false })
    expect(() => validateKanataGenerationDescriptor(unverified)).toThrow('STAGING_NOT_VERIFIED')
    await expect(h.coordinator.commitStagedRestore(unverified, MASTER_PW)).rejects.toThrow('STAGING_NOT_VERIFIED')
    expect(h.files.size).toBe(0)
    expect(h.disk.get('/data/no_backup/active/kanata.db')).toBe(h.prevBytes)
    expect(h.state.blocked).toBe(false)
  })

  it('re-checks owner & sessionRevision after async prepare and aborts cleanly on session change', async () => {
    const h = createHarness({
      onPrepare: async () => {
        // Simulate session expiring during async prepare!
        h.setOwner({ ownerId: 'owner-1', sessionRevision: 2 })
      },
    })
    const staged = await h.coordinator.stageAndVerify({ source: new Uint8Array(16), backupPassword: BACKUP_PW })
    await expect(h.coordinator.commitStagedRestore(staged.descriptor, MASTER_PW)).rejects.toThrow('RESTORE_SESSION_OR_OWNER_CHANGED')
    expect(h.disk.get('/data/no_backup/active/kanata.db')).toBe(h.prevBytes)
    expect(h.files.size).toBe(0)
    expect(h.state.blocked).toBe(false)
  })

  it('covers all 10 crash interruption points deterministically', async () => {
    // Points 1-4: before journal write -> active DB unchanged & unblocked
    {
      const h = createHarness({ failStage: Object.assign(new Error('STAGE_INTERRUPTED'), { code: 'IO_FAILED' }) })
      await expect(h.coordinator.stageAndVerify({ source: new Uint8Array(8), backupPassword: BACKUP_PW })).rejects.toThrow('STAGE_INTERRUPTED')
      expect(h.disk.get('/data/no_backup/active/kanata.db')).toBe(h.prevBytes)
      expect(h.files.size).toBe(0)
      expect(h.state.blocked).toBe(false)
    }

    // Point 5 & 7: after journal written / before commit marker -> restart recovers previous
    for (const mutatedActive of [false, true]) {
      const h = createHarness()
      const prevDesc = await h.engine.capturePreviousGeneration()
      const targetDesc = makeDescriptor({ payload: h.targetBytes })
      await h.journal.prepare({ version: 1, previous: prevDesc, target: targetDesc }, MASTER_PW)
      if (mutatedActive) {
        h.disk.set('/data/no_backup/active/kanata.db', h.targetBytes)
      }
      await h.coordinator.probe()
      expect(h.state.blocked).toBe(true)
      await h.coordinator.recover(MASTER_PW)
      expect(h.disk.get('/data/no_backup/active/kanata.db')).toBe(h.prevBytes)
      expect(h.state.blocked).toBe(false)
      expect(h.files.size).toBe(0)
    }

    // Point 6: failure during apply -> rolls back to previous cleanly
    {
      const h = createHarness({
        onApply: async (desc, count) => {
          if (count === 1) throw Object.assign(new Error('APPLY_ENOSPC'), { code: 'IO_FAILED' })
        },
      })
      const staged = await h.coordinator.stageAndVerify({ source: new Uint8Array(8), backupPassword: BACKUP_PW })
      await expect(h.coordinator.commitStagedRestore(staged.descriptor, MASTER_PW)).rejects.toThrow('APPLY_ENOSPC')
      expect(h.disk.get('/data/no_backup/active/kanata.db')).toBe(h.prevBytes)
      expect(h.state.blocked).toBe(false)
      expect(h.files.size).toBe(0)
    }

    // Point 8: after commit marker -> restart replays target forward
    {
      const h = createHarness()
      const prevDesc = await h.engine.capturePreviousGeneration()
      const targetDesc = makeDescriptor({ payload: h.targetBytes })
      const prepared = await h.journal.prepare({ version: 1, previous: prevDesc, target: targetDesc }, MASTER_PW)
      await h.journal.commit(prepared.digest)
      await h.coordinator.probe()
      expect(h.state.blocked).toBe(true)
      await h.coordinator.recover(MASTER_PW)
      expect(h.disk.get('/data/no_backup/active/kanata.db')).toBe(h.targetBytes)
      expect(h.state.blocked).toBe(false)
      expect(h.files.size).toBe(0)
    }

    // Point 9: crash during journal clear (restore-v1.enc deleted, orphan commit remains) -> idempotent convergence to target
    {
      const h = createHarness()
      const prevDesc = await h.engine.capturePreviousGeneration()
      const targetDesc = makeDescriptor({ payload: h.targetBytes })
      const prepared = await h.journal.prepare({ version: 1, previous: prevDesc, target: targetDesc }, MASTER_PW)
      h.disk.set('/data/no_backup/active/kanata.db', h.targetBytes)
      await h.journal.commit(prepared.digest)
      h.files.delete(RESTORE_PATH) // crashed after removing primary record, leaving orphan commit
      await h.coordinator.probe()
      expect(h.state.blocked).toBe(false)
      expect(h.files.size).toBe(0)
      expect(h.disk.get('/data/no_backup/active/kanata.db')).toBe(h.targetBytes)
    }

    // Point 10: rollback failure -> remains blocked and retains encrypted journal
    {
      const h = createHarness({
        onApply: async () => { throw Object.assign(new Error('PERSISTENT_DISK_ERROR'), { code: 'IO_FAILED' }) },
      })
      const staged = await h.coordinator.stageAndVerify({ source: new Uint8Array(8), backupPassword: BACKUP_PW })
      await expect(h.coordinator.commitStagedRestore(staged.descriptor, MASTER_PW)).rejects.toHaveProperty('rollbackFailed', true)
      expect(h.state.blocked).toBe(true)
      expect(h.files.has(RESTORE_PATH)).toBe(true)
      expect(h.phases).toContain('rollback_failed')
    }
  })

  it('keeps DURABILITY_UNCONFIRMED protected and enforces manual verification/safe cleanup rules', async () => {
    const h = createHarness({
      onApply: async () => {
        throw Object.assign(new Error('DIR_FSYNC_FAILED'), { code: 'DURABILITY_UNCONFIRMED' })
      },
    })
    const staged = await h.coordinator.stageAndVerify({ source: new Uint8Array(8), backupPassword: BACKUP_PW })
    await expect(h.coordinator.commitStagedRestore(staged.descriptor, MASTER_PW)).rejects.toHaveProperty('code', 'DURABILITY_UNCONFIRMED')
    expect(h.state.blocked).toBe(true)
    expect(h.files.has(RESTORE_PATH)).toBe(true)
    expect(h.phases).toContain('unconfirmed')

    // Manual cleanup MUST refuse while restore journal is pending or unconfirmed
    const refusedNoConfirm = await h.coordinator.manualCleanupUnconfirmed('task-u1', { confirmed: false })
    expect(refusedNoConfirm.resolved).toBe(false)
    expect(refusedNoConfirm.reason).toBe('USER_CONFIRMATION_REQUIRED')

    const refusedJournal = await h.coordinator.manualCleanupUnconfirmed('task-u1', { confirmed: true })
    expect(refusedJournal.resolved).toBe(false)
    expect(refusedJournal.reason).toBe('RESTORE_JOURNAL_PENDING')
  })

  it('separates derived synchronization failure from business DB commit and retries sync without re-applying DB', async () => {
    const h = createHarness({ failSync: true })
    const staged = await h.coordinator.stageAndVerify({ source: new Uint8Array(8), backupPassword: BACKUP_PW })
    const res = await h.coordinator.commitStagedRestore(staged.descriptor, MASTER_PW)
    expect(res.committed).toBe(true)
    expect(h.state.blocked).toBe(false)
    expect(h.state.syncError).toContain('同步失败')
    expect(h.engine.applyGeneration).toHaveBeenCalledTimes(1)

    h.synchronize.mockImplementationOnce(async () => {})
    await h.coordinator.retrySynchronization()
    expect(h.state.syncError).toBe('')
    expect(h.engine.applyGeneration).toHaveBeenCalledTimes(1)
  })
})

describe('M6-03 Work Package E: Android WebView & Capacitor Bridge capability detection', () => {
  it('parses WebView major versions accurately', () => {
    expect(parseWebViewMajorVersion('113.0.5672.136')).toBe(113)
    expect(parseWebViewMajorVersion('52.0.2743.100')).toBe(52)
    expect(parseWebViewMajorVersion('')).toBe(null)
    expect(parseWebViewMajorVersion(null)).toBe(null)
  })

  it('keeps Web on existing encrypted file adapter and honestly reports KPB1 portable restore unavailable (F03)', async () => {
    const cap = await probeBackupRuntimeCapability({
      capacitor: { getPlatform: () => 'web', isPluginAvailable: () => false },
    })
    expect(cap.platform).toBe('web')
    expect(cap.sqlitePluginStatus).toBe('web_encrypted_file_adapter')
    expect(cap.safStatus).toBe('browser_file_api')
    expect(cap.bridgeStatus).toBe('not_applicable')
    expect(cap.portableRestoreAvailable).toBe(false)
    expect(cap.unavailableCode).toBe('WEB_KPB1_RESTORE_UNAVAILABLE')
  })

  it('blocks API 24/25 stock AOSP WebView 52.0.2743.100 honestly and never marks it supported', () => {
    const cap = evaluateBackupCapability({
      platform: 'android',
      pluginAvailable: false,
      handshakeOk: false,
      nativeInfo: {
        androidApi: 24,
        androidRelease: '7.0',
        webviewPackage: 'com.android.webview',
        webviewVersion: '52.0.2743.100',
        webviewMajorVersion: 52,
        sqlitePluginRegistered: true,
        sqlitePluginActivated: true,
        safAvailable: true,
      },
    })
    expect(cap.bridgeStatus).toBe('blocked_webview')
    expect(cap.portableRestoreAvailable).toBe(false)
    expect(cap.unavailableCode).toBe('WEBVIEW_BELOW_CAPACITOR_FLOOR')
    expect(cap.unavailableReason).toContain('52.0.2743.100')
  })

  it('never trusts isPluginAvailable() alone — requires live nonce handshake round-trip', async () => {
    // isPluginAvailable() returns true, but handshake returns wrong nonce
    const badNonce = await probeBackupRuntimeCapability({
      capacitor: { getPlatform: () => 'android', isPluginAvailable: () => true },
      plugin: { handshake: async () => ({ ok: true, bridgeHandshakeOk: true, nonce: 'wrong-nonce' }) },
      createNonce: () => 'expected-nonce',
    })
    expect(badNonce.portableRestoreAvailable).toBe(false)
    expect(badNonce.bridgeStatus).toBe('handshake_failed')
    expect(badNonce.unavailableCode).toBe('HANDSHAKE_NONCE_MISMATCH')

    // Valid live handshake on API 34 synthetic build -> ready!
    const okCap = await probeBackupRuntimeCapability({
      capacitor: { getPlatform: () => 'android', isPluginAvailable: () => true },
      plugin: {
        handshake: async ({ nonce }) => ({
          ok: true,
          bridgeHandshakeOk: true,
          nonce,
          androidApi: 34,
          androidRelease: '14',
          webviewPackage: 'com.google.android.webview',
          webviewVersion: '113.0.5672.136',
          webviewMajorVersion: 113,
          sqlitePluginRegistered: true,
          sqlitePluginActivated: true,
          safAvailable: true,
        }),
      },
      createNonce: () => 'nonce-ok-1',
    })
    expect(okCap.portableRestoreAvailable).toBe(true)
    expect(okCap.bridgeStatus).toBe('ready')
    expect(okCap.webviewVersion).toBe('113.0.5672.136')
    expect(okCap.sqlitePluginStatus).toBe('ready')
    expect(okCap.safStatus).toBe('available')

    // Ordinary APK (sqlitePluginActivated: false) reports registered_not_activated honestly
    const ordCap = await probeBackupRuntimeCapability({
      capacitor: { getPlatform: () => 'android', isPluginAvailable: () => true },
      plugin: {
        handshake: async ({ nonce }) => ({
          ok: true,
          bridgeHandshakeOk: true,
          nonce,
          androidApi: 34,
          webviewVersion: '113.0.5672.136',
          webviewMajorVersion: 113,
          sqlitePluginRegistered: true,
          sqlitePluginActivated: false,
          safAvailable: true,
        }),
      },
      createNonce: () => 'nonce-ord-1',
    })
    expect(ordCap.portableRestoreAvailable).toBe(false)
    expect(ordCap.sqlitePluginStatus).toBe('registered_not_activated')
    expect(ordCap.unavailableCode).toBe('SQLITE_PLUGIN_NOT_ACTIVATED')
  })
})

describe('M6-03 Work Package F: SettingsBackup UI state, cancel, coordinator commit, and UNCONFIRMED', () => {
  it('renders capability, blocks on WebView 52, handles stage/confirm/cancel, and exposes UNCONFIRMED manual entry', async () => {
    const h = createHarness()
    h.setUnconfirmed([{
      taskId: 'imp-unconfirmed-1',
      kind: 'IMPORT',
      state: 'RENAMED_PENDING_DIR_SYNC',
      journalPath: '/data/no_backup/.import-imp-unconfirmed-1.pending',
      targetPath: '/data/no_backup/active/kanata.db',
      expectedSha256Hex: sha256Hex(h.targetBytes),
      actualTargetSha256Hex: sha256Hex(h.targetBytes),
      targetExists: true,
      lockActive: false,
      shaMatches: true,
      reason: 'PENDING_DIR_FSYNC',
    }])

    let currentCap = evaluateBackupCapability({
      platform: 'android',
      pluginAvailable: true,
      handshakeOk: true,
      nativeInfo: {
        androidApi: 34,
        webviewVersion: '113.0.5672.136',
        webviewMajorVersion: 113,
        sqlitePluginRegistered: true,
        sqlitePluginActivated: true,
        safAvailable: true,
      },
    })

    const rt = createKanataPortableRestoreRuntime({
      probeCapability: async () => currentCap,
      coordinator: h.coordinator,
    })
    await rt.refreshCapability()
    await rt.refreshUnconfirmed()

    const pwd = ref(BACKUP_PW)
    const model = reactive({
      isGeneralSection: s => s === 'data',
      backupPickerOpen: false,
      backupTypeOptions: [{ value: 'full', label: '完整数据' }],
      exportDataType: 'full',
      exportJSON: vi.fn(),
      fileInputRef: null,
      getDataTypeLabel: () => '完整',
      handleFileUpload: vi.fn(),
      triggerImport: vi.fn(),
      portableFileInputRef: null,
      portableBackupPassword: pwd,
      portableRestoreState: rt.state,
      refreshBackupCapability: () => rt.refreshCapability(),
      triggerPortableFileSelect: vi.fn(),
      handlePortableFileChange: vi.fn(),
      startPortableRestore: () => rt.startStaging({ backupPassword: pwd.value }),
      confirmPortableRestore: () => rt.confirmCommitRestore({ localMasterPassword: MASTER_PW }),
      cancelPortableRestore: () => rt.cancelRestore(),
      retryPortableRestoreSync: () => rt.retrySync(),
      reverifyUnconfirmedTask: tid => rt.reverifyUnconfirmed(tid),
      manualCleanupUnconfirmedTask: tid => rt.manualCleanupUnconfirmed(tid, { confirmed: true }),
    })

    const wrapper = mount(SettingsBackup, { props: { model } })
    expect(wrapper.get('[data-testid="capability-summary"]').text()).toContain('可用')
    expect(wrapper.get('[data-testid="capability-details"]').text()).toContain('113.0.5672.136')
    expect(wrapper.get('[data-testid="unconfirmed-panel"]').text()).toContain('imp-unconfirmed-1')

    // Re-verify UNCONFIRMED entry clears panel once proven safe
    await wrapper.get('[data-testid="reverify-unconfirmed-imp-unconfirmed-1"]').trigger('click')
    await vi.waitFor(() => expect(rt.state.unconfirmedItems).toHaveLength(0))

    // Stage -> Awaiting Confirmation -> Commit through RestoreCoordinator
    rt.selectBackupFile({ name: 'synthetic-1k.kpb1' })
    await nextTick()
    await wrapper.get('[data-testid="start-portable-restore-btn"]').trigger('click')
    await vi.waitFor(() => expect(rt.state.phase).toBe('awaiting_confirmation'))
    expect(wrapper.get('[data-testid="staged-summary"]').text()).toContain('kds-0123456789abcdef')
    expect(wrapper.find('[data-testid="restore-completion-box"]').exists()).toBe(false)

    await wrapper.get('[data-testid="confirm-portable-restore-btn"]').trigger('click')
    await vi.waitFor(() => expect(rt.state.phase).toBe('succeeded'))
    expect(wrapper.get('[data-testid="restore-completion-box"]').text()).toContain('50/50')

    // Simulate WebView 52.0 on API 24 -> UI blocks restore clearly
    currentCap = evaluateBackupCapability({
      platform: 'android',
      pluginAvailable: false,
      handshakeOk: false,
      nativeInfo: { androidApi: 24, webviewVersion: '52.0.2743.100', webviewMajorVersion: 52 },
    })
    await rt.refreshCapability()
    await nextTick()
    expect(wrapper.get('[data-testid="capability-unavailable-reason"]').text()).toContain('WEBVIEW_BELOW_CAPACITOR_FLOOR')
    expect(wrapper.get('[data-testid="start-portable-restore-btn"]').attributes('disabled')).toBeDefined()

    rt.dispose()
    wrapper.unmount()
  })
})
