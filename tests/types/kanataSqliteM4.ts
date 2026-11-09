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
// @ts-expect-error Candidate ViewModel has no whole-dataset snapshot.
void view.snapshot
// @ts-expect-error The active scope must include both world and conversation.
runtime.activate({ conversationId: scope.conversationId })
// @ts-expect-error Chat settings cannot rewrite the conversation's participants.
void repository.updateChatSettings(scope, 2, { participantIds: [] }, 2000)

declare const domains: import('../../src/application/contracts').KanataSqliteDomains
void domains.events.graphPage('world', 'event', 'cause')
// @ts-expect-error The cursor must bind root, direction, and revision.
void domains.events.graphPage('world', 'event', 'cause', { after: 'edge' })
// @ts-expect-error Unsupported traversal direction.
void domains.events.graphPage('world', 'event', 'sideways')
void domains.memories.sourcePage({ worldId: 'world', instanceId: 'actor' }, 'memory')
// @ts-expect-error A source cursor must also bind its memory revision and role.
void domains.memories.sourcePage({ worldId: 'world', instanceId: 'actor' }, 'memory', { after: 'message' })
