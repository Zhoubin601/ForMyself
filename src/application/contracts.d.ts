import type { Component } from 'vue'
export type {KanataSqlValue, KanataSqlRow, KanataSchemaTransaction, KanataSchemaConnection,
  KanataSchemaMigration, KanataSchemaResult, KanataSchemaMigrationOptions} from '../features/chat/storage/sqlite/kanataSchemaTypes'
export type KanataSchemaMigrator = typeof import('../features/chat/storage/sqlite/kanataSchemaMigrator.js').migrateKanataSchema
export type { KanataDataMigrationSource, KanataDataMigratorOptions } from '../features/chat/storage/sqlite/kanataMigrationTypes'
export type { KanataSqliteWriteResult, KanataSqliteTransaction, KanataSqliteHealth,
  KanataSqliteOperation, KanataSqliteContext, KanataSqliteDriver } from '../platform/storage/kanataSqliteTypes'
export type { KanataReplyProvenance, KanataMessageWriteReceipt, KanataMessageState, KanataMessageScope, KanataMessageCursor, KanataMessagePage, KanataMessageRepository, KanataHistoryCursor, KanataHistoryPage, KanataHistoryArchivePlan,
  KanataConversationRepository, KanataGroupMemberEdit, KanataTranscriptMessage, KanataMessagePreview, KanataMessageDetailIdentity,
  KanataMessageSourceCursor, KanataMessageJsonSelection, KanataMessageJsonCursor, KanataMessageTextCursor, KanataReplyExpectation,
  KanataChatContextState, KanataDeferredReply } from '../features/chat/storage/sqlite/kanataRepositoryTypes'
export type { KanataSqliteDomains, KanataSqliteDomainOwner, KanataEventAcknowledgement, KanataEventGraphCursor,
  KanataTaskHeader, KanataTaskListCursor, KanataTaskReadIdentity, KanataTaskRelationKind,
  KanataTaskRelationCursor, KanataTaskJsonField, KanataTaskJsonCursor, KanataTaskReadRepository,
  KanataEventReadScope, KanataEventRelationKind, KanataEventRelationCursor, KanataEventReadCursor,
  KanataEventJsonSelection, KanataEventJsonCursor, KanataRelationshipEventCursor, KanataMemorySourceCursor,
  KanataEventRevocationPlan, KanataEventRevocationCursor, KanataEventRevocationDecision, KanataEventEffectAuditCursor, KanataEventEffectAuditField, KanataEventEffectAuditEntry, KanataEventEffectAuditJsonCursor,
  KanataMemoryConflictPlan, KanataMemoryConflictCursor,
  KanataMemoryPromptProjection, KanataOutgoingMemoryShareCursor } from '../features/chat/storage/sqlite/kanataDomainTypes'
/** Candidate application event APIs use acknowledgements, pages and compact plans; no legacyEvents facade. */
export type KanataSqliteWorldRuntime = ReturnType<typeof import('./kanataSqliteWorldRuntime.js').createKanataSqliteWorldRuntime>
export type KanataChatViewModel = ReturnType<typeof import('../features/chat/kanataChatViewModel.js').createKanataChatViewModel>
export type KanataSqliteChatRuntime = ReturnType<typeof import('./kanataSqliteChatRuntime.js').createKanataSqliteChatRuntime>
export type { KanataData, World, CharacterCard, CharacterCardVersion, CharacterInstance,
  WorldPreset, WorldUserIdentity, Conversation, GroupReplyLimits, ReplyTimingPolicy, Message, LorebookEntry, Memory,
  Relationship, WorldEvent, WorldEffect, BackgroundTask, LifeGrant, SeedOptions } from '../features/chat/domain/kanataTypes'

