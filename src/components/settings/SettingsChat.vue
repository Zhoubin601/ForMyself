<script setup>
import { computed } from 'vue'
import { useSettingsStore } from '../../stores/settings.js'

const props = defineProps({ model: { type: Object, required: true } })
const settings = useSettingsStore()
const visible = computed(() => props.model.settingsScope === 'chat')
const openKanata = () => settings.switchView('chat')
</script>

<template>
  <div v-if="visible" class="setting-section">
    <h3 class="caption body-muted section-title">彼方 · Kanata</h3>
    <div class="store-utility-card">
      <p>角色、世界与资料准备请在彼方中管理。</p>
      <p class="caption body-muted">旧温馨小家不会被导入新世界。清理前会显示明确警告并等待你确认。</p>
      <button class="button-primary full-width" type="button" @click="openKanata">进入彼方</button>
    </div>
  </div>
</template>
