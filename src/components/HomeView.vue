<script setup>
import { computed, onMounted, ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useMoodStore } from '../stores/mood'
import { useWeightStore } from '../stores/weight'
import { useDebtStore } from '../stores/debt'
import { useScheduleStore } from '../stores/schedule'
import { askAI } from '../services/aiEngine'
import {
  buildHomeCompanionContext,
  buildHomeCompanionPrompt,
  getCompanionContextFingerprint,
  normalizeCompanionReply,
  shouldGenerateHomeCompanion
} from '../services/companionPrompts'

const settingsStore = useSettingsStore()
const moodStore = useMoodStore()
const weightStore = useWeightStore()
const debtStore = useDebtStore()
const scheduleStore = useScheduleStore()
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

const MOOD_EMOJI_MAP = { great: '🤩', good: '🙂', normal: '😐', bad: '😔', terrible: '😫' }
const MOOD_LABEL_MAP = { great: '超赞', good: '开心', normal: '一般', bad: '低落', terrible: '极差' }
const getMoodEmoji = (mood) => MOOD_EMOJI_MAP[mood] || '😐'
const getMoodLabel = (mood) => MOOD_LABEL_MAP[mood] || '一般'
const todayMoodEmoji = computed(() => todayMood.value ? getMoodEmoji(todayMood.value.mood) : null)

const sortedWeights = computed(() => [...weightStore.weightRecords]
  .filter(record => Number.isFinite(Number(record.weight)) && record.date)
  .sort((a, b) => b.date.localeCompare(a.date)))
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

const totalSavedAmount = computed(() => debtStore.savedDebts.reduce((sum, debt) => {
  return sum + (debt.records || []).reduce((recordSum, record) => recordSum + (Number(record.amount) || 0), 0)
}, 0))

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
      mood: record?.mood || 'normal',
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

const switchView = (view) => settingsStore.switchView(view)

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
          <b aria-hidden="true">›</b>
        </button>
      </div>
    </section>

    <section class="dashboard-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">今日</span>
          <h2>今日记录</h2>
        </div>
        <span class="section-summary">{{ todayRecordCount }}/3 有动态</span>
      </div>

      <div class="today-grid">
        <button
          v-for="task in todayTasks"
          :key="task.key"
          class="today-action"
          :class="{ completed: task.done }"
          @click="switchView(task.view)"
        >
          <span class="today-icon">{{ task.icon }}</span>
          <span class="today-label">{{ task.label }}</span>
          <span class="today-detail">{{ task.detail }}</span>
          <span class="today-state">{{ task.done ? '已记录' : '去记录' }} <b>›</b></span>
        </button>
      </div>
    </section>

    <button class="schedule-home-card dashboard-card" @click="switchView('schedule')">
      <div class="schedule-date-tile">
        <strong>{{ currentTime.getDate() }}</strong>
        <span>{{ ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][currentTime.getDay()] }}</span>
      </div>
      <div class="schedule-home-copy">
        <span class="section-kicker">今日日程</span>
        <h2>{{ nextSchedule ? nextSchedule.title : '今日暂无日程' }}</h2>
        <p>{{ nextScheduleDateLabel }}</p>
      </div>
      <div class="schedule-count">
        <strong>{{ todaySchedules.length }}</strong>
        <span>剩余</span>
      </div>
    </button>

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

<style scoped>
.home-dashboard {
  --home-blue: var(--primary);
  --home-ink: #172033;
  --home-muted: #747c8d;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 24px;
}

.home-dashboard > * {
  animation: galaxySectionRise .58s cubic-bezier(.2, .78, .28, 1) both;
}

.home-dashboard > :nth-child(2) { animation-delay: .055s; }
.home-dashboard > :nth-child(3) { animation-delay: .105s; }
.home-dashboard > :nth-child(4) { animation-delay: .155s; }
.home-dashboard > :nth-child(5) { animation-delay: .205s; }
.home-dashboard > :nth-child(6) { animation-delay: .255s; }

