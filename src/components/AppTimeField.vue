<script setup>
import { computed, ref } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: String, default: '08:00' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '选择时间' }
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const phase = ref('hour')
const hour = ref(8)
const minute = ref(0)
const draggingMinute = ref(false)

const padTime = value => String(value).padStart(2, '0')
const isValidTime = value => {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '')
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59)
}

const displayValue = computed(() => isValidTime(props.modelValue) ? props.modelValue : '08:00')
const selectedTime = computed(() => `${padTime(hour.value)}:${padTime(minute.value)}`)
const hourOptions = [
  ...Array.from({ length: 12 }, (_, index) => ({
    value: index === 0 ? 12 : index,
    label: index === 0 ? '12' : String(index),
    ring: 'outer',
    angle: index * 30
  })),
  ...Array.from({ length: 12 }, (_, index) => ({
    value: index === 0 ? 0 : index + 12,
    label: index === 0 ? '00' : String(index + 12),
    ring: 'inner',
    angle: index * 30
  }))
]
const minuteLabels = Array.from({ length: 12 }, (_, index) => ({
  value: index * 5,
  label: padTime(index * 5),
  angle: index * 30
}))
const minuteTicks = Array.from({ length: 60 }, (_, value) => ({
  value,
  angle: value * 6
}))

const positionOnDial = (angle, radius) => {
  const radians = angle * Math.PI / 180
  return {
    left: `${50 + Math.sin(radians) * radius}%`,
    top: `${50 - Math.cos(radians) * radius}%`
  }
}

const showPicker = () => {
  if (props.disabled) return
  const [currentHour = '08', currentMinute = '00'] = displayValue.value.split(':')
  hour.value = Number(currentHour)
  minute.value = Number(currentMinute)
  phase.value = 'hour'
  open.value = true
}

const selectHour = value => {
  hour.value = value
  phase.value = 'minute'
}

const setMinuteFromPointer = event => {
  const rect = event.currentTarget.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const angle = (Math.atan2(event.clientX - centerX, centerY - event.clientY) * 180 / Math.PI + 360) % 360
  minute.value = Math.round(angle / 6) % 60
}

const handleDialPointer = event => {
  if (phase.value !== 'minute') return
  draggingMinute.value = true
  event.currentTarget.setPointerCapture?.(event.pointerId)
  setMinuteFromPointer(event)
}

const moveDialPointer = event => {
  if (phase.value === 'minute' && draggingMinute.value) setMinuteFromPointer(event)
}

const stopDialPointer = event => {
  if (!draggingMinute.value) return
  setMinuteFromPointer(event)
  draggingMinute.value = false
}

const adjustMinute = delta => {
  minute.value = (minute.value + delta + 60) % 60
}

const handleDialKey = event => {
  if (phase.value !== 'minute') return
  if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
    event.preventDefault()
    adjustMinute(1)
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
    event.preventDefault()
    adjustMinute(-1)
  }
}

const save = () => {
  emit('update:modelValue', selectedTime.value)
  open.value = false
}
</script>

