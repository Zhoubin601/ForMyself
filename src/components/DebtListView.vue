<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useDebtStore } from '../stores/debt'
import { useSettingsStore } from '../stores/settings'
import { askAI } from '../services/aiEngine'

const debtStore = useDebtStore()
const settingsStore = useSettingsStore()

const getTodayStr = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

const activeTab = ref('active')
const searchQuery = ref('')

const activeDebts = computed(() => debtStore.savedDebts.filter(d => !d.isCleared))
const historyDebts = computed(() => debtStore.savedDebts.filter(d => d.isCleared))

const filteredDebts = computed(() => {
  const source = activeTab.value === 'active' ? activeDebts.value : historyDebts.value
  if (!searchQuery.value) return source
  const kw = searchQuery.value.toLowerCase()
  return source.filter(d => d.name.toLowerCase().includes(kw))
})

const DEBT_PAGE_SIZE = 10
const debtPage = ref(1)
const totalDebtPages = computed(() => Math.ceil(filteredDebts.value.length / DEBT_PAGE_SIZE) || 1)
const paginatedDebts = computed(() => {
  const start = (debtPage.value - 1) * DEBT_PAGE_SIZE
  return filteredDebts.value.slice(start, start + DEBT_PAGE_SIZE)
})
watch(totalDebtPages, (n) => { if (debtPage.value > n) debtPage.value = n > 0 ? n : 1 })

const totalSaved = computed(() => {
  return debtStore.savedDebts.reduce((sum, item) => {
    return sum + (item.records ? item.records.reduce((s, r) => s + r.amount, 0) : 0)
  }, 0)
})

const isAdding = ref(false)
const addForm = ref({ name: '', totalAmount: '', startDate: getTodayStr() })

const startAdd = () => { isAdding.value = true }
const submitAdd = () => {
  if (!addForm.value.name || !addForm.value.totalAmount) return alert('名称和目标金额不能为空哦')
  const amount = parseFloat(addForm.value.totalAmount)
  debtStore.addDebt({ id: Date.now().toString(), name: addForm.value.name, totalAmount: amount, remainingAmount: amount, startDate: addForm.value.startDate, records: [], isCleared: false })
  isAdding.value = false
  addForm.value = { name: '', totalAmount: '', startDate: getTodayStr() }
}

const deleteDebt = (id) => { if (confirm('确定要删除这个省钱计划吗？')) debtStore.deleteDebt(id) }

const currentDebtId = ref(null)
const isEditing = ref(false)
const editForm = ref({ name: '', totalAmount: '', startDate: '' })

const startEdit = (debt) => { currentDebtId.value = debt.id; isEditing.value = true; editForm.value = { name: debt.name, totalAmount: debt.totalAmount, startDate: debt.startDate } }

const saveEdit = () => {
  if (!editForm.value.name) return alert('名称不能为空')
  const newData = [...debtStore.savedDebts]
  const idx = newData.findIndex(d => d.id === currentDebtId.value)
  if (idx !== -1) {
    const debt = newData[idx]
    const savedTotal = debt.records.reduce((sum, r) => sum + r.amount, 0)
    debt.name = editForm.value.name
    debt.totalAmount = parseFloat(editForm.value.totalAmount)
    debt.startDate = editForm.value.startDate
    debt.remainingAmount = Math.max(0, debt.totalAmount - savedTotal)
    debt.isCleared = debt.remainingAmount <= 0
    debtStore.updateDebts(newData)
  }
  isEditing.value = false
}

const isRepaying = ref(false)
const repayForm = ref({ date: '', amount: '', note: '' })

const startRepay = (debt) => { currentDebtId.value = debt.id; isRepaying.value = true; repayForm.value = { date: getTodayStr(), amount: '', note: '' } }

const submitRepay = () => {
  if (!repayForm.value.amount) return alert('请输入存入金额')
  const repayAmount = parseFloat(repayForm.value.amount)
  const newData = [...debtStore.savedDebts]
  const idx = newData.findIndex(d => d.id === currentDebtId.value)
  if (idx !== -1) {
    const debt = newData[idx]
    const oldSaved = debt.records.reduce((sum, r) => sum + r.amount, 0)
    const oldProgress = debt.totalAmount > 0 ? (oldSaved / debt.totalAmount) * 100 : 0
    debt.records.push({ id: Date.now().toString(), date: repayForm.value.date, amount: repayAmount, note: repayForm.value.note })
    debt.remainingAmount -= repayAmount
    if (debt.remainingAmount <= 0) { debt.remainingAmount = 0; debt.isCleared = true; alert('太棒了！该目标已顺利达成！🎉') }
    debtStore.updateDebts(newData)
    fetchAIEncouragement(true)
    const newSaved = oldSaved + repayAmount
    const newProgress = debt.totalAmount > 0 ? (newSaved / debt.totalAmount) * 100 : 0
    const milestones = [25, 50, 75, 100]
    const crossedMilestone = [...milestones].reverse().find(m => oldProgress < m && newProgress >= m)
    if (crossedMilestone && settingsStore.aiApiKey && crossedMilestone !== 100) triggerCheerleader(debt.name, crossedMilestone)
  }
  isRepaying.value = false
}

