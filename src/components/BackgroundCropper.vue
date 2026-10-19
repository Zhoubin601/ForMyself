<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { backgroundCropAroundPoint, backgroundCropRect, cropOutputSize } from '../services/backgroundCrop.js'
import { registerBackHandler } from '../services/backNavigation.js'

const props = defineProps({ source: { type: String, required: true }, saving: Boolean })
const emit = defineEmits(['cancel', 'confirm'])
const dialog = ref(null)
const image = ref(null)
const frame = ref(null)
const width = ref(0), height = ref(0), zoom = ref(1), x = ref(50), y = ref(50)
const aspect = ref(window.innerWidth / window.innerHeight)
const error = ref('')
const previousFocus = document.activeElement
const pointers = new Map()
let gesture = null
const crop = computed(() => width.value && height.value ? backgroundCropRect(width.value, height.value, aspect.value, zoom.value, x.value, y.value) : null)
const imageStyle = computed(() => crop.value ? {
  width: `${width.value / crop.value.width * 100}%`,
  height: `${height.value / crop.value.height * 100}%`,
  left: `${-crop.value.x / crop.value.width * 100}%`,
  top: `${-crop.value.y / crop.value.height * 100}%`
} : { visibility: 'hidden' })
const cancel = () => { if (!props.saving) emit('cancel') }
const unregisterBack = registerBackHandler(() => { cancel(); return true }, { priority: 900 })
onMounted(async () => { await nextTick(); dialog.value?.querySelector('button')?.focus() })
onBeforeUnmount(() => { unregisterBack(); previousFocus?.focus?.() })

const loaded = () => {
  width.value = image.value.naturalWidth
  height.value = image.value.naturalHeight
}
const reset = () => { zoom.value = 1; x.value = 50; y.value = 50; pointers.clear(); gesture = null }
const startGesture = () => {
  const points = [...pointers.values()]
  const bounds = frame.value.getBoundingClientRect()
  if (!crop.value || !points.length || !bounds.width || !bounds.height) { gesture = null; return }
  if (points.length === 1) {
    gesture = { type: 'drag', point: points[0], startX: x.value, startY: y.value, bounds }
    return
  }
  const [first, second] = points
  const center = { x: ((first.x + second.x) / 2 - bounds.left) / bounds.width, y: ((first.y + second.y) / 2 - bounds.top) / bounds.height }
  gesture = {
    type: 'pinch', bounds, zoom: zoom.value,
    distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
    anchor: { x: crop.value.x + center.x * crop.value.width, y: crop.value.y + center.y * crop.value.height }
  }
}
const pointerDown = event => {
  if (!crop.value || props.saving || (event.pointerType === 'mouse' && event.button !== 0) || pointers.size >= 2) return
  frame.value.setPointerCapture?.(event.pointerId)
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  startGesture()
}
const pointerMove = event => {
  if (!gesture || !pointers.has(event.pointerId) || props.saving) return
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  const bounds = gesture.bounds
  if (gesture.type === 'pinch') {
    const [first, second] = [...pointers.values()]
    const state = backgroundCropAroundPoint(width.value, height.value, aspect.value,
      gesture.zoom * Math.hypot(first.x - second.x, first.y - second.y) / gesture.distance,
      gesture.anchor,
      { x: ((first.x + second.x) / 2 - bounds.left) / bounds.width, y: ((first.y + second.y) / 2 - bounds.top) / bounds.height })
    zoom.value = state.zoom; x.value = state.x; y.value = state.y
    return
  }
  const overflowX = (width.value / crop.value.width - 1) * bounds.width
  const overflowY = (height.value / crop.value.height - 1) * bounds.height
  if (overflowX > .1) x.value = Math.max(0, Math.min(100, gesture.startX - (event.clientX - gesture.point.x) / overflowX * 100))
  if (overflowY > .1) y.value = Math.max(0, Math.min(100, gesture.startY - (event.clientY - gesture.point.y) / overflowY * 100))
}
const pointerEnd = event => {
  if (!pointers.delete(event.pointerId)) return
  startGesture()
}
const frameKey = event => {
  if (props.saving) return
  const changes = { ArrowLeft: [2, 0], ArrowRight: [-2, 0], ArrowUp: [0, 2], ArrowDown: [0, -2] }
  const change = changes[event.key]
  if (!change) return
  event.preventDefault()
  x.value = Math.max(0, Math.min(100, x.value + change[0]))
  y.value = Math.max(0, Math.min(100, y.value + change[1]))
}
const keydown = event => {
  if (event.key === 'Escape') { event.stopPropagation(); cancel() }
  if (event.key !== 'Tab') return
  const focusable = [...dialog.value.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
  const first = focusable[0], last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
const confirm = () => {
  if (!crop.value || props.saving) return
  try {
    const canvas = document.createElement('canvas')
    const size = cropOutputSize(crop.value)
    canvas.width = size.width; canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('CANVAS_UNAVAILABLE')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size.width, size.height)
    const rect = crop.value
    ctx.drawImage(image.value, rect.x, rect.y, rect.width, rect.height, 0, 0, size.width, size.height)
    const result = canvas.toDataURL('image/jpeg', .9)
    if (!result.startsWith('data:image/jpeg')) throw new Error('IMAGE_EXPORT_FAILED')
    emit('confirm', result)
  } catch { error.value = '图片处理失败，请重试或换一张图片。' }
}
</script>

<template>
  <Teleport to="body">
    <div class="background-crop-mask" @keydown="keydown" @click.self="cancel">
      <section ref="dialog" class="background-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="background-crop-title" :aria-busy="saving">
        <header><button type="button" :disabled="saving" @click="cancel">取消</button><h2 id="background-crop-title">裁剪背景图片</h2><button type="button" :disabled="saving" @click="reset">重置</button></header>
        <p id="background-crop-hint">单指拖动、双指缩放，也可用下方滑块调整。裁剪框按当前屏幕比例显示。</p>
        <div class="background-crop-stage">
          <div ref="frame" class="background-crop-frame" :style="{ aspectRatio: aspect, width: `min(100%, ${48 * aspect}dvh)` }" tabindex="0" role="group" aria-label="图片裁剪区域，可使用方向键移动图片" aria-describedby="background-crop-hint" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerEnd" @pointercancel="pointerEnd" @lostpointercapture="pointerEnd" @keydown="frameKey">
            <img ref="image" :src="source" :style="imageStyle" alt="" draggable="false" @load="loaded" @error="error = '图片无法显示，请重新选择。'" />
            <div class="background-crop-grid" aria-hidden="true"></div>
          </div>
        </div>
        <label class="background-crop-zoom" for="background-crop-zoom"><span>缩放</span><output>{{ Math.round(zoom * 100) }}%</output></label>
        <input id="background-crop-zoom" v-model.number="zoom" type="range" min="1" max="3" step="0.01" :disabled="saving" :aria-valuetext="`${Math.round(zoom * 100)}%`" />
        <p v-if="error" class="background-crop-error" role="alert">{{ error }}</p>
        <button type="button" class="button-primary" :disabled="!crop || saving || Boolean(error)" @click="confirm">{{ saving ? '正在保存…' : '使用此背景' }}</button>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.background-crop-mask { position: fixed; inset: 0; z-index: 19000; display: grid; place-items: center; padding: max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom)); background: rgba(15, 20, 31, .6); }
