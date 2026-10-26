import { createPreferenceRepository } from '../../platform/storage/preferenceRepository.js'
import { STORAGE_KEYS } from '../../platform/storage/keys.js'
export const createSavingsRepository = driver => createPreferenceRepository([STORAGE_KEYS.debtRecords, STORAGE_KEYS.debtGroups], driver)
export const savingsRepository = createSavingsRepository()
