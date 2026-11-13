import type { CharacterInstance, Conversation, Memory, Message, Relationship, WorldEvent } from '../../domain/kanataTypes'

export interface KanataMessageScope {
  readonly worldId: string
  readonly conversationId: string
}

export interface KanataMessageCursor extends KanataMessageScope {
  readonly version: 1
  readonly createdAt: number
  readonly id: string
}

export interface KanataHistoryCursor extends KanataMessageCursor {
  readonly query: string
}
export interface KanataHistoryArchivePlan extends KanataMessageScope {
  readonly keepRecent: number
  readonly conversationRevision: number
  readonly count: number
  readonly signature: string
}
export interface KanataHistoryPage {
  readonly messages: readonly Pick<Message, 'id' | 'content' | 'senderNameSnapshot' | 'createdAt' | 'revision'>[]
  readonly cursor: KanataHistoryCursor | null
}
export interface KanataMessagePage {
  readonly messages: readonly KanataTranscriptMessage[]
  readonly cursor: KanataMessageCursor | null
  readonly hasMore: boolean
}

export type KanataTranscriptMessage = Omit<Message,'lifeSources'>
export interface KanataMessageDetailIdentity extends KanataMessageScope {
  readonly id: string; readonly revision: number
}
export interface KanataMessageSourceCursor extends KanataMessageDetailIdentity {
  readonly kind: 'sources'; readonly grantId: string; readonly grantRevision: number; readonly fingerprint: string
}
export type KanataMessageJsonSelection = {readonly kind:'snapshot'|'extensions'} |
  {readonly kind:'audit';readonly auditId:string;readonly side:'previous'|'next'}
export interface KanataMessageJsonCursor extends KanataMessageDetailIdentity {
  readonly kind:'json'; readonly selection:KanataMessageJsonSelection; readonly offset:number
}

export interface KanataReplyExpectation {
  readonly sourceId: string
  readonly sourceRevision: number
  readonly conversationRevision: number
  readonly speakerId: string
  readonly speakerRevision: number
}
export interface KanataChatContextState {
  readonly speaker: Pick<CharacterInstance, 'state' | 'revision'>
  readonly events: readonly Pick<WorldEvent, 'id' | 'status' | 'revision'>[]
  readonly memories: readonly Pick<Memory, 'id' | 'status' | 'revision'>[]
  readonly relationships: readonly Pick<Relationship, 'id' | 'dimensions' | 'revision'>[]
}
export interface KanataDeferredReply {
  readonly id: string
  readonly sourceId: string
  readonly sourceRevision: number
  readonly notBefore: number
  readonly expiresAt: number
  readonly activityDelay: boolean
}

/** Authorized roots to revisit within the reply write transaction. */
export interface KanataReplyProvenance {
  readonly recentMessages: number
  readonly history: readonly { id: string; revision: number }[]
  readonly memories: readonly { id: string; revision: number }[]
  readonly events: readonly { id: string; revision: number }[]
  readonly life: readonly import('../../domain/kanataTypes').LifeSource[]
}

export type KanataMessageState = Pick<Message,'id'|'revision'|'createdAt'|'status'|'senderId'> & { readonly deleted: boolean }
export type KanataMessageWriteReceipt = Readonly<Pick<Message,'id'|'revision'>>

