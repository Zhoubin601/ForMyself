<script setup>
import { ref, computed, onBeforeUnmount, watch } from 'vue'
import { useWeightStore } from '../stores/weight'
import { useSettingsStore } from '../stores/settings'
import {
  sortWeightRecords, normalizeWeightTime, localWeightDate, filterWeightRange, calculateDailyAverages,
  calculateBmi,
  calculateWeeklyAverages,
  calculateWeightChangeNotice
} from '../services/weightInsights.js'
import { notifyWeightChange } from '../services/notificationService.js'
import { appAlert, appConfirm } from '../services/uiFeedback'
import { registerBackHandler } from '../services/backNavigation'
import AppDateField from './AppDateField.vue'
import AppTimeField from './AppTimeField.vue'
import CommonNoteField from './CommonNoteField.vue'

const weightStore = useWeightStore()
const settingsStore = useSettingsStore()

const showAddModal = ref(false)
const unregisterBackHandler = registerBackHandler(() => {
  if (showAddModal.value) { showAddModal.value = false; return true }
  return false
}, { priority: 500, isActive: () => showAddModal.value })
onBeforeUnmount(unregisterBackHandler)
const editDate = ref('')
const editWeight = ref(null)
const editNote = ref('')
const filterSegment = ref(30)
const chartMode = ref('daily')
const editingId = ref(null)
const editTime = ref('')
const selectedPoint = ref(null)
const changeNotice = ref(null)
const changeNoticeSent = ref(false)
const getTodayStr = () => localWeightDate()

const sortedRecords = computed(() => sortWeightRecords(weightStore.weightRecords))
const filteredRecords = computed(() => filterWeightRange(sortedRecords.value, filterSegment.value))

const WEIGHT_PAGE_SIZE = 10
const weightPage = ref(1)
const totalWeightPages = computed(() => Math.ceil(sortedRecords.value.length / WEIGHT_PAGE_SIZE) || 1)
const paginatedWeightRecords = computed(() => {
  const start = (weightPage.value - 1) * WEIGHT_PAGE_SIZE
  return sortedRecords.value.slice(start, start + WEIGHT_PAGE_SIZE)
})
watch(totalWeightPages, (n) => { if (weightPage.value > n) weightPage.value = n > 0 ? n : 1 })

const groupedRecords = computed(() => {
  const days = new Map()
  paginatedWeightRecords.value.forEach(record => {
    if (!days.has(record.date)) days.set(record.date, [])
    days.get(record.date).push(record)
  })
  return [...days].map(([date, records]) => ({ date, records }))
})
const dailyChartRecords = computed(() => calculateDailyAverages(filteredRecords.value))
const weeklyChartRecords = computed(() => calculateWeeklyAverages(filteredRecords.value).map(item => ({
  date: item.weekStart, weight: item.average, count: filteredRecords.value.filter(record => record.date >= item.weekStart && record.date <= item.weekEnd).length
})))
const chartRecords = computed(() => chartMode.value === 'weekly' ? weeklyChartRecords.value : dailyChartRecords.value)
const stats = computed(() => ({ latest: sortedRecords.value[0] || null }))
const latestChange = computed(() => sortedRecords.value.length > 1 ? Number((sortedRecords.value[0].weight - sortedRecords.value[1].weight).toFixed(1)) : null)
const sevenDayAverage = computed(() => {
  const days = calculateDailyAverages(filterWeightRange(weightStore.weightRecords, 7))
  return days.length ? (days.reduce((sum, day) => sum + day.weight, 0) / days.length).toFixed(1) : null
})
const showChartMarkers = computed(() => chartRecords.value.length <= 1 || (filterSegment.value !== 90 && filterSegment.value !== 0 && chartRecords.value.length <= 12))
watch([chartRecords, chartMode], () => { selectedPoint.value = null })

const bmi = computed(() => calculateBmi(stats.value.latest?.weight, settingsStore.heightCm))
const targetGap = computed(() => {
  if (!stats.value.latest || settingsStore.targetWeight === null) return null
  return Number((stats.value.latest.weight - settingsStore.targetWeight).toFixed(1))
})

const targetGapText = computed(() => {
  if (targetGap.value === null) return '设置后显示差距'
  if (Math.abs(targetGap.value) < 0.05) return '已达到目标'
  return targetGap.value > 0 ? `相差 ${targetGap.value} kg` : `低于目标 ${Math.abs(targetGap.value)} kg`
})

