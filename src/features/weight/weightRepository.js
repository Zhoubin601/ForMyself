import { createPreferenceRepository } from '../../platform/storage/preferenceRepository.js'
import { STORAGE_KEYS } from '../../platform/storage/keys.js'
import { parseStoredJson } from '../../platform/storage/storePersistence.js'
export function createWeightRepository(driver) {
  const storage = createPreferenceRepository([STORAGE_KEYS.weightRecords], driver)
  return { ...storage, read: async () => parseStoredJson((await storage.get({ key: STORAGE_KEYS.weightRecords })).value, [], 'records') }
}
export const weightRepository = createWeightRepository()
