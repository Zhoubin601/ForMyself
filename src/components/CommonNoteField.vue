<script setup>
import { computed, ref, onMounted, onBeforeUnmount, nextTick, useId } from 'vue'
import { useSettingsStore } from '../stores/settings.js'
import { normalizeNote } from '../services/commonNotes.js'
import { appAlert, appConfirm } from '../services/uiFeedback.js'
import { registerBackHandler } from '../services/backNavigation.js'
const props = defineProps({ modelValue: { type: String, default: '' }, scope: { type: String, required: true, validator: value => ['weight', 'savings'].includes(value) }, placeholder: { type: String, default: '输入备注或选择常用备注' } })
const emit = defineEmits(['update:modelValue'])
const settings = useSettingsStore()
const open = ref(false)
const editing = ref(null)
const draft = ref('')
const root = ref(null)
const popup = ref(null)
const managing = ref(false)
const active = ref(-1)
const popupStyle = ref({})
const listId = useId()
const position = () => {
  if (!open.value || !root.value) return
  const rect = root.value.querySelector('.note-input').getBoundingClientRect()
  const viewport = window.visualViewport
  const top = viewport?.offsetTop || 0
  const bottom = top + (viewport?.height || window.innerHeight)
  const below = bottom - rect.bottom - 12
  const above = rect.top - top - 12
  const upwards = below < 180 && above > below
  const height = Math.max(44, Math.min(240, upwards ? above : below))
  popupStyle.value = { left: `${rect.left}px`, width: `${rect.width}px`, maxHeight: `${height}px`, top: `${upwards ? rect.top - 6 : rect.bottom + 6}px`, transform: upwards ? 'translateY(-100%)' : 'none' }
}
const toggle = async () => {
  open.value = !open.value
  active.value = notes.value.indexOf(normalizeNote(props.modelValue))
  await nextTick(); position()
}
const select = note => { emit('update:modelValue', note); open.value = false }
const keydown = async event => {
  if (event.key === 'Escape') { open.value = false; return }
  if (event.key === 'Enter' && open.value && active.value >= 0) { event.preventDefault(); select(notes.value[active.value]); return }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
  event.preventDefault()
  if (!open.value) await toggle()
  active.value = notes.value.length ? (active.value + (event.key === 'ArrowDown' ? 1 : -1) + notes.value.length) % notes.value.length : -1
  await nextTick(); popup.value?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
}
const outside = event => { if (!root.value?.contains(event.target) && !popup.value?.contains(event.target)) open.value = false }
const manage = () => { open.value = false; managing.value = true }
const closeManager = () => { editing.value = null; managing.value = false }
const notes = computed(() => settings.commonNotes?.[props.scope] || [])
const replaceNotes = list => { settings.commonNotes = { ...settings.commonNotes, [props.scope]: list } }
const save = () => {
  const note = normalizeNote(props.modelValue)
  if (!note) return appAlert('请先输入备注')
  if (notes.value.includes(note)) return appAlert('这条备注已保存为常用')
  replaceNotes([...notes.value, note])
}
const rename = old => {
  const note = normalizeNote(draft.value)
  if (!note || (note !== old && notes.value.includes(note))) return appAlert('备注不能为空或重复')
  replaceNotes(notes.value.map(item => item === old ? note : item)); editing.value = null
}
const remove = async note => {
  if (await appConfirm('历史记录中的备注会保留。', { title: '删除常用备注？', destructive: true })) replaceNotes(notes.value.filter(item => item !== note))
}
const unregister = registerBackHandler(() => {
  if (editing.value !== null) { editing.value = null; return true }
  if (managing.value) { closeManager(); return true }
  if (open.value) { open.value = false; return true }
  return false
}, { priority: 600, isActive: () => open.value || managing.value })
onMounted(() => {
  document.addEventListener('pointerdown', outside)
  window.addEventListener('resize', position)
  window.addEventListener('scroll', position, true)
  window.visualViewport?.addEventListener('resize', position)
  window.visualViewport?.addEventListener('scroll', position)
})
onBeforeUnmount(() => {
  unregister()
  document.removeEventListener('pointerdown', outside)
  window.removeEventListener('resize', position)
  window.removeEventListener('scroll', position, true)
  window.visualViewport?.removeEventListener('resize', position)
  window.visualViewport?.removeEventListener('scroll', position)
})
</script>

