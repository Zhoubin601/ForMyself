import { createPreferenceRepository } from '../../platform/storage/preferenceRepository.js'
import { STORAGE_KEYS } from '../../platform/storage/keys.js'
export const createVaultRepository = driver => createPreferenceRepository([STORAGE_KEYS.passwordVault, STORAGE_KEYS.passwordVaultCategories, STORAGE_KEYS.legacyPasswordVault], driver)
export const vaultRepository = createVaultRepository()
