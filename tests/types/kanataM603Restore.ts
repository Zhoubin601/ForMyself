import { createRestoreCoordinator } from '../../src/application/restoreCoordinator.js'
import { createKanataPortableRestoreCoordinator, validateKanataGenerationDescriptor } from '../../src/application/kanataPortableRestoreCoordinator.js'
import { evaluateBackupCapability, probeBackupRuntimeCapability } from '../../src/platform/runtime/backupCapabilityProbe.js'
import type {
  BackupRuntimeCapability,
  KanataPortableRestoreCoordinatorOptions,
  KanataSqliteGenerationDescriptor,
  RestoreCoordinatorOptions,
  UnconfirmedTaskSummary,
} from '../../src/application/contracts'

declare const validCoordinatorOpts: KanataPortableRestoreCoordinatorOptions
const portableCoordinator = createKanataPortableRestoreCoordinator(validCoordinatorOpts)
void portableCoordinator

declare const baseCoordinatorOpts: RestoreCoordinatorOptions<KanataSqliteGenerationDescriptor>
const coord = createRestoreCoordinator({
  ...baseCoordinatorOpts,
  assertSession: () => {},
  onPhase: phase => { void phase },
})
void coord

const validDesc: KanataSqliteGenerationDescriptor = validateKanataGenerationDescriptor({
  kind: 'kanata-sqlite-generation-v1',
  generationId: 'gen-1',
  taskId: 'task-1',
  absent: false,
  dbPath: '/data/staging.db',
  dbSha256Hex: 'a'.repeat(64),
  schemaVersion: 5,
  applicationId: 0x4b4e5441,
  schemaFingerprint: '8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a',
  datasetIdentity: 'kds-1234',
  totalBusinessRows: 10,
  tableCount: 50,
  verified: true,
})
void validDesc

const cap: BackupRuntimeCapability = evaluateBackupCapability({
  platform: 'web',
  pluginAvailable: false,
  handshakeOk: false,
})
void cap
void probeBackupRuntimeCapability

const unconfirmed: UnconfirmedTaskSummary = {
  taskId: 'imp-1',
  kind: 'IMPORT',
  state: 'RENAMED_PENDING_DIR_SYNC',
  journalPath: '/data/.import-imp-1.pending',
  targetPath: '/data/kanata.db',
  expectedSha256Hex: 'b'.repeat(64),
  actualTargetSha256Hex: 'b'.repeat(64),
  targetExists: true,
  lockActive: false,
  shaMatches: true,
  reason: 'PENDING_DIR_FSYNC',
}
void unconfirmed

// @ts-expect-error generation descriptor schemaVersion is strictly fixed to 5
const badSchemaGen: KanataSqliteGenerationDescriptor = { ...validDesc, schemaVersion: 4 }
void badSchemaGen

// @ts-expect-error generation descriptor tableCount is strictly 50
const badTableCount: KanataSqliteGenerationDescriptor = { ...validDesc, tableCount: 45 }
void badTableCount

// @ts-expect-error unknown bridgeStatus cannot pass strict capability contract
const badBridgeStatus: BackupRuntimeCapability['bridgeStatus'] = 'assumed_ok'
void badBridgeStatus

// @ts-expect-error unknown unavailableCode cannot bypass typed capability errors
const badUnavailableCode: BackupRuntimeCapability['unavailableCode'] = 'IGNORE_WEBVIEW_52'
void badUnavailableCode

// @ts-expect-error restore phase must be a known coordinator state machine phase
const badPhase: Parameters<NonNullable<RestoreCoordinatorOptions<KanataSqliteGenerationDescriptor>['onPhase']>>[0] = 'skip_journal'
void badPhase