<template>
  <div ref="root" class="common-note">
    <div class="note-input">
      <input :value="modelValue" class="apple-input" :placeholder="placeholder" aria-label="备注" role="combobox" aria-autocomplete="none" :aria-expanded="open" :aria-controls="listId" :aria-activedescendant="open && active >= 0 ? listId + '-' + active : undefined" @keydown="keydown" @input="emit('update:modelValue', $event.target.value); active = -1" />
      <button type="button" :aria-expanded="open" aria-label="展开常用备注" @click="toggle">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" :class="{ rotated: open }"><path d="m6 9 6 6 6-6" /></svg>
      </button>
    </div>
    <div class="note-tools"><button type="button" class="text-link" @click="save">保存为常用</button><button type="button" class="text-link" @click="manage">管理</button></div>
    <Teleport to="body">
      <div v-if="open" :id="listId" ref="popup" class="note-options" :style="popupStyle" role="listbox" aria-label="常用备注">
        <p v-if="!notes.length" class="note-empty">暂无常用备注，输入后可保存</p>
        <button v-for="(note, index) in notes" :id="listId + '-' + index" :key="note" type="button" class="note-select" role="option" :aria-selected="normalizeNote(modelValue) === note" :data-active="active === index" @pointerdown.prevent @click="select(note)"><span>{{ note }}</span><span v-if="normalizeNote(modelValue) === note" aria-hidden="true">✓</span></button>
      </div>
      <div v-if="managing" class="note-manager-backdrop" @click.self="closeManager" @keydown.esc.stop="closeManager">
        <section class="note-manager" role="dialog" aria-modal="true" aria-label="管理常用备注">
          <header><strong>管理常用备注</strong><button type="button" class="text-link" @click="closeManager">完成</button></header>
          <p class="note-empty">修改常用项不会改变历史记录中的备注</p>
          <p v-if="!notes.length" class="note-empty">还没有常用备注</p>
          <div v-for="note in notes" :key="note" class="note-option">
            <template v-if="editing === note"><input v-model="draft" class="apple-input" aria-label="修改常用备注" @keyup.enter="rename(note)" /><button type="button" class="text-link" @click="rename(note)">保存</button><button type="button" class="text-link" @click="editing = null">取消</button></template>
            <template v-else><span class="note-name">{{ note }}</span><button type="button" class="text-link" @click="editing = note; draft = note">改名</button><button type="button" class="text-link danger-text" @click="remove(note)">删除</button></template>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.common-note{min-width:0;width:100%}
.note-input{position:relative}
.note-input input{width:100%;padding-right:48px;box-sizing:border-box}
.note-input>button{position:absolute;right:2px;top:2px;bottom:2px;width:44px;min-height:44px;display:grid;place-items:center;border:0;background:transparent;color:var(--accent,#477ba0);border-radius:12px}
.note-input svg{transition:transform .18s}.note-input svg.rotated{transform:rotate(180deg)}
.note-tools{display:flex;align-items:center;justify-content:space-between}
.note-tools button{min-height:36px;font-size:12px}
.note-options{position:fixed;z-index:10020;overflow:auto;overscroll-behavior:contain;box-sizing:border-box;padding:4px;border:1px solid var(--hairline);border-radius:12px;background:var(--canvas,#fff);color:var(--ink);box-shadow:0 8px 28px #0002}
.note-select{display:flex;justify-content:space-between;gap:12px;width:100%;min-height:44px;padding:10px 12px;border:0;border-radius:8px;background:transparent;color:var(--ink);text-align:left;font:inherit;font-size:14px;overflow-wrap:anywhere}
.note-select[aria-selected=true],.note-select[data-active=true],.note-select:hover{background:color-mix(in srgb,var(--accent,#477ba0) 10%,transparent)}
.note-empty{font-size:12px;color:var(--ink-secondary,#888);padding:8px;margin:0;line-height:1.6}
.note-manager-backdrop{position:fixed;inset:0;z-index:10030;background:#0005;display:flex;align-items:center;justify-content:center;padding:16px}
.note-manager{width:100%;max-width:400px;max-height:70dvh;overflow:auto;box-sizing:border-box;padding:16px;border-radius:18px;background:var(--canvas,#fff);color:var(--ink)}
.note-manager header{display:flex;align-items:center;justify-content:space-between}
.note-manager button{min-height:44px}
.note-option{display:flex;align-items:center;gap:10px;border-top:1px solid var(--hairline);padding:4px 0}
.note-option input,.note-name{min-width:0;flex:1;overflow-wrap:anywhere}
.note-option button{flex-shrink:0;font-size:12px}
@media(prefers-reduced-motion:reduce){.note-input svg{transition:none}}
</style>
