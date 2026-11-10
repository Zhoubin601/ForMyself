// @ts-check
import { createKanataBudgetSelection } from '../domain/kanataBudgetSelection.js'
import { activatesKanataLore, estimateKanataContextTokens } from './kanataLorebook.js'

/** @typedef {{id:string,revision:number,priority:number,content:string}} Selection */
/** @param {Pick<import('../storage/sqlite/kanataDomainTypes').KanataSqliteDomains['lorebook'],'promptCandidates'>} repository
 * @param {string} worldId @param {string} instanceId @param {string} text */
export async function readKanataRoleLore(repository, worldId, instanceId, text) {
  const book = createKanataBudgetSelection(4000,
    (/** @type {Selection} */ a, /** @type {Selection} */ b) => b.priority - a.priority || a.id.localeCompare(b.id, 'en'))
  let cursor = ''
  for (;;) {
    const page = await repository.promptCandidates(worldId, instanceId, cursor)
    for (const entry of page.entries) {
      const { id, revision, priority, content } = entry
      if (activatesKanataLore(entry, text)) book.offer({ id, revision, priority, content }, estimateKanataContextTokens(content) + 8)
    }
    if (page.cursor === null) return book.finish()
    cursor = page.cursor
  }
}
