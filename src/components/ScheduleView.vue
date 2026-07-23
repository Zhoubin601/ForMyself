<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useScheduleStore } from '../stores/schedule'
import { useSettingsStore } from '../stores/settings'
import {
  addDays,
  formatLocalDate,
  getWeekdayLabel,
  parseLocalDate
} from '../services/scheduleCore.js'
import { syncScheduleNotifications } from '../services/scheduleNotificationService.js'

const scheduleStore = useScheduleStore()
const settingsStore = useSettingsStore()

const today = ref(formatLocalDate())
const activeView = ref('agenda')
const activeCategory = ref('all')
const searchText = ref('')
const editorOpen = ref(false)
const editingOccurrence = ref(null)
const monthCursor = ref(today.value.slice(0, 7))
const agendaBottom = ref(null)

const recurrenceLabels = {
  none: '一次性日程',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年',
  custom: '每隔几天'
}

const reminderLabels = {
  '': '不提醒',
  0: '准时',
  10: '10分钟前',
  60: '1小时前',
  1440: '1天前'
}

const recurrenceOptions = Object.entries(recurrenceLabels).map(([value, label]) => ({ value, label }))
const reminderOptions = [
  { value: '', label: '不提醒' },
  { value: 0, label: '准时' },
  { value: 10, label: '10分钟前' },
  { value: 60, label: '1小时前' },
  { value: 1440, label: '1天前' }
]
const picker = ref(null)

const openPicker = (title, options, currentValue, onSelect) => {
  picker.value = { title, options, currentValue, onSelect }
}

const choosePickerOption = option => {
  picker.value?.onSelect(option.value)
  picker.value = null
}

const createDefaultForm = () => {
  const now = new Date()
  now.setMinutes(Math.ceil((now.getMinutes() + 5) / 5) * 5, 0, 0)
  const end = new Date(now.getTime() + 60 * 60 * 1000)
  return {
    type: 'event',
    title: '',
    categoryId: scheduleStore.categories[0]?.id || 'study',
    allDay: false,
    startDate: formatLocalDate(now),
    startTime: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    endDate: formatLocalDate(end),
    endTime: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
    lunar: false,
    timeZone: 'Asia/Shanghai',
    location: '',
    note: '',
    reminderOffset: '',
    recurrence: { type: 'none', weekdays: [], intervalDays: 2 }
  }
}

const form = reactive(createDefaultForm())

const resetForm = value => {
  Object.assign(form, createDefaultForm(), value || {})
  form.recurrence = {
    type: value?.recurrence?.type || 'none',
    weekdays: [...(value?.recurrence?.weekdays || [])],
    intervalDays: Number(value?.recurrence?.intervalDays) || 2
  }
  form.reminderOffset = value?.reminderOffset ?? ''
}

const openNewEditor = date => {
  editingOccurrence.value = null
  resetForm(date ? { startDate: date, endDate: date } : null)
  editorOpen.value = true
}

const openOccurrence = occurrence => {
  editingOccurrence.value = occurrence
  resetForm({
    ...occurrence,
    startDate: occurrence.occurrenceDate,
    endDate: occurrence.occurrenceEndDate
  })
  editorOpen.value = true
}

const closeEditor = () => {
  editorOpen.value = false
  editingOccurrence.value = null
}

const chooseSeriesScope = action => {
  const occurrence = editingOccurrence.value
  if (!occurrence || occurrence.recurrence.type === 'none') return 'all'
  const answer = prompt(
    `${action}重复日程：\n1 仅本次\n2 本次及以后\n3 整个系列`,
    '1'
  )
  if (answer === null) return ''
  return ({ 1: 'single', 2: 'future', 3: 'all' })[String(answer).trim()] || 'single'
}

const normalizeFormPayload = () => ({
  ...form,
  title: form.title.trim(),
  reminderOffset: form.reminderOffset === '' ? null : Number(form.reminderOffset),
  recurrence: {
    type: form.recurrence.type,
    weekdays: form.recurrence.type === 'weekly'
      ? [...form.recurrence.weekdays]
      : [],
    intervalDays: Math.min(365, Math.max(1, Math.round(Number(form.recurrence.intervalDays) || 2)))
  }
})

