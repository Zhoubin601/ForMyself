<script setup>
import HomeScheduleCard from './HomeScheduleCard.vue'
import HomeTodayCards from './HomeTodayCards.vue'
import { sortWeightRecords } from "../services/weightInsights.js"
import { computed, onMounted, ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useMoodStore } from '../features/mood/moodStore'
import { useWeightStore } from '../stores/weight'
import { useDebtStore } from '../stores/debt'
import TodoProgressCard from '../features/todo/TodoProgressCard.vue'
import { useTodoStore } from '../features/todo/todoStore.js'
import { appToast } from '../services/uiFeedback.js'
import { useScheduleStore } from '../features/schedule/scheduleStore'
import { askAI } from '../services/aiEngine'
import {
  buildHomeCompanionContext,
  buildHomeCompanionPrompt,
  getCompanionContextFingerprint,
  normalizeCompanionReply,
  shouldGenerateHomeCompanion
} from '../features/chat/companionPrompts'

const settingsStore = useSettingsStore()
const moodStore = useMoodStore()
const weightStore = useWeightStore()
const debtStore = useDebtStore()
const scheduleStore = useScheduleStore()
const todoStore = useTodoStore()
const completeTodo = async item => {
  try { await todoStore.complete(item.taskId, item.date, !item.completed) }
  catch { appToast('保存待办失败，请重试', { tone:'danger' }) }
}
const props = defineProps({
  chatUnreadCount: { type: Number, default: 0 },
  showBiometricSetup: { type: Boolean, default: false },
  isEnablingBiometric: { type: Boolean, default: false }
})
const emit = defineEmits(['enable-biometric', 'dismiss-biometric'])
const currentTime = ref(new Date())

const formatLocalDate = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const todayStr = computed(() => formatLocalDate(currentTime.value))
const yesterdayStr = computed(() => {
  const date = new Date(currentTime.value)
  date.setDate(date.getDate() - 1)
  return formatLocalDate(date)
})

const greeting = computed(() => {
  const hour = currentTime.value.getHours()
  if (hour < 6) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
})

const heroTone = computed(() => {
  const hour = currentTime.value.getHours()
  if (hour < 6 || hour >= 19) return 'hero-night'
  if (hour < 12) return 'hero-morning'
  return 'hero-afternoon'
})

const dateLabel = computed(() => new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long'
}).format(currentTime.value))

const formatCurrency = (value) => new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2
}).format(Number(value) || 0)

const todayMood = computed(() => moodStore.getRecordByDate(todayStr.value))
const todayMoodEvents = computed(() => moodStore.getRecordsByDate(todayStr.value))
const isMoodLogged = computed(() => !!todayMood.value)

const getMoodEmoji = mood => moodStore.getMoodDefinition(mood).emoji
const getMoodLabel = mood => moodStore.getMoodDefinition(mood).label
const todayMoodEmoji = computed(() => todayMood.value ? getMoodEmoji(todayMood.value.mood) : null)

const sortedWeights = computed(() => sortWeightRecords(weightStore.weightRecords))
const latestWeight = computed(() => sortedWeights.value[0] || null)
const isWeightLoggedToday = computed(() => latestWeight.value?.date === todayStr.value)

const weightTrend = computed(() => {
  if (sortedWeights.value.length < 2) return { status: 'none', diff: 0, icon: '', color: '' }
  const current = Number(sortedWeights.value[0].weight)
  const previous = Number(sortedWeights.value[1].weight)
  const diff = Number((current - previous).toFixed(1))
  if (diff > 0) return { status: 'up', icon: '↑', diff: diff.toFixed(1), color: '#f28b3c' }
  if (diff < 0) return { status: 'down', icon: '↓', diff: Math.abs(diff).toFixed(1), color: '#2f9e72' }
  return { status: 'flat', icon: '—', diff: '0.0', color: '#7b8190' }
})

