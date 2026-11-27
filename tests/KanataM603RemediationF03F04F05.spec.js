import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { mount } from '@vue/test-utils'
import { createRestoreJournal, RESTORE_PATH } from '../src/platform/storage/restoreJournal.js'
import {
  createKanataPortableRestoreCoordinator,
  KANATA_SQLITE_APPLICATION_ID,
  KANATA_SQLITE_GENERATION_KIND,
  KANATA_SQLITE_SCHEMA_005_FINGERPRINT,
  KANATA_SQLITE_SCHEMA_VERSION,
  KANATA_SQLITE_VERIFIER_COUNT,
  RESTORE_MATERIAL_LIFECYCLE,
} from '../src/application/kanataPortableRestoreCoordinator.js'
import { createKanataPortableRestoreRuntime } from '../src/application/kanataPortableRestoreRuntime.js'
import { createSyntheticPortableRestoreCoordinator } from '../src/application/kanataSyntheticRestoreWiring.js'
import { createSecureCredentials } from '../src/platform/security/secureCredentials.js'
import { sha256Text } from '../src/shared/crypto/sha256Text.js'
import SettingsBackup from '../src/components/settings/SettingsBackup.vue'

const BACKUP_PW = 'M603R-Synthetic-Backup-Pass!'
const MASTER_PW = 'M603R-Synthetic-Master-Pass!'

function createMemoryFs() {
  const files = new Map()
  return {
    files,
    fs: {
      async readFile({ path }) {
        if (!files.has(path)) throw new Error('ENOENT: not found')
        return { data: files.get(path) }
      },
      async writeFile({ path, data }) {
        files.set(path, String(data))
      },
      async rename({ from, to }) {
        if (!files.has(from)) throw new Error('ENOENT: not found')
        files.set(to, files.get(from))
        files.delete(from)
      },
      async deleteFile({ path }) {
        files.delete(path)
      },
    },
  }
}

function makeDescriptor(overrides = {}) {
  const payload = overrides.payload ?? 'synthetic-target-db-bytes'
  return {
    kind: KANATA_SQLITE_GENERATION_KIND,
    generationId: overrides.generationId ?? 'gen-m603r-target',
    taskId: overrides.taskId ?? 'task-m603r-1',
    absent: false,
    dbPath: overrides.dbPath ?? '/no_backup/generations/gen-m603r-target/kanata.db',
    dbSha256Hex: overrides.dbSha256Hex ?? sha256Text(payload),
    envelopePath: overrides.envelopePath ?? '/no_backup/generations/gen-m603r-target/envelope.json',
    envelopeSha256Hex: overrides.envelopeSha256Hex ?? sha256Text('envelope-bytes'),
    stagingHandle: overrides.stagingHandle ?? 'stg-handle-001',
    schemaVersion: KANATA_SQLITE_SCHEMA_VERSION,
    applicationId: KANATA_SQLITE_APPLICATION_ID,
    schemaFingerprint: KANATA_SQLITE_SCHEMA_005_FINGERPRINT,
    datasetIdentity: overrides.datasetIdentity ?? 'kds-m603r-001',
    totalBusinessRows: overrides.totalBusinessRows ?? 120,
    tableCount: KANATA_SQLITE_VERIFIER_COUNT,
    verified: overrides.verified ?? true,
  }
}

const readyAndroidCap = async () => ({
  platform: 'android',
  checkedAt: Date.now(),
  androidApi: 34,
  androidRelease: '14',
  webviewPackage: 'com.google.android.webview',
  webviewVersion: '113.0.5672.136',
  webviewMajorVersion: 113,
  bridgeStatus: 'ready',
  bridgeHandshakeOk: true,
  sqlitePluginStatus: 'ready',
  safStatus: 'available',
  portableRestoreAvailable: true,
  unavailableCode: '',
  unavailableReason: '',
})

