import type { CharacterDefinition, JsonValue } from '../domain/kanataTypes'

export interface ImportedCardAsset {
  fileName: string
  format: 'json' | 'png'
  sourceBase64: string
  avatarDataUrl?: string
}
export interface CardLoreCandidate {
  key: string; keys: string[]; content: string; priority: number
  activationRule: 'keyword' | 'always'; enabled: boolean; caseSensitive: boolean
  secondaryKeys: string[]
}
export interface ParsedCharacterCard {
  spec: 'v1' | 'v2' | 'v3'
  definition: CharacterDefinition
  rawData: JsonValue
  asset: ImportedCardAsset
  lorebook: CardLoreCandidate[]
  warnings: string[]
}
