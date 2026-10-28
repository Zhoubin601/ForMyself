<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import { useSettingsStore } from '../../stores/settings.js'
import { useKanataStore } from './kanataStore.js'
import KanataSetupView from './KanataSetupView.vue'
import KanataWorldManager from './KanataWorldManager.vue'
import './kanataManagement.css'

defineOptions({ name: 'KanataView' })
const props = defineProps({ isVisible: { type: Boolean, default: true } })
const store = useKanataStore(), settings = useSettingsStore()
const frame = ref(null), entered = ref(false)
watch(() => [store.isDataLoaded, store.snapshot?.worlds.length, store.saveError, store.hasPendingSave], () => {
  if (!store.isDataLoaded || !store.snapshot?.worlds.length) entered.value = false
  else if (store.snapshot?.worlds.length && !store.saveError && !store.hasPendingSave) entered.value = true
}, { immediate: true })
const restoreScroll = async () => {
  await nextTick()
  if (props.isVisible && frame.value) frame.value.scrollTop = settings.currentRoute.scrollTop || 0
}
onMounted(restoreScroll)
watch(() => props.isVisible, restoreScroll)
const saveScroll = event => {
  if (props.isVisible && settings.currentView === 'chat') settings.updateCurrentRouteScroll(event.currentTarget.scrollTop)
}
</script>

<template>
  <div v-if="isVisible" ref="frame" class="kanata-frame" @scroll.passive="saveScroll">
    <KanataWorldManager v-if="entered && store.isDataLoaded && store.snapshot" />
    <KanataSetupView v-else :is-visible="isVisible" />
  </div>
</template>
