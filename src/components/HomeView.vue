<script setup>
import { ref, computed, onMounted } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useMoodStore } from '../stores/mood'
import { useWeightStore } from '../stores/weight'
import { useDebtStore } from '../stores/debt'
import { askAI } from '../services/aiEngine'

const settingsStore = useSettingsStore()
const moodStore = useMoodStore()
const weightStore = useWeightStore()
const debtStore = useDebtStore()

const getTodayStr = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

const todayStr = ref('')
const updateToday = () => {
  const n = new Date()
  todayStr.value = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
updateToday()

const getDataFingerprint = () => {
  const debtPct = closestDebt.value ? closestDebt.value.progress : 0
  const debtName = closestDebt.value ? closestDebt.value.name : 'none'
  const weightVal = latestWeight.value ? latestWeight.value.weight : 0
  const moodKey = todayMood.value ? todayMood.value.mood : 'none'
  const totSaved = totalSavedAmount.value
  return `${debtPct}|${debtName}|${weightVal}|${moodKey}|${totSaved}`
}

const fetchAIQuote = async () => {
  if (!settingsStore.aiApiKey) return
  if (!settingsStore.dataFingerprint) {
    settingsStore.dataFingerprint = getDataFingerprint()
    return
  }
  const fp = getDataFingerprint()
  if (fp === settingsStore.dataFingerprint) return
  settingsStore.dataFingerprint = fp
  const today = getTodayStr()
  try {
    const allMoods = [...moodStore.moodRecords].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3)
    const last3Moods = allMoods.reverse().map(m => getMoodLabel(m.mood))
    const debtName = closestDebt.value ? closestDebt.value.name : '未设置目标'
    const savedAmount = closestDebt.value ? (closestDebt.value.totalAmount - closestDebt.value.remainingAmount) : 0
    const debtPct = closestDebt.value ? closestDebt.value.progress : 0
    const weightDiff = weightTrend.value.status !== 'none' ? `${weightTrend.value.status === 'down' ? '减轻' : '增加'}了 ${weightTrend.value.diff} kg` : '暂无对比数据'
    const rawPrompt = `你是一个贴心、博学的个人生活助手。\n当前用户的数据状态如下：\n1. 财务：存钱计划 [${debtName}] 目前已存 [${savedAmount}] 元，进度已达 [${debtPct}]%。\n2. 体重：最新体重比上一次${weightDiff}。\n3. 心情：最近连续三天的心情轨迹为 [${last3Moods.join(' -> ')}]。\n请结合这些具体的数据变化，为用户生成一段 80 字以内、温柔且充满细节的每日简报和鼓励，不要透露你是根据模板生成的。`
    const aiAnswer = await askAI(rawPrompt)
    settingsStore.cachedQuote = { text: aiAnswer, date: today }
  } catch (e) {
    if (e.message !== 'MISSING_KEY') console.error('[HomeView] AI error:', e.message)
  }
}

onMounted(() => {
  updateToday()
  if (settingsStore.aiApiKey) {
    fetchAIQuote()
  }
})

const todayMood = computed(() => {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const today = `${y}-${m}-${d}`
  return moodStore.getRecordByDate(today)
})
const isMoodLogged = computed(() => !!todayMood.value)
const todayMoodEmoji = computed(() => {
  if (!todayMood.value) return null
  const MOOD_MAP = { great: '🤩', good: '🙂', normal: '😐', bad: '😔', terrible: '😫' }
  return MOOD_MAP[todayMood.value.mood] || '😐'
})

const sortedWeights = computed(() => {
  return [...weightStore.weightRecords].sort((a, b) => b.date.localeCompare(a.date))
})
const latestWeight = computed(() => sortedWeights.value[0] || null)
const isWeightLoggedToday = computed(() => {
  if (!latestWeight.value) return false
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return latestWeight.value.date === today
})

const weightTrend = computed(() => {
  if (sortedWeights.value.length < 2) return { status: 'none', diff: 0, icon: '', color: '' }
  const current = sortedWeights.value[0].weight
  const previous = sortedWeights.value[1].weight
  const diff = (current - previous).toFixed(1)
  if (diff > 0) return { status: 'up', icon: '↑', diff, color: '#ff9500' }
  if (diff < 0) return { status: 'down', icon: '↓', diff: Math.abs(diff), color: '#34c759' }
  return { status: 'flat', icon: '—', diff: 0, color: '#86868b' }
})

const activeDebts = computed(() => debtStore.savedDebts.filter(d => !d.isCleared))
const closestDebt = computed(() => {
  const withProgress = activeDebts.value.map(d => {
    const saved = d.records ? d.records.reduce((s, r) => s + r.amount, 0) : 0
    const progress = d.totalAmount > 0 ? Math.round((saved / d.totalAmount) * 100) : 0
    return { ...d, saved, progress }
  })
  return withProgress.sort((a, b) => b.progress - a.progress)[0] || null
})

const totalSavedAmount = computed(() => {
  return debtStore.savedDebts.reduce((sum, item) => {
    return sum + (item.records ? item.records.reduce((s, r) => s + r.amount, 0) : 0)
  }, 0)
})

