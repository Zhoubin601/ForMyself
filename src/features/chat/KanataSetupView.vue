<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DataStatusBanner from '../../components/DataStatusBanner.vue'
import { createKanataRuntime } from '../../application/kanataRuntime.js'
import { restoreState } from '../../platform/storage/restoreState.js'
import { appConfirm, resolveFeedbackDialog } from '../../services/uiFeedback.js'
import { useKanataStore } from './kanataStore.js'

defineOptions({ name: 'KanataSetupView' })
const props = defineProps({ isVisible: { type: Boolean, default: true } })
const store = useKanataStore()
const runtime = createKanataRuntime()
const busy = ref(false)
const probing = ref(false)
const legacyPending = ref(false)
const interrupted = ref(false)
const localError = ref('')
const notice = ref('')
let mounted = true
let revision = 0
let confirming = false

const data = computed(() => store.snapshot)
const initialized = computed(() => Boolean(store.isDataLoaded && data.value?.worlds?.length && !store.saveError && !store.hasPendingSave))
const disabled = computed(() => busy.value || probing.value || restoreState.blocked || !props.isVisible)
const issues = computed(() => {
  const result = []
  if (restoreState.blocked) result.push({ id: 'recovery', title: '暂时无法准备', message: '请先完成尚未结束的数据恢复。' })
  if (store.loadError) result.push({ id: 'load', title: '资料尚未安全读取', message: '请重新验证后重试，现有资料会保留。' })
  if (store.saveError) result.push({ id: 'save', title: '资料尚未保存', message: '请重试准备；成功前请勿关闭或卸载应用。' })
  if (localError.value) result.push({ id: 'operation', title: '准备未完成', message: localError.value })
  return result
})

const refreshLegacy = async () => {
  const run = revision
  probing.value = true
  try {
    const preview = await runtime.probeLegacy()
    if (!mounted || run !== revision) return
    legacyPending.value = preview?.hasLegacy === true
    interrupted.value = preview?.pending === true
  } catch {
    if (mounted && run === revision) localError.value = '无法检查现有资料，请稍后重试。'
  } finally {
    if (mounted && run === revision) probing.value = false
  }
}

const prepare = async () => {
  if (disabled.value) return
  const run = ++revision
  busy.value = true
  notice.value = ''
  localError.value = ''
  try {
    const result = await runtime.initialize({
      confirm: async () => {
        if (!mounted || run !== revision || !props.isVisible) return false
        confirming = true
        try {
          const accepted = await appConfirm(
            '准备彼方时，旧温馨小家的聊天、记忆、关系、事件和待发消息将被永久清理，无法撤销。确认后会先清理旧资料，再建立新世界；若后续准备中断，已经完成的清理也无法恢复。\n\n日程、待办、心情、体重、储蓄、密码库、全局 AI 配置和主密码会保留。你在应用外自行保存的旧备份不在清理范围内，需自行处理。\n\n是否确认清理上述旧资料并准备阿拜多斯世界？',
            { title: '准备彼方并清理旧资料？', confirmText: '确认清理并准备', cancelText: '暂不准备', destructive: true }
          )
          return mounted && run === revision && props.isVisible && accepted === true
        } finally {
          confirming = false
        }
      }
    })
    if (!mounted || run !== revision) return
    if (result?.status === 'cancelled') notice.value = '已取消本次准备。'
    else if (result?.status === 'initialized' || result?.status === 'already-initialized') notice.value = '彼方资料已安全准备。'
    else localError.value = '尚未完成身份验证，请重新验证后重试。'
    await refreshLegacy()
  } catch {
    if (mounted && run === revision) localError.value = '本次准备尚未完成。请保留应用资料，验证后重试。'
  } finally {
    if (mounted && run === revision) busy.value = false
  }
}

onMounted(refreshLegacy)
watch(() => props.isVisible, visible => {
  if (!visible && confirming) resolveFeedbackDialog(null)
})
onBeforeUnmount(() => {
  mounted = false
  revision += 1
  if (confirming) resolveFeedbackDialog(null)
})
</script>

