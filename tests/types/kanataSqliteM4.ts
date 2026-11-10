import type { KanataChatViewModel, KanataMessageScope, KanataSqliteChatRuntime, KanataConversationRepository } from '../../src/application/contracts'

declare const runtime: KanataSqliteChatRuntime
declare const view: KanataChatViewModel
declare const repository: KanataConversationRepository
declare const scope: KanataMessageScope

runtime.activate(scope)
void view.open(scope.conversationId)
void view.loadMembers(0)
view.dispose()
void repository.updateChatSettings(scope, 2, { mode: 'daily' }, 2000)
void repository.editGroupMembers(scope, { expectedRevision:2, expectedHistory:true, instanceIds:['a','b'], commandId:'edit', newGroupId:'new' })
// @ts-expect-error A membership command must specify the history observed and confirmed by the editor.
void repository.editGroupMembers(scope, { expectedRevision:2, instanceIds:['a','b'], commandId:'edit', newGroupId:'new' })
// @ts-expect-error Candidate ViewModel has no whole-dataset snapshot.
void view.snapshot
// @ts-expect-error The active scope must include both world and conversation.
runtime.activate({ conversationId: scope.conversationId })
// @ts-expect-error Chat settings cannot rewrite the conversation's participants.
void repository.updateChatSettings(scope, 2, { participantIds: [] }, 2000)

declare const worlds: import('../../src/application/contracts').KanataSqliteWorldRuntime
void worlds.select(scope.worldId).previewLore('actor','test',0,()=>{})
void worlds.createWorld({name:'world',rules:'',displayName:'user',background:''},
  {key:'create',now:1000,timeZone:'UTC',idFactory:kind=>kind},()=>{})
// @ts-expect-error Candidate creation derives the owner inside the protected repository.
void worlds.createWorld('arbitrary-owner',{name:'world'},()=>{})
// @ts-expect-error An offset is numeric and a request owner guard is required.
void worlds.select(scope.worldId).previewLore('actor','test','0')

declare const domains: import('../../src/application/contracts').KanataSqliteDomains
void domains.events.graphPage('world', 'event', 'cause')
declare const plan: import('../../src/application/contracts').KanataEventRevocationPlan
void domains.events.confirmRevocation(plan,'keep-independent','command')
// @ts-expect-error A browser graph cursor is not a frozen confirmation plan.
void domains.events.confirmRevocation({after:'id'},'keep-independent','command')
// @ts-expect-error An inferred event requires one of the product decisions.
void domains.events.confirmRevocation(plan,'revoke-everything','command')
// @ts-expect-error The cursor must bind root, direction, and revision.
void domains.events.graphPage('world', 'event', 'cause', { after: 'edge' })
// @ts-expect-error Unsupported traversal direction.
void domains.events.graphPage('world', 'event', 'sideways')
void domains.memories.sourcePage({ worldId: 'world', instanceId: 'actor' }, 'memory')
void domains.memories.shareManaged({worldId:'world',instanceId:'actor'},'memory',1,'recipient','command')
// @ts-expect-error Sharing the visible memory requires its revision.
void domains.memories.shareManaged({worldId:'world',instanceId:'actor'},'memory','recipient','command')
declare const conflictPlan: import('../../src/application/contracts').KanataMemoryConflictPlan
void domains.memories.confirmConflicts({worldId:'world',instanceId:'actor'},conflictPlan,'command')
// @ts-expect-error Confirmation accepts a scope-bound snapshot, not a list of arbitrary IDs.
void domains.memories.confirmConflicts({worldId:'world',instanceId:'actor'},['old'],'command')
// @ts-expect-error A source cursor must also bind its memory revision and role.
void domains.memories.sourcePage({ worldId: 'world', instanceId: 'actor' }, 'memory', { after: 'message' })
