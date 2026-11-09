export type KanataSqliteDomains = ReturnType<typeof import('./kanataSqliteDomains.js').createKanataSqliteDomains>
export interface KanataSqliteDomainOwner {
  readonly worldId: string
  assertCurrent(): void
}

export interface KanataEventGraphCursor {
  readonly worldId: string
  readonly eventId: string
  readonly direction: 'cause' | 'consequence'
  readonly rootRevision: number
  readonly after: string
}

export interface KanataMemorySourceCursor {
  readonly worldId: string
  readonly instanceId: string
  readonly conversationId?: string
  readonly memoryId: string
  readonly revision: number
  readonly after: string
}