@keyframes galaxySectionRise {
  from { opacity: 0; transform: translate3d(0, 18px, 0) scale(.987); }
  to { opacity: 1; transform: none; }
}

button {
  font: inherit;
}

.home-hero {
  position: relative;
  min-height: 240px;
  padding: 22px;
  overflow: hidden;
  border: 1px solid rgba(var(--theme-primary-rgb), .12);
  border-radius: var(--radius-panel);
  color: var(--home-ink);
  box-shadow: var(--shadow-panel);
  isolation: isolate;
}

.hero-morning { background: linear-gradient(145deg, var(--theme-soft) 0%, #fbfdff 58%, var(--theme-surface) 100%); }
.hero-afternoon { background: linear-gradient(145deg, #fff0df 0%, #fff9f1 54%, var(--theme-soft) 100%); }
.hero-night { background: linear-gradient(145deg, var(--theme-soft) 0%, #f1edff 52%, var(--theme-surface) 100%); }

.hero-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(2px);
  opacity: 0.68;
  z-index: -1;
}

.hero-orb-one {
  width: 220px;
  height: 220px;
  right: -72px;
  top: -62px;
  background: radial-gradient(circle at 35% 35%, rgba(255, 255, 255, 0.98), rgba(var(--theme-primary-rgb), .2) 68%, transparent 70%);
  animation: heroOrbOne 13s ease-in-out infinite alternate;
}

.hero-orb-two {
  width: 170px;
  height: 170px;
  left: -74px;
  bottom: -92px;
  background: rgba(255, 255, 255, 0.5);
  animation: heroOrbTwo 16s ease-in-out infinite alternate;
}

@keyframes heroOrbOne {
  from { transform: translate3d(0, 0, 0) scale(.94); opacity: .54; }
  to { transform: translate3d(-18px, 22px, 0) scale(1.08); opacity: .78; }
}

@keyframes heroOrbTwo {
  from { transform: translate3d(-8px, 7px, 0) scale(1.06); opacity: .42; }
  to { transform: translate3d(20px, -16px, 0) scale(.92); opacity: .66; }
}

.hero-content { position: relative; z-index: 1; }

.hero-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.02em;
  color: rgba(23, 32, 51, 0.65);
}

.home-hero h1 {
  margin: 24px 0 12px;
  max-width: 430px;
  font-size: clamp(30px, 7vw, 42px);
  line-height: 1.08;
  letter-spacing: -0.05em;
  font-weight: 720;
}

.hero-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: rgba(23, 32, 51, 0.7);
}

.hero-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2f9e72;
  box-shadow: 0 0 0 5px rgba(47, 158, 114, 0.12);
  animation: statusBreathe 2.8s ease-in-out infinite;
}

@keyframes statusBreathe {
  0%, 100% { box-shadow: 0 0 0 4px rgba(47, 158, 114, .11); transform: scale(.94); }
  50% { box-shadow: 0 0 0 7px rgba(47, 158, 114, .04); transform: scale(1.08); }
}

.companion-note {
  display: flex;
  gap: 11px;
  align-items: flex-start;
  margin-top: 18px;
  padding: 13px 15px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: var(--radius-control);
  background: rgba(255, 255, 255, 0.54);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  width: 100%;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.companion-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 9px;
  background: var(--theme-soft);
  color: var(--home-blue);
  font-size: 13px;
}

.companion-note p {
  margin: 1px 0 0;
  font-size: 14px;
  line-height: 1.55;
  color: rgba(23, 32, 51, 0.76);
}
.companion-note b { margin-left: auto; color: var(--home-blue); font-size: 21px; font-weight: 500; }

.dashboard-section { display: flex; flex-direction: column; gap: 12px; }

.section-heading,
.goal-topline,
.insight-title-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
}

.section-kicker {
  display: block;
  margin-bottom: 5px;
  color: var(--primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .03em;
}

.section-heading h2,
.goal-card h2,
.insight-card h2 {
  margin: 0;
  color: var(--home-ink);
  letter-spacing: -0.025em;
}

.section-heading h2 { font-size: 21px; }
.section-summary { color: var(--home-muted); font-size: 13px; padding-top: 17px; }

.today-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.today-action {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  min-width: 0;
  padding: 13px 12px 12px;
  text-align: left;
  color: var(--home-ink);
  border: 1px solid var(--theme-border);
  border-radius: var(--radius-card);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: var(--shadow-card);
  cursor: pointer;
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.today-action::before,
.dashboard-card::before {
  content: '';
  position: absolute;
  width: 170px;
  height: 170px;
  top: -108px;
  right: -106px;
  z-index: 0;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(var(--theme-primary-rgb), .18), rgba(var(--theme-primary-rgb), .06) 43%, transparent 70%);
  opacity: 0;
  transform: scale(.72);
  transition: opacity .28s ease, transform .38s cubic-bezier(.2, .8, .2, 1);
  pointer-events: none;
}

.today-action > *,
.dashboard-card > * {
  position: relative;
  z-index: 1;
}

.today-action:active { transform: scale(0.97); }
.today-action:active::before,
.dashboard-card:active::before { opacity: 1; transform: scale(1.12); }
.today-action.completed { border-color: rgba(76, 161, 122, 0.28); background: rgba(247, 255, 251, 0.9); }

.today-icon {
  display: grid;
  place-items: center;
  width: 35px;
  height: 35px;
  margin-bottom: 10px;
  border-radius: 13px;
  background: var(--theme-soft);
  color: var(--home-blue);
  font-size: 18px;
  font-weight: 700;
}

.today-action.completed .today-icon { background: #e7f6ee; color: #27855e; }
.today-label { display: block; font-size: 15px; font-weight: 700; }
.today-detail { display: block; min-height: 34px; margin-top: 4px; color: var(--home-muted); font-size: 11px; line-height: 1.45; }
.today-state { display: block; margin-top: 10px; color: var(--home-blue); font-size: 11px; font-weight: 650; }
.today-action.completed .today-state { color: #27855e; }
.today-state b, .card-link b { font-size: 15px; line-height: 0; }

.dashboard-card {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  border: 1px solid var(--theme-border);
  border-radius: var(--radius-card);
  background: rgba(255, 255, 255, 0.86);
  box-shadow: var(--shadow-card);
  transition: transform .22s ease, box-shadow .28s ease, border-color .28s ease;
}

.schedule-home-card {
  width: 100%;
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr) 50px;
  align-items: center;
  gap: 15px;
  padding: 18px;
  border: 1px solid var(--theme-border);
  text-align: left;
  color: var(--home-ink);
  cursor: pointer;
  background:
    radial-gradient(circle at 100% 0%, rgba(var(--theme-primary-rgb), .1), transparent 34%),
    rgba(255, 255, 255, 0.9);
}

.schedule-date-tile {
  width: 58px;
  height: 62px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  color: white;
  background: var(--theme-gradient);
  box-shadow: 0 8px 18px rgba(var(--theme-primary-rgb), .24);
  animation: dateTileGlow 5s ease-in-out infinite;
}

@keyframes dateTileGlow {
  0%, 100% { box-shadow: 0 8px 18px rgba(var(--theme-primary-rgb), .18); }
  50% { box-shadow: 0 10px 25px rgba(var(--theme-primary-rgb), .27); }
}

.schedule-date-tile strong { font-size: 24px; line-height: 1; }
.schedule-date-tile span { margin-top: 5px; font-size: 10px; opacity: 0.9; }
.schedule-home-copy { min-width: 0; }
.schedule-home-copy h2 {
  margin: 0;
  overflow: hidden;
  color: var(--home-ink);
  font-size: 19px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.schedule-home-copy p { margin: 6px 0 0; color: var(--home-muted); font-size: 12px; }
.schedule-count { display: flex; flex-direction: column; align-items: center; color: var(--primary); }
.schedule-count strong { font-size: 27px; line-height: 1; }
.schedule-count span { margin-top: 5px; color: var(--home-muted); font-size: 10px; }

.goal-card {
  width: 100%;
  padding: 18px;
  text-align: left;
  color: var(--home-ink);
  cursor: pointer;
}

.goal-card:active,
.insight-card:active,
.report-banner:active { transform: scale(0.985); }

.goal-card h2 { max-width: 470px; font-size: 21px; }
.goal-percentage { color: var(--home-blue); font-size: 30px; line-height: 1; font-weight: 760; letter-spacing: -0.04em; }

.progress-track {
  height: 12px;
  margin-top: 18px;
  overflow: hidden;
  border-radius: 999px;
  background: #edf0f5;
}

.progress-value {
  position: relative;
  display: block;
  height: 100%;
  min-width: 8px;
  border-radius: inherit;
  background: var(--theme-gradient);
  box-shadow: 0 3px 8px rgba(var(--theme-primary-rgb), .24);
  overflow: hidden;
  transition: width .72s cubic-bezier(.2, .78, .28, 1);
}

.progress-value::after {
  content: '';
  position: absolute;
  inset: 0;
  width: 42%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.56), transparent);
  transform: translate3d(-180%, 0, 0);
  animation: progressGleam 4.8s ease-in-out infinite;
}

@keyframes progressGleam {
  0%, 48% { transform: translate3d(-180%, 0, 0); opacity: 0; }
  58% { opacity: 1; }
  82%, 100% { transform: translate3d(330%, 0, 0); opacity: 0; }
}

.goal-amounts {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  color: var(--home-muted);
  font-size: 12px;
}

.goal-amounts strong { color: var(--home-ink); font-weight: 700; }
.goal-empty { margin: 18px 0 0; color: var(--home-muted); font-size: 13px; line-height: 1.55; }
.card-link { color: var(--home-blue); font-size: 12px; font-weight: 650; }
.goal-card > .card-link { display: block; margin-top: 17px; }

.insight-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.insight-card {
  min-width: 0;
  padding: 15px;
  text-align: left;
  color: var(--home-ink);
  cursor: pointer;
  overflow: hidden;
}

.insight-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 12px;
  font-size: 17px;
  font-weight: 750;
}

.insight-icon svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.weight-icon { background: var(--theme-soft); color: var(--primary); }
.mood-icon { background: #fff1dc; color: #b76a19; }
.insight-card > .section-kicker { margin-top: 14px; }
.insight-card h2 { font-size: 17px; }
.insight-card h2 strong { font-size: 28px; letter-spacing: -0.045em; }
.insight-card p { margin: 7px 0 0; color: var(--home-muted); font-size: 11px; line-height: 1.45; }

.weight-sparkline {
  width: 100%;
  height: 44px;
  margin-top: 16px;
  color: var(--primary);
  overflow: visible;
}

.sparkline-placeholder {
  height: 44px;
  margin-top: 16px;
  border-bottom: 2px dashed #e0e4eb;
}

.mini-mood-row {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
  margin-top: 17px;
}

.mini-mood-item { display: flex; min-width: 0; flex-direction: column; align-items: center; gap: 4px; }
.mini-mood-item b { font-size: clamp(13px, 3.5vw, 20px); line-height: 1; font-weight: 500; }
.mini-mood-item small { color: #979daa; font-size: 8px; }
.mini-mood-item.empty { opacity: 0.35; }

.activity-section { margin-top: 1px; }
.activity-card { overflow: hidden; padding: 0 18px; }

.activity-item {
  display: grid;
  grid-template-columns: 39px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  width: 100%;
  padding: 13px 0;
  text-align: left;
  color: var(--home-ink);
  border: 0;
  border-bottom: 1px solid #edf0f4;
  background: transparent;
  cursor: pointer;
}

.activity-item:last-child { border-bottom: 0; }
.activity-icon { display: grid; place-items: center; width: 39px; height: 39px; border-radius: 14px; font-size: 17px; font-weight: 750; }
.activity-mood { background: #fff1dc; }
.activity-weight { background: var(--theme-soft); color: var(--primary); }
.activity-savings { background: #e8f7ef; color: #27855e; }
.activity-copy { min-width: 0; }
.activity-copy strong, .activity-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activity-copy strong { font-size: 13px; }
.activity-copy small { margin-top: 4px; color: var(--home-muted); font-size: 11px; }
.activity-date { color: #9aa0ac; font-size: 10px; white-space: nowrap; }

.activity-empty { padding: 28px 18px; text-align: center; color: var(--home-muted); }
.activity-empty span { font-size: 28px; color: #b5bbc6; }
.activity-empty p { max-width: 330px; margin: 9px auto 0; font-size: 12px; line-height: 1.55; }

.report-banner {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  width: 100%;
  padding: 18px;
  text-align: left;
  color: var(--home-ink);
  border: 1px solid var(--theme-border);
  border-radius: var(--radius-card);
  background: linear-gradient(135deg, var(--theme-soft) 0%, var(--theme-surface) 58%, rgba(var(--theme-primary-rgb), .17) 100%);
  background-size: 180% 180%;
  box-shadow: var(--shadow-card);
  cursor: pointer;
  animation: reportGradientDrift 11s ease infinite;
}

.report-banner::before {
  content: '';
  position: absolute;
  inset: -80% -38%;
  z-index: 0;
  background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,.65) 50%, transparent 60%);
  transform: translate3d(-70%, 0, 0) rotate(5deg);
  animation: reportBannerShine 7.5s ease-in-out infinite;
  pointer-events: none;
}

.report-banner > * { position: relative; z-index: 1; }

@keyframes reportGradientDrift {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

@keyframes reportBannerShine {
  0%, 55% { transform: translate3d(-70%, 0, 0) rotate(5deg); opacity: 0; }
  63% { opacity: 1; }
  82%, 100% { transform: translate3d(70%, 0, 0) rotate(5deg); opacity: 0; }
}

.report-mark { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 17px; background: rgba(255, 255, 255, 0.66); color: var(--primary); font-size: 20px; font-weight: 700; }
.report-copy { min-width: 0; }
.report-copy small, .report-copy strong, .report-copy span { display: block; }
.report-copy small { margin-bottom: 4px; color: var(--primary); font-size: 10px; font-weight: 750; letter-spacing: .04em; }
.report-copy strong { font-size: 16px; }
.report-copy span { margin-top: 4px; color: var(--home-muted); font-size: 11px; }
.report-banner > b { font-size: 27px; font-weight: 300; color: var(--primary); }

@media (min-width: 640px) {
  .home-hero { min-height: 252px; padding: 26px; }
  .today-action { padding: 18px; }
  .today-detail { min-height: auto; }
  .goal-card { padding: 26px; }
  .insight-card { padding: 22px; }
}

@media (hover: hover) and (pointer: fine) {
  .today-action:hover,
  .dashboard-card:hover {
    transform: translateY(-3px);
    border-color: rgba(var(--theme-primary-rgb), .3);
    box-shadow: 0 16px 38px rgba(var(--theme-primary-rgb), .13);
  }
  .today-action:hover::before,
  .dashboard-card:hover::before { opacity: .72; transform: scale(1); }
}

@media (max-width: 380px) {
  .home-hero { padding: 23px; border-radius: 26px; }
  .today-grid { gap: 7px; }
  .today-action { padding: 13px 10px 11px; border-radius: 18px; }
  .today-label { font-size: 14px; }
  .today-detail { font-size: 10px; }
  .insight-grid { gap: 9px; }
  .insight-card { padding: 15px; }
  .mini-mood-item b { font-size: 13px; }
}

@media (prefers-reduced-motion: reduce) {
  .home-dashboard > *,
  .hero-orb,
  .hero-status-dot,
  .schedule-date-tile,
  .progress-value::after,
  .report-banner,
  .report-banner::before { animation: none; }
  .today-action,
  .goal-card,
  .insight-card,
  .report-banner { transition: none; }
}
</style>
