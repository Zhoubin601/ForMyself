import type {JsonValue,WorldEffect} from '../../domain/kanataTypes'
export type KanataSqliteDomains = ReturnType<typeof import('./kanataSqliteDomains.js').createKanataSqliteDomains>
export interface KanataSqliteDomainOwner {
  readonly worldId: string
  assertCurrent(): void
}

export interface KanataEventAcknowledgement {
  readonly id: string
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

export type KanataEventEffectAuditField = 'path'|'value'|'before'|'after'|'snapshot'
export type KanataEventEffectAuditEntry = Omit<WorldEffect,'worldId'|'eventId'|'path'|'value'> & {
  readonly path?:string;readonly value?:JsonValue;readonly before?:JsonValue;readonly after?:JsonValue
  readonly pathChunked?:boolean;readonly valueChunked?:boolean;readonly beforeChunked?:boolean
  readonly afterChunked?:boolean;readonly snapshotChunked?:boolean
  readonly ownerRevision?:number;readonly nextOwnerRevision?:number;readonly idempotencyKey?:readonly string[]
}
export interface KanataEventEffectAuditIdentity {
  readonly worldId: string
  readonly eventId: string
  readonly auditId: string
  readonly previousRevision:number
  readonly nextRevision:number
  readonly signature:string
}
export interface KanataEventEffectAuditCursor extends KanataEventEffectAuditIdentity {
  readonly after:number
}
export interface KanataEventEffectAuditJsonCursor extends KanataEventEffectAuditIdentity {
  readonly effectId:string
  readonly field:KanataEventEffectAuditField
  readonly offset:number
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
export type KanataEventReadScope = { readonly instanceId: string; readonly group: boolean }
export type KanataEventRelationKind = 'participantIds' | 'causedByEventIds' | 'sourceRefs' | 'lifeSources'
export interface KanataEventReadIdentity {
  readonly worldId: string
  readonly eventId: string
  readonly eventRevision: number
  readonly scope: KanataEventReadScope | null
}
export interface KanataEventRelationCursor extends KanataEventReadIdentity {
  readonly kind: KanataEventRelationKind
  readonly after: number
}
export interface KanataEventReadCursor extends KanataEventReadIdentity {
  readonly kind: 'effects' | 'audits'
  readonly after: string
}
export type KanataEventJsonSelection =
  | { readonly kind: 'extensions' | 'summary' }
  | { readonly kind: 'relation'; readonly relation: KanataEventRelationKind; readonly position: number }
  | { readonly kind: 'effectValue' | 'effectPath'; readonly effectId: string }
  | { readonly kind: 'audit'; readonly auditId: string; readonly side: 'previous' | 'next';
      readonly snapshotRevision: number; readonly field?: KanataEventRelationKind }
export interface KanataEventJsonCursor extends KanataEventReadIdentity {
  readonly selection: KanataEventJsonSelection
  readonly offset: number
}
export interface KanataRelationshipEventCursor {
  readonly worldId: string
  readonly relationshipId: string
  readonly relationshipRevision: number
  readonly after: string
}