<template>
  <button
    v-bind="$attrs"
    type="button"
    class="app-time-field"
    :disabled="disabled"
    :aria-label="ariaLabel"
    @click="showPicker"
  >
    <span>{{ displayValue }}</span>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v5l3.3 2M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Z" /></svg>
  </button>

  <Teleport to="body">
    <Transition name="time-rise">
      <div v-if="open" class="time-picker-mask" @click="open = false">
        <section
          class="time-picker-sheet"
          role="dialog"
          aria-modal="true"
          :aria-label="ariaLabel"
          @click.stop
          @keydown.esc="open = false"
        >
          <div class="time-handle"></div>
          <header>
            <div>
              <small>{{ phase === 'hour' ? '选择小时' : '选择分钟 · 精确到 1 分钟' }}</small>
              <div class="time-display" aria-label="当前选择时间">
                <button type="button" :class="{ active: phase === 'hour' }" @click="phase = 'hour'">{{ padTime(hour) }}</button>
                <span>:</span>
                <button type="button" :class="{ active: phase === 'minute' }" @click="phase = 'minute'">{{ padTime(minute) }}</button>
              </div>
            </div>
            <button class="confirm-button" type="button" @click="save">确定</button>
          </header>

          <div
            class="clock-dial"
            :class="{ 'minute-mode': phase === 'minute' }"
            :role="phase === 'minute' ? 'slider' : undefined"
            :tabindex="phase === 'minute' ? 0 : -1"
            :aria-valuemin="phase === 'minute' ? 0 : undefined"
            :aria-valuemax="phase === 'minute' ? 59 : undefined"
            :aria-valuenow="phase === 'minute' ? minute : undefined"
            aria-label="分钟转盘"
            @pointerdown="handleDialPointer"
            @pointermove="moveDialPointer"
            @pointerup="stopDialPointer"
            @pointercancel="draggingMinute = false"
            @keydown="handleDialKey"
          >
            <template v-if="phase === 'hour'">
              <button
                v-for="item in hourOptions"
                :key="item.value"
                type="button"
                class="dial-number hour-number"
                :class="[item.ring, { selected: hour === item.value }]"
                :style="positionOnDial(item.angle, item.ring === 'outer' ? 42 : 27)"
                @click="selectHour(item.value)"
              >
                {{ item.label }}
              </button>
            </template>

            <template v-else>
              <span
                v-for="tick in minuteTicks"
                :key="tick.value"
                class="minute-tick"
                :class="{ major: tick.value % 5 === 0, selected: minute === tick.value }"
                :style="positionOnDial(tick.angle, 47)"
              ></span>
              <span
                class="dial-hand"
                :style="{ transform: `translateX(-50%) rotate(${minute * 6}deg)` }"
              >
                <i></i>
              </span>
              <button
                v-for="item in minuteLabels"
                :key="item.value"
                type="button"
                class="dial-number minute-number"
                :class="{ selected: minute === item.value }"
                :style="positionOnDial(item.angle, 39)"
                @click="minute = item.value"
              >
                {{ item.label }}
              </button>
              <span class="dial-center"></span>
            </template>
          </div>

          <footer v-if="phase === 'minute'" class="minute-stepper">
            <button type="button" aria-label="减少一分钟" @click="adjustMinute(-1)">−</button>
            <div><strong>{{ padTime(minute) }}</strong><small>分钟</small></div>
            <button type="button" aria-label="增加一分钟" @click="adjustMinute(1)">＋</button>
          </footer>
          <p class="picker-tip">
            {{ phase === 'hour' ? '选择小时后自动进入分钟转盘' : '拖动指针或点击刻度，也可以逐分钟微调' }}
          </p>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.app-time-field { display: flex; align-items: center; justify-content: space-between; gap: 7px; min-height: 40px; color: inherit; font: inherit; text-align: left; }
