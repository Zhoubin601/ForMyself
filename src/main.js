import { Capacitor } from '@capacitor/core'
import { restoreJournal } from './platform/storage/restoreJournal.js'
import { restoreState } from './platform/storage/restoreState.js'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useSettingsStore } from './stores/settings.js'
import { useAuthStore } from './stores/auth.js'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
// Read and decode the wallpaper before the first app frame, independently of auth/native setup.
const settings = useSettingsStore(pinia)
const auth = useAuthStore(pinia)
restoreState.blocked = true
const probeRecovery = async () => {
  try {
    let blocked = false
    // R03.7 / H-05: In the isolated candidate build, ALWAYS run the Native read-only 5-path
    // inventory + authoritative head probe FIRST so legacy `restoreJournal.inspect()` can NEVER
    // silently delete orphan markers (`restore-v1.commit` / `restore-v1.tmp`) before inspection!
    if (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('KanataM6RestoreBridge')) {
      const { probeNativeDurableControlState } = await import('./application/kanataSyntheticRestoreWiring.js')
      const nativeState = await probeNativeDurableControlState()
      if (!nativeState || nativeState.blocked || nativeState.legacyInventory?.clean === false) {
        blocked = true
      } else {
        blocked = false
      }
    } else {
      // Ordinary production APK & Web keep existing legacy RestoreJournal inspection path unchanged.
      blocked = Boolean(await restoreJournal.inspect())
    }
    restoreState.blocked = blocked
    if (restoreState.blocked) restoreState.message = '检测到未完成的数据恢复，请验证身份后继续。'
  } catch { restoreState.blocked = true; restoreState.message = '恢复记录无法读取，请保留应用数据并重试。' }
}
probeRecovery().then(() => Promise.all([settings.loadAppearanceSettings(), settings.loadSecuritySettings(), auth.loadAuthData({ checkBiometric: false })])).then(() => {
  if (!settings.requireAppUnlock) auth.enterWithoutUnlock()
  performance.mark('app:appearance-ready')
  app.mount('#app')
})
