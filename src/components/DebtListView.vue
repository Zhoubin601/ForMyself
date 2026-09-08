<script setup>
import { ref, computed, watch, onBeforeUnmount, onMounted, onActivated, onDeactivated } from 'vue'
import { useDebtStore } from '../stores/debt'
import { useSettingsStore } from '../stores/settings'
import { askAI } from '../services/aiEngine'
import { appAlert, appConfirm, appToast } from '../services/uiFeedback'
import { registerBackHandler } from '../services/backNavigation'
import { useAuthStore } from '../stores/auth'
import { useDebtDrag } from '../composables/useDebtDrag'
import { getSavingsProgress } from '../services/debtOrdering'
import AppDateField from './AppDateField.vue'

const debtStore = useDebtStore()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()

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

const totalSaved = computed(() => {
  // Stable summation prevents floating-point order differences from refreshing AI.
  return [...debtStore.savedDebts].sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .reduce((sum, item) => sum + getSavingsProgress(item).saved, 0)
})

const listRef = ref(null)
const moreId = ref(null)
const savingOrder = ref(false)
const undoOrder = ref(null)
const orderMessage = ref('')
let undoTimer
let pageActive = true
const currentDebts = computed(() => activeTab.value === 'active' ? activeDebts.value : historyDebts.value)
const sortDisabled = computed(() => Boolean(searchQuery.value) || currentDebts.value.length < 2 || !debtStore.isDataLoaded || savingOrder.value)
const { start: startDrag, cancel: cancelDrag, dragging, draggedId, previewIds, ghost } = useDebtDrag({
  items: currentDebts, disabled: sortDisabled, listRef, onDrop: saveOrder
})
const busy = computed(() => dragging.value || savingOrder.value)
const displayDebts = computed(() => {
  const byId = new Map(filteredDebts.value.map(debt => [debt.id, debt]))
  const records = previewIds.value ? previewIds.value.map(id => byId.get(id)).filter(Boolean) : filteredDebts.value
  return records.map(debt => ({ ...debt, ...getSavingsProgress(debt) }))
})
const draggedDebt = computed(() => displayDebts.value.find(debt => debt.id === draggedId.value))
const money = value => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value) || 0)
const members = computed(() => JSON.stringify(debtStore.savedDebts.map(debt => [debt.id, Boolean(debt.isCleared)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))))
function clearUndo() { clearTimeout(undoTimer); undoOrder.value = null; orderMessage.value = '' }
function showOrderMessage(message) {
  orderMessage.value = message
  clearTimeout(undoTimer)
  undoTimer = setTimeout(clearUndo, 5000)
}
async function saveOrder(ids, undo = false) {
  if (savingOrder.value || sortDisabled.value) return
  const before = currentDebts.value.map(debt => debt.id)
  if (JSON.stringify(before) === JSON.stringify(ids)) return
  const category = activeTab.value
  const memberSnapshot = members.value
  savingOrder.value = true
  moreId.value = null
  clearUndo()
  try {
    await debtStore.reorderDebts({ orderedIds: ids, isCleared: category === 'history' })
    if (pageActive && !authStore.isLocked && memberSnapshot === members.value && category === activeTab.value) {
      undoOrder.value = undo ? null : before
      showOrderMessage(undo ? '已撤销排序' : '顺序已更新')
    }
  } catch {
    if (pageActive) appToast(undo ? '撤销失败，顺序未改变' : '顺序未保存，请重新拖动', { tone: 'danger' })
  } finally { savingOrder.value = false }
}
function moveDebt(id, offset) {
  const ids = currentDebts.value.map(debt => debt.id)
  const index = ids.indexOf(id)
  const target = index + offset
  if (index < 0 || target < 0 || target >= ids.length) return
  ids.splice(target, 0, ids.splice(index, 1)[0])
  saveOrder(ids)
}
function pausePage() { pageActive = false; cancelDrag(); clearUndo(); moreId.value = null }
watch([activeTab, members], () => { cancelDrag(); clearUndo(); moreId.value = null })
watch(() => authStore.isLocked, locked => { if (locked) pausePage(); else pageActive = true })
watch(dragging, value => { if (value) moreId.value = null })
onActivated(() => { pageActive = true })
onDeactivated(pausePage)
onBeforeUnmount(pausePage)

