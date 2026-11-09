// @ts-check
import { createKanataWorldRepository } from './kanataWorldRepository.js'
import { createKanataCharacterRepository } from './kanataCharacterRepository.js'
import { createKanataLorebookRepository } from './kanataLorebookRepository.js'
import { createKanataMemoryRepository } from './kanataMemoryRepository.js'
import { createKanataEventRepository } from './kanataEventRepository.js'
import { createKanataAutonomyRepository } from './kanataAutonomyRepository.js'
import { createKanataUsageRepository } from './kanataUsageRepository.js'

/** @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} operation
 * @param {{id:()=>string,clock:()=>number}} tools */
export function createKanataSqliteDomains(operation, tools) {
  return {
    worlds: createKanataWorldRepository(operation),
    characters: createKanataCharacterRepository(operation),
    lorebook: createKanataLorebookRepository(operation),
    memories: createKanataMemoryRepository(operation, tools.id),
    events: createKanataEventRepository(operation, tools),
    autonomy: createKanataAutonomyRepository(operation, tools),
    usage: createKanataUsageRepository(operation),
  }
}