const last7Moods = computed(() => {
  const result = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`
    const record = moodStore.getRecordByDate(dateStr)
    result.push({
      _day: parseInt(day),
      isEmpty: !record,
      mood: record ? record.mood : 'normal',
      date: dateStr
    })
  }
  return result
})

const MOOD_EMOJI_MAP = { great: '🤩', good: '🙂', normal: '😐', bad: '😔', terrible: '😫' }
const getMoodEmoji = (mood) => MOOD_EMOJI_MAP[mood] || '😐'
const getMoodLabel = (mood) => {
  const labels = { great: '超赞', good: '开心', normal: '一般', bad: '低落', terrible: '极差' }
  return labels[mood] || '一般'
}

onMounted(() => {
})
</script>

<template>
  <div class="home-container">

    <section class="glass-card hero">
      <div class="hero-header">
        <h3 class="hero-title">✨ 每日陪伴</h3>
      </div>
      <p class="hero-text">{{ settingsStore.cachedQuote.text }}</p>
    </section>

    <section class="quick-row">
      <button class="glass-card capsule" @click="settingsStore.switchView('mood')">
        <span v-if="isMoodLogged" class="capsule-emoji">{{ todayMoodEmoji }}</span>
        <span v-else>+ 记录心情</span>
      </button>
      <button class="glass-card capsule" @click="settingsStore.switchView('weight')">
        <span v-if="isWeightLoggedToday">{{ latestWeight.weight }}kg</span>
        <span v-else>⚖️ 记体重</span>
      </button>
      <button class="glass-card capsule highlight" @click="settingsStore.switchView('debts')">
        💰 存钱
      </button>
    </section>

    <section class="widget-grid">
      <div class="glass-card widget">
        <h4 class="widget-title">省钱进度</h4>
        <div class="donut-wrapper">
          <div class="donut-ring">
            <svg viewBox="0 0 40 40" class="donut-svg">
              <circle cx="20" cy="20" r="16" fill="none" stroke="#e8e8ed" stroke-width="4"/>
              <circle cx="20" cy="20" r="16" fill="none" stroke="#0066cc" stroke-width="4"
                :stroke-dasharray="100.53" :stroke-dashoffset="100.53 - (closestDebt ? closestDebt.progress : 0) * 1.0053"
                stroke-linecap="round" transform="rotate(-90, 20, 20)"/>
            </svg>
          </div>
          <div class="donut-label">
            <span class="donut-pct">{{ closestDebt ? closestDebt.progress : 0 }}%</span>
            <span class="donut-name">{{ closestDebt ? closestDebt.name : '暂无目标' }}</span>
          </div>
        </div>
      </div>

      <div class="glass-card widget">
        <h4 class="widget-title">最新体重</h4>
        <div class="weight-block">
          <span class="weight-num">{{ latestWeight ? latestWeight.weight : '--' }}</span>
          <span class="weight-unit">kg</span>
        </div>
        <div v-if="weightTrend.status !== 'none'" class="weight-compare" :style="{ color: weightTrend.color }">
          {{ weightTrend.icon }} {{ weightTrend.diff }} kg
        </div>
        <div v-else class="weight-compare muted">暂无对比</div>
      </div>

      <div class="glass-card widget widget-full">
        <h4 class="widget-title">七天心情</h4>
        <div class="mood-wave">
          <div v-for="m in last7Moods" :key="m.date" class="mood-dot" :class="{ dim: m.isEmpty }">
            <span class="mood-emoji">{{ m.isEmpty ? '—' : getMoodEmoji(m.mood) }}</span>
            <span class="mood-day">{{ m._day }}日</span>
          </div>
        </div>
      </div>
    </section>

  </div>
</template>

<style scoped>
.home-container { padding: 0 0 32px 0; position: relative; min-height: 100%; }

.glass-card {
  background: rgba(240, 248, 255, 0.45);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 18px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
  padding: 18px;
}

.hero { margin-bottom: 20px; }
.hero-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.hero-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--ink); }
.hero-text { margin: 0; font-size: 15px; line-height: 1.6; color: var(--ink); font-weight: 400; }

.quick-row { display: flex; gap: 10px; margin-bottom: 24px; }
.capsule { flex: 1; padding: 14px 0; border-radius: 30px; text-align: center; font-size: 14px; font-weight: 500; color: var(--ink); cursor: pointer; border: none; }
.capsule:active { transform: scale(0.95); }
.capsule.highlight { background: rgba(0, 102, 204, 0.12); color: var(--primary); font-weight: 600; }
.capsule-emoji { font-size: 20px; }

.widget-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.widget-full { grid-column: 1 / -1; }
.widget-title { margin: 0 0 12px 0; font-size: 13px; font-weight: 600; color: var(--body-muted); text-transform: uppercase; letter-spacing: 0.3px; }

.donut-wrapper { display: flex; align-items: center; gap: 14px; }
.donut-ring { width: 56px; height: 56px; flex-shrink: 0; }
.donut-svg { width: 100%; height: 100%; }
.donut-label { display: flex; flex-direction: column; gap: 2px; }
.donut-pct { font-size: 22px; font-weight: 700; color: var(--primary); line-height: 1; }
.donut-name { font-size: 13px; color: var(--body-muted); line-height: 1.2; }

.weight-block { display: flex; align-items: baseline; gap: 4px; }
.weight-num { font-size: 28px; font-weight: 700; color: var(--ink); line-height: 1; }
.weight-unit { font-size: 14px; color: var(--body-muted); }
.weight-compare { font-size: 14px; font-weight: 500; }
.weight-compare.muted { color: var(--body-muted); font-weight: 400; }

.mood-wave { display: flex; justify-content: space-between; gap: 4px; }
.mood-dot { display: flex; flex-direction: column; align-items: center; gap: 4px; opacity: 1; transition: opacity 0.3s; }
.mood-dot.dim { opacity: 0.4; }
.mood-emoji { font-size: 22px; line-height: 1; }
.mood-day { font-size: 11px; color: var(--body-muted); }

</style>