import type { Component } from 'vue'
export type { KanataData, World, CharacterCard, CharacterCardVersion, CharacterInstance,
  WorldPreset, WorldUserIdentity, Conversation, Message, LorebookEntry, Memory,
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
export interface RestoreState { blocked: boolean; busy: boolean; message: string; syncError: string }
export interface RestoreRecord<Snapshot> { version: 1; previous: Snapshot; target: Snapshot }
export interface RestoreJournal<Snapshot> {
  inspect(): Promise<{ encrypted: string; committed: boolean; digest: string } | null>
  prepare(record: RestoreRecord<Snapshot>, password: string): Promise<void>
  commit(): Promise<void>
  clear(): Promise<void>
}
export interface RestoreCoordinatorOptions<Snapshot> {
  journal: RestoreJournal<Snapshot>
  state: RestoreState
  prepare(options?: { recovering?: boolean }): Promise<unknown>
  capture(): Snapshot
  apply(snapshot: Snapshot): Promise<unknown>
  validate(value: unknown): Snapshot
  validateRecovery?(value: unknown): Snapshot
  synchronize?(): Promise<unknown>
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
export type KanataChatRuntime = ReturnType<typeof import('./kanataChatRuntime.js').createKanataChatRuntime>
export type {LifeSource,MemoryPolicy,RoleBinding,KanataRoleBindings,EffectBaseline,EventAudit} from '../features/chat/domain/kanataTypes'
export type KanataExperienceRuntime = ReturnType<typeof import('./kanataExperienceRuntime.js').createKanataExperienceRuntime>
export type {MessageAudit} from '../features/chat/domain/kanataTypes'
export type KanataLifeCompanion = ReturnType<typeof import('./kanataLifeCompanion.js').createKanataLifeCompanion>
export type KanataLifeReaders = Parameters<typeof import('./kanataLifeContext.js').collectKanataLifeContext>[2]