export interface KanataMessageRepository {
  insert(message: Message): Promise<'inserted' | 'existing'>
  insertBatch(messages: readonly Message[]): Promise<readonly ('inserted' | 'existing')[]>
  recent(scope: KanataMessageScope, limit?: number): Promise<KanataMessagePage>
  older(scope: KanataMessageScope, cursor: KanataMessageCursor, limit?: number): Promise<KanataMessagePage>
  previewArchive(scope: KanataMessageScope, keepRecent?: number): Promise<KanataHistoryArchivePlan>
  confirmArchive(scope: KanataMessageScope, plan: KanataHistoryArchivePlan, commandId: string): Promise<{archivedCount: number}>
  searchHistory(scope: KanataMessageScope, text: string, cursor?: KanataHistoryCursor): Promise<KanataHistoryPage>
  locate(scope: KanataMessageScope, id: string, limit?: number): Promise<KanataMessagePage | null>
  get(scope: KanataMessageScope, id: string): Promise<KanataTranscriptMessage | null>
  state(scope: KanataMessageScope, id: string): Promise<KanataMessageState | null>
  latestState(scope: KanataMessageScope, role?: Message['role']): Promise<KanataMessageState | null>
  quote(scope: KanataMessageScope, id: string): Promise<Pick<Message, 'id' | 'content' | 'senderNameSnapshot' | 'revision'> | null>
  count(scope: KanataMessageScope): Promise<number>
  latest(scope: KanataMessageScope, role: Message['role']): Promise<KanataTranscriptMessage | null>
  historyForSpeaker(scope: KanataMessageScope, speakerId: string, limit: number): Promise<readonly KanataTranscriptMessage[]>
  contextState(scope: KanataMessageScope, speakerId: string, ids: {
    events: readonly string[]; memories: readonly string[]; relationships: readonly string[]
  }): Promise<KanataChatContextState>
  sourcePage(scope: KanataMessageScope,id:string,cursor?:KanataMessageSourceCursor,limit?:number): Promise<{
    rows:readonly import('../../domain/kanataTypes').LifeSource[];cursor:KanataMessageSourceCursor|null
  }>
  jsonChunk(scope:KanataMessageScope,id:string,selection:KanataMessageJsonSelection,cursor?:KanataMessageJsonCursor): Promise<{
    fragment:string;cursor:KanataMessageJsonCursor|null
  }>
  replies(scope: KanataMessageScope, id: string, cursor?: KanataMessageCursor, limit?: number): Promise<KanataMessagePage>
  completedReplies(scope: KanataMessageScope, id: string): Promise<readonly Pick<Message, 'id' | 'revision' | 'senderId'>[]>
  insertReplyBatch(scope: KanataMessageScope, expected: KanataReplyExpectation, messages: readonly Message[], provenance?: KanataReplyProvenance): Promise<void>
  setStatus(scope: KanataMessageScope, id: string, expectedRevision: number, status: Message['status']): Promise<KanataMessageWriteReceipt>
  revise(scope: KanataMessageScope, id: string, expectedRevision: number, change: { content: string; deleted: boolean }): Promise<KanataMessageWriteReceipt>
}

export interface KanataGroupMemberEdit {
  expectedRevision: number
  expectedHistory: boolean
  instanceIds: string[]
  commandId: string
  newGroupId: string
}

export interface KanataConversationRepository {
  list(worldId: string, afterId?: string, limit?: number): Promise<{
    readonly conversations: readonly Conversation[]
    readonly cursor: string | null
    readonly hasMore: boolean
  }>
  get(scope: KanataMessageScope): Promise<Conversation | null>
  participants(scope: KanataMessageScope): Promise<readonly { id: string; kind: 'user' | 'character' }[]>
  groupEdit(scope: KanataMessageScope): Promise<{ title: string; revision: number; hasHistory: boolean }>
  groupMemberPage(scope: KanataMessageScope, revision: number, after?: number, limit?: number): Promise<{
    entries: { id: string; title: string }[]; cursor: number | null
  }>
  editGroupMembers(scope: KanataMessageScope, input: KanataGroupMemberEdit): Promise<{ id: string; created: boolean }>
  createGroup(worldId: string, fields: { title: string; instanceIds: string[] }, options: { id: string; commandId: string }): Promise<{ id: string }>
  create(conversation: Conversation): Promise<Conversation>
  updateChatSettings(scope: KanataMessageScope, expectedRevision: number | undefined, changes: Partial<Pick<Conversation, 'mode' | 'replyLimits' | 'replyTiming'>>, now: number): Promise<void>
  update(scope: KanataMessageScope, expectedRevision: number, fields: {
    title: Conversation['title']; mode: Conversation['mode']; lastReadAt: number
    replyLimits?: Conversation['replyLimits']; replyTiming?: Conversation['replyTiming']
  }): Promise<Conversation>
}