const isViewing = ref(false)
const viewRecords = ref([])
const viewDetails = (debt) => { viewRecords.value = debt.records; isViewing.value = true }

const cheerModal = ref(null)
const cheerText = ref('')
const isCheerLoading = ref(false)
const triggerCheerleader = async (debtName, percent) => {
  cheerModal.value = { name: debtName, percent }
  cheerText.value = '🎉 拉拉队正在赶来的路上...'
  isCheerLoading.value = true
  try { cheerText.value = await askAI(`用户正在为目标"[${debtName}]"攒钱，刚刚存入一笔钱后，进度正式突破了 [${percent}]%。请生成一句 20 字以内的幽默激昂的贺词，激励他继续坚持。`) }
  catch (e) { cheerText.value = `太棒了！[${debtName}] 进度突破 ${percent}%！继续冲！` }
  finally { isCheerLoading.value = false }
}

const aiEncouragement = ref('')
const isAiLoading = ref(false)
const restoreEncouragement = () => {
  const stored = settingsStore.lastEncouragement
  if (!stored) return settingsStore.bannerSettings.subtitle
  const pipeIdx = stored.indexOf('|')
  return pipeIdx > -1 ? stored.substring(pipeIdx + 1) : stored
}
aiEncouragement.value = restoreEncouragement()

const fetchAIEncouragement = async (force = false) => {
  const currentTotal = totalSaved.value
  if (!force && settingsStore.lastEncouragement) {
    const pipeIdx = settingsStore.lastEncouragement.indexOf('|')
    if (pipeIdx > -1) {
      const lastAmount = parseFloat(settingsStore.lastEncouragement.substring(0, pipeIdx))
      if (lastAmount === currentTotal) return
    }
  }
  if (!settingsStore.aiApiKey) { aiEncouragement.value = settingsStore.bannerSettings.subtitle; return }
  isAiLoading.value = true
  try {
    const reply = await askAI(`用户累计省钱 ${currentTotal} 元。写一句 15 字内的鼓励语：`)
    if (reply && reply.trim()) { aiEncouragement.value = reply.trim(); settingsStore.lastEncouragement = `${currentTotal}|${reply.trim()}` }
    else { aiEncouragement.value = settingsStore.bannerSettings.subtitle }
  } catch (e) { console.error('[DebtListView] AI error:', e.message); aiEncouragement.value = settingsStore.bannerSettings.subtitle }
  finally { isAiLoading.value = false }
}

onMounted(() => { fetchAIEncouragement() })
</script>