const isAdding = ref(false)
const addForm = ref({ name: '', totalAmount: '', startDate: getTodayStr() })

const startAdd = () => { isAdding.value = true }
const submitAdd = () => {
  if (!addForm.value.name || !addForm.value.totalAmount) return appAlert('名称和目标金额不能为空哦')
  const amount = parseFloat(addForm.value.totalAmount)
  debtStore.addDebt({ id: Date.now().toString(), name: addForm.value.name, totalAmount: amount, remainingAmount: amount, startDate: addForm.value.startDate, records: [], isCleared: false })
  isAdding.value = false
  addForm.value = { name: '', totalAmount: '', startDate: getTodayStr() }
}

const deleteDebt = async (id) => {
  if (await appConfirm('删除后，这个计划及其存入记录将无法恢复。', {
    title: '删除省钱计划？',
    destructive: true
  })) debtStore.deleteDebt(id)
}

const currentDebtId = ref(null)
const isEditing = ref(false)
const editForm = ref({ name: '', totalAmount: '', startDate: '' })

const startEdit = (debt) => { currentDebtId.value = debt.id; isEditing.value = true; editForm.value = { name: debt.name, totalAmount: debt.totalAmount, startDate: debt.startDate } }

const saveEdit = () => {
  if (!editForm.value.name) return appAlert('名称不能为空')
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
  if (!repayForm.value.amount) return appAlert('请输入存入金额')
  const repayAmount = parseFloat(repayForm.value.amount)
  const newData = [...debtStore.savedDebts]
  const idx = newData.findIndex(d => d.id === currentDebtId.value)
  if (idx !== -1) {
    const debt = newData[idx]
    const oldSaved = debt.records.reduce((sum, r) => sum + r.amount, 0)
    const oldProgress = debt.totalAmount > 0 ? (oldSaved / debt.totalAmount) * 100 : 0
    debt.records.push({ id: Date.now().toString(), date: repayForm.value.date, amount: repayAmount, note: repayForm.value.note })
    debt.remainingAmount -= repayAmount
    if (debt.remainingAmount <= 0) {
      debt.remainingAmount = 0
      debt.isCleared = true
      appAlert('太棒了！该目标已顺利达成！🎉', { title: '目标达成', tone: 'success' })
    }
    debtStore.updateDebts(newData)
    const newSaved = oldSaved + repayAmount
    const newProgress = debt.totalAmount > 0 ? (newSaved / debt.totalAmount) * 100 : 0
    const milestones = [25, 50, 75, 100]
    const crossedMilestone = [...milestones].reverse().find(m => oldProgress < m && newProgress >= m)
    if (crossedMilestone && settingsStore.aiApiKey && crossedMilestone !== 100) triggerCheerleader(debt.name, crossedMilestone)
  }
  isRepaying.value = false
}

const isViewing = ref(false)
const unregisterBackHandler = registerBackHandler(() => {
  if (moreId.value) { moreId.value = null; return true }
  if (cheerModal.value) { cheerModal.value = null; return true }
  if (isViewing.value) { isViewing.value = false; return true }
  if (isRepaying.value) { isRepaying.value = false; return true }
  if (isEditing.value) { isEditing.value = false; return true }
  if (isAdding.value) { isAdding.value = false; return true }
  return false
}, { priority: 500, isActive: () => Boolean(moreId.value || cheerModal.value) || isViewing.value || isRepaying.value || isEditing.value || isAdding.value })
onBeforeUnmount(unregisterBackHandler)
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
  catch { cheerText.value = `太棒了！[${debtName}] 进度突破 ${percent}%！继续冲！` }
  finally { isCheerLoading.value = false }
}

