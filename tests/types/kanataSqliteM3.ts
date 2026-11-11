import type { KanataSqliteDomains } from '../../src/application/contracts'

declare const domains: KanataSqliteDomains
void domains.worlds.archive('world-one', 1, true)
void domains.memories.resolveSource({ worldId: 'world-one', instanceId: 'actor-one' }, 'memory-one', { messageId: 'message-one', revision: 1 })
// @ts-expect-error Context proof requires an instance identity.
void domains.memories.readFor({ worldId: 'world-one' }, 'memory-one')
// @ts-expect-error The source must carry an exact revision.
void domains.memories.resolveSource({ worldId: 'world-one', instanceId: 'actor-one' }, 'memory-one', { messageId: 'message-one' })
// @ts-expect-error Callers cannot directly update the watermark.
void domains.autonomy.setWatermark('world-one', 100)
// @ts-expect-error Effect reversal is driven by a complete preview.
void domains.events.legacy.revoke({ eventId: 'event-one' })

import type { KanataEventJsonSelection, KanataEventRelationCursor } from '../../src/application/contracts'
declare const relationCursor: KanataEventRelationCursor
// @ts-expect-error Every continuation must retain the event revision.
const brokenEventCursor: KanataEventRelationCursor = { worldId:'world',eventId:'event',scope:null,kind:'lifeSources',after:1 }
// @ts-expect-error An audit stream selects an exact snapshot revision.
const unboundAudit: KanataEventJsonSelection = { kind:'audit',auditId:'audit',side:'previous' }
// @ts-expect-error A relation cursor is not an Effect continuation.
void domains.events.effects('world','event',relationCursor)

// @ts-expect-error Public role reads cannot request internal shared-memory audience privileges.
void domains.events.readFor('world','event',{instanceId:'actor',group:false,sharedMemory:true})