const CHART_PADDING = { top: 20, right: 16, bottom: 28, left: 44 }
const CHART_W = 300, CHART_H = 160
const plotW = CHART_W - CHART_PADDING.left - CHART_PADDING.right
const plotH = CHART_H - CHART_PADDING.top - CHART_PADDING.bottom

const chartPoints = computed(() => {
  const records = chartRecords.value
  if (!records.length) return null
  const weights = records.map(r => r.weight)
  const minW = Math.min(...weights), maxW = Math.max(...weights), range = maxW - minW || 1
  const yMin = minW - range * 0.15, yMax = maxW + range * 0.15, yRange = yMax - yMin || 1
  const points = records.map((r, i) => ({
    x: CHART_PADDING.left + (records.length === 1 ? .5 : (Date.parse(r.date) - Date.parse(records[0].date)) / (Date.parse(records[records.length - 1].date) - Date.parse(records[0].date) || 1)) * plotW,
    y: CHART_PADDING.top + ((yMax - r.weight) / yRange) * plotH,
    weight: r.weight, date: r.date, count: r.count, isFirst: i === 0, isLast: i === records.length - 1
  }))
  return { points, yMin: Math.round(yMin * 10) / 10, yMax: Math.round(yMax * 10) / 10, firstDate: records[0].date, lastDate: records[records.length - 1].date }
})

const chartLinePath = computed(() => {
  if (!chartPoints.value) return ''
  return chartPoints.value.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
})
const chartAreaPath = computed(() => {
  if (!chartPoints.value) return ''
  const pts = chartPoints.value.points
  const bottom = CHART_PADDING.top + plotH
  return `M${pts[0].x.toFixed(1)},${bottom} L${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')} L${pts[pts.length - 1].x.toFixed(1)},${bottom} Z`
})

const formatDateShort = (dateStr) => { const d = new Date(dateStr + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}` }
const currentTime = () => new Date().toTimeString().slice(0, 5)
const openAddModal = () => { editingId.value = null; editDate.value = getTodayStr(); editTime.value = currentTime(); editWeight.value = null; editNote.value = ''; showAddModal.value = true }
const editRecord = record => { editingId.value = record.id; editDate.value = record.date; editTime.value = normalizeWeightTime(record.time); editWeight.value = record.weight; editNote.value = record.note || ''; showAddModal.value = true }
const stepWeight = delta => { editWeight.value = Math.max(20, Math.min(300, Number((Number(editWeight.value || stats.value.latest?.weight || 60) + delta).toFixed(1)))) }

const saveRecord = async () => {
  changeNotice.value = null
  if (!editDate.value) return appAlert('请选择日期')
  if (editWeight.value === null || editWeight.value === '' || isNaN(editWeight.value)) return appAlert('请填写有效体重')
  if (editWeight.value < 20 || editWeight.value > 300) return appAlert('体重数值似乎不合理（20-300 kg）')
  if (editTime.value && !normalizeWeightTime(editTime.value)) return appAlert('请选择有效时间')
  const record = { id: editingId.value || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, date: editDate.value, time: normalizeWeightTime(editTime.value), weight: Number(Number(editWeight.value).toFixed(1)), note: editNote.value || '' }
  const notice = settingsStore.weightChangeReminderEnabled
    ? calculateWeightChangeNotice(weightStore.weightRecords, record, settingsStore.weightChangeThreshold)
    : null
  if (editingId.value) weightStore.updateRecord(editingId.value, record)
  else weightStore.addRecord(record)
  showAddModal.value = false
  if (notice) {
    changeNotice.value = notice
    changeNoticeSent.value = false
    try {
      const result = await notifyWeightChange(notice)
      changeNoticeSent.value = result.scheduled
    } catch {
      changeNoticeSent.value = false
    }
  }
}

const deleteRecord = async (record) => {
  if (!await appConfirm(`将删除 ${record.date} 的 ${record.weight} kg 记录。`, {
    title: '删除体重记录？',
    destructive: true
  })) return
  weightStore.deleteRecord(record.id)
  changeNotice.value = null
}

const formatDate = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00')
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.getMonth() + 1}月${d.getDate()}日 周${weekdays[d.getDay()]}`
}

const getTrend = (record) => {
  const recordIndex = sortedRecords.value.findIndex(item => item.id === record.id)
  if (recordIndex < 0 || recordIndex >= sortedRecords.value.length - 1) return ''
  const next = sortedRecords.value[recordIndex + 1]
  if (!next) return ''
  const diff = record.weight - next.weight
  return diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'
}
</script>

