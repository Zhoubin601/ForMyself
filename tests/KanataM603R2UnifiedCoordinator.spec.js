import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRestoreCoordinator } from '../src/application/restoreCoordinator.js'
import { createSyntheticPortableRestoreCoordinator } from '../src/application/kanataSyntheticRestoreWiring.js'
import { createKanataPortableRestoreRuntime } from '../src/application/kanataPortableRestoreRuntime.js'
import {
  KANATA_SQLITE_APPLICATION_ID,
  KANATA_SQLITE_GENERATION_KIND,
  KANATA_SQLITE_SCHEMA_005_FINGERPRINT,
  KANATA_SQLITE_SCHEMA_VERSION,
  KANATA_SQLITE_VERIFIER_COUNT,
} from '../src/application/kanataPortableRestoreCoordinator.js'
import { restoreState } from '../src/platform/storage/restoreState.js'

const HEX_A = 'a'.repeat(64)
const HEX_B = 'b'.repeat(64)
const HEX_C = 'c'.repeat(64)
const HEX_D = 'd'.repeat(64)
const HEX_E = 'e'.repeat(64)
const HEX_F = 'f'.repeat(64)

function createStatefulNativeBridgeMock({ failCommitOnce = false, failVerifyApplyOnce = false, failGcOnce = false } = {}) {
  const calls = []
  let seq = 0
  let state = 'FINALIZED'
  let decisionDirection = 'none'
  let txnId = ''
  let ownerId = 'system-init'
  let epoch = 0
  let preparedDigest = ''
  let recordDigest = HEX_A
  let activeGenerationId = 'gen-prev'
  let previousGen = {
    generationId: 'gen-prev',
    absent: false,
    relativeDir: 'generations/gen-prev',
    dbSha256Hex: HEX_A,
    envelopeSha256Hex: HEX_B,
    schemaFingerprint: KANATA_SQLITE_SCHEMA_005_FINGERPRINT,
    datasetIdentity: 'prev-dataset',
    totalBusinessRows: 15,
    tableCount: 50,
  }
  let targetGen = null
  let verifiedReceipt = false
  let commitFailedOnce = false
  let verifyFailedOnce = false
  let gcFailedOnce = false
  const registeredHandles = new Map()

  const bridge = {
    calls,
    getState: () => ({ seq, state, decisionDirection, txnId, activeGenerationId, verifiedReceipt }),
    async probeState() {
      calls.push('probeState')
      return {
        initialized: true,
        blocked: state !== 'FINALIZED',
        state,
        decisionDirection,
        txnId,
        ownerId,
        epoch,
        sequence: seq,
        recordDigest,
        preparedDigest,
        activeGenerationId,
        legacyInventory: { clean: true, status: 'CLEAN' },
        headRecord: {
          previousGeneration: previousGen,
          targetGeneration: targetGen,
        },
        unconfirmed: [],
      }
    },
    async stageBackup(req) {
      calls.push('stageBackup')
      const genId = `gen-staged-${registeredHandles.size + 1}`
      const handle = `stg-${registeredHandles.size + 1}`
      const desc = {
        kind: KANATA_SQLITE_GENERATION_KIND,
        generationId: genId,
        taskId: `task-${registeredHandles.size + 1}`,
        absent: false,
        dbPath: `generations/${genId}/kanata.db`,
        dbSha256Hex: HEX_C,
        envelopePath: `generations/${genId}/envelope.json`,
        envelopeSha256Hex: HEX_D,
        stagingHandle: handle,
        schemaVersion: KANATA_SQLITE_SCHEMA_VERSION,
        applicationId: KANATA_SQLITE_APPLICATION_ID,
        schemaFingerprint: KANATA_SQLITE_SCHEMA_005_FINGERPRINT,
        datasetIdentity: 'target-dataset',
        totalBusinessRows: 60,
        tableCount: KANATA_SQLITE_VERIFIER_COUNT,
        transcriptHex: HEX_E,
        verified: true,
      }
      registeredHandles.set(handle, {
        gen: {
          generationId: genId,
          absent: false,
          relativeDir: `generations/${genId}`,
          dbSha256Hex: HEX_C,
          envelopeSha256Hex: HEX_D,
          schemaFingerprint: KANATA_SQLITE_SCHEMA_005_FINGERPRINT,
          datasetIdentity: 'target-dataset',
          totalBusinessRows: 60,
          tableCount: 50,
        },
        ownerId: req.ownerId,
      })
      return {
        stagingHandle: handle,
        descriptor: desc,
        summary: { worldCount: 1, messageCount: 60, dekFingerprintHex: HEX_F },
        metrics: { totalRestoreMs: 120 },
      }
    },
    async beginGateAndDrain(req) {
      calls.push('beginGateAndDrain')
      if (state !== 'FINALIZED') throw Object.assign(new Error('CAS_ILLEGAL_EDGE'), { code: 'CAS_ILLEGAL_EDGE' })
      seq += 1
      state = 'GATE'
      decisionDirection = 'none'
      txnId = req.txnId
      ownerId = req.ownerId
      epoch = req.epoch
      recordDigest = HEX_B
      preparedDigest = ''
      verifiedReceipt = false
      return { txnId, ownerId, epoch, sequence: seq, recordDigest }
    },
    async prepareTransaction(req) {
      calls.push('prepareTransaction')
      if (state !== 'GATE') throw Object.assign(new Error('CAS_ILLEGAL_EDGE'), { code: 'CAS_ILLEGAL_EDGE' })
      const reg = registeredHandles.get(req.stagingHandle)
      if (!reg) throw Object.assign(new Error('STAGING_REGISTRATION_MISSING'), { code: 'STAGING_NOT_REGISTERED' })
      seq += 1
      state = 'PREPARED'
      targetGen = reg.gen
      preparedDigest = HEX_E
      recordDigest = HEX_C
      return { sequence: seq, recordDigest, preparedDigest }
    },
    async authenticateAndIssueCapability(req) {
      calls.push(`authenticateAndIssueCapability:${req.operation}`)
      // R01.3: Strictly enforce Native capability state rules!
      if (req.operation === 'COMMIT_DECISION' && state !== 'PREPARED') {
        throw Object.assign(new Error('RECOVERY_CAPABILITY_STATE_INVALID'), { code: 'RECOVERY_CAPABILITY_STATE_INVALID' })
      }
      if ((req.operation === 'APPLY_GENERATION' || req.operation === 'FINALIZE') && state !== 'DECISION') {
        throw Object.assign(new Error('RECOVERY_CAPABILITY_STATE_INVALID'), { code: 'RECOVERY_CAPABILITY_STATE_INVALID' })
      }
      if (req.localMasterPassword !== 'Synthetic-Master-R2') {
        throw Object.assign(new Error('AUTH_FAILED'), { code: 'AUTH_FAILED' })
      }
      return {
        tokenId: 'cap-1',
        txnId: req.txnId,
        participantId: req.participantId,
        operation: req.operation,
        generationId: req.generationId,
        ownerId: req.ownerId,
        epoch: req.epoch,
      }
    },
    async commitDecision(req) {
      calls.push(`commitDecision:${req.direction}`)
      if (state !== 'PREPARED') throw Object.assign(new Error('CAS_ILLEGAL_EDGE'), { code: 'CAS_ILLEGAL_EDGE' })
      if (failCommitOnce && !commitFailedOnce) {
        commitFailedOnce = true
        throw Object.assign(new Error('IO_FAILED'), { code: 'IO_FAILED' })
      }
      seq += 1
      state = 'DECISION'
      decisionDirection = req.direction
      activeGenerationId = req.direction === 'target' ? targetGen.generationId : previousGen.generationId
      recordDigest = HEX_D
      return { sequence: seq, recordDigest, activeGenerationId }
    },
    async verifyAndApplyGeneration() {
      calls.push('verifyAndApplyGeneration')
      // R01.3: Must NEVER be invoked in PREPARED!
      if (state !== 'DECISION') {
        throw Object.assign(new Error('RECOVERY_CAPABILITY_STATE_INVALID'), { code: 'RECOVERY_CAPABILITY_STATE_INVALID' })
      }
      if (failVerifyApplyOnce && !verifyFailedOnce) {
        verifyFailedOnce = true
        throw Object.assign(new Error('IO_FAILED'), { code: 'IO_FAILED' })
      }
      verifiedReceipt = true
      return { activeGenerationId, verified: true, integrityOk: true }
    },
    async finalizeTransaction() {
      calls.push('finalizeTransaction')
      if (state !== 'DECISION') throw Object.assign(new Error('CAS_ILLEGAL_EDGE'), { code: 'CAS_ILLEGAL_EDGE' })
      if (!verifiedReceipt) {
        throw Object.assign(new Error('FINALIZE_UNVERIFIED_GENERATION'), { code: 'FINALIZE_UNVERIFIED_GENERATION' })
      }
      seq += 1
      state = 'FINALIZED'
      if (decisionDirection === 'target') {
        previousGen = targetGen
      }
      recordDigest = HEX_F
      return { sequence: seq, recordDigest, finalized: true, cleanupError: '' }
    },
    async prepareRecoveryDecision(req) {
      calls.push('prepareRecoveryDecision')
      if (req.localMasterPassword !== 'Synthetic-Master-R2') {
        throw Object.assign(new Error('AUTH_FAILED'), { code: 'AUTH_FAILED' })
      }
      if (state === 'FINALIZED') {
        return { alreadyFinalized: true, direction: 'none' }
      }
      if (state === 'GATE' || state === 'PREPARED') {
        state = 'DECISION'
        decisionDirection = 'previous'
        activeGenerationId = previousGen.generationId
      }
      // Irreversible: DECISION(target) stays target!
      ownerId = req.ownerId
      epoch += 1
      seq += 1
      recordDigest = HEX_E
      return {
        alreadyFinalized: false,
        direction: decisionDirection,
        txnId,
        ownerId,
        epoch,
        sequence: seq,
        recordDigest,
        preparedDigest,
        activeGenerationId,
        headRecord: {
          previousGeneration: previousGen,
          targetGeneration: targetGen,
        },
      }
    },
    async recoverAuthoritative(req) {
      calls.push('recoverAuthoritative')
      if (req.localMasterPassword !== 'Synthetic-Master-R2') {
        throw Object.assign(new Error('AUTH_FAILED'), { code: 'AUTH_FAILED' })
      }
      if (state === 'GATE' || state === 'PREPARED') {
        state = 'FINALIZED'
        decisionDirection = 'previous'
        activeGenerationId = previousGen.generationId
      } else if (state === 'DECISION') {
        state = 'FINALIZED'
        activeGenerationId = decisionDirection === 'target' ? targetGen.generationId : previousGen.generationId
      }
      return { recovered: true, blocked: false, convergedDirection: decisionDirection }
    },
    async cancelOrDestroyStaging(req) {
      calls.push(`cancelOrDestroyStaging:${req.generationId}`)
      if (state !== 'FINALIZED' && (req.generationId === previousGen?.generationId || req.generationId === targetGen?.generationId)) {
        throw Object.assign(new Error('MATERIAL_REFERENCED_BY_TX'), { code: 'MATERIAL_REFERENCED_BY_TX' })
      }
      if (failGcOnce && !gcFailedOnce) {
        gcFailedOnce = true
        throw Object.assign(new Error('TX_GC_FAILED'), { code: 'TX_GC_FAILED' })
      }
      return { cancelled: true, removed: true }
    },
  }
  return bridge
}

