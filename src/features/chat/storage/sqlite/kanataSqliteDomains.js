// @ts-check
import { createKanataConversationRepository } from './kanataConversationRepository.js'
import { createKanataWorldRepository } from './kanataWorldRepository.js'
import { createKanataCharacterRepository } from './kanataCharacterRepository.js'
import { createKanataLorebookRepository } from './kanataLorebookRepository.js'
import { createKanataMemoryRepository } from './kanataMemoryRepository.js'
import { createKanataEventRepository } from './kanataEventRepository.js'
import { createKanataAutonomyRepository } from './kanataAutonomyRepository.js'
import { createKanataChatViewRepository } from './kanataChatViewRepository.js'
import { createKanataTurnRepository } from './kanataTurnRepository.js'
import { createKanataManagementViewRepository } from './kanataManagementViewRepository.js'
import { createKanataRoleBindingRepository } from './kanataRoleBindingRepository.js'
import { createKanataUsageRepository } from './kanataUsageRepository.js'

/** @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} operation
 * @param {{id:()=>string,clock:()=>number}} tools */
export function createKanataSqliteDomains(operation, tools) {
  return {
    turns: createKanataTurnRepository(operation, tools),
    managementView: createKanataManagementViewRepository(operation),
    chatView: createKanataChatViewRepository(operation),
    conversations: createKanataConversationRepository(operation),
    worlds: createKanataWorldRepository(operation),
    characters: createKanataCharacterRepository(operation),
    lorebook: createKanataLorebookRepository(operation),
    memories: createKanataMemoryRepository(operation, tools.id),
    events: createKanataEventRepository(operation, tools),
    autonomy: createKanataAutonomyRepository(operation, tools),
    roleBindings: createKanataRoleBindingRepository(operation),
    usage: createKanataUsageRepository(operation),
  }
}