const DEFAULT_ENCOURAGEMENT = '小小改变，大大未来 ✨'
const aiEncouragement = ref(DEFAULT_ENCOURAGEMENT)
const isAiLoading = ref(false)
let encouragementRequest = 0
const cachedEncouragement = () => {
  const stored = settingsStore.lastEncouragement || ''
  const separator = stored.indexOf('|')
  return separator > 0 ? stored.slice(separator + 1).trim() : ''
}
aiEncouragement.value = cachedEncouragement() || DEFAULT_ENCOURAGEMENT
const fetchAIEncouragement = async () => {
  if (!debtStore.isDataLoaded) return
  const request = ++encouragementRequest
  const currentTotal = totalSaved.value
  if (!settingsStore.aiApiKey) {
    aiEncouragement.value = DEFAULT_ENCOURAGEMENT
    isAiLoading.value = false
    return
  }
  const cached = cachedEncouragement()
  if (cached && Number(settingsStore.lastEncouragement.split('|')[0]) === currentTotal) {
    aiEncouragement.value = cached
    isAiLoading.value = false
    return
  }
  isAiLoading.value = true
  try {
    const reply = await askAI(`用户累计省钱 ${currentTotal} 元。写一句 20 字以内温柔自然的鼓励语，不编造数据、不制造财务焦虑，只输出正文：`)
    if (request !== encouragementRequest) return
    if (reply?.trim()) {
      aiEncouragement.value = reply.trim()
      settingsStore.lastEncouragement = `${currentTotal}|${reply.trim()}`
    } else aiEncouragement.value = cached || DEFAULT_ENCOURAGEMENT
  } catch {
    if (request === encouragementRequest) aiEncouragement.value = cached || DEFAULT_ENCOURAGEMENT
  } finally { if (request === encouragementRequest) isAiLoading.value = false }
}
watch([totalSaved, () => debtStore.isDataLoaded, () => settingsStore.aiApiKey], fetchAIEncouragement)
onMounted(fetchAIEncouragement)
</script>

