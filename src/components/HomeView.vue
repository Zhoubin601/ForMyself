<script setup>
import { computed, onMounted, ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useMoodStore } from '../stores/mood'
import { useWeightStore } from '../stores/weight'
import { useDebtStore } from '../stores/debt'
import { useScheduleStore } from '../stores/schedule'
import { askAI } from '../services/aiEngine'
import { compareMoodRecordsNewestFirst } from '../services/moodRecords'

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

const getDataFingerprint = () => {
  const debtPct = closestDebt.value?.progress || 0
  const debtName = closestDebt.value?.name || 'none'
  const weightVal = latestWeight.value?.weight || 0
  const moodKey = JSON.stringify(todayMoodEvents.value.map(item => [item.mood, item.tags, item.note]))
  return `${debtPct}|${debtName}|${weightVal}|${moodKey}|${totalSavedAmount.value}`
}

const fetchAIQuote = async () => {
  if (!settingsStore.aiApiKey) return
  if (!settingsStore.dataFingerprint) {
    settingsStore.dataFingerprint = getDataFingerprint()
    return
  }
  const fingerprint = getDataFingerprint()
  if (fingerprint === settingsStore.dataFingerprint) return
  settingsStore.dataFingerprint = fingerprint
  try {
    const recentMoods = [...moodStore.moodRecords]
      .sort(compareMoodRecordsNewestFirst)
      .slice(0, 3)
      .reverse()
      .map(record => `${getMoodLabel(record.mood)}（${(record.tags || ['学习']).join('、')}）`)
    const debtName = closestDebt.value?.name || '未设置目标'
    const savedAmount = closestDebt.value?.saved || 0
    const debtPct = closestDebt.value?.progress || 0
    const weightDiff = weightTrend.value.status !== 'none'
      ? `${weightTrend.value.status === 'down' ? '减轻' : weightTrend.value.status === 'up' ? '增加' : '保持'}了 ${weightTrend.value.diff} kg`
      : '暂无对比数据'
    const prompt = `你是一个贴心、博学的个人生活助手。\n当前用户的数据状态如下：\n1. 财务：存钱计划 [${debtName}] 目前已存 [${savedAmount}] 元，进度已达 [${debtPct}]%。\n2. 体重：最新体重比上一次${weightDiff}。\n3. 心情：最近三条心情轨迹为 [${recentMoods.join(' -> ')}]。\n请结合这些真实变化，生成一段 80 字以内、温柔且具体的每日简报，不要编造缺失信息。`
    const answer = await askAI(prompt)
    settingsStore.cachedQuote = { text: answer, date: todayStr.value }
  } catch (error) {
    if (error.message !== 'MISSING_KEY') console.error('[HomeView] AI error:', error.message)
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
        <div class="companion-note">
          <span class="companion-icon">✦</span>
          <p>{{ companionText }}</p>
        </div>
      </div>
    </section>

    <section class="dashboard-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">TODAY</span>
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
        <span class="section-kicker">TODAY SCHEDULE</span>
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
          <span class="section-kicker">MAIN GOAL</span>
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
          <span class="insight-icon weight-icon">⚖</span>
          <span class="card-link">详情 ›</span>
        </div>
        <span class="section-kicker">WEIGHT</span>
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
          <span class="insight-icon mood-icon">☺</span>
          <span class="card-link">详情 ›</span>
        </div>
        <span class="section-kicker">MOOD</span>
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
          <span class="section-kicker">RECENT</span>
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
        <small>MONTHLY REPORT</small>
        <strong>看看这个月的自己</strong>
        <span>心情、体重与省钱进度汇总</span>
      </span>
      <b>›</b>
    </button>
  </div>
</template>

<style scoped>
.home-dashboard {
  --home-blue: #0a6fd6;
  --home-ink: #172033;
  --home-muted: #747c8d;
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding-bottom: 24px;
}

button {
  font: inherit;
}

.home-hero {
  position: relative;
  min-height: 310px;
  padding: 28px;
  overflow: hidden;
  border-radius: 30px;
  color: var(--home-ink);
  box-shadow: 0 18px 44px rgba(42, 71, 106, 0.13);
  isolation: isolate;
}

.hero-morning { background: linear-gradient(145deg, #dff1ff 0%, #f4f9ff 58%, #e8e4ff 100%); }
.hero-afternoon { background: linear-gradient(145deg, #fff0df 0%, #fff9f1 54%, #e5f1ff 100%); }
.hero-night { background: linear-gradient(145deg, #dfe4ff 0%, #f1edff 52%, #dcedff 100%); }

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
  background: radial-gradient(circle at 35% 35%, rgba(255, 255, 255, 0.98), rgba(85, 153, 255, 0.2) 68%, transparent 70%);
}

.hero-orb-two {
  width: 170px;
  height: 170px;
  left: -74px;
  bottom: -92px;
  background: rgba(255, 255, 255, 0.5);
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
  margin: 34px 0 14px;
  max-width: 430px;
  font-size: clamp(34px, 7vw, 48px);
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
}

.companion-note {
  display: flex;
  gap: 11px;
  align-items: flex-start;
  margin-top: 28px;
  padding: 15px 17px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.54);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.companion-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 9px;
  background: rgba(10, 111, 214, 0.12);
  color: var(--home-blue);
  font-size: 13px;
}

.companion-note p {
  margin: 1px 0 0;
  font-size: 14px;
  line-height: 1.55;
  color: rgba(23, 32, 51, 0.76);
}

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
  color: #8b93a3;
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.13em;
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
  gap: 10px;
}

.today-action {
  position: relative;
  min-width: 0;
  padding: 15px 13px 13px;
  text-align: left;
  color: var(--home-ink);
  border: 1px solid rgba(220, 224, 232, 0.85);
  border-radius: 21px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 9px 24px rgba(44, 55, 75, 0.055);
  cursor: pointer;
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.today-action:active { transform: scale(0.97); }
.today-action.completed { border-color: rgba(76, 161, 122, 0.28); background: rgba(247, 255, 251, 0.9); }

.today-icon {
  display: grid;
  place-items: center;
  width: 35px;
  height: 35px;
  margin-bottom: 13px;
  border-radius: 13px;
  background: #edf4fb;
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
  border: 1px solid rgba(220, 224, 232, 0.82);
  border-radius: 25px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 12px 32px rgba(44, 55, 75, 0.065);
}

.schedule-home-card {
  width: 100%;
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr) 50px;
  align-items: center;
  gap: 15px;
  padding: 18px;
  border: 1px solid rgba(255, 109, 116, 0.18);
  text-align: left;
  color: var(--home-ink);
  cursor: pointer;
  background:
    radial-gradient(circle at 100% 0%, rgba(255, 79, 88, 0.1), transparent 34%),
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
  background: linear-gradient(145deg, #ff5a63, #ff3440);
  box-shadow: 0 8px 18px rgba(255, 52, 64, 0.24);
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
.schedule-count { display: flex; flex-direction: column; align-items: center; color: #ff3e49; }
.schedule-count strong { font-size: 27px; line-height: 1; }
.schedule-count span { margin-top: 5px; color: var(--home-muted); font-size: 10px; }

.goal-card {
  width: 100%;
  padding: 22px;
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
  margin-top: 25px;
  overflow: hidden;
  border-radius: 999px;
  background: #edf0f5;
}

.progress-value {
  display: block;
  height: 100%;
  min-width: 8px;
  border-radius: inherit;
  background: linear-gradient(90deg, #58a5ef, #0a6fd6);
  box-shadow: 0 3px 8px rgba(10, 111, 214, 0.24);
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
  padding: 18px;
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

.weight-icon { background: #e7f3ff; color: #156dbf; }
.mood-icon { background: #fff1dc; color: #b76a19; }
.insight-card > .section-kicker { margin-top: 18px; }
.insight-card h2 { font-size: 17px; }
.insight-card h2 strong { font-size: 28px; letter-spacing: -0.045em; }
.insight-card p { margin: 7px 0 0; color: var(--home-muted); font-size: 11px; line-height: 1.45; }

.weight-sparkline {
  width: 100%;
  height: 44px;
  margin-top: 16px;
  color: #3188d8;
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
  padding: 15px 0;
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
.activity-weight { background: #e7f3ff; color: #156dbf; }
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
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  width: 100%;
  padding: 18px;
  text-align: left;
  color: #f9fbff;
  border: 0;
  border-radius: 24px;
  background: linear-gradient(135deg, #172b4d 0%, #244b78 58%, #356c9f 100%);
  box-shadow: 0 16px 34px rgba(28, 59, 94, 0.18);
  cursor: pointer;
}

.report-mark { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 17px; background: rgba(255, 255, 255, 0.13); font-size: 20px; font-weight: 700; }
.report-copy { min-width: 0; }
.report-copy small, .report-copy strong, .report-copy span { display: block; }
.report-copy small { margin-bottom: 4px; color: rgba(255, 255, 255, 0.56); font-size: 9px; font-weight: 750; letter-spacing: 0.13em; }
.report-copy strong { font-size: 16px; }
.report-copy span { margin-top: 4px; color: rgba(255, 255, 255, 0.66); font-size: 11px; }
.report-banner > b { font-size: 27px; font-weight: 300; color: rgba(255, 255, 255, 0.8); }

@media (min-width: 640px) {
  .home-hero { min-height: 330px; padding: 34px; }
  .today-action { padding: 18px; }
  .today-detail { min-height: auto; }
  .goal-card { padding: 26px; }
  .insight-card { padding: 22px; }
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
  .today-action,
  .goal-card,
  .insight-card,
  .report-banner { transition: none; }
}
</style>
