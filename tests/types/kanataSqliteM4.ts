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