const weightSparkline = computed(() => {
  const values = sortedWeights.value.slice(0, 7).reverse().map(record => Number(record.weight))
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values.map((value, index) => {
    const x = values.length === 1 ? 60 : (index / (values.length - 1)) * 120
    const y = 38 - ((value - min) / range) * 28
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
})

const activeDebts = computed(() => debtStore.savedDebts.filter(debt => !debt.isCleared))
const closestDebt = computed(() => {
  const withProgress = activeDebts.value.map(debt => {
    const saved = (debt.records || []).reduce((sum, record) => sum + (Number(record.amount) || 0), 0)
    const total = Number(debt.totalAmount) || 0
    const progress = total > 0 ? Math.min(100, Math.round((saved / total) * 100)) : 0
    return { ...debt, saved, progress, remaining: Math.max(0, total - saved) }
  })
  return withProgress.sort((a, b) => b.progress - a.progress)[0] || null
})


const isSavingsLoggedToday = computed(() => debtStore.savedDebts.some(debt => {
  return (debt.records || []).some(record => record.date === todayStr.value)
}))

const todayRecordCount = computed(() => [
  isMoodLogged.value,
  isWeightLoggedToday.value,
  isSavingsLoggedToday.value
].filter(Boolean).length)

const todaySchedules = computed(() => scheduleStore.todayUpcoming)
const nextSchedule = computed(() => todaySchedules.value[0] || scheduleStore.upcoming[0] || null)
const nextScheduleDateLabel = computed(() => {
  const item = nextSchedule.value
  if (!item) return '今天可以留一点空白'
  if (item.occurrenceDate === todayStr.value) return item.allDay ? '今天 · 全天' : `今天 · ${item.startTime}`
  const date = new Date(`${item.occurrenceDate}T00:00:00`)
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${item.allDay ? '全天' : item.startTime}`
})

const companionText = computed(() => {
  const cachedText = settingsStore.cachedQuote?.text?.trim()
  if (cachedText && settingsStore.cachedQuote?.date === todayStr.value) return cachedText
  if (todayRecordCount.value === 0) return '今天还没有留下记录，从你最想关注的一项开始就好。'
  if (todayRecordCount.value === 1) return '已经为今天留下第一项记录，慢慢来，也是一种认真。'
  if (todayRecordCount.value === 2) return '今天已经有两项新动态，你正在更清楚地看见自己的节奏。'
  return '今天的三类动态都有记录，给认真生活的自己一个小小肯定。'
})

const todayTasks = computed(() => [
  {
    key: 'mood',
    icon: todayMoodEmoji.value || '☺',
    label: '心情',
    detail: isMoodLogged.value ? `已记录 ${todayMoodEvents.value.length} 个事件` : '记录此刻感受',
    done: isMoodLogged.value,
    view: 'mood'
  },
  {
    key: 'weight',
    icon: '⚖',
    label: '体重',
    detail: isWeightLoggedToday.value ? `${latestWeight.value.weight} kg` : '记录今日体重',
    done: isWeightLoggedToday.value,
    view: 'weight'
  },
  {
    key: 'savings',
    icon: '¥',
    label: '存钱',
    detail: isSavingsLoggedToday.value ? '今天有新进展' : '为目标存一笔',
    done: isSavingsLoggedToday.value,
    view: 'debts'
  }
])

const last7Moods = computed(() => {
  const result = []
  for (let index = 6; index >= 0; index--) {
    const date = new Date(currentTime.value.getFullYear(), currentTime.value.getMonth(), currentTime.value.getDate() - index)
    const dateStr = formatLocalDate(date)
    const record = moodStore.getRecordByDate(dateStr)
    result.push({
      day: date.getDate(),
      weekday: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
      isEmpty: !record,
      mood: record?.mood || moodStore.defaultMoodDefinition.id,
      date: dateStr
    })
  }
  return result
})

const moodWeekSummary = computed(() => {
  const recorded = last7Moods.value.filter(item => !item.isEmpty).length
  if (!recorded) return '最近七天还没有心情记录'
  if (recorded === 7) return '连续七天都有留下心情'
  return `最近七天已记录 ${recorded} 天`
})

const formatActivityDate = (date) => {
  if (date === todayStr.value) return '今天'
  if (date === yesterdayStr.value) return '昨天'
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date || '较早'
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日`
}

const recentActivities = computed(() => {
  const moodActivities = moodStore.moodRecords
    .filter(record => record.date && !record.autoFilled)
    .map(record => ({
      key: `mood-${record.id}`,
      type: 'mood',
      icon: getMoodEmoji(record.mood),
      title: '记录了心情',
      detail: `${getMoodLabel(record.mood)} · ${(record.tags || ['学习']).slice(0, 2).join('、')}`,
      date: record.date,
      timestamp: Number(record.createdAt) || new Date(`${record.date}T12:00:00`).getTime(),
      view: 'mood'
    }))

  const weightActivities = sortedWeights.value.map(record => ({
    key: `weight-${record.id}`,
    type: 'weight',
    icon: '⚖',
    title: '记录了体重',
    detail: `${record.weight} kg${record.note ? ` · ${record.note}` : ''}`,
    date: record.date,
    timestamp: Number(record.createdAt) || Number(record.id) || new Date(`${record.date}T12:00:00`).getTime(),
    view: 'weight'
  }))

  const savingsActivities = debtStore.savedDebts.flatMap(debt => (debt.records || []).map(record => ({
    key: `saving-${debt.id}-${record.id}`,
    type: 'savings',
    icon: '¥',
    title: `为“${debt.name}”存入`,
    detail: `+ ¥${formatCurrency(record.amount)}${record.note ? ` · ${record.note}` : ''}`,
    date: record.date,
    timestamp: Number(record.createdAt) || Number(record.id) || new Date(`${record.date}T12:00:00`).getTime(),
    view: 'debts'
  })))

  return [...moodActivities, ...weightActivities, ...savingsActivities]
    .sort((a, b) => b.timestamp - a.timestamp || b.date.localeCompare(a.date))
    .slice(0, 4)
})

let isFetchingAIQuote = false

const fetchAIQuote = async () => {
  if (
    isFetchingAIQuote ||
    !settingsStore.aiApiKey?.trim() ||
    !settingsStore.isDataLoaded ||
    !moodStore.isDataLoaded ||
    !weightStore.isDataLoaded ||
    !debtStore.isDataLoaded
  ) return

  const context = buildHomeCompanionContext({
    moodRecords: moodStore.moodRecords,
    moodDefinitions: moodStore.moodDefinitions,
    weightRecords: weightStore.weightRecords,
    savedDebts: debtStore.savedDebts
  }, todayStr.value)
  const fingerprint = getCompanionContextFingerprint(context)
  if (!shouldGenerateHomeCompanion({
    cachedQuote: settingsStore.cachedQuote,
    storedFingerprint: settingsStore.dataFingerprint,
    nextFingerprint: fingerprint,
    referenceDate: todayStr.value
  })) return

  isFetchingAIQuote = true
  try {
    const answer = await askAI(buildHomeCompanionPrompt(context))
    settingsStore.cachedQuote = {
      text: normalizeCompanionReply(answer, 120),
      date: todayStr.value
    }
    // 仅在成功生成后提交指纹，失败时下次进入首页仍可重试。
    settingsStore.dataFingerprint = fingerprint
  } catch (error) {
    if (error.message !== 'MISSING_KEY') console.error('[HomeView] AI error:', error.message)
  } finally {
    isFetchingAIQuote = false
  }
}

const switchView = view => {
  if (view === 'chat' && settingsStore.warmHomeEnabled === false) {
    appToast('温馨小家入口已关闭，可在设置中重新开启')
    return
  }
  settingsStore.switchView(view)
}

onMounted(() => {
  currentTime.value = new Date()
  if (settingsStore.aiApiKey) fetchAIQuote()
})
</script>

<template>
  <div class="home-dashboard">
    <section class="home-hero" :class="heroTone">
      <div class="hero-orb hero-orb-one"></div>
      <div class="hero-orb hero-orb-two"></div>
      <div class="hero-content">
        <div class="hero-meta">
          <span>{{ greeting }}</span>
          <span>{{ dateLabel }}</span>
        </div>
        <h1>安排好今天，<br />也照顾好自己。</h1>
        <div class="hero-status-row">
          <span class="hero-status-dot"></span>
          今天已留下 {{ todayRecordCount }} 项记录
        </div>
        <button type="button" class="companion-note" @click="switchView('chat')">
          <span class="companion-icon">✦</span>
          <p>{{ companionText }}</p>
          <span
            v-if="settingsStore.warmHomeEnabled !== false && props.chatUnreadCount"
            class="companion-unread"
            :aria-label="`${props.chatUnreadCount}条未读消息`"
          >{{ props.chatUnreadCount > 99 ? '99+' : props.chatUnreadCount }}</span>
          <b aria-hidden="true">›</b>
        </button>
      </div>
    </section>

    <section v-if="props.showBiometricSetup" class="biometric-setup-card" aria-live="polite">
      <span class="biometric-setup-icon" aria-hidden="true">◉</span>
      <div>
        <strong>启用指纹快捷解锁</strong>
        <p>下次可以用系统生物认证直接进入，主密码仍保留作为安全后备。</p>
      </div>
      <div class="biometric-setup-actions">
        <button type="button" :disabled="props.isEnablingBiometric" @click="emit('enable-biometric')">
          {{ props.isEnablingBiometric ? '正在启用…' : '启用' }}
        </button>
        <button type="button" :disabled="props.isEnablingBiometric" @click="emit('dismiss-biometric')">稍后</button>
      </div>
    </section>

    <HomeTodayCards
      :today-record-count="todayRecordCount"
      :today-tasks="todayTasks"
      @open="switchView"
    />

    <TodoProgressCard :items="todoStore.todayItems" compact @complete="completeTodo" @open="switchView('todo')" />
    <HomeScheduleCard
      :current-time="currentTime"
      :next-schedule="nextSchedule"
      :next-schedule-date-label="nextScheduleDateLabel"
      :today-schedules="todaySchedules"
      @open="switchView('schedule')"
    />

    <button class="goal-card dashboard-card" @click="switchView('debts')">
      <div class="goal-topline">
        <div>
          <span class="section-kicker">主要目标</span>
          <h2>{{ closestDebt ? closestDebt.name : '建立一个省钱目标' }}</h2>
        </div>
        <span class="goal-percentage">{{ closestDebt ? closestDebt.progress : 0 }}%</span>
      </div>

      <template v-if="closestDebt">
        <div class="progress-track" aria-label="省钱目标进度">
          <span class="progress-value" :style="{ width: `${closestDebt.progress}%` }"></span>
        </div>
        <div class="goal-amounts">
          <span>已存 <strong>¥{{ formatCurrency(closestDebt.saved) }}</strong></span>
          <span>目标 ¥{{ formatCurrency(closestDebt.totalAmount) }}</span>
        </div>
      </template>
      <p v-else class="goal-empty">给想做的事设定金额，首页会持续显示进度。</p>
      <span class="card-link">{{ closestDebt ? '查看计划' : '新建计划' }} <b>›</b></span>
    </button>

    <section class="insight-grid">
      <button class="insight-card dashboard-card weight-insight" @click="switchView('weight')">
        <div class="insight-title-row">
          <span class="insight-icon weight-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 19a7 7 0 1 1 14 0H5Z" />
              <path d="m12 12 2.5-2.5" />
              <path d="M8.5 8.5A5 5 0 0 1 12 7a5 5 0 0 1 3.5 1.5" />
            </svg>
          </span>
          <span class="card-link">详情 ›</span>
        </div>
        <span class="section-kicker">体重趋势</span>
        <h2 v-if="latestWeight"><strong>{{ latestWeight.weight }}</strong> kg</h2>
        <h2 v-else><strong>--</strong> kg</h2>
        <p v-if="weightTrend.status !== 'none'" :style="{ color: weightTrend.color }">
          较上次 {{ weightTrend.icon }} {{ weightTrend.diff }} kg
        </p>
        <p v-else>记录两次后显示变化</p>
        <svg v-if="weightSparkline" class="weight-sparkline" viewBox="0 0 120 44" preserveAspectRatio="none" aria-hidden="true">
          <polyline :points="weightSparkline" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <div v-else class="sparkline-placeholder"></div>
      </button>

      <button class="insight-card dashboard-card mood-insight" @click="switchView('mood')">
        <div class="insight-title-row">
          <span class="insight-icon mood-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8" />
              <path d="M9 10h.01M15 10h.01M9 14.5c.9.8 1.9 1.2 3 1.2s2.1-.4 3-1.2" />
            </svg>
          </span>
          <span class="card-link">详情 ›</span>
        </div>
        <span class="section-kicker">心情回顾</span>
        <h2>七天心情</h2>
        <div class="mini-mood-row">
          <span v-for="item in last7Moods" :key="item.date" class="mini-mood-item" :class="{ empty: item.isEmpty }">
            <b>{{ item.isEmpty ? '·' : getMoodEmoji(item.mood) }}</b>
            <small>{{ item.weekday }}</small>
          </span>
        </div>
        <p>{{ moodWeekSummary }}</p>
      </button>
    </section>

    <section class="dashboard-section activity-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">最近记录</span>
          <h2>最近动态</h2>
        </div>
      </div>

      <div class="activity-card dashboard-card">
        <template v-if="recentActivities.length">
          <button
            v-for="activity in recentActivities"
            :key="activity.key"
            class="activity-item"
            @click="switchView(activity.view)"
          >
            <span class="activity-icon" :class="`activity-${activity.type}`">{{ activity.icon }}</span>
            <span class="activity-copy">
              <strong>{{ activity.title }}</strong>
              <small>{{ activity.detail }}</small>
            </span>
            <span class="activity-date">{{ formatActivityDate(activity.date) }}</span>
          </button>
        </template>
        <div v-else class="activity-empty">
          <span>⌁</span>
          <p>记录心情、体重或存钱后，最近动态会出现在这里。</p>
        </div>
      </div>
    </section>

    <button class="report-banner" @click="switchView('reports')">
      <span class="report-mark">月</span>
      <span class="report-copy">
        <small>月度回顾</small>
        <strong>看看这个月的自己</strong>
        <span>心情、体重与省钱进度汇总</span>
      </span>
      <b>›</b>
    </button>
  </div>
</template>

<style src="./home.css"></style>