export interface ModuleDescriptor {
  id: string
  title: string
  loadView(): Promise<Component | { default: Component }>
  label?: string
  meta?: string
  icon?: string
  name?: string
  cache?: boolean
  access?: 'protected'
  settings?: string
  backup?: { id: string; label: string; prefix: string }
  enabled?(context: { warmHomeEnabled?: boolean }): boolean
  bindings?(context: Record<string, any>): Record<string, unknown>
}
export interface BackupPart { data: unknown; metadata?: any }
export interface BackupParticipant {
  id: string
  optional?: boolean
  ready(): boolean
  initialize?(): unknown
  /** Materialize external encrypted pages before synchronous capture/export. Failure aborts export. */
  prepareExport?(): Promise<unknown>
  /** export() already returns a detached inert DTO; registry may omit a second JSON serialize/parse. */
  detachedExport?: boolean
  export(): BackupPart
  restore(part: BackupPart): unknown
  flush(): unknown
  validate?(part: BackupPart): void
  singleExport?(): unknown
  import?(value: unknown, options: { overwrite: boolean }): unknown
  synchronize?(): unknown
}
export interface PreferenceDriver {
  get(options: { key: string }): Promise<{ value: string | null }>
  set(options: { key: string; value: string }): Promise<unknown>
  remove?(options: { key: string }): Promise<unknown>
  flush?(): Promise<unknown>
}
export interface PreferenceRepository extends PreferenceDriver {
  remove(options: { key: string }): Promise<unknown>
  flush(): Promise<void>
}
export interface LifecycleParticipant {
  id: string
  initialize?(): unknown
  resume?(): unknown
  flush?(): unknown
  subscribe?(): (() => void) | void
  dispose?(): void
}
export interface NativeListenerHandle { remove(): void | Promise<void> }
export interface NativeListenerPlugin {
  addListener(event: string, listener: (...args: any[]) => unknown): Promise<NativeListenerHandle>
}
export type RestoreCoordinatorPhase =
  | 'idle'
  | 'capability_check'
  | 'reading_kpb1'
  | 'authenticating'
  | 'staging_import'
  | 'verifying_staging'
  | 'awaiting_confirmation'
  | 'coordinator_prepare'
  | 'journal_persisting'
  | 'applying'
  | 'rolling_back'
  | 'committing'
  | 'clearing_journal'
  | 'synchronizing'
  | 'succeeded'
  | 'failed'
  | 'rollback_failed'
  | 'cancelled'
  | 'unconfirmed'
  | 'manual_verification_required'

export type RestoreCommitStrategy = 'apply_then_commit' | 'decision_then_apply'

export interface RestoreRecoveryPlan<Snapshot> {
  direction: 'previous' | 'target' | 'none'
  snapshot?: Snapshot
  alreadyFinalized?: boolean
}

export interface RestoreState { blocked: boolean; busy: boolean; message: string; syncError: string }
export interface RestoreRecord<Snapshot> { version: 1; previous: Snapshot; target: Snapshot }
export type {RestoreCipherEnvelope,CompressedRestorePayload} from '../platform/storage/restorePayloadTypes'
export interface RestoreJournal<Snapshot> {
  inspect(): Promise<{ encrypted: string; committed: boolean; digest: string } | null>
  prepare(record: RestoreRecord<Snapshot>, password: string): Promise<void | {digest:string}>
  commit(expectedDigest?: string): Promise<void>
  clear(): Promise<void>
  /** Optional Native durable control abort for undecided GATE/PREPARED transactions (never decodes legacy AES-GCM JSON). */
  abortPrepared?(expectedDigest: string, password: string): Promise<void>
  /** Optional Native durable control cold-start recovery resolver (never calls legacy openRestoreRecord). */
  resolveRecovery?(password: string): Promise<RestoreRecoveryPlan<Snapshot>>
}
export interface RestoreCoordinatorOptions<Snapshot> {
  journal: RestoreJournal<Snapshot>
  /** Release the captured rollback graph only after its complete encrypted journal is durable;
   * compensation reopens the same uncommitted digest and validates its previous image. */
  journalRollback?: boolean
  /** Transaction execution strategy:
   * - 'apply_then_commit' (default): legacy JSON restore (`prepare -> journal.prepare -> apply -> commit -> clear`).
   * - 'decision_then_apply': Native durable generation restore (`prepare -> journal.prepare -> commit(DECISION) -> apply(verify selected) -> clear(FINALIZED)`). */
  commitStrategy?: RestoreCommitStrategy
  state: RestoreState
  prepare(options?: { recovering?: boolean }): Promise<unknown>
  capture(): Snapshot | Promise<Snapshot>
  apply(snapshot: Snapshot): Promise<unknown>
  validate(value: unknown): Snapshot
  validateRecovery?(value: unknown): Snapshot
  synchronize?(): Promise<unknown>
  assertSession?(): void
  onPhase?(phase: RestoreCoordinatorPhase): void
}

export type BackupCapabilityUnavailableCode =
  | ''
  | 'UNSUPPORTED_PLATFORM'
  | 'WEBVIEW_BELOW_CAPACITOR_FLOOR'
  | 'BRIDGE_UNAVAILABLE'
  | 'HANDSHAKE_FAILED'
  | 'HANDSHAKE_TIMEOUT'
  | 'HANDSHAKE_NONCE_MISMATCH'
  | 'SQLITE_PLUGIN_MISSING'
  | 'SQLITE_PLUGIN_NOT_ACTIVATED'
  | 'SAF_UNAVAILABLE'
  | 'WEB_KPB1_RESTORE_UNAVAILABLE'