<template>
  <section class="kanata-setup" :aria-busy="busy || probing">
    <header class="kanata-heading">
      <span class="kanata-mark" aria-hidden="true">彼</span>
      <div>
        <p class="caption body-muted">在现实之外，共同成长</p>
        <h2>彼方 · Kanata</h2>
      </div>
    </header>

    <DataStatusBanner :issues="issues" />

    <div v-if="initialized" class="kanata-card" data-test="ready">
      <h3>世界已准备好</h3>
      <dl class="kanata-counts">
        <div><dt>世界</dt><dd>{{ data.worlds.length }}</dd></div>
        <div><dt>角色实例</dt><dd>{{ data.instances.length }}</dd></div>
        <div><dt>私聊</dt><dd>{{ data.conversations.filter(item => item.type === 'private').length }}</dd></div>
        <div><dt>群聊</dt><dd>{{ data.conversations.filter(item => item.type === 'group').length }}</dd></div>
      </dl>
      <p>角色与会话已建立，聊天功能尚未开放。准备过程不会发起 AI 请求。</p>
    </div>

    <div v-else class="kanata-card" data-test="setup">
      <h3>从阿拜多斯开始</h3>
      <p>五位成员，各自的私聊与共同群聊，从没有历史消息的新世界开始。</p>
      <p v-if="legacyPending">检测到旧温馨小家资料。准备前会请你确认清理范围。</p>
      <p v-if="interrupted">上次准备尚未完成，验证后可以继续。</p>
      <p>准备过程不会生成聊天、长期记忆或已发生事件，也不会发起 AI 请求。</p>
      <button class="button-primary full-width" type="button" :disabled="disabled" @click="prepare">
        {{ busy ? '正在安全准备…' : localError || store.loadError || store.saveError ? '验证并重试准备' : '开始准备彼方' }}
      </button>
    </div>

    <p v-if="notice" class="kanata-notice" role="status">{{ notice }}</p>
    <p class="kanata-disclaimer">这是非官方同人文字预设，不含官方图像或完整台词。</p>
  </section>
</template>

<style scoped>
.kanata-setup { width: min(100%, 760px); margin: 0 auto; padding: 20px 16px 36px; box-sizing: border-box; }
.kanata-heading { display: flex; align-items: center; gap: 14px; margin: 8px 0 22px; }
.kanata-heading h2 { margin: 3px 0 0; font-size: 25px; }
.kanata-heading p { margin: 0; }
.kanata-mark { display: grid; place-items: center; width: 54px; height: 54px; border-radius: 18px; background: rgba(255,255,255,.65); font-size: 24px; color: var(--theme-primary, #607a8b); }
.kanata-card { padding: 22px; border: 1px solid rgba(255,255,255,.65); border-radius: 24px; background: rgba(255,255,255,.72); box-shadow: 0 8px 30px rgba(60,75,95,.05); }
.kanata-card h3 { margin: 0 0 12px; font-size: 19px; }
.kanata-card p { line-height: 1.8; color: #556174; overflow-wrap: anywhere; }
.kanata-card button { min-height: 48px; margin-top: 12px; }
.kanata-counts { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 8px; margin: 20px 0; }
.kanata-counts div { padding: 12px 6px; border-radius: 16px; text-align: center; background: rgba(235,241,246,.7); }
.kanata-counts dt { color: #637186; font-size: 12px; }
.kanata-counts dd { margin: 8px 0 0; font-size: 24px; font-weight: 650; color: #324357; }
.kanata-notice { padding: 0 8px; line-height: 1.7; color: #466857; }
.kanata-disclaimer { margin: 18px 8px 0; font-size: 12px; line-height: 1.8; color: #697587; }
@media (max-width: 360px) { .kanata-counts { grid-template-columns: repeat(2,minmax(0,1fr)); } .kanata-card { padding: 18px; } }
</style>