<template>
  <div class="savings-page fade-in" @click="moreId = null">
    <header class="savings-heading">
      <svg class="piggy-mark" viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r="37" fill="#fff0f3" />
        <path d="M21 35 18 21 33 28C46 20 61 29 64 40L71 42V55L63 57 58 69H49L48 62H32L29 69H20L18 57C9 47 13 38 21 35Z" fill="#f6a9bd" />
        <path d="M21 34 21 26 29 30" fill="#e481a1" />
        <ellipse cx="61" cy="48" rx="10" ry="8" fill="#f9c6d3" />
        <circle cx="59" cy="48" r="1.5" fill="#d66a8c" /><circle cx="64" cy="48" r="1.5" fill="#d66a8c" />
        <circle cx="51" cy="38" r="2" fill="#704651" />
        <path d="M33 29H45" stroke="#b76785" stroke-width="3" stroke-linecap="round" />
        <circle cx="39" cy="17" r="11" fill="#f7ce67" /><circle cx="39" cy="17" r="7" fill="none" stroke="#e7ac39" stroke-width="2" />
        <path d="M39 12V22" stroke="#e7ac39" stroke-width="2" stroke-linecap="round" />
      </svg>
      <div class="heading-copy">
        <h1>省钱计划</h1>
        <p class="encouragement" :aria-busy="isAiLoading">{{ aiEncouragement }}</p>
      </div>
    </header>
    <div class="savings-summary"><span>累计已省 <small>每一笔，都算数</small></span><strong>¥{{ money(totalSaved) }}</strong></div>
    <div class="top-controls">
      <input v-model="searchQuery" :disabled="busy" aria-label="搜索省钱项目" placeholder="搜索省钱项目" class="apple-input search-input" />
      <button class="button-primary add-btn" :disabled="busy" @click="startAdd">＋ 新建计划</button>
    </div>
    <div class="segmented-control" aria-label="计划状态">
      <button class="segment" :class="{ active: activeTab === 'active' }" :aria-pressed="activeTab === 'active'" :disabled="busy" @click="activeTab = 'active'">进行中 <span>{{ activeDebts.length }}</span></button>
      <button class="segment" :class="{ active: activeTab === 'history' }" :aria-pressed="activeTab === 'history'" :disabled="busy" @click="activeTab = 'history'">已达成 <span>{{ historyDebts.length }}</span></button>
    </div>
    <p id="savings-drag-hint" class="sort-hint">{{ searchQuery ? '清空搜索后可调整顺序' : '长按右上角六点可排序，也可在更多中上移或下移' }}</p>
    <div ref="listRef" class="record-list" :aria-busy="savingOrder">
    <TransitionGroup name="savings-card">
      <article v-for="(debt, index) in displayDebts" :key="debt.id" :data-debt-id="debt.id" class="savings-card" :class="{ 'drag-placeholder': draggedId === debt.id, cleared: debt.isCleared }">
        <div class="card-header">
          <span class="goal-icon" aria-hidden="true">{{ debt.isCleared ? '✓' : '◎' }}</span>
          <div class="goal-heading"><h2>{{ debt.name }}</h2><span class="caption body-muted">自 {{ debt.startDate }} 起</span></div>
          <button class="drag-handle" :disabled="sortDisabled" :aria-label="`拖动排序：${debt.name}`" aria-describedby="savings-drag-hint" @pointerdown="startDrag($event, debt.id)" @contextmenu.prevent @click.stop>
            <svg viewBox="0 0 16 24" aria-hidden="true"><circle v-for="n in 6" :key="n" :cx="n % 2 ? 4 : 12" :cy="4 + Math.floor((n - 1) / 2) * 8" r="1.8" /></svg>
          </button>
        </div>
        <div class="card-amounts"><div><span class="caption body-muted">已存下</span><strong class="saved-amount">¥{{ money(debt.saved) }}</strong></div><span class="remaining">{{ debt.isCleared ? '目标达成 ✨' : `还差 ¥${money(debt.remaining)}` }}</span></div>
        <div class="saving-track" role="progressbar" :aria-label="`${debt.name}完成进度`" :aria-valuenow="debt.percent" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: debt.percent + '%' }"></span></div>
        <div class="progress-caption"><span>目标 ¥{{ money(debt.target) }}</span><strong>{{ debt.percent }}%</strong></div>
        <div class="card-actions">
          <button v-if="!debt.isCleared" class="button-primary small-pill" :disabled="busy" @click="startRepay(debt)">＋ 存入</button>
          <button class="button-secondary-pill small-pill" :disabled="busy" @click="viewDetails(debt)">明细</button>
          <div class="more-wrap" @click.stop>
            <button class="more-button" :disabled="busy" :aria-label="`${debt.name}的更多操作`" :aria-expanded="moreId === debt.id" @click="moreId = moreId === debt.id ? null : debt.id">更多 ···</button>
            <div v-if="moreId === debt.id" class="card-menu">
              <button v-if="!debt.isCleared" @click="startEdit(debt); moreId = null">编辑计划</button>
              <button :disabled="sortDisabled || index === 0" @click="moveDebt(debt.id, -1)">上移</button>
              <button :disabled="sortDisabled || index === displayDebts.length - 1" @click="moveDebt(debt.id, 1)">下移</button>
              <button class="destructive" @click="deleteDebt(debt.id); moreId = null">删除计划</button>
            </div>
          </div>
        </div>
      </article>
    </TransitionGroup>
    </div>
    <div v-if="!displayDebts.length" class="empty-state"><span aria-hidden="true">🌱</span><p>{{ searchQuery ? '没有找到匹配的计划' : activeTab === 'active' ? '从一个小目标开始，慢慢积累' : '属于你的达成时刻，正在路上' }}</p></div>
    <Teleport to="body">
      <div v-if="ghost && draggedDebt" class="savings-drag-ghost" :style="{ top: ghost.top + 'px', left: ghost.left + 'px', width: ghost.width + 'px', height: ghost.height + 'px' }" aria-hidden="true"><span class="goal-icon">◎</span><strong>{{ draggedDebt.name }}</strong><span class="ghost-amount">¥{{ money(draggedDebt.saved) }}</span><div class="saving-track"><span :style="{ width: draggedDebt.percent + '%' }"></span></div><small>移动到想放的位置</small></div>
      <div v-if="orderMessage" class="order-toast" role="status"><span>{{ orderMessage }}</span><button v-if="undoOrder" :disabled="busy" @click="saveOrder(undoOrder, true)">撤销</button></div>
    </Teleport>

    <Teleport to="body">
      <div v-if="isAdding || isEditing || isRepaying || isViewing" class="apple-modal-overlay fade-in">
        <div class="apple-modal-card">
          <h3 class="display-lg modal-title">{{ isAdding ? '新建省钱计划' : isEditing ? '调整计划' : isRepaying ? '存入省钱金' : '省钱存入明细' }}</h3>
          <div v-if="isAdding" class="form-stack">
            <div class="input-group"><label class="caption">计划名称</label><input v-model="addForm.name" placeholder="例如：换新电脑" class="apple-input" /></div>
            <div class="input-group"><label class="caption">目标金额 (¥)</label><input type="number" v-model="addForm.totalAmount" class="apple-input" /></div>
            <div class="input-group"><label class="caption">开始日期</label><AppDateField v-model="addForm.startDate" class="apple-input" aria-label="选择计划开始日期" /></div>
            <div class="modal-buttons"><button class="button-primary full-width" @click="submitAdd">确立计划</button><button class="text-link full-width" @click="isAdding = false">取消</button></div>
          </div>
          <div v-if="isEditing" class="form-stack">
            <div class="input-group"><label class="caption">计划名称</label><input v-model="editForm.name" class="apple-input" /></div>
            <div class="input-group"><label class="caption">目标金额 (¥)</label><input type="number" v-model="editForm.totalAmount" class="apple-input" /></div>
            <div class="input-group"><label class="caption">开始日期</label><AppDateField v-model="editForm.startDate" class="apple-input" aria-label="选择计划开始日期" /></div>
            <div class="modal-buttons"><button class="button-primary full-width" @click="saveEdit">保存修改</button><button class="text-link full-width" @click="isEditing = false">取消</button></div>
          </div>
          <div v-if="isRepaying" class="form-stack">
            <div class="input-group"><label class="caption">存入日期</label><AppDateField v-model="repayForm.date" class="apple-input" aria-label="选择存入日期" /></div>
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
.savings-page { padding-bottom: 24px; }
.savings-heading { display: flex; align-items: center; gap: 14px; margin: 8px 0 22px; }
.piggy-mark { width: 72px; height: 72px; flex-shrink: 0; }
.heading-copy { min-width: 0; }
.heading-copy h1 { margin: 0 0 6px; font-size: 29px; line-height: 1.2; letter-spacing: -.8px; color: var(--ink); }
.encouragement { margin: 0; color: var(--body-muted); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.savings-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px; margin-bottom: 20px; border-radius: 18px; background: color-mix(in srgb, var(--primary) 7%, var(--canvas)); }
.savings-summary span { font-size: 13px; flex-shrink: 0; }.savings-summary small { display: block; margin-top: 5px; font-size: 11px; color: var(--body-muted); }.savings-summary strong { font-size: 25px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; min-width: 0; text-align: right; }
.top-controls { display: flex; gap: 10px; margin-bottom: 20px; align-items: center; }.search-input { border-radius: 14px; min-width: 0; }.add-btn { flex-shrink: 0; padding: 12px 15px; border-radius: 14px; }
.segmented-control { display: flex; padding: 4px; border-radius: 14px; background: var(--divider-soft); }
.segment { flex: 1; border: 0; background: none; padding: 9px 4px; border-radius: 11px; color: var(--body-muted); font: inherit; font-size: 14px; cursor: pointer; }.segment span { margin-left: 5px; font-size: 12px; }.segment.active { color: var(--primary); background: var(--canvas); box-shadow: 0 2px 6px #00000009; font-weight: 600; }
.sort-hint { color: var(--body-muted); font-size: 11px; margin: 12px 2px 16px; line-height: 1.5; }
.savings-card { position: relative; padding: 18px; margin-bottom: 16px; border-radius: 22px; border: 1px solid var(--hairline); background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 4%, var(--canvas)), var(--canvas) 65%); box-shadow: 0 5px 18px #152b4610; }
.card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }.goal-icon { display: inline-flex; flex: 0 0 40px; width: 40px; height: 40px; align-items: center; justify-content: center; border-radius: 15px; background: color-mix(in srgb, var(--primary) 12%, var(--canvas)); color: var(--primary); font-size: 27px; }
.goal-heading { flex: 1; min-width: 0; }.goal-heading h2 { font-size: 16px; line-height: 1.4; margin: 0 0 4px; overflow-wrap: anywhere; }.goal-heading .caption { font-size: 11px; }
.drag-handle { width: 44px; height: 44px; padding: 10px 14px; border: 0; border-radius: 12px; background: transparent; color: var(--body-muted); flex-shrink: 0; cursor: grab; touch-action: pan-y; user-select: none; -webkit-touch-callout: none; }.drag-handle svg { width: 16px; height: 24px; fill: currentColor; }.drag-handle:active { background: var(--divider-soft); }.drag-handle:disabled { opacity: .3; cursor: default; }
.card-amounts { display: flex; justify-content: space-between; align-items: end; gap: 12px; margin-bottom: 14px; }.card-amounts > div { min-width: 0; }.saved-amount { display: block; margin-top: 4px; font-size: 28px; line-height: 1.2; font-variant-numeric: tabular-nums; letter-spacing: -.5px; overflow-wrap: anywhere; }.remaining { color: var(--primary); font-size: 12px; text-align: right; max-width: 45%; overflow-wrap: anywhere; }
.saving-track { height: 9px; border-radius: 9px; overflow: hidden; background: var(--divider-soft); }.saving-track > span { display: block; height: 100%; background: var(--primary); border-radius: inherit; }.progress-caption { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; font-size: 12px; color: var(--body-muted); overflow-wrap: anywhere; }
.card-actions { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--divider-soft); padding-top: 14px; margin-top: 16px; }.small-pill { padding: 9px 18px; min-height: 40px; font-size: 13px; }.more-wrap { margin-left: auto; position: relative; }.more-button { min-height: 44px; padding: 6px; color: var(--body-muted); border: 0; background: none; cursor: pointer; }
.card-menu { position: absolute; right: 0; bottom: 100%; width: 132px; z-index: 5; background: var(--canvas); border: 1px solid var(--hairline); border-radius: 14px; padding: 5px; box-shadow: 0 8px 30px #0002; }.card-menu button { display: block; width: 100%; min-height: 44px; border: 0; border-radius: 9px; background: none; color: var(--ink); text-align: left; padding: 10px 14px; cursor: pointer; }.card-menu button:hover { background: var(--divider-soft); }.card-menu .destructive { color: #cc344d; }
.savings-page button:disabled { opacity: .4; cursor: default; }.savings-page button:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }.cleared .goal-icon { background: #e5f5eb; color: #288052; }.cleared .remaining { color: #288052; }
.empty-state { text-align: center; padding: 48px 0; color: var(--body-muted); font-size: 14px; }.empty-state > span { font-size: 34px; }.savings-card-move { transition: transform .18s ease; }.drag-placeholder { opacity: .28; border: 2px dashed var(--primary); }
.savings-drag-ghost { position: fixed; z-index: 10000; pointer-events: none; box-sizing: border-box; padding: 18px; border: 1px solid var(--primary); border-radius: 22px; background: var(--canvas); color: var(--ink); box-shadow: 0 16px 40px #152b4638; transform: scale(1.015); overflow: hidden; }.savings-drag-ghost > strong { margin-left: 10px; overflow-wrap: anywhere; }.ghost-amount { display: block; font-size: 28px; font-weight: 700; margin: 20px 0 14px; }.savings-drag-ghost small { display: block; color: var(--body-muted); margin-top: 14px; }
.order-toast { position: fixed; bottom: max(30px, env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%); z-index: 10001; display: flex; align-items: center; gap: 20px; padding: 10px 18px; border-radius: 16px; background: var(--ink); color: var(--canvas); box-shadow: 0 8px 30px #0002; white-space: nowrap; }.order-toast button { background: none; border: 0; color: inherit; font-weight: 700; min-height: 44px; padding: 0 8px; text-decoration: underline; }
@media (prefers-reduced-motion: reduce) { .savings-card-move { transition: none; }.savings-drag-ghost { transform: none; } }
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
</style>
