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
const context = reactive({
  ...navigation,
  ...appearance,
  ...useHealthSettings(navigation),
  ...useCatalogSettings(appearance),
  ...useChatSettings(),
  ...useSecuritySettings(),
  ...useBackupSettings(),
  ...useReminderSettings()
})

const unregisterBackHandler = registerBackHandler(() => {
  if (context.backupPickerOpen) { context.backupPickerOpen = false; return true }
  if (context.autoLockPickerOpen) { context.autoLockPickerOpen = false; return true }
  if (context.isChangingPwd || context.isChangingPwdBio) {
    context.isChangingPwd = false
    context.isChangingPwdBio = false
    return true
  }
  return false
}, {
  priority: 600,
  isActive: () => context.backupPickerOpen || context.autoLockPickerOpen || context.isChangingPwd || context.isChangingPwdBio
})
onBeforeUnmount(unregisterBackHandler)
</script>

<template>
  <div class="fade-in settings-container">
    <SettingsOverview :model="context" />
    <SettingsChat :model="context" />
    <SettingsAppearance :model="context" />
    <SettingsWidgets :model="context" />
    <SettingsSecurity :model="context" />
    <SettingsCatalogs :model="context" />
    <SettingsHealth :model="context" />
    <SettingsNotifications :model="context" />
    <SettingsBackup :model="context" />
    <SettingsAi :model="context" />
    <SettingsPickers :model="context" />
  </div>
</template>

<style src="../styles/settings.css"></style>