<template>
<div class="fade-in weight-container">
  <section class="weight-hero">
    <div><span class="stat-label">最新体重</span><div class="hero-value">{{ stats.latest ? stats.latest.weight : '--' }} <small>kg</small></div><p class="caption body-muted">{{ stats.latest ? `${stats.latest.date} · ${stats.latest.time || '未记录时间'}` : '从第一次记录开始' }}</p><p class="caption">{{ latestChange === null ? '记录两次后显示变化' : `较上次 ${latestChange > 0 ? '+' : ''}${latestChange.toFixed(1)} kg` }}</p></div>
    <button class="button-primary" @click="openAddModal">＋ 记录体重</button>
  </section>
  <div class="stats-grid">
    <div class="stat-card"><span class="stat-label">目标差距</span><span class="stat-value">{{ targetGap === null ? '--' : `${Math.abs(targetGap)} kg` }}</span><span class="stat-detail">{{ targetGapText }}</span></div>
    <div class="stat-card"><span class="stat-label">近 7 天均重</span><span class="stat-value">{{ sevenDayAverage ? sevenDayAverage + ' kg' : '--' }}</span><span class="stat-detail">按有记录的每日均值计算</span></div>
    <div class="stat-card"><span class="stat-label">BMI</span><span class="stat-value">{{ bmi ? bmi.value : '--' }}</span><span class="stat-detail">{{ bmi ? bmi.label + ' · 仅供参考' : '填写身高后计算' }}</span></div>
  </div>

  <button class="health-settings-button" @click="settingsStore.openModuleSettings('weight')">
    <span><strong>健康与趋势设置</strong><small>身高、目标体重、变化提醒阈值</small></span>
    <span class="health-settings-chevron">›</span>
  </button>

  <div v-if="changeNotice" class="change-notice">
    <div><strong>{{ changeNotice.title }}</strong><p>{{ changeNotice.body }}</p><small>{{ changeNoticeSent ? '已同步发送本地通知' : '页面提醒已生效；开启系统通知权限后也会发送通知' }}</small></div>
    <button aria-label="关闭提醒" @click="changeNotice = null">×</button>
  </div>

  <div class="chart-card">
    <div class="segment-control weight-range"><button v-for="range in [7, 30, 90, 0]" :key="range" :class="{ active: filterSegment === range }" @click="filterSegment = range">{{ range ? `近 ${range} 天` : '全部' }}</button></div>
    <div class="chart-header">
      <div><span class="chart-title">{{ chartMode === 'weekly' ? '周平均趋势' : '每日体重趋势' }}</span><span class="chart-range" v-if="chartPoints && chartPoints.firstDate !== chartPoints.lastDate">{{ formatDateShort(chartPoints.firstDate) }} — {{ formatDateShort(chartPoints.lastDate) }}</span></div>
      <div class="chart-mode-control"><button :class="{ active: chartMode === 'weekly' }" @click="chartMode = 'weekly'">周均</button><button :class="{ active: chartMode === 'daily' }" @click="chartMode = 'daily'">每日</button></div>
    </div>
    <div v-if="chartPoints" class="chart-svg-wrapper">
      <svg viewBox="0 0 300 160" class="weight-chart">
        <line x1="44" :y1="CHART_PADDING.top" x2="44" :y2="CHART_PADDING.top+plotH" stroke="#e0e0e0" stroke-width="1" />
        <line :x1="CHART_PADDING.left" :y1="CHART_PADDING.top+plotH" :x2="CHART_PADDING.left+plotW" :y2="CHART_PADDING.top+plotH" stroke="#e0e0e0" stroke-width="1" />
              <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--primary)" stop-opacity="0.15" /><stop offset="100%" stop-color="var(--primary)" stop-opacity="0.02" /></linearGradient></defs>
        <path :d="chartAreaPath" fill="url(#areaGrad)" />
              <path :d="chartLinePath" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              <template v-if="showChartMarkers"><circle v-for="p in chartPoints.points" :key="p.date" :cx="p.x" :cy="p.y" r="3.5" fill="var(--primary)" stroke="#fff" stroke-width="1.5" tabindex="0" role="button" :aria-label="`${p.date} 均重 ${p.weight} kg，${p.count} 次记录`" @click="selectedPoint = p" @keydown.enter="selectedPoint = p" /></template>
        <text :x="chartPoints.points[0].x" :y="CHART_PADDING.top+plotH+16" text-anchor="start" class="chart-label">{{ formatDateShort(chartPoints.firstDate) }}</text>
        <text :x="chartPoints.points[chartPoints.points.length-1].x" :y="CHART_PADDING.top+plotH+16" text-anchor="end" class="chart-label">{{ formatDateShort(chartPoints.lastDate) }}</text>
        <template v-for="p in chartPoints.points" :key="'lb-'+p.date">
          <text v-if="showChartMarkers && (p.isFirst || p.isLast)" :x="p.x" :y="p.y - 8" text-anchor="middle" class="chart-weight-label">{{ p.weight }}</text>
        </template>
      </svg>
    </div>
    <p v-if="!chartPoints" class="chart-note">这个时间范围内还没有记录。</p>
    <p v-if="selectedPoint" class="chart-note" role="status">{{ selectedPoint.date }}{{ chartMode === 'weekly' ? ' 起的一周' : '' }} · 均重 {{ selectedPoint.weight }} kg · {{ selectedPoint.count }} 次记录</p>
    <p v-if="chartMode === 'weekly'" class="chart-note">同一天多次称重会先求日均，再计算自然周平均，减少单次波动影响。</p>
  </div>

  <div class="history-heading"><strong>全部体重记录</strong><span class="caption body-muted">共 {{ sortedRecords.length }} 条 · 每页 {{ WEIGHT_PAGE_SIZE }} 条</span></div>
  <div v-if="sortedRecords.length === 0" class="empty-state">
    <p class="body-text body-muted">还没有体重记录</p>
    <p class="caption body-muted">点击上方按钮添加第一条记录</p>
  </div>

  <div v-else class="record-list">
    <section v-for="group in groupedRecords" :key="group.date" class="weight-day-group">
    <h3 class="caption body-muted">{{ formatDate(group.date) }}</h3>
    <div v-for="record in group.records" :key="record.id" class="record-item">
      <div class="record-main">
        <div class="record-left">
          <div class="record-weight">
            <span class="weight-num">{{ record.weight }}</span><span class="weight-unit">kg</span>
            <span v-if="getTrend(record) === 'up'" class="trend-icon trend-up-icon">↑</span>
            <span v-else-if="getTrend(record) === 'down'" class="trend-icon trend-down-icon">↓</span>
            <span v-else-if="getTrend(record) === 'flat'" class="trend-icon trend-flat-icon">—</span>
          </div>
          <div class="record-note" v-if="record.note">{{ record.note }}</div>
        </div>
        <div class="record-right">
          <span class="record-date">{{ record.time || '未记录时间' }}</span>
          <div class="record-actions"><button class="text-link" @click="editRecord(record)">编辑</button>
          <button class="delete-btn" aria-label="删除体重记录" @click="deleteRecord(record)"><svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg></button></div>
        </div>
      </div>
    </div>
    </section>
  </div>

  <div class="pagination-bar" v-if="sortedRecords.length">
    <button class="page-btn" :disabled="weightPage === 1" @click="weightPage--">‹ 上一页</button>
    <span class="page-info">{{ weightPage }} / {{ totalWeightPages }}</span>
    <button class="page-btn" :disabled="weightPage === totalWeightPages" @click="weightPage++">下一页 ›</button>
  </div>

  <Teleport to="body">
    <div class="modal-overlay" v-if="showAddModal" @click="showAddModal = false"></div>
    <div class="modal-panel" v-if="showAddModal">
      <h3 class="body-strong" style="margin: 0 0 20px 0;">{{ editingId ? '编辑体重' : '记录体重' }}</h3>
      <div class="input-group"><label class="caption">日期</label><AppDateField v-model="editDate" class="apple-input" aria-label="选择体重记录日期" /></div>
      <div class="input-group"><label class="caption">时间（可选）</label><div class="weight-stepper"><AppTimeField v-model="editTime" empty-label="未记录时间" class="apple-input" aria-label="测量时间" /><button class="text-link" @click="editTime = ''">清空</button></div></div>
      <div class="input-group"><label class="caption">体重 (kg)</label><div class="weight-stepper"><button class="button-secondary-pill" aria-label="减 0.1 kg" @click="stepWeight(-0.1)">−</button><input type="number" inputmode="decimal" step="0.1" v-model="editWeight" class="apple-input" placeholder="例如：65.5" aria-label="体重 kg" @keyup.enter="saveRecord" /><button class="button-secondary-pill" aria-label="加 0.1 kg" @click="stepWeight(0.1)">＋</button></div></div>
      <div class="input-group"><label class="caption">备注（可选）</label><CommonNoteField v-model="editNote" scope="weight" placeholder="例如：晨起空腹" /></div>
      <div style="display: flex; gap: 12px; margin-top: 24px;"><button class="button-primary" style="flex:1" @click="saveRecord">保存</button><button class="button-secondary-pill" style="flex:1" @click="showAddModal = false">取消</button></div>
    </div>
  </Teleport>