describe('M6-03-R F04: Material lifecycle safety, cancel/dispose/reselect races & cleanup decoupling', () => {
  it('refuses to delete PREPARED_REGISTERED materials on cancelRestore or dispose during commit', async () => {
    const { fs, files } = createMemoryFs()
    const journal = createRestoreJournal(fs)
    const state = reactive({ blocked: false, busy: false, message: '', syncError: '' })
    let releaseApply
    const applyStarted = new Promise(resolve => { releaseApply = resolve })
    let finishApply
    const applyGate = new Promise(resolve => { finishApply = resolve })

    const destroyStaging = vi.fn(async () => {})
    const finalizeArtifacts = vi.fn(async () => {})
    const targetDesc = makeDescriptor()

    const coordinator = createKanataPortableRestoreCoordinator({
      journal,
      state,
      getOwnerIdentity: () => ({ ownerId: 'owner-1', sessionRevision: 1, epoch: 1 }),
      engine: {
        stageAndVerify: async () => ({ descriptor: targetDesc, summary: { worldCount: 1, messageCount: 20 } }),
        destroyStaging,
        prepareWriteDrain: async () => {},
        capturePreviousGeneration: async () => makeDescriptor({ generationId: 'gen-prev', payload: 'prev-bytes' }),
        applyGeneration: async () => {
          releaseApply()
          await applyGate
        },
        finalizeArtifacts,
      },
    })

    const runtime = createKanataPortableRestoreRuntime({
      probeCapability: readyAndroidCap,
      coordinator,
    })

    runtime.selectBackupFile({ name: 'test.kpb1', uri: 'content://test/1' })
    expect(await runtime.startStaging({ backupPassword: BACKUP_PW })).toBe(true)
    expect(runtime.state.materialLifecycle).toBe(RESTORE_MATERIAL_LIFECYCLE.VERIFIED_AWAITING_CONFIRM)

    // Start commit and wait until applyGeneration is running (already past journal_persisting / PREPARED_REGISTERED!)
    const commitPromise = runtime.confirmCommitRestore({ localMasterPassword: MASTER_PW })
    await applyStarted
    expect(files.has(RESTORE_PATH)).toBe(true)

    // F04-1: cancelRestore during commit MUST NOT delete referenced material!
    const cancelRes = await runtime.cancelRestore()
    expect(cancelRes.cancelled).toBe(false)
    expect(cancelRes.reason).toBe('MATERIAL_REFERENCED_BY_TX')
    expect(destroyStaging).not.toHaveBeenCalled()

    // F04-2: UI unmount (dispose) during commit MUST NOT delete referenced material!
    runtime.dispose()
    expect(destroyStaging).not.toHaveBeenCalled()

    // Let commit finish cleanly
    finishApply()
    await commitPromise
    expect(finalizeArtifacts).toHaveBeenCalledTimes(1)
    expect(files.size).toBe(0)
  })

  it('decouples FINALIZED business commit success from post-commit finalizeArtifacts cleanup failure', async () => {
    const { fs } = createMemoryFs()
    const journal = createRestoreJournal(fs)
    const state = reactive({ blocked: false, busy: false, message: '', syncError: '' })
    let failCleanup = true
    const finalizeArtifacts = vi.fn(async () => {
      if (failCleanup) throw Object.assign(new Error('GC_EACCES'), { code: 'TX_GC_FAILED' })
    })
    const coordinator = createKanataPortableRestoreCoordinator({
      journal,
      state,
      getOwnerIdentity: () => ({ ownerId: 'owner-1', sessionRevision: 1, epoch: 1 }),
      engine: {
        stageAndVerify: async () => ({ descriptor: makeDescriptor(), summary: { worldCount: 1, messageCount: 5 } }),
        destroyStaging: vi.fn(async () => {}),
        prepareWriteDrain: async () => {},
        capturePreviousGeneration: async () => makeDescriptor({ generationId: 'gen-prev', payload: 'prev-bytes' }),
        applyGeneration: async () => {},
        finalizeArtifacts,
      },
    })

    const runtime = createKanataPortableRestoreRuntime({ probeCapability: readyAndroidCap, coordinator })
    runtime.selectBackupFile({ name: 'test.kpb1' })
    await runtime.startStaging({ backupPassword: BACKUP_PW })
    const ok = await runtime.confirmCommitRestore({ localMasterPassword: MASTER_PW })

    // Business commit MUST be reported as committed=true despite cleanup error!
    expect(ok).toBe(true)
    expect(runtime.state.phase).toBe('succeeded')
    expect(runtime.state.completionResult?.committed).toBe(true)
    expect(runtime.state.cleanupError).toContain('TX_GC_FAILED')
    expect(runtime.state.cleanupError).toContain('切勿重复导入')

    // Render SettingsBackup.vue to verify both completion box and independent cleanup retry button render
    const wrapper = mount(SettingsBackup, {
      props: {
        model: {
          isGeneralSection: () => true,
          backupPickerOpen: false,
          backupTypeOptions: [],
          exportDataType: 'full',
          getDataTypeLabel: () => '全部数据',
          exportJSON: vi.fn(),
          triggerImport: vi.fn(),
          handleFileUpload: vi.fn(),
          fileInputRef: null,
          portableFileInputRef: null,
          portableBackupPassword: '',
          portableRestoreState: runtime.state,
          refreshBackupCapability: vi.fn(),
          triggerPortableFileSelect: vi.fn(),
          handlePortableFileChange: vi.fn(),
          startPortableRestore: vi.fn(),
          confirmPortableRestore: vi.fn(),
          cancelPortableRestore: vi.fn(),
          retryPortableRestoreSync: vi.fn(),
          retryPortableRestoreCleanup: () => runtime.retryCleanup(),
          reverifyUnconfirmedTask: vi.fn(),
          manualCleanupUnconfirmedTask: vi.fn(),
        },
      },
    })
    expect(wrapper.find('[data-testid="restore-completion-box"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="restore-cleanup-error"]').exists()).toBe(true)

    // Retry cleanup succeeds without re-running apply!
    failCleanup = false
    await wrapper.find('[data-testid="retry-cleanup-btn"]').trigger('click')
    await Promise.resolve()
    expect(runtime.state.cleanupError).toBe('')
    expect(finalizeArtifacts).toHaveBeenCalledTimes(2)
  })

  it('discards stale unregistered staging on file reselect, late cancel response, and post-staging session expiry', async () => {
    const { fs } = createMemoryFs()
    const journal = createRestoreJournal(fs)
    const state = reactive({ blocked: false, busy: false, message: '', syncError: '' })
    let sessionRev = 1
    let resolveDelayedStage
    const destroyStaging = vi.fn(async () => {})

    const coordinator = createKanataPortableRestoreCoordinator({
      journal,
      state,
      getOwnerIdentity: () => ({ ownerId: 'owner-1', sessionRevision: sessionRev, epoch: 1 }),
      engine: {
        stageAndVerify: async ({ backupPassword }) => {
          if (backupPassword === 'DELAYED') {
            return new Promise(resolve => {
              resolveDelayedStage = () => resolve({ descriptor: makeDescriptor({ generationId: 'gen-delayed' }), summary: { worldCount: 1, messageCount: 1 } })
            })
          }
          return { descriptor: makeDescriptor({ generationId: `gen-${backupPassword}` }), summary: { worldCount: 1, messageCount: 1 } }
        },
        destroyStaging,
        prepareWriteDrain: async () => {},
        capturePreviousGeneration: async () => makeDescriptor({ generationId: 'gen-prev', payload: 'p' }),
        applyGeneration: async () => {},
      },
    })

    const runtime = createKanataPortableRestoreRuntime({ probeCapability: readyAndroidCap, coordinator })

    // 1) Reselect while awaiting confirmation destroys previous unregistered staging
    runtime.selectBackupFile({ name: 'a.kpb1' })
    expect(await runtime.startStaging({ backupPassword: 'FIRST' })).toBe(true)
    runtime.selectBackupFile({ name: 'b.kpb1' })
    await Promise.resolve()
    expect(destroyStaging).toHaveBeenCalledTimes(1)

    // 2) Delayed cancel response: cancel before underlying stage resolves -> late result discarded & destroyed
    const delayedPromise = runtime.startStaging({ backupPassword: 'DELAYED' })
    await Promise.resolve()
    await Promise.resolve()
    const cRes = await runtime.cancelRestore()
    expect(cRes.cancelled).toBe(true)
    resolveDelayedStage?.()
    expect(await delayedPromise).toBe(false)
    expect(runtime.state.phase).toBe('cancelled')
    expect(destroyStaging).toHaveBeenCalledTimes(2)

    // 3) Session changes while staging is in-flight -> coordinator destroys returned staging & throws CANCELLED
    let finishExpStage
    const expCoord = createKanataPortableRestoreCoordinator({
      journal,
      state,
      getOwnerIdentity: () => ({ ownerId: 'owner-1', sessionRevision: sessionRev, epoch: 1 }),
      engine: {
        stageAndVerify: async () => new Promise(resolve => {
          finishExpStage = () => resolve({ descriptor: makeDescriptor({ generationId: 'gen-expired-sess' }) })
        }),
        destroyStaging,
        prepareWriteDrain: async () => {},
        capturePreviousGeneration: async () => makeDescriptor({ generationId: 'gen-prev', payload: 'p' }),
        applyGeneration: async () => {},
      },
    })
    const stageP = expCoord.stageAndVerify({ source: new Uint8Array(4), backupPassword: BACKUP_PW })
    sessionRev += 1
    finishExpStage()
    await expect(stageP).rejects.toHaveProperty('code', 'CANCELLED')
    expect(destroyStaging).toHaveBeenCalledTimes(3)
  })
})

