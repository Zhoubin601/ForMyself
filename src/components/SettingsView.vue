<script setup>
import SettingsOverview from './settings/SettingsOverview.vue'
import SettingsChat from './settings/SettingsChat.vue'
import SettingsAppearance from './settings/SettingsAppearance.vue'
import SettingsWidgets from './settings/SettingsWidgets.vue'
import SettingsSecurity from './settings/SettingsSecurity.vue'
import SettingsCatalogs from './settings/SettingsCatalogs.vue'
import SettingsHealth from './settings/SettingsHealth.vue'
import SettingsNotifications from './settings/SettingsNotifications.vue'
import SettingsBackup from './settings/SettingsBackup.vue'
import SettingsAi from './settings/SettingsAi.vue'
import SettingsPickers from './settings/SettingsPickers.vue'
import { onBeforeUnmount, reactive } from 'vue'
import { projectSettingsModel, SETTINGS_SECTION_FIELDS } from '../application/settingsModels.js'
import { registerBackHandler } from '../services/backNavigation'
import { useSettingsNavigation } from '../composables/settings/useSettingsNavigation.js'
import { useHealthSettings } from '../composables/settings/useHealthSettings.js'
import { useAppearanceSettings } from '../composables/settings/useAppearanceSettings.js'
import { useCatalogSettings } from '../composables/settings/useCatalogSettings.js'
import { useChatSettings } from '../composables/settings/useChatSettings.js'
import { useSecuritySettings } from '../composables/settings/useSecuritySettings.js'
import { useBackupSettings } from '../composables/settings/useBackupSettings.js'
import { useReminderSettings } from '../composables/settings/useReminderSettings.js'

const navigation = useSettingsNavigation()
const appearance = useAppearanceSettings()
const health = useHealthSettings(navigation)
const catalog = useCatalogSettings(appearance)
const chat = useChatSettings()
const security = useSecuritySettings()
const backup = useBackupSettings()
const reminders = useReminderSettings()
const providers = [navigation, appearance, health, catalog, chat, security, backup, reminders]
const models = Object.fromEntries(Object.entries(SETTINGS_SECTION_FIELDS).map(([section, keys]) =>
  [section, reactive(projectSettingsModel(providers, keys))]
))

const unregisterBackHandler = registerBackHandler(() => {
  if (backup.backupPickerOpen.value) { backup.backupPickerOpen.value = false; return true }
  if (navigation.autoLockPickerOpen.value) { navigation.autoLockPickerOpen.value = false; return true }
  if (security.isChangingPwd.value || security.isChangingPwdBio.value) {
    security.isChangingPwd.value = false
    security.isChangingPwdBio.value = false
    return true
  }
  return false
}, {
  priority: 600,
  isActive: () => backup.backupPickerOpen.value || navigation.autoLockPickerOpen.value || security.isChangingPwd.value || security.isChangingPwdBio.value
})
onBeforeUnmount(unregisterBackHandler)
</script>

<template>
  <div class="fade-in settings-container">
    <SettingsOverview :model="models.SettingsOverview" />
    <SettingsChat :model="models.SettingsChat" />
    <SettingsAppearance :model="models.SettingsAppearance" />
    <SettingsWidgets :model="models.SettingsWidgets" />
    <SettingsSecurity :model="models.SettingsSecurity" />
    <SettingsCatalogs :model="models.SettingsCatalogs" />
    <SettingsHealth :model="models.SettingsHealth" />
    <SettingsNotifications :model="models.SettingsNotifications" />
    <SettingsBackup :model="models.SettingsBackup" />
    <SettingsAi :model="models.SettingsAi" />
    <SettingsPickers :model="models.SettingsPickers" />
  </div>
</template>

<style src="../styles/settings.css"></style>