</div>
</template>

<style scoped>
.weight-hero { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; padding:20px; border:1px solid var(--hairline); border-radius:18px; background:var(--canvas); }.hero-value { font-size:40px; font-weight:700; margin-top:8px; }.hero-value small { font-size:16px; font-weight:400; }.weight-hero p { margin:6px 0; }.weight-range { margin-bottom:16px; }.weight-range button { flex:1; padding:10px 6px!important; }.weight-stepper { display:flex; align-items:center; gap:8px; }.weight-stepper .apple-input { min-width:0; flex:1; }.weight-stepper > .text-link { white-space:nowrap; flex-shrink:0; }.weight-stepper button { min-width:44px; min-height:44px; padding:6px; }.weight-day-group h3 { margin:4px 0 10px; }.weight-day-group + .weight-day-group { margin-top:18px; }.weight-chart circle { cursor:pointer; }.stats-grid .stat-card:last-child { grid-column:1/-1; flex-direction:row; align-items:center; gap:10px; padding:12px 16px; }.stats-grid .stat-card:last-child .stat-detail { margin-left:auto; text-align:right; }.modal-panel { max-height:85dvh; overflow:auto; }

.weight-container { display: flex; flex-direction: column; gap: 20px; }
.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.stat-card { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 6px; }
.stat-label { font-size: 14px; color: var(--body-muted); font-weight: 400; }
.stat-value { font-size: 24px; font-weight: 600; font-family: "SF Pro Display",-apple-system,sans-serif; letter-spacing: -0.374px; }
.stat-detail { color: var(--body-muted); font-size: 11px; line-height: 1.35; }
.trend-up { color: #ff9500; }
.trend-down { color: #34c759; }
.health-settings-button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 15px 17px; border: 1px solid var(--hairline); border-radius: 14px; background: var(--canvas); color: var(--ink); text-align: left; cursor: pointer; }
.health-settings-button span:first-child { display: flex; flex-direction: column; gap: 4px; }
.health-settings-button strong { font-size: 15px; }
.health-settings-button small { color: var(--body-muted); font-size: 12px; }
.health-settings-chevron { color: var(--body-muted); font-size: 28px; line-height: 1; }
.change-notice { display: flex; justify-content: space-between; gap: 14px; padding: 15px 16px; border: 1px solid rgba(0,102,204,.18); border-radius: 14px; background: rgba(0,102,204,.07); }
.change-notice strong { color: var(--primary); font-size: 14px; }
.change-notice p { margin: 5px 0; font-size: 14px; line-height: 1.5; }
.change-notice small { color: var(--body-muted); }
.change-notice button { align-self: flex-start; padding: 0; border: 0; background: transparent; color: var(--body-muted); font-size: 24px; cursor: pointer; }
.segment-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.segment-control { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 9999px; display: flex; overflow: hidden; }
.segment-control button { background: transparent; border: none; padding: 8px 16px; font-size: 14px; color: var(--body-muted); cursor: pointer; transition: all 0.2s; white-space: nowrap; }
.segment-control button.active { background: var(--primary); color: #fff; }
.add-btn { flex-shrink: 0; }
.chart-card { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 16px; padding: 16px; }
.chart-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
.chart-header > div:first-child { display: flex; flex-direction: column; gap: 3px; }
.chart-title { font-size: 15px; font-weight: 600; color: var(--ink); }
.chart-range { font-size: 12px; color: var(--body-muted); }
.chart-mode-control { display: inline-flex; padding: 2px; border-radius: 9px; background: var(--surface-pearl); }
.chart-mode-control button { padding: 5px 9px; border: 0; border-radius: 7px; background: transparent; color: var(--body-muted); font-size: 12px; cursor: pointer; }
.chart-mode-control button.active { background: var(--canvas); color: var(--primary); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.chart-svg-wrapper { width: 100%; }
.chart-note { margin: 8px 0 0; color: var(--body-muted); font-size: 11px; line-height: 1.5; }
.weight-chart { width: 100%; height: auto; display: block; }
.chart-label { font-size: 10px; fill: #86868b; font-family: "SF Pro Text",-apple-system,sans-serif; }
.chart-weight-label { font-size: 10px; fill: var(--primary); font-weight: 600; font-family: "SF Pro Text",-apple-system,sans-serif; }
.record-list { display: flex; flex-direction: column; gap: 8px; }
.record-item { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 14px; padding: 14px 16px; }
.record-main { display: flex; justify-content: space-between; align-items: flex-start; }
.record-left { display: flex; flex-direction: column; gap: 4px; }
.record-weight { display: flex; align-items: baseline; gap: 4px; }
.weight-num { font-size: 28px; font-weight: 600; font-family: "SF Pro Display",-apple-system,sans-serif; letter-spacing: -0.374px; }
.weight-unit { font-size: 14px; color: var(--body-muted); }
.record-note { font-size: 14px; color: var(--body-muted); }
.record-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.record-date { font-size: 13px; color: var(--body-muted); white-space: nowrap; }
.delete-btn { background: transparent; border: none; color: #ff3b30; cursor: pointer; padding: 4px; border-radius: 8px; display: flex; }
.delete-btn:active { background: rgba(255, 59, 48, 0.1); }
.trend-icon { font-size: 14px; font-weight: 600; margin-left: 4px; }
.trend-up-icon { color: #ff9500; }
.trend-down-icon { color: #34c759; }
.trend-flat-icon { color: var(--body-muted); }
.empty-state { text-align: center; padding: 60px 20px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 200; }
.modal-panel { position: fixed; bottom: 0; left: 0; right: 0; background: var(--canvas); border-radius: 18px 18px 0 0; padding: 24px 20px; z-index: 201; max-width: 500px; margin: 0 auto; }
.input-group { margin-bottom: 16px; }
.input-group label { display: block; margin-bottom: 6px; color: var(--body-muted); }
.health-input-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.health-modal-note { margin: 0 0 16px; line-height: 1.5; }
.weight-reminder-option { display: flex; align-items: flex-start; gap: 10px; margin: 2px 0 18px; }
.weight-reminder-option input { margin-top: 3px; }
.weight-reminder-option span { display: flex; flex-direction: column; gap: 3px; }
.weight-reminder-option strong { font-size: 15px; }
.weight-reminder-option small { color: var(--body-muted); font-size: 12px; line-height: 1.4; }
.pagination-bar { display: flex; justify-content: center; align-items: center; gap: 16px; margin-top: 20px; padding-bottom: 8px; }
.page-btn { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 12px; padding: 8px 16px; font-size: 14px; color: var(--primary); font-weight: 500; cursor: pointer; transition: all 0.2s; }
.page-btn:active { transform: scale(0.95); background: var(--surface-pearl); }
.page-btn:disabled { opacity: 0.4; color: var(--body-muted); pointer-events: none; }
.page-info { font-size: 14px; color: var(--body-muted); font-weight: 500; font-variant-numeric: tabular-nums; }
@media (max-width: 420px) {
  .health-input-grid { grid-template-columns: 1fr; gap: 0; }
  .chart-header { align-items: flex-start; }
}

/* Keep date groups and record controls compact without reducing touch targets. */
.weight-container { gap:12px; }
.weight-hero { padding:14px; gap:8px; }
.hero-value { font-size:34px; margin-top:4px; }
.stats-grid { gap:8px; }
.stat-card { padding:12px; gap:4px; }
.health-settings-button { padding:10px 14px; }
.history-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
.weight-day-group h3 { margin:0 0 4px; font-size:12px; }
.weight-day-group + .weight-day-group { margin-top:8px; }
.record-list { gap:0; }
.record-item { padding:8px 12px; border-radius:12px; margin-bottom:4px; }
.record-main { gap:8px; }
.record-left { min-width:0; }
.record-right { gap:0; flex-shrink:0; }
.record-actions { display:flex; align-items:center; gap:4px; }
.record-actions button { min-width:44px; min-height:44px; padding:4px; }
.weight-num { font-size:23px; }
.record-note { font-size:12px; line-height:1.4; margin-top:2px; overflow-wrap:anywhere; }
.record-date { font-size:11px; }
.pagination-bar { margin-top:4px; }
</style>
