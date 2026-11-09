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

export interface KanataMessagePage {
  readonly messages: readonly Message[]
  readonly cursor: KanataMessageCursor | null
  readonly hasMore: boolean
}

export type KanataMessageProvenance = Pick<Message, 'id' | 'worldId' | 'conversationId' | 'revision' | 'status' |
  'deleted' | 'replyToMessageId' | 'replyToRevision' | 'lifeSources'>

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

export interface KanataMessageRepository {
  insert(message: Message): Promise<'inserted' | 'existing'>
  insertBatch(messages: readonly Message[]): Promise<readonly ('inserted' | 'existing')[]>
  recent(scope: KanataMessageScope, limit?: number): Promise<KanataMessagePage>
  older(scope: KanataMessageScope, cursor: KanataMessageCursor, limit?: number): Promise<KanataMessagePage>
  locate(scope: KanataMessageScope, id: string, limit?: number): Promise<KanataMessagePage | null>
  get(scope: KanataMessageScope, id: string): Promise<Message | null>
  quote(scope: KanataMessageScope, id: string): Promise<Pick<Message, 'id' | 'content' | 'senderNameSnapshot' | 'revision'> | null>
  count(scope: KanataMessageScope): Promise<number>
  latest(scope: KanataMessageScope, role: Message['role']): Promise<Message | null>
  historyForSpeaker(scope: KanataMessageScope, speakerId: string, limit: number): Promise<readonly Message[]>
  contextState(scope: KanataMessageScope, speakerId: string, ids: {
    events: readonly string[]; memories: readonly string[]; relationships: readonly string[]
  }): Promise<KanataChatContextState>
  provenance(worldId: string, id: string): Promise<KanataMessageProvenance | null>
  replies(scope: KanataMessageScope, id: string, cursor?: KanataMessageCursor, limit?: number): Promise<KanataMessagePage>
  insertReplyBatch(scope: KanataMessageScope, expected: KanataReplyExpectation, messages: readonly Message[]): Promise<void>
  setStatus(scope: KanataMessageScope, id: string, expectedRevision: number, status: Message['status']): Promise<Message>
  revise(scope: KanataMessageScope, id: string, expectedRevision: number, change: { content: string; deleted: boolean }): Promise<Message>
}

export interface KanataConversationRepository {
  list(worldId: string, afterId?: string, limit?: number): Promise<{
    readonly conversations: readonly Conversation[]
    readonly cursor: string | null
    readonly hasMore: boolean
  }>
  get(scope: KanataMessageScope): Promise<Conversation | null>
  participants(scope: KanataMessageScope): Promise<readonly { id: string; kind: 'user' | 'character' }[]>
  create(conversation: Conversation): Promise<Conversation>
  update(scope: KanataMessageScope, expectedRevision: number, fields: {
    title: Conversation['title']; mode: Conversation['mode']; lastReadAt: number
    replyLimits?: Conversation['replyLimits']; replyTiming?: Conversation['replyTiming']
  }): Promise<Conversation>
}
