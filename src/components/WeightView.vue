<script setup>
import { ref, computed, watch } from 'vue'
import { useWeightStore } from '../stores/weight'

const weightStore = useWeightStore()

const showAddModal = ref(false)
const editDate = ref('')
const editWeight = ref(null)
const editNote = ref('')
const filterSegment = ref('all')

const getTodayStr = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

const sortedRecords = computed(() => [...weightStore.weightRecords].sort((a, b) => b.date.localeCompare(a.date)))

const filteredRecords = computed(() => {
  const now = new Date()
  if (filterSegment.value === 'week') {
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7)
    const cutoff = weekAgo.toISOString().slice(0, 10)
    return sortedRecords.value.filter(r => r.date >= cutoff)
  }
  if (filterSegment.value === 'month') {
    const monthAgo = new Date(now); monthAgo.setMonth(monthAgo.getMonth() - 1)
    const cutoff = monthAgo.toISOString().slice(0, 10)
    return sortedRecords.value.filter(r => r.date >= cutoff)
  }
  return sortedRecords.value
})

const WEIGHT_PAGE_SIZE = 10
const weightPage = ref(1)
const totalWeightPages = computed(() => Math.ceil(filteredRecords.value.length / WEIGHT_PAGE_SIZE) || 1)
const paginatedWeightRecords = computed(() => {
  const start = (weightPage.value - 1) * WEIGHT_PAGE_SIZE
  return filteredRecords.value.slice(start, start + WEIGHT_PAGE_SIZE)
})
watch(totalWeightPages, (n) => { if (weightPage.value > n) weightPage.value = n > 0 ? n : 1 })

const chartRecords = computed(() => {
  const allSorted = [...weightStore.weightRecords].sort((a, b) => a.date.localeCompare(b.date))
  if (allSorted.length < 2) return allSorted
  const now = new Date()
  if (filterSegment.value === 'week') {
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7)
    const cutoff = weekAgo.toISOString().slice(0, 10)
    return allSorted.filter(r => r.date >= cutoff)
  }
  if (filterSegment.value === 'month') {
    const monthAgo = new Date(now); monthAgo.setMonth(monthAgo.getMonth() - 1)
    const cutoff = monthAgo.toISOString().slice(0, 10)
    return allSorted.filter(r => r.date >= cutoff)
  }
  return allSorted
})

const stats = computed(() => {
  const records = weightStore.weightRecords
  if (records.length === 0) return { latest: null, min: null, max: null, start: null, diff: null }
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date))
  const latest = sorted[sorted.length - 1]
  let min = sorted[0], max = sorted[0]
  sorted.forEach(r => { if (r.weight < min.weight) min = r; if (r.weight > max.weight) max = r })
  const diff = (latest.weight - sorted[0].weight).toFixed(1)
  return { latest, min, max, start: sorted[0], diff }
})

const CHART_PADDING = { top: 20, right: 16, bottom: 28, left: 44 }
const CHART_W = 300, CHART_H = 160
const plotW = CHART_W - CHART_PADDING.left - CHART_PADDING.right
const plotH = CHART_H - CHART_PADDING.top - CHART_PADDING.bottom

