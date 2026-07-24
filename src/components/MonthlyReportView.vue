<script setup>
import { computed, ref, watch } from 'vue'
import { useMoodStore } from '../stores/mood'
import { useWeightStore } from '../stores/weight'
import { useDebtStore } from '../stores/debt'
import { useSettingsStore } from '../stores/settings'
import { askAI } from '../services/aiEngine'
import { buildMonthlyReport, buildMonthlySummaryPrompt } from '../services/monthlyReport'
import { appAlert } from '../services/uiFeedback'

const moodStore = useMoodStore()
const weightStore = useWeightStore()
const debtStore = useDebtStore()
const settingsStore = useSettingsStore()

const now = new Date()
const selectedYear = ref(now.getFullYear())
const selectedMonth = ref(now.getMonth() + 1)
const aiSummary = ref('')
const isGeneratingSummary = ref(false)

const report = computed(() => buildMonthlyReport({
  moodRecords: moodStore.moodRecords,
  weightRecords: weightStore.weightRecords,
  savedDebts: debtStore.savedDebts
}, selectedYear.value, selectedMonth.value, {
  targetWeight: settingsStore.targetWeight,
  now
}))

const reportFingerprint = computed(() => JSON.stringify(report.value))
watch(reportFingerprint, () => { aiSummary.value = '' })

const monthLabel = computed(() => `${selectedYear.value}年${selectedMonth.value}月`)
const isCurrentMonth = computed(() => selectedYear.value === now.getFullYear() && selectedMonth.value === now.getMonth() + 1)

const changeMonth = offset => {
  const next = new Date(selectedYear.value, selectedMonth.value - 1 + offset, 1)
  if (next > new Date(now.getFullYear(), now.getMonth(), 1)) return
  selectedYear.value = next.getFullYear()
  selectedMonth.value = next.getMonth() + 1
}

const MOODS = [
  { key: 'great', emoji: '🤩', label: '很棒', color: '#34c759' },
  { key: 'good', emoji: '🙂', label: '不错', color: '#75c86b' },
  { key: 'normal', emoji: '😐', label: '一般', color: '#ffcc00' },
  { key: 'bad', emoji: '😔', label: '低落', color: '#ff9500' },
  { key: 'terrible', emoji: '😫', label: '很糟', color: '#ff3b30' }
]

const weightTrendText = computed(() => {
  const stats = report.value.weight
  if (stats.trend === 'none') return '本月暂无记录'
  if (stats.trend === 'stable') return '整体保持稳定'
  return stats.trend === 'down' ? `较月初下降 ${Math.abs(stats.change)} kg` : `较月初上升 ${stats.change} kg`
})

const targetGapText = computed(() => {
  const gap = report.value.weight.targetGap
  if (gap === null) return '设置目标后显示差距'
  if (Math.abs(gap) < 0.05) return '已达到目标体重'
  return gap > 0 ? `距离目标还有 ${gap} kg` : `已低于目标 ${Math.abs(gap)} kg`
})

const generateMonthlySummary = async () => {
  if (!settingsStore.aiApiKey?.trim()) return appAlert('请先在通用配置中填写 AI API Key')
  isGeneratingSummary.value = true
  try {
    aiSummary.value = await askAI(buildMonthlySummaryPrompt(report.value))
  } catch (error) {
    appAlert('月度总结生成失败：' + error.message)
  } finally {
    isGeneratingSummary.value = false
  }
}
</script>