.background-crop-dialog { width: min(100%, 520px); max-height: 100%; overflow: auto; padding: 16px; border: 1px solid var(--hairline); border-radius: 24px; background: var(--component-panel); color: var(--ink); box-shadow: var(--shadow-panel); }
header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
header h2 { margin: 0; font-size: 17px; }
header button { min-width: 44px; min-height: 44px; padding: 0 4px; color: var(--primary); background: transparent; border: 0; font: inherit; }
p { margin: 8px 0 12px; color: #535b68; font-size: 13px; line-height: 1.6; }
.background-crop-stage { display: grid; place-items: center; padding: 12px; border-radius: 14px; background: #1d222b; overflow: hidden; }
.background-crop-frame { position: relative; overflow: hidden; outline: 2px solid #fff; cursor: grab; touch-action: none; }
.background-crop-frame:active { cursor: grabbing; }
.background-crop-frame img { position: absolute; max-width: none; pointer-events: none; user-select: none; }
.background-crop-grid { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(to right, transparent calc(100% / 3 - .5px), #ffffff70 calc(100% / 3), transparent calc(100% / 3 + .5px), transparent calc(200% / 3 - .5px), #ffffff70 calc(200% / 3), transparent calc(200% / 3 + .5px)), linear-gradient(to bottom, transparent calc(100% / 3 - .5px), #ffffff70 calc(100% / 3), transparent calc(100% / 3 + .5px), transparent calc(200% / 3 - .5px), #ffffff70 calc(200% / 3), transparent calc(200% / 3 + .5px)); }
.background-crop-zoom { display: flex; justify-content: space-between; margin-top: 16px; font-size: 14px; }
.background-crop-zoom output { color: var(--primary); font-variant-numeric: tabular-nums; }
input[type=range] { width: 100%; min-height: 44px; margin: 0 0 8px; accent-color: var(--primary); touch-action: pan-y; }
.background-crop-error { color: #b42318; }
.button-primary { width: 100%; min-height: 48px; }
button:disabled { opacity: .5; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.background-crop-frame:focus-visible { outline: 3px solid #72d1bd; outline-offset: 3px; }
</style>