describe('M6-03-R F05: Transaction identity, exclusive ownership, anti-forgery & session-independent recovery', () => {
  it('rejects externally fabricated verified=true descriptors and enforces owner/session/epoch binding', async () => {
    const { fs } = createMemoryFs()
    const journal = createRestoreJournal(fs)
    const state = reactive({ blocked: false, busy: false, message: '', syncError: '' })
    let identity = { ownerId: 'owner-A', sessionRevision: 10, epoch: 3 }
    const applySpy = vi.fn(async () => {})

    const coordinator = createKanataPortableRestoreCoordinator({
      journal,
      state,
      getOwnerIdentity: () => identity,
      engine: {
        stageAndVerify: async () => ({ descriptor: makeDescriptor({ generationId: 'gen-real' }) }),
        prepareWriteDrain: async () => {},
        capturePreviousGeneration: async () => makeDescriptor({ generationId: 'gen-prev', payload: 'p' }),
        applyGeneration: applySpy,
      },
    })

    // 1) Forged verified=true descriptor NEVER registered via stageAndVerify -> MUST fail before journal/apply!
    const forged = makeDescriptor({ generationId: 'gen-forged', verified: true })
    await expect(coordinator.commitStagedRestore(forged, MASTER_PW)).rejects.toHaveProperty('code', 'STAGING_NOT_REGISTERED')
    expect(applySpy).not.toHaveBeenCalled()
    expect(state.blocked).toBe(false)

    // 2) Authentic descriptor becomes invalid if epoch or owner changes before commit
    const staged = await coordinator.stageAndVerify({ source: new Uint8Array(4), backupPassword: BACKUP_PW })
    identity = { ownerId: 'owner-B', sessionRevision: 10, epoch: 3 }
    await expect(coordinator.commitStagedRestore(staged.descriptor, MASTER_PW)).rejects.toHaveProperty('code', 'CANCELLED')
    expect(applySpy).not.toHaveBeenCalled()
  })

  it('enforces mutual exclusion across concurrent commit/recover/manualCleanup and allows recovery even if ordinary UI session expired', async () => {
    const { fs } = createMemoryFs()
    const journal = createRestoreJournal(fs)
    const state = reactive({ blocked: false, busy: false, message: '', syncError: '' })
    let identity = { ownerId: 'owner-A', sessionRevision: 1, epoch: 1 }

    let releaseRecover
    const recoverGate = new Promise(resolve => { releaseRecover = resolve })
    const coordinator = createKanataPortableRestoreCoordinator({
      journal,
      state,
      getOwnerIdentity: () => identity,
      engine: {
        stageAndVerify: async () => ({ descriptor: makeDescriptor() }),
        prepareWriteDrain: async () => {},
        capturePreviousGeneration: async () => makeDescriptor({ generationId: 'gen-prev', payload: 'p' }),
        applyGeneration: async () => {
          // Simulate ordinary UI session revocation mid-recovery (e.g., background lock)
          identity = { ownerId: 'owner-EXPIRED', sessionRevision: 99, epoch: 99 }
          await recoverGate
        },
        manualCleanupUnconfirmed: vi.fn(async () => ({ taskId: 'u1', resolved: true, outcome: 'CLEANED', reason: 'OK' })),
      },
    })

    // Prepare a durable committed journal as if process restarted after decision
    const prev = makeDescriptor({ generationId: 'gen-prev', payload: 'p' })
    const target = makeDescriptor({ generationId: 'gen-targ', payload: 't' })
    const prep = await journal.prepare({ version: 1, previous: prev, target }, MASTER_PW)
    await journal.commit(prep.digest)
    await coordinator.probe()
    expect(state.blocked).toBe(true)

    // Start recovery
    const recP = coordinator.recover(MASTER_PW)
    await Promise.resolve()
    await Promise.resolve()

    // Concurrent manualCleanup MUST be rejected with RESTORE_BUSY while recover holds exclusive ownership!
    await expect(coordinator.manualCleanupUnconfirmed('u1', { confirmed: true })).rejects.toHaveProperty('code', 'RESTORE_BUSY')

    // Release recovery: MUST succeed despite ordinary UI session having changed to owner-EXPIRED/99!
    releaseRecover()
    const recRes = await recP
    expect(recRes.recovered).toBe(true)
    expect(state.blocked).toBe(false)
  })
})