<template>
  <div class="fade-in">
    <div class="saving-hero-banner">
      <h1 class="hero-display" :style="{ fontSize: settingsStore.bannerSettings.titleSize + 'px' }">
        {{ settingsStore.bannerSettings.prefix }}<span style="margin: 0 4px">{{ totalSaved }}</span>{{ settingsStore.bannerSettings.suffix }}
      </h1>
      <p class="body-text" :class="{ 'body-muted': !isAiLoading }">
        {{ isAiLoading ? '✨ AI 正在为你写鼓励语...' : (aiEncouragement || settingsStore.bannerSettings.subtitle) }}
      </p>
    </div>

    <div class="top-controls">
      <input v-model="searchQuery" placeholder="搜索省钱项目" class="apple-input search-input" />
      <button class="button-primary add-btn" @click="startAdd">新建计划</button>
    </div>

    <div class="segmented-control">
      <div class="segment" :class="{ active: activeTab === 'active' }" @click="activeTab = 'active'">进行中</div>
      <div class="segment" :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'">已达成</div>
    </div>

    <div v-if="activeTab === 'history'" class="store-utility-card global-overview-card">
      <div class="overview-header">
        <span class="caption body-muted">累计省钱总额 (含进行中已省金额)</span>
        <h2 class="display-md">¥{{ totalSaved }}</h2>
      </div>
    </div>

    <div class="record-list">
      <div v-if="filteredDebts.length === 0" class="empty-state">
        <p class="body-text body-muted">{{ activeTab === 'active' ? '暂无进行中的省钱计划' : '暂无已达成的计划，加油积少成多' }}</p>
      </div>
      <div class="store-utility-card" v-for="debt in paginatedDebts" :key="debt.id">
        <div class="card-header">
          <h3 class="body-strong">{{ debt.name }}</h3>
          <span class="caption body-muted">自 {{ debt.startDate }} 起</span>
        </div>
        <div class="card-amounts">
          <div class="amount-block"><span class="caption body-muted">目标金额</span><span class="body-text">¥{{ debt.totalAmount }}</span></div>
          <div class="amount-block" style="text-align: right;"><span class="caption body-muted">{{ debt.isCleared ? '状态' : '还差' }}</span><span class="body-strong" :style="{ color: debt.isCleared ? 'var(--body-muted)' : 'var(--ink)' }">{{ debt.isCleared ? '目标达成' : `¥${debt.remainingAmount}` }}</span></div>
        </div>
        <div class="card-actions">
          <button v-if="!debt.isCleared" class="button-primary small-pill" @click="startRepay(debt)">存入</button>
          <button class="button-secondary-pill small-pill" @click="viewDetails(debt)">明细</button>
          <button v-if="!debt.isCleared" class="button-secondary-pill small-pill" @click="startEdit(debt)">编辑</button>
          <button class="text-link destructive" @click="deleteDebt(debt.id)">删除</button>
        </div>
      </div>
    </div>

    <div class="pagination-bar" v-if="totalDebtPages > 1">
      <button class="page-btn" :disabled="debtPage === 1" @click="debtPage--">‹ 上一页</button>
      <span class="page-info">{{ debtPage }} / {{ totalDebtPages }}</span>
      <button class="page-btn" :disabled="debtPage === totalDebtPages" @click="debtPage++">下一页 ›</button>
    </div>

    <Teleport to="body">
      <div v-if="isAdding || isEditing || isRepaying || isViewing" class="apple-modal-overlay fade-in">
        <div class="apple-modal-card">
          <h3 class="display-lg modal-title">{{ isAdding ? '新建省钱计划' : isEditing ? '调整计划' : isRepaying ? '存入省钱金' : '省钱存入明细' }}</h3>
          <div v-if="isAdding" class="form-stack">
            <div class="input-group"><label class="caption">计划名称</label><input v-model="addForm.name" placeholder="例如：换新电脑" class="apple-input" /></div>
            <div class="input-group"><label class="caption">目标金额 (¥)</label><input type="number" v-model="addForm.totalAmount" class="apple-input" /></div>
            <div class="input-group"><label class="caption">开始日期</label><input type="date" v-model="addForm.startDate" class="apple-input" /></div>
            <div class="modal-buttons"><button class="button-primary full-width" @click="submitAdd">确立计划</button><button class="text-link full-width" @click="isAdding = false">取消</button></div>
          </div>
          <div v-if="isEditing" class="form-stack">
            <div class="input-group"><label class="caption">计划名称</label><input v-model="editForm.name" class="apple-input" /></div>
            <div class="input-group"><label class="caption">目标金额 (¥)</label><input type="number" v-model="editForm.totalAmount" class="apple-input" /></div>
            <div class="input-group"><label class="caption">开始日期</label><input type="date" v-model="editForm.startDate" class="apple-input" /></div>
            <div class="modal-buttons"><button class="button-primary full-width" @click="saveEdit">保存修改</button><button class="text-link full-width" @click="isEditing = false">取消</button></div>
          </div>
          <div v-if="isRepaying" class="form-stack">
            <div class="input-group"><label class="caption">存入日期</label><input type="date" v-model="repayForm.date" class="apple-input" /></div>
            <div class="input-group"><label class="caption">存入金额 (¥)</label><input type="number" v-model="repayForm.amount" class="apple-input" /></div>
            <div class="input-group"><label class="caption">备注</label><input v-model="repayForm.note" placeholder="少喝了一杯咖啡" class="apple-input" /></div>
            <div class="modal-buttons"><button class="button-primary full-width" @click="submitRepay">确认存入</button><button class="text-link full-width" @click="isRepaying = false">取消</button></div>
          </div>
          <div v-if="isViewing" class="form-stack">
            <div class="view-list">
              <div v-if="viewRecords.length === 0" class="body-text body-muted" style="text-align: center; padding: 24px 0;">该计划还没有存入记录</div>
              <div v-for="r in viewRecords" :key="r.id" class="view-item">
                <div><div class="body-text">{{ r.date }}</div><div class="caption body-muted">{{ r.note || '无备注' }}</div></div>
                <div class="body-strong" style="color: var(--primary);">+ ¥{{ r.amount }}</div>
              </div>
            </div>
            <button class="button-primary full-width" style="margin-top: 24px;" @click="isViewing = false">完成</button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="cheerModal" class="apple-modal-overlay fade-in" @click="cheerModal = null">
        <div class="apple-modal-card" style="text-align: center;" @click.stop>
          <div style="font-size: 48px; margin-bottom: 12px;">🎉</div>
          <h3 class="display-lg modal-title">里程碑达成！</h3>
          <p class="body-text" style="margin: 12px 0;"><strong>{{ cheerModal.name }}</strong> 进度突破 <strong>{{ cheerModal.percent }}%</strong></p>
          <p class="body-strong" style="color: var(--primary); margin: 16px 0;">{{ isCheerLoading ? '🎉 拉拉队正在赶来的路上...' : cheerText }}</p>
          <button class="button-primary full-width" @click="cheerModal = null">继续加油！</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.saving-hero-banner { text-align: center; padding: 40px 0 32px 0; }
