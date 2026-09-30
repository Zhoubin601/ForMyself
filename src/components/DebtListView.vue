<script setup>
import CommonNoteField from "./CommonNoteField.vue"
import { ref, computed, nextTick, watch, onBeforeUnmount, onMounted, onActivated, onDeactivated } from 'vue'
import { useDebtStore } from '../stores/debt'
import { useSettingsStore } from '../stores/settings'
import { askAI } from '../services/aiEngine'
import { appAlert, appConfirm, appToast } from '../services/uiFeedback'
import { registerBackHandler } from '../services/backNavigation'
import { useAuthStore } from '../stores/auth'
import { useDebtDrag } from '../composables/useDebtDrag'
import { useSortableDrag } from '../composables/useSortableDrag'
import { getSavingsProgress } from '../services/debtOrdering'
import { DEFAULT_DEBT_GROUP } from '../services/debtOrdering'
import { debtIconGraphemes, normalizeDebtIconLabel } from '../services/debtIcon'
import { preferenceStorage as Preferences } from '../platform/storage/preferences.js'
import { STORAGE_KEYS } from '../platform/storage/keys.js'
import AppDateField from './AppDateField.vue'
import { Plus, Ellipsis } from 'lucide-vue-next'

const debtStore = useDebtStore()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()

const getTodayStr = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

const activeTab = ref('active')
const searchQuery = ref('')
const density = ref('full')
const densityOptions = ['full', 'grid', 'rows']
const editingGroup = ref('')
const editingGroupName = ref('')
const hoverGroup = ref(null)
const previewGroup = ref(null)
const iconSuggestions = ['✈️', '🏠', '🎮', '🎓', '🎁', '💖']
let pinchStartDistance = 0
let pinchStartDensity = 'full'
let pinchChanged = false
let densityAnimationVersion = 0
let densityAnimations = []
let densityAnimatedStyles = []

