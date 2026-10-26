import { createPreferenceRepository } from '../../platform/storage/preferenceRepository.js'
import { STORAGE_KEYS } from '../../platform/storage/keys.js'
export const createScheduleRepository = driver => createPreferenceRepository([STORAGE_KEYS.scheduleData, STORAGE_KEYS.scheduleWidgetSnapshot], driver)
export const scheduleRepository = createScheduleRepository()
