<script setup>
import { reactive, ref, watch } from 'vue'
import { clampColorValue, hexToHsv, hsvToHex } from '../services/colorPicker.js'
const props = defineProps({ modelValue: { type: String, default: '#FF9F43' }, label: { type: String, default: '心情颜色' } })
const emit = defineEmits(['update:modelValue'])
const hsv = reactive({ hue: 0, saturation: 100, value: 100 })
const hex = ref(props.modelValue)
watch(() => props.modelValue, color => {
  hex.value = color
  // Keep hue and cursor stable while dragging through grey/black.
  if (hsvToHex(hsv.hue, hsv.saturation, hsv.value).toLowerCase() === color.toLowerCase()) return
  const parsed = hexToHsv(color)
  if (parsed) Object.assign(hsv, parsed)
}, { immediate: true })
const apply = () => emit('update:modelValue', hsvToHex(hsv.hue, hsv.saturation, hsv.value))
const fromHex = () => {
  if (hexToHsv(hex.value)) emit('update:modelValue', hex.value.toUpperCase())
  else hex.value = props.modelValue
}
const pointer = event => {
  if (event.type === 'pointerdown') event.currentTarget.setPointerCapture(event.pointerId)
  if (event.type === 'pointermove' && !event.currentTarget.hasPointerCapture(event.pointerId)) return
  const rect = event.currentTarget.getBoundingClientRect()
  hsv.saturation = clampColorValue((event.clientX - rect.left) / rect.width * 100)
  hsv.value = clampColorValue(100 - (event.clientY - rect.top) / rect.height * 100)
  apply()
}
const keyboard = event => {
  const step = event.shiftKey ? 10 : 1
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'ArrowLeft') hsv.saturation = clampColorValue(hsv.saturation - step)
  if (event.key === 'ArrowRight') hsv.saturation = clampColorValue(hsv.saturation + step)
  if (event.key === 'ArrowUp') hsv.value = clampColorValue(hsv.value + step)
  if (event.key === 'ArrowDown') hsv.value = clampColorValue(hsv.value - step)
  apply()
}
</script>

<template>
  <div class="color-palette">
    <div class="palette-heading"><span>{{ label }}</span><i :style="{ background: modelValue }"></i></div>
    <div class="palette-board" :style="{ backgroundColor: `hsl(${hsv.hue}, 100%, 50%)` }" role="slider" tabindex="0" :aria-label="`${label}的饱和度与亮度`" :aria-valuetext="modelValue" @pointerdown="pointer" @pointermove="pointer" @keydown="keyboard">
      <span :style="{ left: `${hsv.saturation}%`, top: `${100 - hsv.value}%` }"></span>
    </div>
    <input v-model.number="hsv.hue" class="palette-hue" type="range" min="0" max="359" :aria-label="`${label}色相`" @input="apply" />
    <label class="palette-hex">HEX <input v-model="hex" class="apple-input" maxlength="7" :aria-label="`${label} HEX`" @change="fromHex" @blur="fromHex" /></label>
  </div>
</template>

<style scoped>
.color-palette { width:100%; min-width:0; display:grid; gap:10px; padding:12px; box-sizing:border-box; border:1px solid var(--hairline); border-radius:14px; }
.palette-heading { display:flex; justify-content:space-between; align-items:center; font-size:13px; }
.palette-heading i { width:26px; height:26px; border-radius:50%; border:1px solid var(--hairline); }
.palette-board { height:130px; position:relative; border-radius:8px; background-image:linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,transparent); touch-action:none; }
.palette-board span { position:absolute; width:14px; height:14px; border:2px solid white; box-shadow:0 0 0 1px #777; border-radius:50%; transform:translate(-50%,-50%); pointer-events:none; }
.palette-hue { appearance:none; -webkit-appearance:none; width:100%; margin:5px 0; height:20px; background:linear-gradient(to right,red,yellow,lime,cyan,blue,magenta,red); border-radius:15px; cursor:pointer; }
.palette-hue::-webkit-slider-thumb { appearance:none; -webkit-appearance:none; width:26px; height:26px; border:3px solid white; border-radius:50%; background:var(--primary); box-shadow:0 0 0 1px #777; }
.palette-hue::-moz-range-thumb { width:20px; height:20px; border:3px solid white; border-radius:50%; background:var(--primary); box-shadow:0 0 0 1px #777; }
.palette-hex { display:flex; align-items:center; gap:10px; font-size:12px; }
.palette-hex input { flex:1; min-width:0; }
</style>