describe('M6-03-R F03 & F03-03: Isolated synthetic bridge wiring & secure credentials readback failure', () => {
  it('returns null coordinator on ordinary APK / Web and wires full real bridge flow on synthetic Android', async () => {
    const state = reactive({ blocked: false, busy: false, message: '', syncError: '' })
    expect(createSyntheticPortableRestoreCoordinator({
      state,
      getOwnerIdentity: () => ({ ownerId: 'u', sessionRevision: 1 }),
      capacitor: { getPlatform: () => 'web', isPluginAvailable: () => false },
    })).toBeNull()

    expect(createSyntheticPortableRestoreCoordinator({
      state,
      getOwnerIdentity: () => ({ ownerId: 'u', sessionRevision: 1 }),
      capacitor: { getPlatform: () => 'android', isPluginAvailable: () => false },
    })).toBeNull()

    // Synthetic Android build where KanataM6RestoreBridge is registered
    const calls = []
    let txState = 'FINALIZED'
    let txDecision = ''
    let txSeq = 0
    let txRecordDigest = 'a'.repeat(64)
    let txPreparedDigest = ''
    const fakeNativeBridge = {
      probeState: vi.fn(async () => {
        calls.push('probeState')
        return {
          initialized: true,
          blocked: txState !== 'FINALIZED',
          state: txState,
          decisionDirection: txDecision,
          sequence: txSeq,
          epoch: 0,
          recordDigest: txRecordDigest,
          preparedDigest: txPreparedDigest,
          headRecord: { previousGeneration: { generationId: 'gen-prev-0', absent: false, dbSha256Hex: 'b'.repeat(64), envelopeSha256Hex: 'c'.repeat(64), datasetIdentity: 'prev', totalBusinessRows: 10, tableCount: 50 } },
          unconfirmed: [],
        }
      }),
      stageBackup: vi.fn(async () => {
        calls.push('stageBackup')
        return { descriptor: makeDescriptor({ generationId: 'gen-new-1', stagingHandle: 'stg-native-1' }), summary: { worldCount: 1, messageCount: 40 } }
      }),
      beginGateAndDrain: vi.fn(async () => {
        calls.push('beginGateAndDrain')
        txState = 'GATE'
        txSeq = 1
        txRecordDigest = 'd'.repeat(64)
        return { txnId: 'txn-1', ownerId: 'ui', epoch: 1, sequence: 1, recordDigest: txRecordDigest }
      }),
      prepareTransaction: vi.fn(async () => {
        calls.push('prepareTransaction')
        txState = 'PREPARED'
        txSeq = 2
        txRecordDigest = 'e'.repeat(64)
        txPreparedDigest = 'f'.repeat(64)
        return { sequence: 2, recordDigest: txRecordDigest, preparedDigest: txPreparedDigest }
      }),
      authenticateAndIssueCapability: vi.fn(async ({ operation }) => {
        calls.push(`authCap:${operation}`)
        return { tokenId: 'cap-1', operation, macHex: '1'.repeat(64) }
      }),
      commitDecision: vi.fn(async () => {
        calls.push('commitDecision')
        txState = 'DECISION'
        txDecision = 'target'
        txSeq = 3
        txRecordDigest = '2'.repeat(64)
        return { sequence: 3, recordDigest: txRecordDigest }
      }),
      verifyAndApplyGeneration: vi.fn(async () => {
        calls.push('verifyAndApplyGeneration')
        return { activeGenerationId: 'gen-new-1', integrityOk: true }
      }),
      finalizeTransaction: vi.fn(async () => {
        calls.push('finalizeTransaction')
        txState = 'FINALIZED'
        txSeq = 4
        txRecordDigest = '3'.repeat(64)
        return { sequence: 4, recordDigest: txRecordDigest, finalized: true, cleanupError: '' }
      }),
      cancelOrDestroyStaging: vi.fn(async () => {
        calls.push('cancelOrDestroyStaging')
        return { cancelled: true, removed: true }
      }),
    }

    const synthCoord = createSyntheticPortableRestoreCoordinator({
      state,
      getOwnerIdentity: () => ({ ownerId: 'ui', sessionRevision: 2, epoch: 1 }),
      capacitor: { getPlatform: () => 'android', isPluginAvailable: name => name === 'KanataM6RestoreBridge' },
      bridge: fakeNativeBridge,
    })
    expect(synthCoord).not.toBeNull()

    const staged = await synthCoord.stageAndVerify({ source: { uri: 'content://saf/1' }, backupPassword: BACKUP_PW, localMasterPassword: MASTER_PW })
    const committed = await synthCoord.commitStagedRestore(staged.descriptor, MASTER_PW)
    expect(committed.committed).toBe(true)
    expect(calls).toContain('stageBackup')
    expect(calls).toContain('beginGateAndDrain')
    expect(calls).toContain('prepareTransaction')
    expect(calls).toContain('authCap:APPLY_GENERATION')
    expect(calls).toContain('verifyAndApplyGeneration')
    expect(calls).toContain('authCap:COMMIT_DECISION')
    expect(calls).toContain('commitDecision')
    expect(calls).toContain('authCap:FINALIZE')
    expect(calls).toContain('finalizeTransaction')
  })

  it('F03-03: detects secure credential write and readback mismatch failures without silently treating them as success', async () => {
    // 1) Readback mismatch after setCredentials -> throws API_KEY_WRITE_VERIFICATION_FAILED
    const badReadbackCreds = createSecureCredentials({
      isNative: () => true,
      biometric: {
        setCredentials: vi.fn(async () => {}),
        getCredentials: vi.fn(async () => ({ username: 'formyself', password: 'stale-corrupted-key' })),
        isCredentialsSaved: vi.fn(async () => ({ isSaved: true })),
      },
    })
    await expect(badReadbackCreds.storeApiKey('sk-synthetic-expected')).rejects.toThrow('API_KEY_WRITE_VERIFICATION_FAILED')

    // 2) Write failure -> propagates error
    const failWriteCreds = createSecureCredentials({
      isNative: () => true,
      biometric: {
        setCredentials: vi.fn(async () => { throw new Error('KEYSTORE_WRITE_IO_ERROR') }),
      },
    })
    await expect(failWriteCreds.storeApiKey('sk-synthetic-expected')).rejects.toThrow('KEYSTORE_WRITE_IO_ERROR')
  })
})
