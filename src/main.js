import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useSettingsStore } from './stores/settings.js'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
// Read and decode the wallpaper before the first app frame, independently of auth/native setup.
useSettingsStore(pinia).loadAppearanceSettings().then(() => {
  performance.mark('app:appearance-ready')
  app.mount('#app')
})
