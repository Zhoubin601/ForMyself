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
Promise.all([settings.loadAppearanceSettings(), settings.loadSecuritySettings(), auth.loadAuthData({ checkBiometric: false })]).then(() => {
  if (!settings.requireAppUnlock) auth.enterWithoutUnlock()
  performance.mark('app:appearance-ready')
  app.mount('#app')
})
