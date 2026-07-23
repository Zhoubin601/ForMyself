import { Capacitor, registerPlugin } from '@capacitor/core'

const ForMyselfWidget = registerPlugin('ForMyselfWidget')

export const refreshHomeWidget = async () => {
  if (!Capacitor.isNativePlatform()) return false
  await ForMyselfWidget.refresh()
  return true
}