<template>
  <div class="report-view fade-in">
    <div class="month-switcher">
      <button class="month-nav" @click="changeMonth(-1)">‹</button>
      <div>
        <strong>{{ monthLabel }}</strong>
        <span>生活月度报告</span>
      </div>
      <button class="month-nav" :disabled="isCurrentMonth" @click="changeMonth(1)">›</button>
    </div>

    <section class="report-card mood-report">
      <div class="report-heading">
        <div>
          <span class="report-kicker">心情</span>
          <h3>本月情绪分布</h3>
        </div>
        <div class="streak-badge">
          <strong>{{ report.mood.longestStreak }}</strong>
          <span>最长连续天数</span>
        </div>
      </div>

      <div v-if="report.mood.total" class="mood-distribution">
        <div v-for="mood in MOODS" :key="mood.key" class="mood-stat-row">
          <span class="mood-name">{{ mood.emoji }} {{ mood.label }}</span>
          <div class="mood-bar-track">
            <div class="mood-bar-fill" :style="{ width: `${report.mood.percentages[mood.key]}%`, background: mood.color }"></div>
          </div>
          <span class="mood-count">{{ report.mood.distribution[mood.key] }}次</span>
        </div>
      </div>
      <p v-else class="empty-copy">本月还没有心情记录。</p>
      <p class="report-footnote">本月共记录 {{ report.mood.totalEvents }} 个事件，覆盖 {{ report.mood.recordedDays }} 天</p>
    </section>

    <section class="report-card weight-report">
      <div class="report-heading">
        <div>
          <span class="report-kicker">体重</span>
          <h3>变化趋势</h3>
        </div>
        <div class="target-input-wrap">
          <label>目标 kg</label>
          <input v-model.number="settingsStore.targetWeight" type="number" min="20" max="300" step="0.1" placeholder="--" />
        </div>
      </div>
      <div class="metric-grid">
        <div class="metric-box">
          <span>月平均</span>
          <strong>{{ report.weight.average ?? '--' }}<small> kg</small></strong>
        </div>
        <div class="metric-box">
          <span>最新记录</span>
          <strong>{{ report.weight.latest?.weight ?? '--' }}<small> kg</small></strong>
        </div>
      </div>
      <div class="insight-line"><span>{{ weightTrendText }}</span><span>{{ targetGapText }}</span></div>
      <p class="report-footnote">本月有效记录 {{ report.weight.count }} 次</p>
    </section>

    <section class="report-card savings-report">
      <div class="report-heading">
        <div>
          <span class="report-kicker">省钱</span>
          <h3>本月完成速度</h3>
        </div>
        <div class="saved-total">¥{{ report.savings.monthlySaved }}</div>
      </div>
      <div class="metric-grid">
        <div class="metric-box">
          <span>日均存入</span>
          <strong>¥{{ report.savings.dailyAverage }}</strong>
        </div>
        <div class="metric-box">
          <span>存入次数</span>
          <strong>{{ report.savings.recordCount }}<small> 次</small></strong>
        </div>
      </div>
      <div v-if="report.savings.closestPlan" class="plan-progress-block">
        <div class="plan-progress-head">
          <span>{{ report.savings.closestPlan.name }}</span>
          <span>{{ report.savings.closestPlan.progress }}%</span>
        </div>
        <div class="plan-track"><div :style="{ width: `${report.savings.closestPlan.progress}%` }"></div></div>
        <p>{{ report.savings.estimatedDays ? `按本月速度预计还需约 ${report.savings.estimatedDays} 天` : '本月产生存款后可估算完成时间' }}</p>
      </div>
      <p v-else class="empty-copy">暂无进行中的省钱计划。</p>
    </section>

    <section class="report-card ai-report">
      <div class="report-heading">
        <div>
          <span class="report-kicker">AI 月度总结</span>
          <h3>把这个月轻轻收好</h3>
        </div>
        <span class="ai-spark">✨</span>
      </div>
      <p v-if="aiSummary" class="ai-summary-text">{{ aiSummary }}</p>
      <p v-else class="empty-copy">AI 会综合心情、体重和省钱数据，给你一段温柔而客观的月度回顾。</p>
      <button class="button-primary full-width" :disabled="isGeneratingSummary" @click="generateMonthlySummary">
        {{ isGeneratingSummary ? '正在整理这个月…' : aiSummary ? '重新生成月度总结' : '生成月度总结' }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.report-view { display: flex; flex-direction: column; gap: 18px; }
.month-switcher { display: grid; grid-template-columns: 44px 1fr 44px; align-items: center; text-align: center; padding: 6px 0 10px; }
.month-switcher div { display: flex; flex-direction: column; gap: 3px; }
.month-switcher strong { font-size: 22px; }
.month-switcher span { color: var(--body-muted); font-size: 13px; }
.month-nav { width: 40px; height: 40px; border: 0; border-radius: 50%; background: var(--canvas); color: var(--primary); font-size: 28px; cursor: pointer; }
.month-nav:disabled { opacity: .3; }
.report-card { padding: 20px; border-radius: 20px; background: rgba(255,255,255,.92); border: 1px solid rgba(255,255,255,.8); box-shadow: 0 8px 28px rgba(0,0,0,.055); }
.report-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
.report-kicker { color: var(--primary); font-size: 13px; font-weight: 600; }
.report-heading h3 { margin: 4px 0 0; font-size: 20px; }
.streak-badge { display: flex; flex-direction: column; align-items: flex-end; }
.streak-badge strong { color: var(--primary); font-size: 28px; line-height: 1; }
.streak-badge span { color: var(--body-muted); font-size: 11px; margin-top: 4px; }
.mood-distribution { display: flex; flex-direction: column; gap: 11px; }
.mood-stat-row { display: grid; grid-template-columns: 76px 1fr 36px; gap: 10px; align-items: center; }
.mood-name, .mood-count { font-size: 13px; }
.mood-count { text-align: right; color: var(--body-muted); }
.mood-bar-track { height: 9px; overflow: hidden; border-radius: 999px; background: var(--divider-soft); }
.mood-bar-fill { height: 100%; min-width: 0; border-radius: inherit; transition: width .4s ease; }
.metric-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.metric-box { display: flex; flex-direction: column; gap: 7px; padding: 15px; border-radius: 14px; background: var(--surface-pearl); }
.metric-box span { color: var(--body-muted); font-size: 13px; }
.metric-box strong { font-size: 23px; font-variant-numeric: tabular-nums; }
.metric-box small { color: var(--body-muted); font-size: 13px; font-weight: 400; }
.target-input-wrap { display: flex; align-items: center; gap: 7px; }
.target-input-wrap label { color: var(--body-muted); font-size: 12px; }
.target-input-wrap input { width: 70px; padding: 8px; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface-pearl); font-size: 14px; }
.insight-line { display: flex; justify-content: space-between; gap: 12px; margin-top: 14px; color: var(--ink); font-size: 13px; }
.saved-total { color: var(--primary); font-size: 27px; font-weight: 650; }
.plan-progress-block { margin-top: 16px; padding: 15px; border-radius: 14px; background: var(--surface-pearl); }
.plan-progress-head { display: flex; justify-content: space-between; font-size: 14px; font-weight: 600; }
.plan-track { height: 8px; margin-top: 10px; overflow: hidden; border-radius: 999px; background: var(--divider-soft); }
.plan-track div { height: 100%; border-radius: inherit; background: var(--primary); }
.plan-progress-block p { margin: 8px 0 0; color: var(--body-muted); font-size: 12px; }
.report-footnote { margin: 14px 0 0; color: var(--body-muted); font-size: 12px; }
.empty-copy { margin: 0 0 18px; color: var(--body-muted); font-size: 14px; line-height: 1.6; }
.ai-report { background: linear-gradient(145deg, rgba(237,246,255,.96), rgba(255,250,240,.96)); }
.ai-spark { font-size: 28px; }
.ai-summary-text { margin: 0 0 20px; font-size: 15px; line-height: 1.75; white-space: pre-wrap; }
.full-width { width: 100%; }
@media (max-width: 480px) {
  .insight-line { flex-direction: column; gap: 5px; }
  .report-card { padding: 18px; }
}
</style>
