// @ts-check
import abydos from './abydos.v1.json'
import { validateWorldPreset } from '../domain/presetCore.js'

const sources = [abydos]
export const DEFAULT_KANATA_PRESET_ID = abydos.id
export const builtinKanataPresets = Object.freeze(sources.map(preset => Object.freeze({
  id: preset.id, name: preset.name, presetVersion: preset.presetVersion,
  characterCount: preset.characters.length, lorebookCount: preset.lorebook.length,
  sourceNotice: preset.sourceNotice, sourceReviewDate: '2026-10-28',
  distributionAuthorization: 'not-provided', assets: 'text-placeholders-only'
})))
/** @param {string} id */
export function getBuiltinKanataPreset(id) {
  const preset = sources.find(p => p.id === id)
  if (!preset) throw new Error('KANATA_PRESET_NOT_FOUND')
  return validateWorldPreset(preset)
}
