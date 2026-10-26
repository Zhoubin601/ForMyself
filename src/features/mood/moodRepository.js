import { createPreferenceRepository } from '../../platform/storage/preferenceRepository.js'
import { STORAGE_KEYS } from '../../platform/storage/keys.js'
export const createMoodRepository = driver => createPreferenceRepository([STORAGE_KEYS.moodRecords, STORAGE_KEYS.moodTrackingStartDate, STORAGE_KEYS.moodCustomTags, STORAGE_KEYS.moodDefinitions, STORAGE_KEYS.moodTagSettings], driver)
export const moodRepository = createMoodRepository()
