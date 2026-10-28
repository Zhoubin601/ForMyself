import type { CompletionAttempt } from '../../../platform/ai/completionTypes'
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type ChatMode = 'daily' | 'roleplay'
export type Visibility = 'public' | 'private' | 'participants'
export interface SourceRef { messageId: string; revision: number }
export interface World {
  id: string; name: string; rules: string; revision: number; timeZone: string
  createdAt: number; lastSimulatedAt: number; autonomyEnabled: boolean
  proactiveEnabled: boolean; notificationsEnabled: boolean; defaultChatMode: ChatMode
  presetSourceId?: string; presetVersion?: number
  archived?: boolean
}
export interface CharacterDefinition {
  name: string; aliases: string[]; summary: string; anchors: string[]; speechStyle: string
  motivations: string[]; interests: string[]; disagreementStyle: string
  knowledgeBoundary: string; addressRule: string; driftGuards: string[]
  promptPriority: ('worldRules' | 'core' | 'worldIdentity' | 'knowledge' | 'style')[]
  avatarPlaceholder: string
  avatarDataUrl?: string
  scenario?: string; exampleDialogue?: string; greetings?: string[]; groupGreetings?: string[]
}
export interface CharacterCard { id: string; currentVersionId: string; archived: boolean; presetKey?: string }
export interface CharacterCardVersion {
  id: string; cardId: string; revision: number; definition: CharacterDefinition
  rawData: JsonValue; source: string
  imported?: import('../cards/characterCardTypes').ImportedCardAsset
}
export interface CharacterInstance {
  id: string; worldId: string; cardId: string; cardVersionId: string; revision: number
  overrides: Partial<CharacterDefinition>; state: { mood: string; energy: number; location: string }
  autonomyEnabled: boolean; proactiveEnabled: boolean
}
export interface WorldUserIdentity {
  id: string; worldId: string; userId: string; displayName: string; background: string; revision: number
}
export interface Conversation {
  id: string; worldId: string; type: 'private' | 'group' | 'character'
  title: string; participantIds: string[]; mode: ChatMode | 'inherit'; revision: number; lastReadAt: number
}
export interface Message {
  id: string; worldId: string; conversationId: string; role: 'user' | 'assistant'
  senderType: 'user' | 'character'; senderId: string; senderNameSnapshot: string
  content: string; createdAt: number; revision: number; status: 'complete' | 'stopped'
  turnId: string; batchId: string; replyToMessageId?: string
}
export interface LorebookEntry {
  id: string; worldId: string; scope: 'world' | 'character' | 'system'; ownerId: string
  keys: string[]; content: string; priority: number; activationRule: 'keyword' | 'always'
  visibility: Visibility; knownBy: string[]; sourceTag: string; revision: number
  enabled?: boolean; caseSensitive?: boolean; secondaryKeys?: string[]
}
export interface Memory {
  id: string; worldId: string; ownerType: 'world' | 'character'; ownerId: string
  layer: 'L2' | 'L3'; key: string; content: string; sourceRefs: SourceRef[]
  status: 'candidate' | 'active' | 'stale' | 'deleted'; revision: number; visibility: Visibility
}
export interface Relationship {
  id: string; worldId: string; fromId: string; toId: string
  kind: 'teammate' | 'teacher' | 'acquaintance' | 'friend' | 'conflict' | 'romantic'
  trustBaseline: 'new' | 'established'; publicSummary: string
  /** Signed deltas from the descriptive baseline, initially zero; not invented affinity scores. */
  dimensions: { trust: number; intimacy: number; understanding: number }; dimensionRuleVersion: number
  sourceEventIds: string[]; revision: number
}
export interface WorldEvent {
  id: string; worldId: string; participantIds: string[]; sourceRefs: SourceRef[]
  causedByEventIds: string[]; status: 'candidate' | 'committed' | 'revoked' | 'needsReview'
  visibility: Visibility; summary: string; effectiveAt: number; recordedAt: number; revision: number
}
export interface WorldEffect {
  id: string; worldId: string; eventId: string; targetType: 'world' | 'instance' | 'relationship'
  targetId: string; operation: 'set' | 'increment'; path: string; value: JsonValue; ruleVersion: number
}
export interface BackgroundTask {
  id: string; worldId: string; kind: 'reply' | 'memory' | 'summary' | 'world' | 'proactive' | 'followup'
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  idempotencyKey: string; sourceRefs: SourceRef[]; sourceRevision: number; attempt: number
  notBefore: number; leaseUntil: number; conversationId?: string; instanceId?: string; resultEventIds: string[]
}
export type LifeModule = 'home' | 'mood' | 'weight' | 'savings' | 'schedule' | 'todo' | 'reports'
export interface LifeGrant {
  id: string; worldId: string; instanceId: string; moduleId: LifeModule
  read: boolean; remember: boolean; share: boolean; revision: number
}
export interface PresetApplication {
  id: string; initializationKey: string; presetSourceId: string; presetVersion: number; worldId: string
}
export interface KanataData {
  type: 'kanata-data'; version: 1; userId: string
  worlds: World[]; cards: CharacterCard[]; cardVersions: CharacterCardVersion[]
  identities: WorldUserIdentity[]; instances: CharacterInstance[]; conversations: Conversation[]
  messages: Message[]; lorebookEntries: LorebookEntry[]; memories: Memory[]
  relationships: Relationship[]; events: WorldEvent[]; effects: WorldEffect[]
  tasks: BackgroundTask[]; lifeGrants: LifeGrant[]; presetApplications: PresetApplication[]
  usageEvents?: KanataUsageEvent[]
}
export interface KanataUsageEvent extends CompletionAttempt {
  worldId: string; conversationId: string; instanceId: string; turnId: string
}
export interface PresetCharacter { key: string; definition: CharacterDefinition; source: string }
export interface WorldPreset {
  type: 'kanata-preset'; version: 1; id: string; presetVersion: number
  name: string; rules: string; sourceNotice: string; sources: string[]
  userIdentity: { displayName: string; background: string }
  characters: PresetCharacter[]
  lorebook: { key: string; scope: LorebookEntry['scope']; keys: string[]; content: string
    priority: number; activationRule: LorebookEntry['activationRule']; visibility: Visibility
    knownBy: string[]; sourceTag: string }[]
  relationships: { fromKey: string; toKey: string; publicSummary: string }[]
}
export interface SeedOptions {
  initializationKey: string; now: number; timeZone: string
  idFactory(kind: string, sourceKey: string): string
}