describe('M6-03-R2 R01 Unified RestoreCoordinator & Native State Machine', () => {
  const androidCapacitor = {
    getPlatform: () => 'android',
    isPluginAvailable: name => name === 'KanataM6RestoreBridge',
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    restoreState.blocked = false
    restoreState.busy = false
    restoreState.message = ''
    restoreState.syncError = ''
  })

  it('R01.1/R01.3/R01.4/R01.5: decision_then_apply executes GATE -> PREPARED -> DECISION -> verifyAndApply -> FINALIZED -> GC in exact order', async () => {
    const bridge = createStatefulNativeBridgeMock()
    const state = { blocked: false, busy: false, message: '', syncError: '' }
    const coordinator = createSyntheticPortableRestoreCoordinator({
      state,
      getOwnerIdentity: () => ({ ownerId: 'settings-ui', sessionRevision: 1, epoch: 1 }),
      capacitor: androidCapacitor,
      bridge,
    })
    const runtime = createKanataPortableRestoreRuntime({
      probeCapability: async () => ({
        platform: 'android',
        checkedAt: Date.now(),
        androidApi: 34,
        androidRelease: '14',
        webviewPackage: 'com.android.webview',
        webviewVersion: '113.0',
        webviewMajorVersion: 113,
        bridgeStatus: 'ready',
        bridgeHandshakeOk: true,
        sqlitePluginStatus: 'ready',
        safStatus: 'available',
        portableRestoreAvailable: true,
        unavailableCode: '',
        unavailableReason: '',
      }),
      coordinator,
    })

    runtime.selectBackupFile({ name: 'target.kpb1', uri: 'content://synthetic/target.kpb1' })
    expect(await runtime.startStaging({ backupPassword: 'bpw', localMasterPassword: 'Synthetic-Master-R2' })).toBe(true)
    expect(runtime.state.phase).toBe('awaiting_confirmation')

    const committed = await runtime.confirmCommitRestore({ localMasterPassword: 'Synthetic-Master-R2' })
    expect(committed).toBe(true)
    expect(runtime.state.phase).toBe('succeeded')
    expect(runtime.state.completionResult?.committed).toBe(true)
    expect(runtime.state.failureStage).toBe('')
    expect(state.blocked).toBe(false)

    // Verify exact Native ordering: commitDecision strictly BEFORE verifyAndApplyGeneration, and verifyAndApplyGeneration strictly BEFORE finalizeTransaction!
    const idxPrepare = bridge.calls.indexOf('prepareTransaction')
    const idxCommit = bridge.calls.indexOf('commitDecision:target')
    const idxApply = bridge.calls.indexOf('verifyAndApplyGeneration')
    const idxFinalize = bridge.calls.indexOf('finalizeTransaction')
    const idxGc = bridge.calls.findIndex(c => c.startsWith('cancelOrDestroyStaging:'))
    expect(idxPrepare).toBeGreaterThan(-1)
    expect(idxCommit).toBeGreaterThan(idxPrepare)
    expect(idxApply).toBeGreaterThan(idxCommit)
    expect(idxFinalize).toBeGreaterThan(idxApply)
    expect(idxGc).toBeGreaterThan(idxFinalize)
    expect(bridge.getState().activeGenerationId).toBe('gen-staged-1')
  })

  it('R01.8: pre-commit failure aborts cleanly without invoking verifyAndApplyGeneration or openRestoreRecord', async () => {
    const bridge = createStatefulNativeBridgeMock({ failCommitOnce: true })
    const state = { blocked: false, busy: false, message: '', syncError: '' }
    const coordinator = createSyntheticPortableRestoreCoordinator({
      state,
      getOwnerIdentity: () => ({ ownerId: 'settings-ui', sessionRevision: 1, epoch: 1 }),
      capacitor: androidCapacitor,
      bridge,
    })
    const runtime = createKanataPortableRestoreRuntime({
      probeCapability: async () => ({
        platform: 'android',
        checkedAt: Date.now(),
        androidApi: 34,
        androidRelease: '14',
        webviewPackage: 'com.android.webview',
        webviewVersion: '113.0',
        webviewMajorVersion: 113,
        bridgeStatus: 'ready',
        bridgeHandshakeOk: true,
        sqlitePluginStatus: 'ready',
        safStatus: 'available',
        portableRestoreAvailable: true,
        unavailableCode: '',
        unavailableReason: '',
      }),
      coordinator,
    })

    runtime.selectBackupFile({ name: 'target.kpb1', uri: 'content://synthetic/target.kpb1' })
    expect(await runtime.startStaging({ backupPassword: 'bpw', localMasterPassword: 'Synthetic-Master-R2' })).toBe(true)
    expect(await runtime.confirmCommitRestore({ localMasterPassword: 'Synthetic-Master-R2' })).toBe(false)

    expect(runtime.state.failureStage).toBe('pre_commit')
    expect(bridge.calls).not.toContain('verifyAndApplyGeneration')
    expect(bridge.calls).toContain('recoverAuthoritative')
    expect(bridge.getState().state).toBe('FINALIZED')
    expect(bridge.getState().activeGenerationId).toBe('gen-prev')
    expect(state.blocked).toBe(false)
  })

  it('R01.6/R01.7/R01.8: post-decision failure NEVER reverses direction and cold-start RestoreCoordinator.recover() converges via resolveRecovery without openRestoreRecord', async () => {
    const bridge = createStatefulNativeBridgeMock({ failVerifyApplyOnce: true })
    const state = { blocked: false, busy: false, message: '', syncError: '' }
    const coordinator = createSyntheticPortableRestoreCoordinator({
      state,
      getOwnerIdentity: () => ({ ownerId: 'settings-ui', sessionRevision: 1, epoch: 1 }),
      capacitor: androidCapacitor,
      bridge,
    })
    const runtime = createKanataPortableRestoreRuntime({
      probeCapability: async () => ({
        platform: 'android',
        checkedAt: Date.now(),
        androidApi: 34,
        androidRelease: '14',
        webviewPackage: 'com.android.webview',
        webviewVersion: '113.0',
        webviewMajorVersion: 113,
        bridgeStatus: 'ready',
        bridgeHandshakeOk: true,
        sqlitePluginStatus: 'ready',
        safStatus: 'available',
        portableRestoreAvailable: true,
        unavailableCode: '',
        unavailableReason: '',
      }),
      coordinator,
    })

    runtime.selectBackupFile({ name: 'target.kpb1', uri: 'content://synthetic/target.kpb1' })
    expect(await runtime.startStaging({ backupPassword: 'bpw', localMasterPassword: 'Synthetic-Master-R2' })).toBe(true)
    expect(await runtime.confirmCommitRestore({ localMasterPassword: 'Synthetic-Master-R2' })).toBe(false)

    // Direction must stay target in DECISION state; barrier stays active; failureStage === 'post_decision'
    expect(runtime.state.failureStage).toBe('post_decision')
    expect(state.blocked).toBe(true)
    expect(bridge.getState().state).toBe('DECISION')
    expect(bridge.getState().decisionDirection).toBe('target')
    expect(bridge.calls).not.toContain('commitDecision:previous')

    // Simulate cold-start restart with a fresh coordinator (no activeNativeTx in memory) -> RestoreCoordinator.recover()!
    const restartedState = { blocked: true, busy: false, message: 'pending', syncError: '' }
    const restartedCoordinator = createSyntheticPortableRestoreCoordinator({
      state: restartedState,
      getOwnerIdentity: () => ({ ownerId: 'cold-start-recovery', sessionRevision: 99, epoch: 5 }),
      capacitor: androidCapacitor,
      bridge,
    })
    const rec = await restartedCoordinator.recover('Synthetic-Master-R2')
    expect(rec.recovered).toBe(true)
    expect(rec.blocked).toBe(false)
    expect(restartedState.blocked).toBe(false)
    expect(bridge.getState().state).toBe('FINALIZED')
    expect(bridge.getState().activeGenerationId).toBe('gen-staged-1')
    expect(bridge.calls).toContain('prepareRecoveryDecision')
  })

  it('R01.8: post-FINALIZED cleanup failure keeps committed=true and separates failureStage=post_finalize_cleanup', async () => {
    const bridge = createStatefulNativeBridgeMock({ failGcOnce: true })
    const state = { blocked: false, busy: false, message: '', syncError: '' }
    const coordinator = createSyntheticPortableRestoreCoordinator({
      state,
      getOwnerIdentity: () => ({ ownerId: 'settings-ui', sessionRevision: 1, epoch: 1 }),
      capacitor: androidCapacitor,
      bridge,
    })
    const runtime = createKanataPortableRestoreRuntime({
      probeCapability: async () => ({
        platform: 'android',
        checkedAt: Date.now(),
        androidApi: 34,
        androidRelease: '14',
        webviewPackage: 'com.android.webview',
        webviewVersion: '113.0',
        webviewMajorVersion: 113,
        bridgeStatus: 'ready',
        bridgeHandshakeOk: true,
        sqlitePluginStatus: 'ready',
        safStatus: 'available',
        portableRestoreAvailable: true,
        unavailableCode: '',
        unavailableReason: '',
      }),
      coordinator,
    })

    runtime.selectBackupFile({ name: 'target.kpb1', uri: 'content://synthetic/target.kpb1' })
    await runtime.startStaging({ backupPassword: 'bpw', localMasterPassword: 'Synthetic-Master-R2' })
    expect(await runtime.confirmCommitRestore({ localMasterPassword: 'Synthetic-Master-R2' })).toBe(true)
    expect(runtime.state.completionResult?.committed).toBe(true)
    expect(runtime.state.cleanupError).toContain('TX_GC_FAILED')
    expect(runtime.state.failureStage).toBe('post_finalize_cleanup')
    expect(state.blocked).toBe(false)

    // Retry cleanup clears cleanupError & failureStage without re-importing
    expect(await runtime.retryCleanup()).toBe(true)
    expect(runtime.state.cleanupError).toBe('')
    expect(runtime.state.failureStage).toBe('')
  })

  it('R01.2: default commitStrategy preserves legacy apply_then_commit order for JSON restore compatibility', async () => {
    const order = []
    const state = { blocked: false, busy: false, message: '', syncError: '' }
    const coord = createRestoreCoordinator({
      state,
      journal: {
        inspect: async () => null,
        prepare: async () => { order.push('journal.prepare'); return { digest: HEX_A } },
        commit: async () => { order.push('journal.commit') },
        clear: async () => { order.push('journal.clear') },
      },
      prepare: async () => { order.push('prepare') },
      capture: async () => ({ v: 'prev' }),
      apply: async snap => { order.push(`apply:${snap.v}`) },
      validate: x => x,
    })
    await coord.restore({ v: 'target' }, 'pw')
    expect(order).toEqual(['prepare', 'journal.prepare', 'apply:target', 'journal.commit', 'journal.clear'])
  })

  it('R03.3: auth & settings credential/preference writes are blocked while restoreState.blocked is true', async () => {
    const { useAuthStore } = await import('../src/stores/auth.js')
    const authStore = useAuthStore()
    restoreState.blocked = true
    const provisioned = await authStore.enableBiometricUnlock('Synthetic-Master-R2')
    expect(provisioned).toBe(false)
  })
})