.app-time-field svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; opacity: .72; }
.app-time-field:disabled { opacity: .45; }
.time-picker-mask { position: fixed; inset: 0; z-index: 18000; display: flex; align-items: flex-end; background: rgba(15,20,31,.34); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.time-picker-sheet { width: 100%; max-height: 92vh; overflow-y: auto; padding: 8px 18px calc(18px + env(safe-area-inset-bottom)); border: 1px solid rgba(255,255,255,.8); border-radius: 28px 28px 0 0; background: rgba(251,252,255,.98); box-shadow: 0 -18px 55px rgba(22,30,45,.18); }
.time-handle { width: 42px; height: 5px; margin: 2px auto 12px; border-radius: 999px; background: #d4d8df; }
header { display: flex; align-items: center; justify-content: space-between; padding: 1px 4px 10px; }
header small { display: block; margin-bottom: 5px; color: #8b929e; font-size: 11px; }
.time-display { display: flex; align-items: center; gap: 4px; color: #98a0ad; font-size: 27px; font-weight: 700; }
.time-display button { min-width: 52px; padding: 4px 7px; border: 0; border-radius: 11px; background: transparent; color: #7f8794; font: inherit; }
.time-display button.active { background: #e8f3ff; color: var(--primary, #0066cc); }
.confirm-button { padding: 10px 15px; border: 0; border-radius: 13px; background: linear-gradient(145deg, #2387ec, #0762c3); box-shadow: 0 7px 16px rgba(0,102,204,.2); color: #fff; font-size: 14px; font-weight: 700; }
.clock-dial { position: relative; width: min(76vw, 310px); aspect-ratio: 1; margin: 2px auto 7px; border: 1px solid rgba(205,214,226,.78); border-radius: 50%; background: radial-gradient(circle at 50% 46%, #fff 0 23%, #f5f8fc 24% 64%, #edf2f8 100%); box-shadow: inset 0 1px 1px rgba(255,255,255,.9), 0 14px 35px rgba(45,61,82,.11); touch-action: none; user-select: none; }
.clock-dial.minute-mode { cursor: crosshair; }
.dial-number { position: absolute; z-index: 4; display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: #2f3744; font-size: 13px; font-weight: 650; transform: translate(-50%, -50%); }
.dial-number.inner { width: 31px; height: 31px; color: #8490a0; font-size: 11px; }
.dial-number.selected { background: linear-gradient(145deg, #2789ed, #0860ba); box-shadow: 0 5px 13px rgba(0,102,204,.25); color: #fff; }
.minute-number { width: 37px; height: 37px; font-size: 12px; }
.minute-tick { position: absolute; z-index: 1; width: 3px; height: 3px; border-radius: 50%; background: #c5ceda; transform: translate(-50%, -50%); }
.minute-tick.major { width: 5px; height: 5px; background: #a8b3c1; }
.minute-tick.selected { width: 8px; height: 8px; background: var(--primary, #0066cc); box-shadow: 0 0 0 4px rgba(0,102,204,.12); }
.dial-hand { position: absolute; z-index: 2; top: 16%; left: 50%; width: 2px; height: 34%; border-radius: 999px; background: linear-gradient(to top, var(--primary, #0066cc), #49a7ff); transform-origin: 50% 100%; pointer-events: none; }
.dial-hand i { position: absolute; top: -6px; left: 50%; width: 14px; height: 14px; border: 3px solid #fff; border-radius: 50%; background: var(--primary, #0066cc); box-shadow: 0 3px 9px rgba(0,102,204,.32); transform: translateX(-50%); }
.dial-center { position: absolute; z-index: 3; top: 50%; left: 50%; width: 11px; height: 11px; border: 3px solid #fff; border-radius: 50%; background: var(--primary, #0066cc); box-shadow: 0 2px 7px rgba(0,102,204,.26); transform: translate(-50%, -50%); pointer-events: none; }
.minute-stepper { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 3px; }
.minute-stepper button { display: grid; place-items: center; width: 42px; height: 38px; border: 1px solid #e1e7ef; border-radius: 13px; background: #f3f7fb; color: var(--primary, #0066cc); font-size: 22px; font-weight: 600; }
.minute-stepper div { display: flex; align-items: baseline; justify-content: center; gap: 5px; min-width: 84px; }
.minute-stepper strong { color: #202936; font-size: 21px; }
.minute-stepper small { color: #9299a5; font-size: 11px; }
.picker-tip { margin: 8px 0 0; color: #9299a5; font-size: 11px; text-align: center; }
.time-rise-enter-active, .time-rise-leave-active { transition: opacity .2s ease; }
.time-rise-enter-active .time-picker-sheet, .time-rise-leave-active .time-picker-sheet { transition: transform .28s cubic-bezier(.2,.8,.2,1); }
.time-rise-enter-from, .time-rise-leave-to { opacity: 0; }
.time-rise-enter-from .time-picker-sheet, .time-rise-leave-to .time-picker-sheet { transform: translateY(100%); }

@media (max-height: 720px) {
  .clock-dial { width: min(66vw, 260px); }
  .time-picker-sheet { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
}
</style>