const saveEditor = async () => {
  if (!form.title.trim()) return alert('请输入日程标题')
  if (form.endDate < form.startDate) return alert('结束日期不能早于开始日期')
  const payload = normalizeFormPayload()
  if (!editingOccurrence.value) {
    scheduleStore.addSeries(payload)
  } else {
    const scope = chooseSeriesScope('修改')
    if (!scope) return
    scheduleStore.updateSeries(
      editingOccurrence.value.seriesId,
      payload,
      scope,
      editingOccurrence.value.originalDate
    )
  }
  try {
    await scheduleStore.persist()
    await syncScheduleNotifications(scheduleStore.snapshot, { requestPermission: true })
    closeEditor()
  } catch (error) {
    console.error('保存日程提醒失败', error)
    if (error.code === 'NOTIFICATION_PERMISSION_DENIED') {
      alert('日程已保存，但通知权限未开启。请在系统设置中允许 ForMyself 通知。')
    } else if (error.code === 'SCHEDULE_NOTIFICATION_VERIFY_FAILED') {
      alert('日程已保存，但系统没有保留提醒任务。请确认已允许“闹钟和提醒”权限后重试。')
    } else {
      alert('日程已保存，但提醒设置失败，请稍后重试。')
    }
  }
}

const deleteEditor = () => {
  if (!editingOccurrence.value) return
  const scope = chooseSeriesScope('删除')
  if (!scope || !confirm('确认删除所选日程？')) return
  scheduleStore.deleteSeries(
    editingOccurrence.value.seriesId,
    scope,
    editingOccurrence.value.originalDate
  )
  closeEditor()
}

const complete = occurrence => {
  if (occurrence.completed) scheduleStore.reopenOccurrence(occurrence)
  else scheduleStore.completeOccurrence(occurrence)
}

const categoryById = id =>
  scheduleStore.categories.find(item => item.id === id) ||
  { id: '', name: '未分类', color: '#a7a7ad' }

const listRange = computed(() =>
  scheduleStore.getOccurrences(addDays(today.value, -180), addDays(today.value, 365))
)

const filteredOccurrences = computed(() => {
  const query = searchText.value.trim().toLowerCase()
  return listRange.value.filter(item => {
    if (activeCategory.value !== 'all' && item.categoryId !== activeCategory.value) return false
    if (query && !`${item.title} ${item.location} ${item.note}`.toLowerCase().includes(query)) return false
    return true
  }).sort((a, b) => a.startAt - b.startAt)
})