function clearDensityAnimation() {
  densityAnimationVersion++
  densityAnimations.forEach(animation => animation.cancel())
  densityAnimations = []
  densityAnimatedStyles.forEach(({ node, overflow, boxSizing, transformOrigin }) => {
    node.style.overflow = overflow
    node.style.boxSizing = boxSizing
    node.style.transformOrigin = transformOrigin
  })
  densityAnimatedStyles = []
  listRef.value?.classList.remove('density-animating')
}
function groupGeometry(list) {
  return new Map([...list.querySelectorAll('.savings-group')].map(group => {
    const rect = group.getBoundingClientRect()
    return [group.dataset.savingsGroup, {
      height: rect.height,
      cards: new Map([...group.querySelectorAll('[data-debt-id]')].map(card => {
        const cardRect = card.getBoundingClientRect()
        return [card.dataset.debtId, {
          left: cardRect.left - rect.left,
          top: cardRect.top - rect.top,
          width: cardRect.width,
          height: cardRect.height
        }]
      }))
    }]
  }))
}
function animateDensity(value, list, before) {
  const version = densityAnimationVersion
  density.value = value
  nextTick(() => {
    if (version !== densityAnimationVersion || !list.isConnected) return
    const easing = 'cubic-bezier(0.2, 0, 0, 1)'
    for (const group of list.querySelectorAll('.savings-group')) {
      const previous = before.get(group.dataset.savingsGroup)
      if (!previous) continue
      const rect = group.getBoundingClientRect()
      densityAnimatedStyles.push({ node: group, overflow: group.style.overflow, boxSizing: group.style.boxSizing, transformOrigin: group.style.transformOrigin })
      group.style.overflow = 'clip'
      group.style.boxSizing = 'border-box'
      densityAnimations.push(group.animate([
        { height: `${previous.height}px` }, { height: `${rect.height}px` }
      ], { duration: 380, easing }))
      for (const card of group.querySelectorAll('[data-debt-id]')) {
        const oldCard = previous.cards.get(card.dataset.debtId)
        if (!oldCard) continue
        const now = card.getBoundingClientRect()
        const left = now.left - rect.left
        const top = now.top - rect.top
        densityAnimatedStyles.push({ node: card, overflow: card.style.overflow, boxSizing: card.style.boxSizing, transformOrigin: card.style.transformOrigin })
        card.style.transformOrigin = 'top left'
        const dx = oldCard.left - left
        const dy = oldCard.top - top
        const distance = Math.hypot(dx, dy)
        const bend = Math.min(16, distance * 0.08)
        const middleX = dx / 2 - (distance ? dy / distance * bend : 0)
        const middleY = dy / 2 + (distance ? dx / distance * bend : 0)
        const scaleX = oldCard.width / Math.max(1, now.width)
        const scaleY = oldCard.height / Math.max(1, now.height)
        densityAnimations.push(card.animate([
          { transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`, opacity: 0.72, offset: 0 },
          { transform: `translate(${middleX}px, ${middleY}px) scale(${(scaleX + 1) / 2}, ${(scaleY + 1) / 2})`, opacity: 0.9, offset: 0.5 },
          { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 1 }
        ], { duration: 380, easing }))
      }
    }
    if (!densityAnimations.length) return
    list.classList.add('density-animating')
    Promise.allSettled(densityAnimations.map(animation => animation.finished)).then(() => {
      if (version === densityAnimationVersion) clearDensityAnimation()
    })
  })
}

function setDensity(value) {
  if (!densityOptions.includes(value) || density.value === value) return
  const list = listRef.value
  const before = list ? groupGeometry(list) : null
  clearDensityAnimation()
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  if (list && before && !reduceMotion && typeof Element.prototype.animate === 'function') animateDensity(value, list, before)
  else density.value = value
  Preferences.set({ key: STORAGE_KEYS.savingsDensity, value }).catch(() => appToast('显示方式未保存', { tone: 'danger' }))
}
function touchDistance(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
}
function onDensityTouchStart(event) {
  if (event.touches.length !== 2) return
  cancelDrag()
  cancelGroupDrag()
  pinchStartDistance = touchDistance(event.touches)
  pinchStartDensity = density.value
  pinchChanged = false
}
function onDensityTouchMove(event) {
  if (event.touches.length !== 2 || !pinchStartDistance) return
  if (event.cancelable) event.preventDefault()
  if (pinchChanged) return
  const delta = touchDistance(event.touches) - pinchStartDistance
  if (Math.abs(delta) < 32) return
  const index = densityOptions.indexOf(pinchStartDensity)
  setDensity(densityOptions[Math.max(0, Math.min(2, index + (delta < 0 ? 1 : -1)))])
  pinchChanged = true
}
function onDensityTouchEnd(event) { if (event.touches.length < 2) pinchStartDistance = 0 }
onMounted(async () => {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEYS.savingsDensity })
    if (densityOptions.includes(value)) density.value = value
  } catch { /* Use the full card layout. */ }
})

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
const savingGroups = ref(false)
const undoOrder = ref(null)
const orderMessage = ref('')
let undoTimer
let pageActive = true
const groups = computed(() => debtStore.debtGroups || [DEFAULT_DEBT_GROUP])
const currentDebts = computed(() => {
  const source = activeTab.value === 'active' ? activeDebts.value : historyDebts.value
  const rank = new Map(groups.value.map((name, index) => [name, index]))
  return [...source].sort((a, b) => (rank.get(a.group || DEFAULT_DEBT_GROUP) ?? 0) - (rank.get(b.group || DEFAULT_DEBT_GROUP) ?? 0))
})
const sortDisabled = computed(() => Boolean(searchQuery.value) || (currentDebts.value.length < 2 && groups.value.length < 2) || !debtStore.isDataLoaded || savingOrder.value || savingGroups.value || groupDragging.value)
function resolveGroupAt({ x, y }) {
  const node = document.elementFromPoint?.(x, y)?.closest?.('[data-savings-group]')
  if (node) return node.dataset.savingsGroup
  return document.elementFromPoint ? null : DEFAULT_DEBT_GROUP
}
function onGroupHover(name) {
  hoverGroup.value = name
  previewGroup.value = name
}
const { start: startDrag, cancel: cancelDrag, dragging, draggedId, previewIds, ghost } = useDebtDrag({
  items: currentDebts, disabled: sortDisabled, listRef,
  onDrop: (ids, meta) => saveOrder(ids, false, meta),
  resolveTarget: resolveGroupAt,
  onHover: onGroupHover,
  onInvalidDrop: () => appToast('请拖到计划分组内', { tone: 'danger' })
})
const groupItems = computed(() => groups.value.map(id => ({ id })))
const groupSortDisabled = computed(() => groups.value.length < 2 || Boolean(searchQuery.value) || !debtStore.isDataLoaded || savingOrder.value || savingGroups.value || dragging.value || Boolean(editingGroup.value))
const { start: startGroupDrag, cancel: cancelGroupDrag, dragging: groupDragging, draggedId: draggedGroup, previewIds: groupPreviewIds, ghost: groupGhost } = useSortableDrag({
  items: groupItems,
  disabled: groupSortDisabled,
  listRef,
  itemSelector: '[data-group-drag-id]',
  idAttr: 'data-group-drag-id',
  onDrop: names => saveGroupOrder(names)
})
const busy = computed(() => dragging.value || groupDragging.value || savingOrder.value || savingGroups.value)
const displayDebts = computed(() => {
  const byId = new Map(filteredDebts.value.map(debt => [debt.id, debt]))
  const records = previewIds.value ? previewIds.value.map(id => byId.get(id)).filter(Boolean) : currentDebts.value.filter(debt => byId.has(debt.id))
  return records.map(debt => {
    const iconLabel = normalizeDebtIconLabel(debt.iconLabel)
    return { ...debt, ...getSavingsProgress(debt), iconLabel, iconCompact: debtIconGraphemes(iconLabel).length > 1 }
  })
})
const displayGroups = computed(() => (groupPreviewIds.value || groups.value).map(name => ({
  name,
  debts: displayDebts.value.filter(debt => (debt.id === draggedId.value && previewGroup.value ? previewGroup.value : debt.group || DEFAULT_DEBT_GROUP) === name)
})))
const draggedDebt = computed(() => displayDebts.value.find(debt => debt.id === draggedId.value))
const money = value => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value) || 0)
const members = computed(() => JSON.stringify(debtStore.savedDebts.map(debt => [debt.id, Boolean(debt.isCleared)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))))
function clearUndo() { clearTimeout(undoTimer); undoOrder.value = null; orderMessage.value = '' }
function showOrderMessage(message) {
  orderMessage.value = message
  clearTimeout(undoTimer)
  undoTimer = setTimeout(clearUndo, 5000)
}
async function saveOrder(ids, undo = false, meta = {}) {
  if (savingOrder.value || sortDisabled.value) return
  const before = currentDebts.value.map(debt => debt.id)
  const moved = meta.id ? currentDebts.value.find(debt => debt.id === meta.id) : null
  const oldGroup = moved?.group || DEFAULT_DEBT_GROUP
  const targetGroup = meta.targetId || null
  const changedGroup = Boolean(moved && targetGroup && oldGroup !== targetGroup)
  if (JSON.stringify(before) === JSON.stringify(ids) && !changedGroup) return
  const category = activeTab.value
  const memberSnapshot = members.value
  savingOrder.value = true
  moreId.value = null
  clearUndo()
  try {
    await debtStore.arrangeDebts({ orderedIds: ids, isCleared: category === 'history', movedId: meta.id || null, targetGroup })
    if (pageActive && !authStore.isLocked && memberSnapshot === members.value && category === activeTab.value) {
      undoOrder.value = undo ? null : { kind: 'cards', ids: before, id: meta.id || null, targetId: oldGroup }
      showOrderMessage(undo ? '已撤销调整' : changedGroup ? `已移到${targetGroup}` : '顺序已更新')
    }
  } catch {
    if (pageActive) appToast(undo ? '撤销失败，顺序未改变' : '顺序未保存，请重新拖动', { tone: 'danger' })
  } finally { savingOrder.value = false }
}
async function saveGroupOrder(names, undo = false) {
  if (savingGroups.value || groupSortDisabled.value) return
  const before = [...groups.value]
  if (JSON.stringify(before) === JSON.stringify(names)) return
  savingGroups.value = true
  clearUndo()
  try {
    await debtStore.reorderDebtGroups(names)
    if (pageActive && !authStore.isLocked) {
      undoOrder.value = undo ? null : { kind: 'groups', names: before }
      showOrderMessage(undo ? '已撤销分组排序' : '分组顺序已更新')
    }
  } catch {
    if (pageActive) appToast(undo ? '撤销失败，分组顺序未改变' : '分组顺序未保存，请重新拖动', { tone: 'danger' })
  } finally { savingGroups.value = false }
}
function undoLastOrder() {
  const order = undoOrder.value
  if (!order) return
  if (order.kind === 'groups') saveGroupOrder(order.names, true)
  else saveOrder(order.ids, true, order)
}
function moveGroup(name, offset) {
  if (groupSortDisabled.value) return
  const names = [...groups.value]
  const index = names.indexOf(name)
  const target = index + offset
  if (index < 0 || target < 0 || target >= names.length) return
  names.splice(target, 0, names.splice(index, 1)[0])
  saveGroupOrder(names)
}
function moveDebt(id, offset) {
  const ids = currentDebts.value.map(debt => debt.id)
  const index = ids.indexOf(id)
  const target = index + offset
  if (index < 0 || target < 0 || target >= ids.length) return
  if ((currentDebts.value[index].group || DEFAULT_DEBT_GROUP) !== (currentDebts.value[target].group || DEFAULT_DEBT_GROUP)) return
  ids.splice(target, 0, ids.splice(index, 1)[0])
  saveOrder(ids)
}
async function renameGroup() {
  try {
    await debtStore.renameDebtGroup(editingGroup.value, editingGroupName.value)
    editingGroup.value = ''
  } catch { appToast('分组名称不能为空或已存在', { tone: 'danger' }) }
}
async function deleteGroup(name) {
  if (!await appConfirm(`删除“${name}”分组？其中的计划会移到“未分组”。`, { title: '删除分组？', destructive: true })) return
  try { await debtStore.deleteDebtGroup(name) }
  catch { appToast('删除分组失败', { tone: 'danger' }) }
}
function pausePage() { pageActive = false; cancelDrag(); cancelGroupDrag(); clearUndo(); moreId.value = null }
watch([activeTab, members], () => { cancelDrag(); cancelGroupDrag(); clearUndo(); moreId.value = null })
watch(() => authStore.isLocked, locked => { if (locked) pausePage(); else pageActive = true })
watch(dragging, value => { if (value) moreId.value = null })
onActivated(() => { pageActive = true })
onDeactivated(pausePage)
onBeforeUnmount(() => { pausePage(); clearDensityAnimation() })

const isAdding = ref(false)
const addForm = ref({ name: '', iconLabel: '', totalAmount: '', startDate: getTodayStr(), group: DEFAULT_DEBT_GROUP })

const startAdd = () => { isAdding.value = true }
const submitAdd = () => {
  if (!addForm.value.name || !addForm.value.totalAmount) return appAlert('名称和目标金额不能为空哦')
  const amount = parseFloat(addForm.value.totalAmount)
  debtStore.addDebt({ id: Date.now().toString(), name: addForm.value.name, iconLabel: normalizeDebtIconLabel(addForm.value.iconLabel), totalAmount: amount, remainingAmount: amount, startDate: addForm.value.startDate, group: addForm.value.group, records: [], isCleared: false })
  isAdding.value = false
  addForm.value = { name: '', iconLabel: '', totalAmount: '', startDate: getTodayStr(), group: DEFAULT_DEBT_GROUP }
}

const deleteDebt = async (id) => {
  if (await appConfirm('删除后，这个计划及其存入记录将无法恢复。', {
    title: '删除省钱计划？',
    destructive: true
  })) debtStore.deleteDebt(id)
}

const currentDebtId = ref(null)
const isEditing = ref(false)
const editForm = ref({ name: '', iconLabel: '', totalAmount: '', startDate: '', group: DEFAULT_DEBT_GROUP })

const startEdit = (debt) => { currentDebtId.value = debt.id; isEditing.value = true; editForm.value = { name: debt.name, iconLabel: normalizeDebtIconLabel(debt.iconLabel), totalAmount: debt.totalAmount, startDate: debt.startDate, group: debt.group || DEFAULT_DEBT_GROUP } }

const saveEdit = () => {
  if (!editForm.value.name) return appAlert('名称不能为空')
  const newData = [...debtStore.savedDebts]
  const idx = newData.findIndex(d => d.id === currentDebtId.value)
  if (idx !== -1) {
    const debt = newData[idx]
    const savedTotal = debt.records.reduce((sum, r) => sum + r.amount, 0)
    debt.name = editForm.value.name
    debt.iconLabel = normalizeDebtIconLabel(editForm.value.iconLabel)
    debt.totalAmount = parseFloat(editForm.value.totalAmount)
    debt.startDate = editForm.value.startDate
    debt.group = editForm.value.group
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
    <div ref="listRef" class="record-list" :class="`density-${density}`" :aria-busy="savingOrder" @touchstart="onDensityTouchStart" @touchmove="onDensityTouchMove" @touchend="onDensityTouchEnd" @touchcancel="onDensityTouchEnd">
    <TransitionGroup name="savings-group" tag="div">
    <section v-for="group in displayGroups" :key="group.name" class="savings-group" :class="{ 'drop-active': dragging && hoverGroup === group.name }" :data-savings-group="group.name">
      <div class="savings-group-header" :class="{ 'group-drag-placeholder': draggedGroup === group.name }" :data-group-drag-id="group.name">
        <div>
          <button class="group-drag-handle" :disabled="groupSortDisabled" :aria-label="`拖动分组排序：${group.name}，也可用上下方向键`" @pointerdown="startGroupDrag($event, group.name)" @keydown.up.prevent="moveGroup(group.name, -1)" @keydown.down.prevent="moveGroup(group.name, 1)" @contextmenu.prevent @click.stop>
            <svg viewBox="0 0 16 24" aria-hidden="true"><circle v-for="n in 6" :key="n" :cx="n % 2 ? 4 : 12" :cy="4 + Math.floor((n - 1) / 2) * 8" r="1.8" /></svg>
          </button>
          <strong>{{ group.name }}</strong><span>{{ group.debts.length }} 项</span>
        </div>
        <div v-if="group.name !== DEFAULT_DEBT_GROUP" class="savings-group-actions">
          <button :aria-label="`重命名${group.name}分组`" :disabled="busy" @click="editingGroup = group.name; editingGroupName = group.name">改名</button>
          <button :aria-label="`删除${group.name}分组`" :disabled="busy" @click="deleteGroup(group.name)">删除</button>
        </div>
      </div>
      <div v-if="editingGroup === group.name" class="savings-group-rename"><input v-model="editingGroupName" class="apple-input" maxlength="20" aria-label="修改分组名称" @keyup.enter="renameGroup" /><button class="button-secondary-pill" @click="renameGroup">保存</button><button class="text-link" @click="editingGroup = ''">取消</button></div>
      <div class="savings-group-list">
    <TransitionGroup name="savings-card">
      <article v-for="(debt, index) in group.debts" :key="debt.id" :data-debt-id="debt.id" class="savings-card" :class="{ 'drag-placeholder': draggedId === debt.id, cleared: debt.isCleared }">
        <div class="card-header">
          <span class="goal-icon" :class="{ 'has-label': debt.iconLabel, 'multi-label': debt.iconCompact }" aria-hidden="true">{{ debt.iconLabel || (debt.isCleared ? '✓' : '◎') }}</span>
          <div class="goal-heading"><h2>{{ debt.name }}</h2><span class="caption body-muted">自 {{ debt.startDate }} 起</span></div>
          <button class="drag-handle" :disabled="sortDisabled" :aria-label="`拖动排序：${debt.name}`" @pointerdown="startDrag($event, debt.id)" @contextmenu.prevent @click.stop>
            <svg viewBox="0 0 16 24" aria-hidden="true"><circle v-for="n in 6" :key="n" :cx="n % 2 ? 4 : 12" :cy="4 + Math.floor((n - 1) / 2) * 8" r="1.8" /></svg>
          </button>
        </div>
        <div class="card-amounts"><div><span class="caption body-muted">已存下</span><strong class="saved-amount">¥{{ money(debt.saved) }}</strong></div><span class="remaining">{{ debt.isCleared ? '目标达成 ✨' : `还差 ¥${money(debt.remaining)}` }}</span></div>
        <div class="saving-track" role="progressbar" :aria-label="`${debt.name}完成进度`" :aria-valuenow="debt.percent" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: debt.percent + '%' }"></span></div>
        <div class="progress-caption"><span>目标 ¥{{ money(debt.target) }}</span><strong>{{ debt.percent }}%</strong></div>
        <div class="card-actions">
          <button v-if="!debt.isCleared" class="button-primary small-pill" :disabled="busy" @click="startRepay(debt)"><Plus :size="14" aria-hidden="true" />存入</button>
          <button class="button-secondary-pill small-pill" :disabled="busy" @click="viewDetails(debt)">明细</button>
          <div class="more-wrap" @click.stop>
            <button class="more-button" :disabled="busy" :aria-label="`${debt.name}的更多操作`" :aria-expanded="moreId === debt.id" @click="moreId = moreId === debt.id ? null : debt.id">更多 <Ellipsis :size="17" aria-hidden="true" /></button>
            <div v-if="moreId === debt.id" class="card-menu">
              <button v-if="!debt.isCleared" @click="startEdit(debt); moreId = null">编辑计划</button>
              <button :disabled="sortDisabled || index === 0" @click="moveDebt(debt.id, -1)">上移</button>
              <button :disabled="sortDisabled || index === group.debts.length - 1" @click="moveDebt(debt.id, 1)">下移</button>
              <button class="destructive" @click="deleteDebt(debt.id); moreId = null">删除计划</button>
            </div>
          </div>
        </div>
      </article>
    </TransitionGroup>
      <div v-if="!group.debts.length" class="savings-group-empty">拖动计划到这里</div>
      </div>
    </section>
    </TransitionGroup>
    </div>
    <div v-if="!displayDebts.length" class="empty-state"><span aria-hidden="true">🌱</span><p>{{ searchQuery ? '没有找到匹配的计划' : activeTab === 'active' ? '从一个小目标开始，慢慢积累' : '属于你的达成时刻，正在路上' }}</p></div>
    <Teleport to="body">
      <div v-if="groupGhost && draggedGroup" class="savings-group-drag-ghost" :class="groupGhost.state" :style="{ top: groupGhost.top + 'px', left: groupGhost.left + 'px', width: groupGhost.width + 'px', height: groupGhost.height + 'px' }" aria-hidden="true">
        <span class="group-drag-ghost-handle">⋮⋮</span><strong>{{ draggedGroup }}</strong><span>{{ displayGroups.find(group => group.name === draggedGroup)?.debts.length }} 项</span>
      </div>
      <article v-if="ghost && draggedDebt" class="savings-card savings-drag-ghost" :class="[ghost.state, `density-${density}`, { 'is-invalid': ghost.invalid, cleared: draggedDebt.isCleared }]" :style="{ top: ghost.top + 'px', left: ghost.left + 'px', width: ghost.width + 'px', height: ghost.height + 'px' }" aria-hidden="true">
        <div class="card-header">
          <span class="goal-icon" :class="{ 'has-label': draggedDebt.iconLabel, 'multi-label': draggedDebt.iconCompact }">{{ draggedDebt.iconLabel || (draggedDebt.isCleared ? '✓' : '◎') }}</span>
          <div class="goal-heading"><h2>{{ draggedDebt.name }}</h2><span class="caption body-muted">自 {{ draggedDebt.startDate }} 起</span></div>
          <span class="drag-handle ghost-handle"><svg viewBox="0 0 16 24"><circle v-for="n in 6" :key="n" :cx="n % 2 ? 4 : 12" :cy="4 + Math.floor((n - 1) / 2) * 8" r="1.8" /></svg></span>
        </div>
        <div class="card-amounts"><div><span class="caption body-muted">已存下</span><strong class="saved-amount">¥{{ money(draggedDebt.saved) }}</strong></div><span class="remaining">{{ draggedDebt.isCleared ? '目标达成 ✨' : `还差 ¥${money(draggedDebt.remaining)}` }}</span></div>
        <div class="saving-track"><span :style="{ width: draggedDebt.percent + '%' }"></span></div>
        <div class="progress-caption"><span>目标 ¥{{ money(draggedDebt.target) }}</span><strong>{{ draggedDebt.percent }}%</strong></div>
        <div class="card-actions"><span v-if="!draggedDebt.isCleared" class="button-primary small-pill"><Plus :size="14" aria-hidden="true" />存入</span><span class="button-secondary-pill small-pill">明细</span><span class="more-wrap more-button">更多 <Ellipsis :size="17" aria-hidden="true" /></span></div>
      </article>
      <div v-if="orderMessage" class="order-toast" role="status"><span>{{ orderMessage }}</span><button v-if="undoOrder" :disabled="busy" @click="undoLastOrder">撤销</button></div>
    </Teleport>

    <Teleport to="body">
      <div v-if="isAdding || isEditing || isRepaying || isViewing" class="apple-modal-overlay fade-in">
        <div class="apple-modal-card">
          <h3 class="display-lg modal-title">{{ isAdding ? '新建省钱计划' : isEditing ? '调整计划' : isRepaying ? '存入省钱金' : '省钱存入明细' }}</h3>
          <div v-if="isAdding" class="form-stack">
            <div class="input-group"><label class="caption">计划名称</label><input v-model="addForm.name" placeholder="例如：换新电脑" class="apple-input" /></div>
            <div class="input-group"><label class="caption" for="new-debt-icon">图标标签</label><div class="icon-label-editor"><span class="goal-icon" :class="{ 'has-label': normalizeDebtIconLabel(addForm.iconLabel), 'multi-label': debtIconGraphemes(normalizeDebtIconLabel(addForm.iconLabel)).length > 1 }" aria-hidden="true">{{ normalizeDebtIconLabel(addForm.iconLabel) || '◎' }}</span><input id="new-debt-icon" v-model="addForm.iconLabel" class="apple-input" maxlength="32" placeholder="例如：✈️ 或 旅行" @blur="addForm.iconLabel = normalizeDebtIconLabel(addForm.iconLabel)" /></div><div class="icon-quick-picks" role="group" aria-label="常用计划图标"><button v-for="emoji in iconSuggestions" :key="emoji" type="button" :aria-label="`选择${emoji}作为计划图标`" :aria-pressed="addForm.iconLabel === emoji" @click="addForm.iconLabel = emoji">{{ emoji }}</button></div><p class="icon-label-hint">最多两个字或表情，留空使用默认图标</p></div>
            <div class="input-group"><label class="caption">目标金额 (¥)</label><input v-model="addForm.totalAmount" type="number" class="apple-input" /></div>
            <div class="input-group"><label class="caption">开始日期</label><AppDateField v-model="addForm.startDate" class="apple-input" aria-label="选择计划开始日期" /></div>
            <div class="input-group"><span class="caption">所属分组</span><div class="group-choice" role="group" aria-label="新计划所属分组"><button v-for="name in groups" :key="name" :aria-pressed="addForm.group === name" :class="{ active: addForm.group === name }" @click="addForm.group = name">{{ name }}</button></div></div>
            <div class="modal-buttons"><button class="button-primary full-width" @click="submitAdd">确立计划</button><button class="text-link full-width" @click="isAdding = false">取消</button></div>
          </div>
          <div v-if="isEditing" class="form-stack">
            <div class="input-group"><label class="caption">计划名称</label><input v-model="editForm.name" class="apple-input" /></div>
            <div class="input-group"><label class="caption" for="edit-debt-icon">图标标签</label><div class="icon-label-editor"><span class="goal-icon" :class="{ 'has-label': normalizeDebtIconLabel(editForm.iconLabel), 'multi-label': debtIconGraphemes(normalizeDebtIconLabel(editForm.iconLabel)).length > 1 }" aria-hidden="true">{{ normalizeDebtIconLabel(editForm.iconLabel) || '◎' }}</span><input id="edit-debt-icon" v-model="editForm.iconLabel" class="apple-input" maxlength="32" placeholder="例如：✈️ 或 旅行" @blur="editForm.iconLabel = normalizeDebtIconLabel(editForm.iconLabel)" /></div><div class="icon-quick-picks" role="group" aria-label="常用计划图标"><button v-for="emoji in iconSuggestions" :key="emoji" type="button" :aria-label="`选择${emoji}作为计划图标`" :aria-pressed="editForm.iconLabel === emoji" @click="editForm.iconLabel = emoji">{{ emoji }}</button></div><p class="icon-label-hint">最多两个字或表情，留空使用默认图标</p></div>
            <div class="input-group"><label class="caption">目标金额 (¥)</label><input v-model="editForm.totalAmount" type="number" class="apple-input" /></div>
            <div class="input-group"><label class="caption">开始日期</label><AppDateField v-model="editForm.startDate" class="apple-input" aria-label="选择计划开始日期" /></div>
            <div class="input-group"><span class="caption">所属分组</span><div class="group-choice" role="group" aria-label="计划所属分组"><button v-for="name in groups" :key="name" :aria-pressed="editForm.group === name" :class="{ active: editForm.group === name }" @click="editForm.group = name">{{ name }}</button></div></div>
            <div class="modal-buttons"><button class="button-primary full-width" @click="saveEdit">保存修改</button><button class="text-link full-width" @click="isEditing = false">取消</button></div>
          </div>
          <div v-if="isRepaying" class="form-stack">
            <div class="input-group"><label class="caption">存入日期</label><AppDateField v-model="repayForm.date" class="apple-input" aria-label="选择存入日期" /></div>
            <div class="input-group"><label class="caption">存入金额 (¥)</label><input v-model="repayForm.amount" type="number" class="apple-input" /></div>
            <div class="input-group"><label class="caption">备注</label><CommonNoteField v-model="repayForm.note" scope="savings" placeholder="少喝了一杯咖啡" /></div>
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
.card-amounts > div { display:flex; align-items:baseline; gap:8px; }

.savings-page { padding-bottom: 24px; }
.savings-heading { display: flex; align-items: center; gap: 14px; margin: 8px 0 22px; }
.piggy-mark { width: 72px; height: 72px; flex-shrink: 0; }
.heading-copy { min-width: 0; }
.heading-copy h1 { margin: 0 0 6px; font-size: 29px; line-height: 1.2; letter-spacing: -.8px; color: var(--ink); }
.encouragement { margin: 0; color: var(--body-muted); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.savings-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px; margin-bottom: 10px; border-radius: 18px; background: color-mix(in srgb, var(--primary) 7%, var(--canvas)); }
.savings-summary span { font-size: 13px; flex-shrink: 0; }.savings-summary small { display: block; margin-top: 5px; font-size: 11px; color: var(--body-muted); }.savings-summary strong { font-size: 25px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; min-width: 0; text-align: right; }
.top-controls { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; }.search-input { border-radius: 14px; min-width: 0; }.add-btn { flex-shrink: 0; padding: 12px 15px; border-radius: 14px; }
.segmented-control { display: flex; padding: 4px; border-radius: 14px; background: var(--divider-soft); }
.segment { flex: 1; border: 0; background: none; padding: 9px 4px; border-radius: 11px; color: var(--body-muted); font: inherit; font-size: 14px; cursor: pointer; }.segment span { margin-left: 5px; font-size: 12px; }.segment.active { color: var(--primary); background: var(--canvas); box-shadow: 0 2px 6px #00000009; font-weight: 600; }
.record-list { margin-top: 14px; }
.group-choice { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 7px; }
.group-choice button { min-height: 40px; padding: 7px 12px; border: 1px solid var(--hairline); border-radius: 10px; background: var(--canvas); color: var(--ink); font: inherit; }
.group-choice button.active { border-color: var(--primary); color: var(--primary); background: color-mix(in srgb, var(--primary) 9%, var(--canvas)); }
.icon-label-editor { display: flex; align-items: center; gap: 10px; margin-top: 7px; }
.icon-label-editor .apple-input { min-width: 0; flex: 1; }
.icon-quick-picks { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; }
.icon-quick-picks button { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid var(--hairline); border-radius: 11px; background: var(--canvas); font-size: 19px; cursor: pointer; }
.icon-quick-picks button[aria-pressed="true"] { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, var(--canvas)); }
.icon-label-hint { margin: 7px 0 0; color: var(--body-muted); font-size: 11px; }
.savings-group { margin: 0 0 18px; padding: 12px; border: 1px solid var(--hairline); border-radius: 20px; background: color-mix(in srgb, var(--primary) 2%, var(--canvas)); transition: border-color .16s ease, background .16s ease, box-shadow .16s ease; }
.savings-group-move { transition: transform .22s cubic-bezier(0.2, 0, 0, 1); }
.savings-group.drop-active { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 8%, var(--canvas)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 12%, transparent); }
.savings-group-header, .savings-group-header > div { display: flex; align-items: center; gap: 8px; }
.savings-group-header { justify-content: space-between; min-height: 34px; margin-bottom: 10px; }
.savings-group-header > div:first-child { min-width: 0; }
.savings-group-header strong { font-size: 15px; overflow-wrap: anywhere; }
.savings-group-header span { font-size: 11px; color: var(--body-muted); }
.group-drag-handle { display: grid; place-items: center; flex: 0 0 34px; width: 34px; height: 38px; padding: 7px; border: 0; border-radius: 10px; background: transparent; color: var(--body-muted); cursor: grab; touch-action: none !important; user-select: none; -webkit-user-select: none; }
.group-drag-handle svg { width: 14px; height: 22px; fill: currentColor; }
.group-drag-handle:active { background: var(--divider-soft); }
.group-drag-placeholder { border-radius: 10px; outline: 1px dashed var(--primary); background: color-mix(in srgb, var(--primary) 7%, var(--canvas)); }
.group-drag-placeholder > * { opacity: .25; }
.savings-group-actions button { padding: 6px; border: 0; background: transparent; color: var(--body-muted); font-size: 11px; cursor: pointer; }
.savings-group-rename { display: flex; gap: 7px; margin: 8px 0; }
.savings-group-rename .apple-input { min-width: 0; flex: 1; }
.savings-group-list { min-height: 62px; }
.savings-group-list .savings-card:last-child { margin-bottom: 0; }
.savings-group-empty { display: grid; place-items: center; min-height: 62px; border: 1px dashed var(--hairline); border-radius: 13px; color: var(--body-muted); font-size: 12px; }
.savings-group.drop-active .savings-group-empty { border-color: var(--primary); color: var(--primary); }
.record-list.density-grid .savings-group-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.record-list.density-grid .savings-card, .savings-drag-ghost.density-grid { margin: 0; padding: 11px; border-radius: 17px; }
.record-list.density-grid .card-header, .savings-drag-ghost.density-grid .card-header { gap: 5px; }
.record-list.density-grid .goal-icon, .savings-drag-ghost.density-grid .goal-icon { width: 28px; height: 28px; flex-basis: 28px; font-size: 18px; border-radius: 10px; }
.record-list.density-grid .goal-heading h2, .savings-drag-ghost.density-grid .goal-heading h2 { font-size: 13px; }
.record-list.density-grid .goal-heading .caption, .savings-drag-ghost.density-grid .goal-heading .caption { display: none; }
.record-list.density-grid .card-amounts, .savings-drag-ghost.density-grid .card-amounts { margin-bottom: 8px; }
.record-list.density-grid .saved-amount, .savings-drag-ghost.density-grid .saved-amount { font-size: 19px; }
.record-list.density-grid .remaining, .savings-drag-ghost.density-grid .remaining { display: none; }
.record-list.density-grid .progress-caption, .savings-drag-ghost.density-grid .progress-caption { font-size: 10px; }
.record-list.density-grid .card-actions, .savings-drag-ghost.density-grid .card-actions { gap: 4px; }
.record-list.density-grid .card-actions .small-pill, .savings-drag-ghost.density-grid .card-actions .small-pill { padding: 7px; min-height: 34px; font-size: 11px; }
.record-list.density-grid .card-actions .more-button, .savings-drag-ghost.density-grid .card-actions .more-button { width: 28px; justify-content: center; font-size: 0; }
.record-list.density-rows .savings-card, .savings-drag-ghost.density-rows { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 8px; padding: 10px 12px; border-radius: 14px; }
.record-list.density-rows .card-header, .savings-drag-ghost.density-rows .card-header { margin: 0; }
.record-list.density-rows .goal-icon, .savings-drag-ghost.density-rows .goal-icon { width: 30px; height: 30px; flex-basis: 30px; font-size: 19px; }
.record-list.density-rows .goal-heading h2, .savings-drag-ghost.density-rows .goal-heading h2 { font-size: 14px; margin: 0; }
.record-list.density-rows .goal-heading .caption, .savings-drag-ghost.density-rows .goal-heading .caption { display: none; }
.record-list.density-rows .card-amounts, .savings-drag-ghost.density-rows .card-amounts { margin: 0; }
.record-list.density-rows .saved-amount, .savings-drag-ghost.density-rows .saved-amount { font-size: 17px; }
.record-list.density-rows .remaining, .savings-drag-ghost.density-rows .remaining, .record-list.density-rows .card-amounts .caption, .savings-drag-ghost.density-rows .card-amounts .caption { display: none; }
.record-list.density-rows .saving-track, .savings-drag-ghost.density-rows .saving-track { grid-column: 1 / -1; height: 5px; }
.record-list.density-rows .progress-caption, .savings-drag-ghost.density-rows .progress-caption { display: none; }
.record-list.density-rows .card-actions, .savings-drag-ghost.density-rows .card-actions { grid-column: 1 / -1; margin: 0; padding: 0; border: 0; }
.record-list.density-rows .card-actions .small-pill, .savings-drag-ghost.density-rows .card-actions .small-pill { min-height: 30px; padding: 4px 8px; font-size: 11px; }
@media (min-width: 900px) { .record-list.density-grid .savings-group-list { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.savings-card { position: relative; padding: 14px; margin-bottom: 16px; border-radius: 22px; border: 1px solid var(--hairline); background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 4%, var(--canvas)), var(--canvas) 65%); box-shadow: 0 5px 18px #152b4610; }
.card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }.goal-icon { display: inline-flex; flex: 0 0 40px; width: 40px; height: 40px; align-items: center; justify-content: center; overflow: hidden; white-space: nowrap; border-radius: 15px; background: color-mix(in srgb, var(--primary) 12%, var(--canvas)); color: var(--primary); font-size: 27px; }
.goal-icon.has-label { font-size: 22px; line-height: 1; }
.goal-icon.multi-label { font-size: 14px; letter-spacing: -1px; }
.record-list.density-grid .goal-icon.has-label, .savings-drag-ghost.density-grid .goal-icon.has-label { font-size: 18px; }
.record-list.density-grid .goal-icon.multi-label, .savings-drag-ghost.density-grid .goal-icon.multi-label { font-size: 11px; }
.record-list.density-rows .goal-icon.has-label, .savings-drag-ghost.density-rows .goal-icon.has-label { font-size: 19px; }
.record-list.density-rows .goal-icon.multi-label, .savings-drag-ghost.density-rows .goal-icon.multi-label { font-size: 12px; }
.goal-heading { flex: 1; min-width: 0; }.goal-heading h2 { font-size: 16px; line-height: 1.4; margin: 0 0 4px; overflow-wrap: anywhere; }.goal-heading .caption { font-size: 11px; }
.drag-handle { width: 44px; height: 44px; padding: 10px 14px; border: 0; border-radius: 12px; background: transparent; color: var(--body-muted); flex-shrink: 0; cursor: grab; touch-action: none !important; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }.drag-handle svg { width: 16px; height: 24px; fill: currentColor; }.drag-handle:active { background: var(--divider-soft); }.drag-handle:disabled { opacity: .3; cursor: default; }
.card-amounts { display: flex; justify-content: space-between; align-items: end; gap: 12px; margin-bottom: 14px; }.card-amounts > div { min-width: 0; }.saved-amount { display: block; margin-top: 4px; font-size: 28px; line-height: 1.2; font-variant-numeric: tabular-nums; letter-spacing: -.5px; overflow-wrap: anywhere; }.remaining { color: var(--primary); font-size: 12px; text-align: right; max-width: 45%; overflow-wrap: anywhere; }
.saving-track { height: 9px; border-radius: 9px; overflow: hidden; background: var(--divider-soft); }.saving-track > span { display: block; height: 100%; background: var(--primary); border-radius: inherit; }.progress-caption { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; font-size: 12px; color: var(--body-muted); overflow-wrap: anywhere; }
.card-actions { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--divider-soft); padding-top: 8px; margin-top: 10px; }.small-pill { display: inline-flex; align-items: center; justify-content: center; gap: 3px; padding: 9px 18px; min-height: 40px; font-size: 13px; white-space: nowrap; }.small-pill svg, .more-button svg { flex: 0 0 auto; }.more-wrap { margin-left: auto; position: relative; }.more-button { display: inline-flex; align-items: center; gap: 2px; min-height: 44px; padding: 6px; color: var(--body-muted); border: 0; background: none; cursor: pointer; white-space: nowrap; }
.card-menu { position: absolute; right: 0; bottom: 100%; width: 132px; z-index: 5; background: var(--canvas); border: 1px solid var(--hairline); border-radius: 14px; padding: 5px; box-shadow: 0 8px 30px #0002; }.card-menu button { display: block; width: 100%; min-height: 44px; border: 0; border-radius: 9px; background: none; color: var(--ink); text-align: left; padding: 10px 14px; cursor: pointer; }.card-menu button:hover { background: var(--divider-soft); }.card-menu .destructive { color: #cc344d; }
.savings-page button:disabled { opacity: .4; cursor: default; }.savings-page button:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }.cleared .goal-icon { background: #e5f5eb; color: #288052; }.cleared .remaining { color: #288052; }
.empty-state { text-align: center; padding: 48px 0; color: var(--body-muted); font-size: 14px; }.empty-state > span { font-size: 34px; }
.savings-card-move { transition: transform .22s cubic-bezier(0.2, 0, 0, 1); }
.drag-placeholder { border: 2px dashed color-mix(in srgb, var(--primary) 70%, var(--canvas)); background: color-mix(in srgb, var(--primary) 8%, var(--canvas)); box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--primary) 4%, transparent); transform: scale(0.985); transition: transform 0.18s ease, border-color 0.18s ease; }
.drag-placeholder > * { visibility: hidden; }
.drag-placeholder::after { content: '松手放在这里'; position: absolute; inset: 0; display: grid; place-items: center; color: var(--primary); font-size: 13px; font-weight: 600; }
.savings-drag-ghost {
  position: fixed;
  z-index: 10000;
  pointer-events: none;
  box-sizing: border-box;
  padding: 14px;
  border: 1px solid var(--primary);
  border-radius: 22px;
  background: var(--canvas);
  color: var(--ink);
  margin: 0;
  box-shadow: 0 16px 40px #152b4638;
  transform: scale(1.025);
  overflow: hidden;
  will-change: top, left, transform;
  animation: savings-lift 0.15s cubic-bezier(0.2, 0, 0, 1) both;
}
.savings-group-drag-ghost { position: fixed; z-index: 10000; pointer-events: none; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--primary); border-radius: 12px; background: var(--canvas); color: var(--ink); box-shadow: 0 12px 30px #152b4630; transform: scale(1.02); will-change: top, left, transform; }
.savings-group-drag-ghost strong { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.savings-group-drag-ghost span { flex-shrink: 0; color: var(--body-muted); font-size: 11px; }
.savings-group-drag-ghost .group-drag-ghost-handle { font-size: 19px; letter-spacing: -4px; padding-right: 5px; }
.savings-group-drag-ghost.is-lifting, .savings-group-drag-ghost.is-dragging { transition: none; }
.savings-group-drag-ghost.is-settling, .savings-group-drag-ghost.is-returning { transform: scale(1); transition: top .18s cubic-bezier(0.2, 0, 0, 1), left .18s cubic-bezier(0.2, 0, 0, 1), transform .18s ease; }
.savings-group-drag-ghost.is-returning { opacity: .7; }
.savings-drag-ghost .ghost-handle { display: inline-flex; align-items: center; justify-content: center; }
.savings-drag-ghost .card-actions > span { display: inline-flex; align-items: center; }
.savings-drag-ghost .card-actions .more-wrap { margin-left: auto; }
@keyframes savings-lift { from { transform: scale(1); box-shadow: 0 5px 18px #152b4610; } to { transform: scale(1.025); box-shadow: 0 16px 40px #152b4638; } }
.savings-drag-ghost.is-lifting,
.savings-drag-ghost.is-dragging {
  /* Only scale and shadow animate. Pointer position stays synchronous. */
  transition: none !important;
}
.savings-drag-ghost.is-settling {
  animation: none;
  transform: scale(1);
  box-shadow: 0 4px 12px rgba(15, 35, 60, 0.08);
  transition: top 0.18s cubic-bezier(0.2, 0, 0, 1), left 0.18s cubic-bezier(0.2, 0, 0, 1), transform 0.18s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.18s ease !important;
}
.savings-drag-ghost.is-returning {
  animation: none;
  transform: scale(1);
  opacity: 0.75;
  box-shadow: 0 4px 12px rgba(15, 35, 60, 0.08);
  transition: top 0.18s cubic-bezier(0.2, 0, 0, 1), left 0.18s cubic-bezier(0.2, 0, 0, 1), transform 0.18s cubic-bezier(0.2, 0, 0, 1), opacity 0.18s ease !important;
}
.savings-drag-ghost.is-invalid { border-color: #cf5266; box-shadow: 0 8px 26px #cf526633; }
.order-toast { position: fixed; bottom: max(30px, env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%); z-index: 10001; display: flex; align-items: center; gap: 20px; padding: 10px 18px; border-radius: 16px; background: var(--ink); color: var(--canvas); box-shadow: 0 8px 30px #0002; white-space: nowrap; }.order-toast button { background: none; border: 0; color: inherit; font-weight: 700; min-height: 44px; padding: 0 8px; text-decoration: underline; }
@media (prefers-reduced-motion: reduce) {
  .savings-card-move, .savings-group-move { transition: none; }
  .savings-drag-ghost { transform: none; transition: none; animation: none; }
  .savings-group-drag-ghost { transform: none; transition: none; }
  .drag-placeholder { transform: none; transition: none; }
}
.apple-modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(5px); z-index: 9999; display: flex; align-items: center; justify-content: center; }
.apple-modal-card { background: var(--canvas); border-radius: 18px; padding: 32px 24px; width: 90%; max-width: 400px; box-shadow: 0 20px 40px rgba(0,0,0,0.15); max-height: 85vh; overflow-y: auto; }
.modal-title { font-size: 26px; text-align: center; margin-bottom: 24px; letter-spacing: -0.28px; }
.form-stack { display: flex; flex-direction: column; gap: 16px; }
.apple-modal-card .form-stack { gap: 12px; }
.apple-modal-card .form-stack .input-group { margin-bottom: 0; }
.input-group label { display: block; margin-bottom: 6px; color: var(--body-muted); }
.input-group { margin-bottom: 12px; }
.modal-buttons { margin-top: 16px; display: flex; flex-direction: column; gap: 16px; }
.full-width { width: 100%; }
.view-list { display: flex; flex-direction: column; }
.view-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-soft); }
.view-item:last-child { border-bottom: none; }
</style>