export interface BackupRuntimeCapability {
  platform: 'web' | 'android' | 'ios' | 'unknown'
  checkedAt: number
  androidApi: number | null
  androidRelease: string
  webviewPackage: string
  webviewVersion: string
  webviewMajorVersion: number | null
  bridgeStatus: 'ready' | 'unavailable' | 'blocked_webview' | 'handshake_failed' | 'not_applicable'
  bridgeHandshakeOk: boolean
  sqlitePluginStatus: 'ready' | 'registered_not_activated' | 'missing' | 'web_encrypted_file_adapter'
  safStatus: 'available' | 'unavailable' | 'browser_file_api'
  portableRestoreAvailable: boolean
  unavailableCode: BackupCapabilityUnavailableCode
  unavailableReason: string
}

export interface KanataSqliteGenerationDescriptor {
  readonly kind: 'kanata-sqlite-generation-v1'
  readonly generationId: string
  readonly taskId: string
  readonly absent: boolean
  readonly dbPath: string
  readonly dbSha256Hex: string
  readonly envelopePath?: string
  readonly envelopeSha256Hex?: string
  readonly stagingHandle?: string
  readonly schemaVersion: 5
  readonly applicationId: 0x4b4e5441
  readonly schemaFingerprint: string
  readonly datasetIdentity: string
  readonly totalBusinessRows: number
  readonly tableCount: 50
  readonly transcriptHex?: string
  readonly verified: boolean
}

export interface UnconfirmedTaskSummary {
  taskId: string
  kind: 'EXPORT' | 'IMPORT' | 'UNKNOWN'
  state: string
  journalPath: string
  targetPath: string
  expectedSha256Hex: string
  actualTargetSha256Hex: string
  targetExists: boolean
  lockActive: boolean
  shaMatches: boolean
  reason: string
}

export interface UnconfirmedManualActionResult {
  taskId: string
  resolved: boolean
  outcome: string
  reason: string
}

export interface KanataPortableStageRequest {
  source: unknown
  backupPassword: string
  localMasterPassword?: string
  ownerId?: string
  sessionRevision?: number
  epoch?: number
  signal?: AbortSignal
  onProgress?: (progress: { phase: RestoreCoordinatorPhase; percent: number }) => void
}

export interface KanataPortableRestoreEngine {
  stageAndVerify(request: KanataPortableStageRequest): Promise<{
    descriptor: KanataSqliteGenerationDescriptor
    summary?: { worldCount: number; messageCount: number; dekFingerprintHex?: string }
    metrics?: Record<string, unknown>
  }>
  verifyStagingRegistration?(
    descriptor: KanataSqliteGenerationDescriptor,
    binding: { ownerId: string; sessionRevision: number; epoch: number },
  ): Promise<unknown>
  destroyStaging?(descriptor: KanataSqliteGenerationDescriptor): Promise<unknown>
  prepareWriteDrain(options?: { recovering?: boolean; ownerId?: string; epoch?: number }): Promise<unknown>
  capturePreviousGeneration(): Promise<KanataSqliteGenerationDescriptor>
  applyGeneration(
    descriptor: KanataSqliteGenerationDescriptor,
    options?: { recoveryMode?: boolean; ownerId?: string; epoch?: number },
  ): Promise<unknown>
  finalizeArtifacts?(artifacts: {
    previous: KanataSqliteGenerationDescriptor | null
    target: KanataSqliteGenerationDescriptor
  }): Promise<unknown>
  recoverAuthoritative?(localMasterPassword: string): Promise<{
    recovered: boolean
    blocked: boolean
    convergedDirection?: string
    cleanupError?: string
  }>
  inspectUnconfirmed?(): Promise<UnconfirmedTaskSummary[]>
  reverifyUnconfirmed?(taskId: string): Promise<UnconfirmedManualActionResult>
  manualCleanupUnconfirmed?(
    taskId: string,
    options: { confirmed: boolean; restoreJournalPending: boolean },
  ): Promise<UnconfirmedManualActionResult>
}

export interface KanataPortableRestoreCoordinatorOptions {
  journal: RestoreJournal<KanataSqliteGenerationDescriptor>
  state: RestoreState
  engine: KanataPortableRestoreEngine
  commitStrategy?: RestoreCommitStrategy
  getOwnerIdentity?: () => { ownerId: string; sessionRevision: number; epoch?: number }
  synchronize?: () => Promise<unknown>
  onPhase?: (phase: RestoreCoordinatorPhase) => void
}
export interface FullBackupDTO {
  type: 'formyself-full-backup'
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
  createdAt: string
  data: {
    savings: Record<string, unknown>[]
    weight: Record<string, unknown>[]
    mood: Record<string, unknown>[]
    passwords: Record<string, unknown>[]
    schedules: Record<string, any>
    chat: Record<string, any>
    todos?: Record<string, any>
  }
  metadata: { savings: Record<string, any>; mood: Record<string, any>; vault: Record<string, any> }
  settings: Record<string, any>
}

