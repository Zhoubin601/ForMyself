import { normalizeAutoLockDelay } from './autoLockPolicy.js'
import { normalizeHealthSettings } from './weightInsights.js'
import { normalizeMoodRecords } from './moodRecords.js'
import {
  BUILT_IN_VAULT_CATEGORIES,
  normalizePasswordVaultRecords,
  normalizeVaultCategoryList
} from './passwordVaultRecords.js'
import {
  normalizeNotificationAiCache,
  normalizeReminderSettings
} from './reminderSchedule.js'

export const FULL_BACKUP_TYPE = 'formyself-full-backup'
export const FULL_BACKUP_VERSION = 1

const cloneJson = value => JSON.parse(JSON.stringify(value))
const cleanText = (value, maxLength = 500) => String(value || '').slice(0, maxLength)

export function normalizeFullBackupSettings(value = {}) {
  const banner = value.banner || {}
  const ai = value.ai || {}
  const homeCache = value.homeCache || {}
  const cachedQuote = homeCache.cachedQuote || {}
  const titleSize = Number(banner.titleSize)

  return {
    banner: {
      prefix: cleanText(banner.prefix, 50) || '你已经省下了',
      suffix: cleanText(banner.suffix, 30) || '元',
      subtitle: cleanText(banner.subtitle, 120),
      titleSize: Number.isFinite(titleSize) && titleSize >= 20 && titleSize <= 80 ? titleSize : 38
    },
    customBg: String(value.customBg || ''),
    ai: {
      url: cleanText(ai.url, 500) || 'https://api.deepseek.com',
      key: cleanText(ai.key, 2000),
      model: cleanText(ai.model, 200) || 'deepseek-chat'
    },
    autoLockDelaySeconds: normalizeAutoLockDelay(value.autoLockDelaySeconds),
    notificationSettings: normalizeReminderSettings(value.notificationSettings),
    notificationAiContent: normalizeNotificationAiCache(value.notificationAiContent),
    health: normalizeHealthSettings(value.health),
    homeCache: {
      cachedQuote: {
        text: cleanText(cachedQuote.text, 500),
        date: cleanText(cachedQuote.date, 30)
      },
      dataFingerprint: cleanText(homeCache.dataFingerprint, 5000),
      lastEncouragement: cleanText(homeCache.lastEncouragement, 1000)
    }
  }
}

const requireArray = (value, field) => {
  if (!Array.isArray(value)) throw new Error(`INVALID_FULL_BACKUP_${field.toUpperCase()}`)
  return cloneJson(value)
}

export function buildFullBackupSnapshot({
  savings = [],
  weight = [],
  mood = [],
  passwords = [],
  moodMetadata = {},
  vaultMetadata = {},
  settings = {}
}, createdAt = new Date().toISOString()) {
  const safeMoodMetadata = moodMetadata && typeof moodMetadata === 'object' ? moodMetadata : {}
  const safeVaultMetadata = vaultMetadata && typeof vaultMetadata === 'object' ? vaultMetadata : {}
  return {
    type: FULL_BACKUP_TYPE,
    version: FULL_BACKUP_VERSION,
    createdAt: String(createdAt),
    data: {
      savings: requireArray(savings, 'savings'),
      weight: requireArray(weight, 'weight'),
      mood: requireArray(mood, 'mood'),
      passwords: requireArray(passwords, 'passwords')
    },
    metadata: {
      mood: {
        trackingStartDate: cleanText(safeMoodMetadata.trackingStartDate, 10),
        customTags: Array.isArray(safeMoodMetadata.customTags)
          ? [...new Set(safeMoodMetadata.customTags.map(tag => cleanText(tag, 20).trim()).filter(Boolean))]
          : []
      },
      vault: {
        categories: Array.isArray(safeVaultMetadata.categories)
          ? normalizeVaultCategoryList(safeVaultMetadata.categories)
          : [...BUILT_IN_VAULT_CATEGORIES]
      }
    },
    settings: normalizeFullBackupSettings(settings)
  }
}

export function normalizeFullBackupSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_FULL_BACKUP')
  if (value.type !== FULL_BACKUP_TYPE) throw new Error('INVALID_FULL_BACKUP_TYPE')
  if (value.version !== FULL_BACKUP_VERSION) throw new Error('UNSUPPORTED_FULL_BACKUP_VERSION')
  if (!value.data || typeof value.data !== 'object') throw new Error('INVALID_FULL_BACKUP_DATA')
  if (!value.settings || typeof value.settings !== 'object') throw new Error('INVALID_FULL_BACKUP_SETTINGS')

  const normalized = buildFullBackupSnapshot({
    savings: requireArray(value.data.savings, 'savings'),
    weight: requireArray(value.data.weight, 'weight'),
    mood: normalizeMoodRecords(requireArray(value.data.mood, 'mood')),
    passwords: normalizePasswordVaultRecords(requireArray(value.data.passwords, 'passwords')),
    moodMetadata: value.metadata?.mood,
    vaultMetadata: value.metadata?.vault,
    settings: value.settings
  }, value.createdAt)

  if (!normalized.createdAt || Number.isNaN(Date.parse(normalized.createdAt))) {
    throw new Error('INVALID_FULL_BACKUP_DATE')
  }
  return normalized
}

export function getFullBackupCounts(snapshot) {
  const normalized = normalizeFullBackupSnapshot(snapshot)
  return {
    savings: normalized.data.savings.length,
    weight: normalized.data.weight.length,
    mood: normalized.data.mood.length,
    passwords: normalized.data.passwords.length
  }
}
