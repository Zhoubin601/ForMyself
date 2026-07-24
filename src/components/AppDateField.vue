<script setup>
import { computed, ref, watch } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: String, default: '' },
  min: { type: String, default: '' },
  max: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '选择日期' }
})

const emit = defineEmits(['update:modelValue'])
const open = ref(false)
const cursor = ref('')

const localToday = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const normalizedValue = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(props.modelValue) ? props.modelValue : localToday())
const displayValue = computed(() => {
  const [year, month, day] = normalizedValue.value.split('-').map(Number)
  return `${year}年${month}月${day}日`
})

const cursorDate = computed(() => {
  const [year, month] = (cursor.value || normalizedValue.value.slice(0, 7)).split('-').map(Number)
  return { year, month }
})
const monthLabel = computed(() => `${cursorDate.value.year}年 ${cursorDate.value.month}月`)
const calendarDays = computed(() => {
  const { year, month } = cursorDate.value
  const count = new Date(year, month, 0).getDate()
  const offset = new Date(year, month - 1, 1).getDay()
  const result = Array.from({ length: offset }, () => null)
  for (let day = 1; day <= count; day++) {
    const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    result.push({
      day,
      value,
      selected: value === props.modelValue,
      today: value === localToday(),
      disabled: (props.min && value < props.min) || (props.max && value > props.max)
    })
  }
  return result
})

const showPicker = () => {
  if (props.disabled) return
  cursor.value = normalizedValue.value.slice(0, 7)
  open.value = true
}
const moveMonth = offset => {
  const { year, month } = cursorDate.value
  const next = new Date(year, month - 1 + offset, 1)
  cursor.value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
}
const choose = item => {
  if (!item || item.disabled) return
  emit('update:modelValue', item.value)
  open.value = false
}

watch(() => props.modelValue, value => {
  if (open.value && value) cursor.value = value.slice(0, 7)
})
</script>

<template>
  <button
    v-bind="$attrs"
    type="button"
    class="app-date-field"
    :disabled="disabled"
    :aria-label="ariaLabel"
    @click="showPicker"
  >
    <span>{{ displayValue }}</span>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" /></svg>
  </button>

  <Teleport to="body">
    <Transition name="picker-rise">
      <div v-if="open" class="app-picker-mask" @click="open = false">
        <section class="date-picker-sheet" role="dialog" aria-modal="true" :aria-label="ariaLabel" @click.stop>
          <div class="picker-handle"></div>
          <header>
            <div>
              <small>选择日期</small>
              <strong>{{ monthLabel }}</strong>
            </div>
            <button type="button" aria-label="关闭日期选择" @click="open = false">完成</button>
          </header>
          <div class="month-navigation">
            <button type="button" aria-label="上个月" @click="moveMonth(-1)">‹</button>
            <button type="button" class="today-button" @click="cursor = localToday().slice(0, 7)">回到本月</button>
            <button type="button" aria-label="下个月" @click="moveMonth(1)">›</button>
          </div>
          <div class="weekday-row">
            <span v-for="label in ['日','一','二','三','四','五','六']" :key="label">{{ label }}</span>
          </div>
          <div class="calendar-grid">
            <span v-for="(item, index) in calendarDays" :key="item?.value || `blank-${index}`">
              <button
                v-if="item"
                type="button"
                :disabled="item.disabled"
                :class="{ selected: item.selected, today: item.today }"
                @click="choose(item)"
              >
                {{ item.day }}
              </button>
            </span>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.app-date-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 44px;
  color: inherit;
  font: inherit;
  text-align: left;
}
.app-date-field svg { width: 18px; height: 18px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; opacity: .72; }
.app-date-field:disabled { opacity: .45; }
.app-picker-mask { position: fixed; inset: 0; z-index: 18000; display: flex; align-items: flex-end; background: rgba(15,20,31,.34); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.date-picker-sheet {
  width: 100%;
  padding: 8px 18px calc(20px + env(safe-area-inset-bottom));
  border: 1px solid rgba(255,255,255,.8);
  border-radius: 28px 28px 0 0;
  background: rgba(251,252,255,.98);
  box-shadow: 0 -18px 55px rgba(22,30,45,.18);
}
.picker-handle { width: 42px; height: 5px; margin: 2px auto 14px; border-radius: 999px; background: #d4d8df; }
header { display: flex; align-items: center; justify-content: space-between; padding: 3px 4px 14px; }
header small, header strong { display: block; }
header small { margin-bottom: 2px; color: #8b929e; font-size: 11px; }
header strong { color: #1d2432; font-size: 21px; }
header button, .month-navigation button { border: 0; background: none; color: var(--primary, #0066cc); font: inherit; }
header button { padding: 8px; font-size: 15px; font-weight: 650; }
.month-navigation { display: grid; grid-template-columns: 44px 1fr 44px; align-items: center; margin-bottom: 6px; }
.month-navigation button { min-height: 40px; font-size: 26px; }
.month-navigation .today-button { justify-self: center; padding: 5px 13px; border-radius: 999px; background: #edf5ff; font-size: 12px; font-weight: 650; }
.weekday-row, .calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; }
.weekday-row { padding: 6px 0; color: #9298a3; font-size: 11px; }
.calendar-grid { row-gap: 4px; }
.calendar-grid > span { display: grid; place-items: center; min-height: 42px; }
.calendar-grid button { width: 38px; height: 38px; border: 0; border-radius: 13px; background: transparent; color: #313846; font-size: 14px; }
.calendar-grid button.today { box-shadow: inset 0 0 0 1px rgba(0,102,204,.24); color: var(--primary, #0066cc); }
.calendar-grid button.selected { background: linear-gradient(145deg, #2789ed, #0860ba); box-shadow: 0 7px 16px rgba(0,102,204,.23); color: #fff; font-weight: 700; }
.calendar-grid button:disabled { opacity: .24; }
.picker-rise-enter-active, .picker-rise-leave-active { transition: opacity .2s ease; }
.picker-rise-enter-active .date-picker-sheet, .picker-rise-leave-active .date-picker-sheet { transition: transform .28s cubic-bezier(.2,.8,.2,1); }
.picker-rise-enter-from, .picker-rise-leave-to { opacity: 0; }
.picker-rise-enter-from .date-picker-sheet, .picker-rise-leave-to .date-picker-sheet { transform: translateY(100%); }
</style>