// Kanata P2 contracts are sourced from the actual adapters; legacy FullBackupDTO stays v1-v12.
export type { KanataReadResult, KanataFilesystem, KanataJournal } from '../features/chat/storage/kanataRepositoryTypes'
export type { KanataChatBackup, KanataFullBackup, KanataRestoreSnapshot } from '../features/chat/backup/kanataBackup.js'
export type KanataRepository = ReturnType<typeof import('../features/chat/storage/kanataRepository.js').createKanataRepository>
export type { ParsedCharacterCard, ImportedCardAsset, CardLoreCandidate } from '../features/chat/cards/characterCardTypes'
export type KanataManagement = ReturnType<typeof import('./kanataManagement.js').createKanataManagement>
export type KanataFeedbackOwner = Parameters<typeof import('../services/uiFeedback.js').cancelOwnedFeedbackDialog>[0]
export type { CompletionOptions, CompletionAttempt, CompletionUsage } from '../platform/ai/completionTypes'
export type { KanataUsageEvent } from '../features/chat/domain/kanataTypes'
export type { MessageArchiveDescriptor, MessageHistoryRequest } from '../features/chat/domain/kanataTypes'
/** reencrypt verifies old plaintext and exact new read-back before its caller commits headers. */
export type KanataArchiveRepository = ReturnType<typeof import('../features/chat/storage/messageArchiveRepository.js').createMessageArchiveRepository>
/** Pure explicit-data crypto helpers used by archive I/O; no Store or retained credentials. */
export type ArchiveTextFingerprint = typeof import('../shared/crypto/sha256Text.js').sha256TextAsync
export type StrictUtf8Encoder = typeof import('../shared/crypto/utf8Words.js').utf8Bytes
/** Internal checked immutable DTO factory; it cannot confer trust through wire flags. */
export type ImmutableKanataFactory = typeof import('../features/chat/domain/kanataValidation.js').ownImmutableKanataData
export type {ArchiveFileCommand,ArchiveFileResult,ArchiveFileBatchDriver,ArchiveFilesystemDriver} from '../platform/storage/archiveFileBatchTypes'
export type KanataChatRuntime = ReturnType<typeof import('./kanataChatRuntime.js').createKanataChatRuntime>
export type {LifeSource,MemoryPolicy,RoleBinding,KanataRoleBindings,EffectBaseline,EventAudit} from '../features/chat/domain/kanataTypes'
export type KanataExperienceRuntime = ReturnType<typeof import('./kanataExperienceRuntime.js').createKanataExperienceRuntime>
export type {MessageAudit} from '../features/chat/domain/kanataTypes'
export type KanataLifeCompanion = ReturnType<typeof import('./kanataLifeCompanion.js').createKanataLifeCompanion>
export type KanataLifeReaders = Parameters<typeof import('./kanataLifeContext.js').collectKanataLifeContext>[2]
export type {AutonomyPolicy,VirtualSchedule} from '../features/chat/domain/kanataTypes'
export type KanataSqliteWorldRuntime = ReturnType<typeof import('./kanataSqliteWorldRuntime.js').createKanataSqliteWorldRuntime>
export type KanataSqliteAutonomyRuntime = ReturnType<typeof import('./kanataSqliteAutonomyRuntime.js').createKanataSqliteAutonomyRuntime>
export type KanataSqliteLifeCompanion = ReturnType<typeof import('./kanataSqliteLifeCompanion.js').createKanataSqliteLifeCompanion>
export type KanataWorldRuntime = ReturnType<typeof import('./kanataWorldRuntime.js').createKanataWorldRuntime>
export type KanataSocialRuntime = ReturnType<typeof import('./kanataSocialRuntime.js').createKanataSocialRuntime>
export type KanataContactRuntime = ReturnType<typeof import('./kanataContactRuntime.js').createKanataContactRuntime>
export type KanataDeferredRuntime = ReturnType<typeof import('./kanataDeferredRuntime.js').createKanataDeferredRuntime>

export type {
  PortableErrorCode,
  PortableTableCategory,
  PortableColumnType,
  PortableValue,
  PortableRowRecord,
  PortableColumnSpec,
  PortableTableSpec,
  PortableSha256Hasher,
  PortableCryptoProvider,
  PortableTableVerifier,
  PortablePublicHeader,
  PortableManifest,
  PortableFooter,
  PortableVerifyContext,
  PortableStagingSink,
  PortableTableRowSource,
  PortableByteSource,
  PortableEncodeMaterial,
  PortableEncodeOptions,
  PortableDecodeOptions,
  PortableDecodeResult,
} from '../features/chat/backup/portable/contracts'