const chartPoints = computed(() => {
  const records = chartRecords.value
  if (records.length < 2) return null
  const weights = records.map(r => r.weight)
  const minW = Math.min(...weights), maxW = Math.max(...weights), range = maxW - minW || 1
  const yMin = minW - range * 0.15, yMax = maxW + range * 0.15, yRange = yMax - yMin || 1
  const points = records.map((r, i) => ({
    x: CHART_PADDING.left + (i / (records.length - 1)) * plotW,
    y: CHART_PADDING.top + ((yMax - r.weight) / yRange) * plotH,
    weight: r.weight, date: r.date, isFirst: i === 0, isLast: i === records.length - 1
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

const openAddModal = () => { editDate.value = getTodayStr(); editWeight.value = null; editNote.value = ''; showAddModal.value = true }

const saveRecord = () => {
  if (!editDate.value) return alert('请选择日期')
  if (editWeight.value === null || editWeight.value === '' || isNaN(editWeight.value)) return alert('请填写有效体重')
  if (editWeight.value < 20 || editWeight.value > 300) return alert('体重数值似乎不合理（20-300 kg）')
  weightStore.addRecord({ id: Date.now().toString(), date: editDate.value, weight: Number(editWeight.value), note: editNote.value || '' })
  showAddModal.value = false
}

const deleteRecord = (record) => { if (!confirm(`确认删除 ${record.date} 的体重记录（${record.weight} kg）？`)) return; weightStore.deleteRecord(record.id) }

const formatDate = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00')
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.getMonth() + 1}月${d.getDate()}日 周${weekdays[d.getDay()]}`
}

const getTrend = (record, index) => {
  if (index >= filteredRecords.value.length - 1) return ''
  const next = filteredRecords.value[index + 1]
  if (!next) return ''
  const diff = record.weight - next.weight
  return diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'
}
</script>

<template>
<div class="fade-in weight-container">
  <div class="stats-grid">
    <div class="stat-card"><span class="stat-label">当前体重</span><span class="stat-value">{{ stats.latest ? stats.latest.weight + ' kg' : '--' }}</span></div>
    <div class="stat-card"><span class="stat-label">最轻</span><span class="stat-value">{{ stats.min ? stats.min.weight + ' kg' : '--' }}</span></div>
    <div class="stat-card"><span class="stat-label">最重</span><span class="stat-value">{{ stats.max ? stats.max.weight + ' kg' : '--' }}</span></div>
    <div class="stat-card"><span class="stat-label">总体变化</span><span class="stat-value" :class="stats.diff !== null ? (stats.diff > 0 ? 'trend-up' : stats.diff < 0 ? 'trend-down' : '') : ''">{{ stats.diff !== null ? (stats.diff > 0 ? '+' : '') + stats.diff + ' kg' : '--' }}</span></div>
  </div>

  <div class="chart-card" v-if="chartPoints && chartPoints.points.length >= 2">
    <div class="chart-header"><span class="chart-title">体重变化趋势</span><span class="chart-range" v-if="chartPoints.firstDate !== chartPoints.lastDate">{{ formatDateShort(chartPoints.firstDate) }} — {{ formatDateShort(chartPoints.lastDate) }}</span></div>
    <div class="chart-svg-wrapper">
      <svg viewBox="0 0 300 160" class="weight-chart">
        <line x1="44" :y1="CHART_PADDING.top" x2="44" :y2="CHART_PADDING.top+plotH" stroke="#e0e0e0" stroke-width="1" />
        <line :x1="CHART_PADDING.left" :y1="CHART_PADDING.top+plotH" :x2="CHART_PADDING.left+plotW" :y2="CHART_PADDING.top+plotH" stroke="#e0e0e0" stroke-width="1" />
        <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0066cc" stop-opacity="0.15" /><stop offset="100%" stop-color="#0066cc" stop-opacity="0.02" /></linearGradient></defs>
        <path :d="chartAreaPath" fill="url(#areaGrad)" />
        <path :d="chartLinePath" fill="none" stroke="#0066cc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <circle v-for="p in chartPoints.points" :key="p.date" :cx="p.x" :cy="p.y" r="3.5" fill="#0066cc" stroke="#fff" stroke-width="1.5" />
        <text :x="chartPoints.points[0].x" :y="CHART_PADDING.top+plotH+16" text-anchor="start" class="chart-label">{{ formatDateShort(chartPoints.firstDate) }}</text>
        <text :x="chartPoints.points[chartPoints.points.length-1].x" :y="CHART_PADDING.top+plotH+16" text-anchor="end" class="chart-label">{{ formatDateShort(chartPoints.lastDate) }}</text>
        <template v-for="p in chartPoints.points" :key="'lb-'+p.date">
          <text v-if="p.isFirst || p.isLast || p.weight === chartPoints.yMax || p.weight === chartPoints.yMin" :x="p.x" :y="p.y - 8" text-anchor="middle" class="chart-weight-label">{{ p.weight }}</text>
        </template>
      </svg>
    </div>
  </div>

  <div class="segment-row">
    <div class="segment-control"><button :class="{ active: filterSegment === 'all' }" @click="filterSegment = 'all'">全部</button><button :class="{ active: filterSegment === 'month' }" @click="filterSegment = 'month'">近一月</button><button :class="{ active: filterSegment === 'week' }" @click="filterSegment = 'week'">近一周</button></div>
    <button class="button-primary add-btn" @click="openAddModal">+ 记录</button>
  </div>

  <div v-if="filteredRecords.length === 0" class="empty-state">
    <p class="body-text body-muted">还没有体重记录</p>
    <p class="caption body-muted">点击上方按钮添加第一条记录</p>
  </div>

  <div v-else class="record-list">
    <div v-for="(record, index) in paginatedWeightRecords" :key="record.id" class="record-item">
      <div class="record-main">
        <div class="record-left">
          <div class="record-weight">
            <span class="weight-num">{{ record.weight }}</span><span class="weight-unit">kg</span>
            <span v-if="getTrend(record, index) === 'up'" class="trend-icon trend-up-icon">↑</span>
            <span v-else-if="getTrend(record, index) === 'down'" class="trend-icon trend-down-icon">↓</span>
            <span v-else-if="getTrend(record, index) === 'flat'" class="trend-icon trend-flat-icon">—</span>
          </div>
          <div class="record-note" v-if="record.note">{{ record.note }}</div>
        </div>
        <div class="record-right">
          <span class="record-date">{{ formatDate(record.date) }}</span>
          <button class="delete-btn" @click="deleteRecord(record)"><svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg></button>
        </div>
      </div>
    </div>
  </div>

  <div class="pagination-bar" v-if="totalWeightPages > 1">
    <button class="page-btn" :disabled="weightPage === 1" @click="weightPage--">‹ 上一页</button>
    <span class="page-info">{{ weightPage }} / {{ totalWeightPages }}</span>
    <button class="page-btn" :disabled="weightPage === totalWeightPages" @click="weightPage++">下一页 ›</button>
  </div>

  <Teleport to="body">
    <div class="modal-overlay" v-if="showAddModal" @click="showAddModal = false"></div>
    <div class="modal-panel" v-if="showAddModal">
      <h3 class="body-strong" style="margin: 0 0 20px 0;">记录体重</h3>
      <div class="input-group"><label class="caption">日期</label><input type="date" v-model="editDate" class="apple-input" /></div>
      <div class="input-group"><label class="caption">体重 (kg)</label><input type="number" step="0.1" v-model="editWeight" class="apple-input" placeholder="例如：65.5" @keyup.enter="saveRecord" /></div>
      <div class="input-group"><label class="caption">备注（可选）</label><input v-model="editNote" class="apple-input" placeholder="例如：晨起空腹" /></div>
      <div style="display: flex; gap: 12px; margin-top: 24px;"><button class="button-primary" style="flex:1" @click="saveRecord">保存</button><button class="button-secondary-pill" style="flex:1" @click="showAddModal = false">取消</button></div>
    </div>
  </Teleport>
</div>
</template>

<style scoped>
.weight-container { display: flex; flex-direction: column; gap: 20px; }
.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.stat-card { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 6px; }
.stat-label { font-size: 14px; color: var(--body-muted); font-weight: 400; }
.stat-value { font-size: 24px; font-weight: 600; font-family: "SF Pro Display",-apple-system,sans-serif; letter-spacing: -0.374px; }
.trend-up { color: #ff9500; }
.trend-down { color: #34c759; }
.segment-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.segment-control { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 9999px; display: flex; overflow: hidden; }
.segment-control button { background: transparent; border: none; padding: 8px 16px; font-size: 14px; color: var(--body-muted); cursor: pointer; transition: all 0.2s; white-space: nowrap; }
.segment-control button.active { background: var(--primary); color: #fff; }
.add-btn { flex-shrink: 0; }
.chart-card { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 16px; padding: 16px; }
.chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.chart-title { font-size: 15px; font-weight: 600; color: var(--ink); }
.chart-range { font-size: 12px; color: var(--body-muted); }
.chart-svg-wrapper { width: 100%; }
.weight-chart { width: 100%; height: auto; display: block; }
.chart-label { font-size: 10px; fill: #86868b; font-family: "SF Pro Text",-apple-system,sans-serif; }
.chart-weight-label { font-size: 10px; fill: #0066cc; font-weight: 600; font-family: "SF Pro Text",-apple-system,sans-serif; }
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
.pagination-bar { display: flex; justify-content: center; align-items: center; gap: 16px; margin-top: 20px; padding-bottom: 8px; }
.page-btn { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 12px; padding: 8px 16px; font-size: 14px; color: var(--primary); font-weight: 500; cursor: pointer; transition: all 0.2s; }
.page-btn:active { transform: scale(0.95); background: var(--surface-pearl); }
.page-btn:disabled { opacity: 0.4; color: var(--body-muted); pointer-events: none; }
.page-info { font-size: 14px; color: var(--body-muted); font-weight: 500; font-variant-numeric: tabular-nums; }
</style>
