// @ts-check
import { validateKanataData } from './kanataValidation.js'

export const KANATA_DATA_TYPE = 'kanata-data'
export const KANATA_DATA_VERSION = 1

/** New namespace, never a chat v4 content migration. @param {string} userId @returns {import('./kanataTypes').KanataData} */
export function createEmptyKanataData(userId) {
  return validateKanataData({
    type: KANATA_DATA_TYPE, version: KANATA_DATA_VERSION, userId,
    worlds: [], cards: [], cardVersions: [], identities: [], instances: [], conversations: [],
    messages: [], lorebookEntries: [], memories: [], relationships: [], events: [],
    effects: [], tasks: [], lifeGrants: [], presetApplications: []
  })
}
