import { Capacitor, registerPlugin } from '@capacitor/core'
import { STORAGE_KEYS } from '../platform/storage/keys.js'
import { writeJsonPreference } from '../platform/storage/preferences.js'
import { buildHomeWidgetSnapshot } from './homeWidgetSnapshot.js'

const ForMyselfWidget = registerPlugin('ForMyselfWidget')

export const refreshHomeWidget = async data => {
  const snapshot = buildHomeWidgetSnapshot(data)
  await writeJsonPreference(STORAGE_KEYS.homeWidgetSnapshot, snapshot)
  if (!Capacitor.isNativePlatform()) return false
  await ForMyselfWidget.refresh()
  return true
}