const groupedOccurrences = computed(() => {
  const groups = []
  for (const item of filteredOccurrences.value) {
    const date = item.occurrenceDate
    let group = groups.find(entry => entry.date === date)
    if (!group) {
      group = { date, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  if (
    activeCategory.value === 'all' &&
    !searchText.value.trim() &&
    !groups.some(group => group.date === today.value)
  ) {
    groups.push({ date: today.value, items: [] })
    groups.sort((a, b) => a.date.localeCompare(b.date))
  }
  return groups
})

const scrollAgendaToLatest = async (smooth = false) => {
  if (activeView.value !== 'agenda') return
  await nextTick()
  agendaBottom.value?.scrollIntoView({
    behavior: smooth ? 'smooth' : 'auto',
    block: 'end'
  })
}

const displayDate = date => {
  const parsed = parseLocalDate(date)
  if (!parsed) return date
  return `${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getDate()).padStart(2, '0')}`
}

const isToday = date => date === today.value

const monthCells = computed(() => {
  const [year, month] = monthCursor.value.split('-').map(Number)
  const first = new Date(year, month - 1, 1)
  const firstOffset = (first.getDay() + 6) % 7
  const gridStart = new Date(year, month - 1, 1 - firstOffset)
  const from = formatLocalDate(gridStart)
  const gridEnd = new Date(gridStart)
  gridEnd.setDate(gridEnd.getDate() + 41)
  const occurrences = scheduleStore.getOccurrences(from, formatLocalDate(gridEnd))
  const counts = occurrences.reduce((map, item) => {
    if (!item.historical) map[item.occurrenceDate] = (map[item.occurrenceDate] || 0) + 1
    return map
  }, {})
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(date.getDate() + index)
    const value = formatLocalDate(date)
    return {
      value,
      day: date.getDate(),
      currentMonth: date.getMonth() === month - 1,
      count: counts[value] || 0
    }
  })
})

const selectedMonthDay = ref(today.value)
const selectedDayItems = computed(() =>
  scheduleStore.getOccurrences(selectedMonthDay.value, selectedMonthDay.value)
    .filter(item => !item.historical)
)

const shiftMonth = amount => {
  const [year, month] = monthCursor.value.split('-').map(Number)
  const date = new Date(year, month - 1 + amount, 1)
  monthCursor.value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const monthTitle = computed(() => {
  const [year, month] = monthCursor.value.split('-')
  return `${year}年 ${Number(month)}月`
})

const toggleWeekday = day => {
  const set = new Set(form.recurrence.weekdays)
  if (set.has(day)) set.delete(day)
  else set.add(day)
  form.recurrence.weekdays = [...set].sort()
}

watch(() => form.allDay, allDay => {
  if (allDay) {
    form.startTime = '09:00'
    form.endTime = '09:00'
  }
})

watch(() => settingsStore.scheduleTarget, target => {
  if (!target?.item) return
  const originalDate = target.occurrence?.split('@').pop() || today.value
  const match = scheduleStore
    .getOccurrences(addDays(originalDate, -1), addDays(originalDate, 1))
    .find(item => item.seriesId === target.item && (!target.occurrence || item.key === target.occurrence))
  if (match) openOccurrence(match)
  settingsStore.scheduleTarget = { item: '', occurrence: '' }
}, { deep: true, immediate: true })

watch(activeView, view => {
  if (view === 'agenda') scrollAgendaToLatest(true)
})

onMounted(() => scrollAgendaToLatest())
</script>

<template>
  <div class="vivo-schedule">
    <header class="schedule-header">
      <button class="plain-icon menu-trigger" aria-label="打开菜单" @click="settingsStore.isDrawerOpen = true">
        <span></span><span></span><span></span>
      </button>
      <div class="year-mark">
        <span>{{ new Date().getFullYear().toString().slice(0, 2) }}</span><b>{{ new Date().getFullYear().toString().slice(2) }}</b>
      </div>
      <button class="plain-icon search-trigger" aria-label="搜索" @click="$refs.searchInput?.focus()">⌕</button>
    </header>

    <div class="view-tabs">
      <button :class="{ active: activeView === 'month' }" @click="activeView = 'month'">月历</button>
      <button :class="{ active: activeView === 'agenda' }" @click="activeView = 'agenda'">日程</button>
    </div>

    <div class="schedule-toolbar">
      <input ref="searchInput" v-model="searchText" class="schedule-search" placeholder="搜索日程" />
    </div>

    <div class="category-filter">
      <button :class="{ active: activeCategory === 'all' }" @click="activeCategory = 'all'">全部分类</button>
      <button
        v-for="category in scheduleStore.categories"
        :key="category.id"
        :class="{ active: activeCategory === category.id }"
        @click="activeCategory = category.id"
      >
        <i :style="{ background: category.color }"></i>{{ category.name }}
      </button>
    </div>

    <Transition name="schedule-content" mode="out-in">
    <main v-if="activeView === 'agenda'" key="agenda" class="agenda-view">
      <section
        v-for="group in groupedOccurrences"
        :key="group.date"
        class="agenda-group"
      >
        <div class="date-heading" :class="{ today: isToday(group.date) }">
          <strong>{{ displayDate(group.date) }}</strong>
          <span>{{ getWeekdayLabel(group.date) }}</span>
        </div>
        <div class="agenda-card">
          <p v-if="!group.items.length" class="agenda-day-empty">今日暂无日程</p>
          <article
            v-for="item in group.items"
            :key="item.key"
            class="agenda-item"
            :class="{ completed: item.completed, expired: item.expired }"
            @click="openOccurrence(item)"
          >
            <button
              v-if="item.type === 'task'"
              class="task-check"
              :class="{ checked: item.completed }"
              :style="{ '--category-color': categoryById(item.categoryId)?.color }"
              aria-label="切换完成状态"
              @click.stop="complete(item)"
            >✓</button>
            <span
              v-else
              class="category-dot"
              :style="{ background: categoryById(item.categoryId)?.color }"
            ></span>
            <div class="item-copy">
              <strong>{{ item.title }}</strong>
              <small>
                {{ item.allDay ? '全天' : `${item.startTime} - ${item.endTime}` }}
                <template v-if="item.location"> · {{ item.location }}</template>
              </small>
            </div>
            <span v-if="item.expired" class="state-label">未完成</span>
            <span v-else-if="item.recurrence.type !== 'none'" class="repeat-label">↻</span>
          </article>
        </div>
      </section>
      <div ref="agendaBottom" class="agenda-bottom-anchor" aria-hidden="true"></div>

      <div v-if="!groupedOccurrences.length" class="empty-agenda">
        <span>□</span>
        <strong>暂时没有日程</strong>
        <small>点击右下角按钮新建一条安排</small>
      </div>
    </main>

    <main v-else key="month" class="month-view">
      <div class="month-toolbar">
        <button @click="shiftMonth(-1)">‹</button>
        <strong>{{ monthTitle }}</strong>
        <button @click="shiftMonth(1)">›</button>
      </div>
      <div class="weekday-row">
        <span v-for="day in ['一', '二', '三', '四', '五', '六', '日']" :key="day">{{ day }}</span>
      </div>
      <div class="month-grid">
        <button
          v-for="cell in monthCells"
          :key="cell.value"
          :class="{
            muted: !cell.currentMonth,
            today: isToday(cell.value),
            selected: selectedMonthDay === cell.value
          }"
          @click="selectedMonthDay = cell.value"
        >
          <span>{{ cell.day }}</span>
          <i v-if="cell.count">{{ Math.min(cell.count, 9) }}</i>
        </button>
      </div>
      <section class="selected-day-card">
        <div class="selected-day-title">
          <div>
            <strong>{{ displayDate(selectedMonthDay) }}</strong>
            <span>{{ getWeekdayLabel(selectedMonthDay) }}</span>
          </div>
          <button @click="openNewEditor(selectedMonthDay)">新增</button>
        </div>
        <article v-for="item in selectedDayItems" :key="item.key" @click="openOccurrence(item)">
          <i :style="{ background: categoryById(item.categoryId)?.color }"></i>
          <div><strong>{{ item.title }}</strong><small>{{ item.allDay ? '全天' : item.startTime }}</small></div>
        </article>
        <p v-if="!selectedDayItems.length">这一天暂无日程</p>
      </section>
    </main>
    </Transition>

    <button class="floating-add" aria-label="新建日程" @click="openNewEditor()">＋</button>

    <Teleport to="body">
      <Transition name="schedule-editor-transition">
        <div v-if="editorOpen" class="schedule-editor-overlay">
          <div class="schedule-editor">
          <header class="editor-header">
            <button @click="closeEditor">取消</button>
            <strong>{{ editingOccurrence ? '编辑日程' : '新建日程' }}</strong>
            <button class="done" @click="saveEditor">完成</button>
          </header>

          <div class="editor-scroll">
            <div class="type-switch">
              <button :class="{ active: form.type === 'event' }" @click="form.type = 'event'">日程</button>
              <button :class="{ active: form.type === 'task' }" @click="form.type = 'task'">待办</button>
            </div>

            <div class="category-strip">
              <button
                v-for="category in scheduleStore.categories"
                :key="category.id"
                :class="{ active: form.categoryId === category.id }"
                @click="form.categoryId = category.id"
              >
                <i :style="{ background: category.color }"></i>
                {{ category.name }}
              </button>
            </div>
            <button
              v-if="!scheduleStore.categories.length"
              class="no-category-notice"
              @click="closeEditor(); settingsStore.switchView('settings')"
            >
              暂无日程标签，请先到通用配置添加
            </button>

            <input v-model="form.title" class="title-input" placeholder="试着输入“明晚7点聚餐”" maxlength="80" />

            <section class="form-card">
              <label class="form-row">
                <strong>全天</strong>
                <input v-model="form.allDay" type="checkbox" class="vivo-switch" />
              </label>
              <div class="form-row date-row">
                <strong>开始</strong>
                <div>
                  <input v-model="form.startDate" type="date" />
                  <input v-if="!form.allDay" v-model="form.startTime" type="time" />
                </div>
              </div>
              <div class="form-row date-row">
                <strong>结束</strong>
                <div>
                  <input v-model="form.endDate" type="date" />
                  <input v-if="!form.allDay" v-model="form.endTime" type="time" />
                </div>
              </div>
            </section>

            <section class="form-card">
              <button
                class="form-row choice-row"
                @click="openPicker('提醒', reminderOptions, form.reminderOffset, value => form.reminderOffset = value)"
              >
                <strong>提醒</strong>
                <span>{{ reminderLabels[form.reminderOffset] }}</span><b>›</b>
              </button>
              <div class="form-row reminder-mode">
                <strong>提醒方式</strong>
                <span>通知提醒</span>
              </div>
            </section>

            <section class="form-card">
              <button
                class="form-row choice-row"
                @click="openPicker('重复', recurrenceOptions, form.recurrence.type, value => form.recurrence.type = value)"
              >
                <strong>重复</strong>
                <span>{{ form.recurrence.type === 'custom' ? `每 ${form.recurrence.intervalDays} 天` : recurrenceLabels[form.recurrence.type] }}</span><b>›</b>
              </button>
              <div v-if="form.recurrence.type === 'weekly'" class="weekday-picker">
                <button
                  v-for="(label, day) in ['日', '一', '二', '三', '四', '五', '六']"
                  :key="day"
                  :class="{ active: form.recurrence.weekdays.includes(day) }"
                  @click="toggleWeekday(day)"
                >{{ label }}</button>
              </div>
              <label v-if="form.recurrence.type === 'custom'" class="interval-days-row">
                <span>每</span>
                <input v-model.number="form.recurrence.intervalDays" type="number" min="1" max="365" inputmode="numeric" />
                <span>天重复一次</span>
              </label>
            </section>

            <input v-model="form.location" class="wide-input" placeholder="输入地点" maxlength="120" />
            <textarea v-model="form.note" class="wide-input note-input" placeholder="输入备注" maxlength="1000"></textarea>

            <div v-if="editingOccurrence" class="editor-meta">
              <span>{{ recurrenceLabels[form.recurrence.type] }}</span>
              <span>{{ reminderLabels[form.reminderOffset] }}</span>
            </div>
            <button v-if="editingOccurrence" class="delete-schedule" @click="deleteEditor">删除日程</button>
          </div>
          </div>
        </div>
      </Transition>

      <Transition name="schedule-picker-transition">
        <div v-if="picker" class="picker-mask" @click="picker = null">
          <div class="app-picker" @click.stop>
            <div class="picker-handle"></div>
            <header><strong>{{ picker.title }}</strong><button @click="picker = null">取消</button></header>
            <button
              v-for="option in picker.options"
              :key="String(option.value)"
              :class="{ selected: option.value === picker.currentValue }"
              @click="choosePickerOption(option)"
            >
              <span>{{ option.label }}</span><b>✓</b>
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.vivo-schedule {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background:
    radial-gradient(circle at 90% 0%, rgba(255, 77, 85, .08), transparent 28%),
    #f5f5f7;
  color: #18181a;
  animation: schedule-page-in .34s cubic-bezier(.22, .8, .28, 1) both;
}
.schedule-header {
  display: grid;
  grid-template-columns: 36px 1fr 36px;
  align-items: center;
  padding: calc(7px + env(safe-area-inset-top)) 16px 6px;
  background: rgba(250, 250, 252, .82);
  backdrop-filter: blur(24px) saturate(160%);
}
.plain-icon { border: 0; background: none; height: 36px; font-size: 27px; color: #1b1b1d; }
.menu-trigger { display: flex; flex-direction: column; justify-content: center; gap: 4px; padding: 8px; }
.menu-trigger span { width: 19px; height: 2px; border-radius: 3px; background: currentColor; }
.year-mark { text-align: center; font-size: 28px; font-weight: 700; letter-spacing: .5px; }
.year-mark b { color: #ff3f48; }
.search-trigger { font-size: 26px; transform: rotate(-18deg); }
.view-tabs {
  width: calc(100% - 40px);
  max-width: 520px;
  margin: 4px auto 10px;
  padding: 4px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-radius: 23px;
  background: #eaeaec;
}
.view-tabs button { border: 0; border-radius: 19px; padding: 9px; background: transparent; font-size: 16px; font-weight: 600; }
.view-tabs button.active { background: white; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
.schedule-toolbar { display: flex; flex-direction: column; gap: 10px; padding: 0 20px 12px; align-items: stretch; }
.category-filter button {
  border: 0; white-space: nowrap; border-radius: 16px; padding: 8px 11px; background: transparent; color: #717176;
}
.category-filter button.active { background: #2d2d30; color: white; }
.schedule-search {
  width: 100%; border: 0; background: rgba(255,255,255,.84); border-radius: 17px; padding: 11px 14px; outline: none;
}
.category-filter { display: flex; overflow-x: auto; gap: 3px; padding: 0 20px 10px; scrollbar-width: none; }
.category-filter button { display: flex; align-items: center; gap: 6px; }
.category-filter i { width: 8px; height: 8px; border-radius: 50%; }
.agenda-view, .month-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 0 20px calc(96px + env(safe-area-inset-bottom));
}
.agenda-group { margin: 0 0 24px; }
.agenda-bottom-anchor { height: 1px; pointer-events: none; }
.date-heading { display: flex; gap: 10px; align-items: baseline; padding: 9px 8px; color: #929296; }
.date-heading strong { font-size: 27px; letter-spacing: .5px; }
.date-heading span { font-size: 14px; }
.date-heading.today strong { color: #ff3944; }
.agenda-card, .selected-day-card, .form-card {
  border-radius: 22px;
  background: rgba(255,255,255,.9);
  box-shadow: 0 8px 26px rgba(31,35,48,.045), inset 0 1px 0 rgba(255,255,255,.95);
  overflow: hidden;
}
.agenda-day-empty { margin: 0; padding: 22px 20px; color: #8e8e93; font-size: 15px; }
.agenda-item { min-height: 76px; padding: 15px 17px; display: flex; align-items: center; gap: 13px; border-bottom: 1px solid #eeeeef; }
.agenda-item:last-child { border-bottom: 0; }
.category-dot { width: 12px; height: 12px; border-radius: 50%; flex: 0 0 auto; }
.task-check {
  width: 23px; height: 23px; border-radius: 50%; border: 2px solid var(--category-color); color: transparent; background: transparent; padding: 0;
}
.task-check.checked { background: var(--category-color); color: white; }
.item-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 5px; }
.item-copy strong { font-size: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-copy small { color: #aaaab0; font-size: 13px; }
.agenda-item.completed .item-copy { opacity: .5; text-decoration: line-through; }
.agenda-item.expired { color: #a5a5aa; }
.agenda-item.expired .item-copy { opacity: .58; text-decoration: line-through; }
.agenda-item.expired .category-dot { filter: grayscale(1); opacity: .48; }
.agenda-item.expired .task-check { border-color: #b8b8bc; }
.state-label { color: #a7a7ab; font-size: 12px; }
.repeat-label { color: #99999e; font-size: 18px; }
.empty-agenda { padding: 80px 20px; display: flex; flex-direction: column; align-items: center; gap: 9px; color: #a1a1a6; }
.empty-agenda span { font-size: 42px; }
.empty-agenda strong { color: #77777d; font-size: 18px; }
.floating-add {
  position: fixed; right: 24px; bottom: calc(24px + env(safe-area-inset-bottom)); width: 64px; height: 64px;
  border-radius: 50%; border: 0; color: white; background: linear-gradient(145deg, #ff5660, #ff303a);
  box-shadow: 0 12px 24px rgba(255, 48, 58, .35); font-size: 38px; line-height: 1; z-index: 30;
}
.month-view { padding-top: 8px; }
.month-toolbar { display: grid; grid-template-columns: 42px 1fr 42px; align-items: center; text-align: center; margin-bottom: 10px; }
.month-toolbar button { border: 0; background: none; font-size: 34px; color: #777; }
.month-toolbar strong { font-size: 20px; }
.weekday-row, .month-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
.weekday-row span { text-align: center; padding: 8px 0; color: #96969b; font-size: 13px; }
.month-grid { background: rgba(255,255,255,.78); border-radius: 22px; padding: 10px 6px; }
.month-grid button { position: relative; height: 48px; border: 0; background: none; border-radius: 16px; color: #222; }
.month-grid button.muted { color: #c4c4c7; }
.month-grid button.today span { color: #ff3944; font-weight: 800; }
.month-grid button.selected { background: #242427; color: white; }
.month-grid button.selected span { color: white; }
.month-grid i { position: absolute; right: 5px; top: 3px; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 7px; background: #ff414b; color: white; font-size: 9px; font-style: normal; line-height: 14px; }
.selected-day-card { margin-top: 18px; padding: 17px; }
.selected-day-title { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; }
.selected-day-title div { display: flex; flex-direction: column; gap: 3px; }
.selected-day-title strong { font-size: 22px; }
.selected-day-title span { color: #999; font-size: 13px; }
.selected-day-title button { border: 0; background: #ff414b; color: white; border-radius: 15px; padding: 7px 13px; }
.selected-day-card article { display: flex; gap: 10px; align-items: center; padding: 12px 0; border-top: 1px solid #eee; }
.selected-day-card article i { width: 10px; height: 10px; border-radius: 50%; }
.selected-day-card article div { display: flex; flex-direction: column; gap: 3px; }
.selected-day-card article small, .selected-day-card p { color: #aaa; }
.schedule-editor-overlay { position: fixed; inset: 0; z-index: 500; background: #f5f5f7; }
.schedule-editor { height: 100%; display: flex; flex-direction: column; color: #161618; }
.editor-header {
  display: grid; grid-template-columns: 70px 1fr 70px; align-items: center; padding: calc(16px + env(safe-area-inset-top)) 18px 14px;
  background: rgba(250,250,252,.88); backdrop-filter: blur(24px); text-align: center;
}
.editor-header button { border: 0; background: none; color: #1684df; font-size: 17px; padding: 8px 0; }
.editor-header .done { font-weight: 700; }
.editor-header strong { font-size: 20px; }
.editor-scroll { flex: 1; overflow-y: auto; padding: 14px 20px calc(54px + env(safe-area-inset-bottom)); }
.type-switch { width: 170px; display: grid; grid-template-columns: 1fr 1fr; background: #e8e8eb; border-radius: 18px; padding: 3px; margin: 0 auto 12px; }
.type-switch button { border: 0; background: none; border-radius: 15px; padding: 7px; }
.type-switch button.active { background: white; font-weight: 700; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.category-strip { display: flex; gap: 14px; overflow-x: auto; padding: 8px 0 16px; scrollbar-width: none; }
.category-strip button { display: flex; align-items: center; gap: 7px; border: 0; background: none; color: #555; white-space: nowrap; padding: 0; }
.category-strip button.active { color: #111; font-weight: 700; }
.category-strip i {
  width: 18px; height: 18px; border: 3px solid rgba(255,255,255,.94); border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(20,20,23,.13);
}
.no-category-notice {
  width: 100%; margin: 0 0 14px; border: 1px dashed #cacacf; border-radius: 16px; padding: 13px;
  background: rgba(255,255,255,.55); color: #85858a;
}
.title-input, .wide-input {
  width: 100%; border: 0; outline: none; background: rgba(255,255,255,.92); border-radius: 22px; padding: 20px;
  font-size: 18px; margin-bottom: 16px; box-shadow: inset 0 1px 0 white;
}
.title-input { font-size: 20px; padding: 23px 20px; }
.title-input::placeholder, .wide-input::placeholder { color: #c5c5c9; }
.form-card { margin-bottom: 16px; }
.form-row {
  min-height: 64px; display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-bottom: 1px solid #ececef;
}
.form-row:last-child { border-bottom: 0; }
.form-row strong { min-width: 70px; font-size: 17px; }
.choice-row { width: 100%; border: 0; background: transparent; text-align: left; }
.choice-row span { flex: 1; color: #8c8c91; text-align: right; font-size: 15px; }
.choice-row b { color: #aaa; font-size: 22px; font-weight: 400; }
.date-row > div { flex: 1; display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 5px; }
.date-row input { border: 0; background: none; color: #1684df; font-size: 14px; outline: none; }
.vivo-switch {
  appearance: none; width: 48px; height: 28px; border-radius: 15px; background: #dedee1; position: relative; transition: .2s; flex: 0 0 auto;
}
.vivo-switch::after { content: ''; position: absolute; width: 24px; height: 24px; border-radius: 50%; top: 2px; left: 2px; background: white; box-shadow: 0 1px 4px rgba(0,0,0,.18); transition: .2s; }
.vivo-switch:checked { background: #ff4852; }
.vivo-switch:checked::after { transform: translateX(20px); }
.reminder-mode {
  display: flex;
  justify-content: space-between;
}
.reminder-mode strong { min-width: 0; text-align: left; }
.reminder-mode span { color: #8c8c91; }
.weekday-picker { display: grid; grid-template-columns: repeat(7, 1fr); gap: 7px; padding: 13px; }
.weekday-picker button { border: 0; width: 35px; height: 35px; border-radius: 50%; background: #eeeef0; }
.weekday-picker button.active { color: white; background: #ff414b; }
.interval-days-row {
  display: flex; align-items: center; justify-content: center; gap: 10px; padding: 14px 18px;
  border-top: 1px solid #ececef; color: #777;
}
.interval-days-row input {
  width: 82px; border: 1px solid #dedee2; border-radius: 14px; padding: 9px 10px;
  background: #f7f7f9; color: #ff414b; font-size: 17px; font-weight: 700; text-align: center; outline: none;
}
.note-input { min-height: 112px; resize: vertical; }
.editor-meta { display: flex; gap: 8px; color: #999; font-size: 12px; padding: 0 6px 14px; }
.delete-schedule { width: 100%; border: 0; border-radius: 22px; padding: 18px; color: #ff3944; background: white; font-size: 17px; }
.picker-mask {
  position: fixed; inset: 0; z-index: 700; display: flex; align-items: flex-end;
  background: rgba(18,18,22,.28); backdrop-filter: blur(4px);
}
.app-picker {
  width: 100%; max-height: 70vh; overflow-y: auto; padding: 8px 18px calc(20px + env(safe-area-inset-bottom));
  border-radius: 28px 28px 0 0; background: rgba(250,250,252,.98); box-shadow: 0 -12px 40px rgba(0,0,0,.12);
}
.picker-handle { width: 42px; height: 5px; margin: 2px auto 13px; border-radius: 3px; background: #d1d1d5; }
.app-picker header { display: flex; justify-content: space-between; align-items: center; padding: 5px 4px 12px; }
.app-picker header strong { font-size: 20px; }
.app-picker header button { border: 0; background: none; color: #1684df; font-size: 16px; }
.app-picker > button {
  width: 100%; display: flex; justify-content: space-between; align-items: center; min-height: 58px;
  border: 0; border-top: 1px solid #ececef; background: transparent; color: #333; font-size: 17px; text-align: left;
}
.app-picker > button b { color: transparent; }
.app-picker > button.selected { color: #1684df; font-weight: 650; }
.app-picker > button.selected b { color: #1684df; }

@keyframes schedule-page-in {
  from { opacity: 0; transform: translateY(10px) scale(.995); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.schedule-content-enter-active,
.schedule-content-leave-active {
  transition: opacity .2s ease, transform .28s cubic-bezier(.22, .8, .28, 1);
}
.schedule-content-enter-from { opacity: 0; transform: translateX(16px); }
.schedule-content-leave-to { opacity: 0; transform: translateX(-10px); }
.schedule-editor-transition-enter-active,
.schedule-editor-transition-leave-active {
  transition: opacity .24s ease, transform .34s cubic-bezier(.22, .8, .28, 1);
}
.schedule-editor-transition-enter-from {
  opacity: 0;
  transform: translateY(28px) scale(.99);
}
.schedule-editor-transition-leave-to {
  opacity: 0;
  transform: translateY(18px) scale(.995);
}
.schedule-picker-transition-enter-active,
.schedule-picker-transition-leave-active { transition: opacity .22s ease; }
.schedule-picker-transition-enter-active .app-picker,
.schedule-picker-transition-leave-active .app-picker {
  transition: transform .32s cubic-bezier(.22, .8, .28, 1);
}
.schedule-picker-transition-enter-from,
.schedule-picker-transition-leave-to { opacity: 0; }
.schedule-picker-transition-enter-from .app-picker,
.schedule-picker-transition-leave-to .app-picker { transform: translateY(100%); }

@media (prefers-reduced-motion: reduce) {
  .vivo-schedule { animation: none; }
  .schedule-content-enter-active,
  .schedule-content-leave-active,
  .schedule-editor-transition-enter-active,
  .schedule-editor-transition-leave-active,
  .schedule-picker-transition-enter-active,
  .schedule-picker-transition-leave-active,
  .schedule-picker-transition-enter-active .app-picker,
  .schedule-picker-transition-leave-active .app-picker { transition-duration: .01ms; }
}
@media (min-width: 700px) {
  .agenda-view, .month-view, .schedule-toolbar, .category-filter { max-width: 720px; margin-left: auto; margin-right: auto; }
  .schedule-editor { max-width: 620px; margin: auto; }
}
</style>
