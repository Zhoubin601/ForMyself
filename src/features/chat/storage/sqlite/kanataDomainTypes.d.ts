export type KanataSqliteDomains = ReturnType<typeof import('./kanataSqliteDomains.js').createKanataSqliteDomains>
export interface KanataSqliteDomainOwner {
  readonly worldId: string
  assertCurrent(): void
}

export interface KanataEventRevocationPlan {
  readonly worldId: string
  readonly eventId: string
  readonly rootRevision: number
  readonly revokeCount: number
  readonly uncertainCount: number
  readonly signature: string
}
export type KanataEventRevocationDecision = 'keep-independent' | 'mark-needs-review'
export interface KanataEventRevocationCursor {
  readonly plan: KanataEventRevocationPlan
  readonly after: string
}

export interface KanataEventEffectAuditCursor {
  readonly worldId: string
  readonly eventId: string
  readonly auditId: string
  readonly after: string
}
export interface KanataEventGraphCursor {
  readonly worldId: string
  readonly eventId: string
  readonly direction: 'cause' | 'consequence'
  readonly rootRevision: number
  readonly after: string
}

/** Storage-authenticated projection for assembling the unchanged system message. */
export interface KanataMemoryPromptProjection {
  readonly id: string
  readonly revision: number
  readonly lifeSources: import('../../domain/kanataTypes').LifeSource[]
  readonly promptJson: string
  readonly promptBytes: number
}

export interface KanataOutgoingMemoryShareCursor {
  readonly worldId: string
  readonly instanceId: string
  readonly memoryId: string
  readonly revision: number
  readonly after: string
}

export interface KanataMemoryConflictPlan {
  readonly worldId: string
  readonly instanceId: string
  readonly memoryId: string
  readonly revision: number
  readonly signature: string
  readonly count: number
}
export interface KanataMemoryConflictCursor {
  readonly plan: KanataMemoryConflictPlan
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