.hero-display { font-family: "SF Pro Display", -apple-system, sans-serif; font-weight: 600; line-height: 1.2; letter-spacing: -0.5px; margin: 0 0 8px 0; color: var(--ink); display: flex; align-items: center; justify-content: center; flex-wrap: wrap; }
.top-controls { display: flex; gap: 12px; margin-bottom: 24px; align-items: center; }
.search-input { border-radius: 9999px; }
.add-btn { flex-shrink: 0; }
.segmented-control { background: rgba(118, 118, 128, 0.12); padding: 2px; border-radius: 9px; display: flex; margin-bottom: 24px; }
.segment { flex: 1; text-align: center; padding: 6px 0; font-size: 14px; font-weight: 500; border-radius: 7px; cursor: pointer; transition: 0.2s; color: var(--body-muted); }
.segment.active { background: var(--canvas); color: var(--ink); box-shadow: 0 3px 8px rgba(0,0,0,0.12); }
.empty-state { text-align: center; padding: 64px 0; }
.global-overview-card { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 18px; padding: 24px; margin-bottom: 24px; text-align: center; }
.overview-header { display: flex; flex-direction: column; gap: 6px; }
.overview-header h2 { margin: 0; font-size: 32px; color: var(--primary); }
.store-utility-card { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 18px; padding: 24px; margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; border-bottom: 1px solid var(--divider-soft); padding-bottom: 12px; }
.card-header h3 { margin: 0; }
.card-amounts { display: flex; justify-content: space-between; margin-bottom: 24px; }
.amount-block { display: flex; flex-direction: column; gap: 4px; }
.card-actions { display: flex; gap: 8px; align-items: center; }
.small-pill { padding: 6px 16px; font-size: 14px; }
.destructive { color: #ff3b30; margin-left: auto; font-size: 14px; }
.apple-modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(5px); z-index: 9999; display: flex; align-items: center; justify-content: center; }
.apple-modal-card { background: var(--canvas); border-radius: 18px; padding: 32px 24px; width: 90%; max-width: 400px; box-shadow: 0 20px 40px rgba(0,0,0,0.15); max-height: 85vh; overflow-y: auto; }
.modal-title { font-size: 26px; text-align: center; margin-bottom: 24px; letter-spacing: -0.28px; }
.form-stack { display: flex; flex-direction: column; gap: 16px; }
.input-group label { display: block; margin-bottom: 6px; color: var(--body-muted); }
.input-group { margin-bottom: 12px; }
.modal-buttons { margin-top: 16px; display: flex; flex-direction: column; gap: 16px; }
.full-width { width: 100%; }
.view-list { display: flex; flex-direction: column; }
.view-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-soft); }
.view-item:last-child { border-bottom: none; }
.pagination-bar { display: flex; justify-content: center; align-items: center; gap: 16px; margin-top: 20px; padding-bottom: 8px; }
.page-btn { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 12px; padding: 8px 16px; font-size: 14px; color: var(--primary); font-weight: 500; cursor: pointer; transition: all 0.2s; }
.page-btn:active { transform: scale(0.95); background: var(--surface-pearl); }
.page-btn:disabled { opacity: 0.4; color: var(--body-muted); pointer-events: none; }
.page-info { font-size: 14px; color: var(--body-muted); font-weight: 500; font-variant-numeric: tabular-nums; }
</style>
