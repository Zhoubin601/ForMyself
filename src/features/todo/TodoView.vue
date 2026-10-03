<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { TodoNative } from './todoRepository.js'
import { useTodoStore } from './todoStore.js'
import { addDays, earliestTodoChange, formatLocalDate, getTodoDay, parseLocalDate } from './todoCore.js'
import { useSettingsStore } from '../../stores/settings.js'
import { appAlert, appChoose, appConfirm, appToast } from '../../services/uiFeedback.js'
import { registerBackHandler } from '../../services/backNavigation.js'
import AppDateField from '../../components/AppDateField.vue'
import AppTimeField from '../../components/AppTimeField.vue'
import TodoProgressCard from './TodoProgressCard.vue'
import { recurrenceSummary } from './todoPresentation.js'

const store = useTodoStore()
const settings = useSettingsStore()
const date = ref(formatLocalDate())
const tab = ref('day')
const open = ref(false)
const busy = ref(false)
const error = ref('')
const editing = ref(null)
const noteExpanded = ref(false)
const errorCode = ref('')
const viewport = reactive({ height: window.innerHeight, top: 0 })
const nativeViewportHeight = ref(Infinity)
let nativeViewportListener, mounted = true
const scope = ref('future')
const form = reactive({ title:'', note:'', startDate:'', endsOn:'', type:'none', weekdays:[], intervalDays:2, time:'', reminder:false })
const items = computed(() => getTodoDay(store.snapshot, date.value))
const targetTaskId = computed(() => date.value === settings.todoTarget.date ? settings.todoTarget.item : '')
const plans = computed(() => [...store.snapshot.tasks].reverse())
const weekdayLabels = ['日','一','二','三','四','五','六']
const labels = { none:'仅一天', daily:'每天', weekly:'每周', custom:'每隔几天' }
const ruleSummary = computed(() => recurrenceSummary({type:form.type, weekdays:form.weekdays, intervalDays:form.intervalDays}))
const historyMin = computed(() => editing.value ? earliestTodoChange(store.snapshot, editing.value.taskId) : '')
const routeTarget = () => {
  if (settings.todoTarget.date && parseLocalDate(settings.todoTarget.date)) date.value = settings.todoTarget.date
  tab.value = 'day'
  void nextTick(() => {
    if (!targetTaskId.value) return
    const row = document.querySelector(`.todo-page .todo-task-row[data-task-id="${CSS.escape(targetTaskId.value)}"]`)
    row?.scrollIntoView({block:'center',behavior:'auto'})
    row?.querySelector('.todo-task-title')?.focus({preventScroll:true})
  })
}
watch(() => settings.todoTarget, routeTarget, { deep:true, immediate:true })
watch(() => store.today, (next, previous) => { if (date.value === previous) date.value = next })
onActivated(() => { void store.load(); routeTarget() })
const unregister = registerBackHandler(() => { open.value=false; return true }, { priority:600, isActive:() => open.value && settings.currentView === 'todo' })
const updateViewport = () => {
  viewport.height = Math.min(window.visualViewport?.height || window.innerHeight, nativeViewportHeight.value)
  viewport.top = window.visualViewport?.offsetTop || 0
  void nextTick(() => {
    if (document.activeElement?.closest('.todo-editor-body')) document.activeElement.scrollIntoView?.({ block:'nearest', behavior:'auto' })
  })
}
const detachViewport = () => {
  window.visualViewport?.removeEventListener('resize', updateViewport)
  window.visualViewport?.removeEventListener('scroll', updateViewport)
  window.removeEventListener('resize', updateViewport)
}
watch(open, value => {
  detachViewport()
  if (value) {
    updateViewport()
    window.visualViewport?.addEventListener('resize', updateViewport)
    window.visualViewport?.addEventListener('scroll', updateViewport)
    window.addEventListener('resize', updateViewport)
  }
})
watch(() => form.time, value => { if (!value) form.reminder=false })
const readNativeViewport = size => {
  nativeViewportHeight.value = size.heightPx > 0 ? size.heightPx / window.devicePixelRatio : Infinity
  if (open.value) updateViewport()
}
onMounted(async () => {
  if (Capacitor.getPlatform() !== 'android') return
  try {
    const listener = await TodoNative.addListener('viewportChanged', readNativeViewport)
    if (!mounted) { void listener.remove(); return }
    nativeViewportListener = listener
    readNativeViewport(await TodoNative.viewport())
  } catch { /* Browser preview and older native bridges retain visualViewport support. */ }
})
onBeforeUnmount(() => { mounted=false; unregister(); detachViewport(); void nativeViewportListener?.remove() })

const handleError = e => {
  errorCode.value=e.code || ''
  const messages = { TODO_TITLE_REQUIRED:'请输入任务名称', TODO_WEEKDAY_REQUIRED:'请选择至少一个星期', TODO_INTERVAL_INVALID:'间隔天数需为 1～365 的整数', TODO_DATE_RANGE_INVALID:'结束日期不能早于开始日期', TODO_OCCURRENCE_NOT_FOUND:'该日期已无此任务，请刷新后重试', TODO_COMPLETION_PROTECTED:'已打卡任务不能删除，可先撤销完成' }
  error.value = e.code === 'TODO_HISTORY_PROTECTED' ? `已有打卡记录，最早可从 ${e.earliestDate} 起修改，请重新选择生效日期` : messages[e.code] || e.message || '保存失败，请重试'
  void nextTick(() => document.querySelector('.todo-editor [role="alert"]')?.scrollIntoView?.({block:'nearest',behavior:'auto'}))
}
const chooseScope = async (action, item) => item.recurrence.type === 'none' ? 'single' : appChoose({ title:`${action}重复任务`, options:[{ value:'single', label:'仅本次', description:'只影响这个日期' }, { value:'future', label:'本次及以后', description:'保留此前历史，建立新的任务版本' }] })
const showEditor = async (item = null) => {
  error.value=''; errorCode.value=''
  scope.value = item ? await chooseScope('编辑', item) : 'future'
  if (!scope.value) return
  editing.value=item
  Object.assign(form, { title:item?.title || '', note:item?.note || '', startDate:item?.date || date.value,
    endsOn:item?.endsOn || '', type:item?.recurrence.type || 'none', weekdays:[...(item?.recurrence.weekdays || [])], intervalDays:item?.recurrence.intervalDays || 2,
    time:item?.time || '', reminder:item?.reminder || false })
  noteExpanded.value=Boolean(form.note)
  open.value=true
}
const save = async () => {
  busy.value=true; error.value=''; errorCode.value=''
  try {
    const changes = { title:form.title, note:form.note, time:form.time, reminder:form.reminder }
    if (scope.value !== 'single' || !editing.value) Object.assign(changes, { startDate:form.startDate, endsOn:form.endsOn,
      recurrence:{ type:form.type, weekdays:form.weekdays, intervalDays:Number(form.intervalDays) } })
    if (editing.value) await store.edit(editing.value.taskId, scope.value === 'single' ? editing.value.date : form.startDate, changes, scope.value)
    else await store.add(changes)
    open.value=false
    date.value=form.startDate
    if (form.reminder) {
      try { await store.syncReminders(true) } catch (e) { appToast(e.message, { tone:'warning' }) }
    }
    appToast('待办已保存')
  } catch(e) { handleError(e) }
  finally { busy.value=false }
}
const complete = async item => {
  busy.value=true
  try { await store.complete(item.taskId, item.date, !item.completed) }
  catch(e) { handleError(e); void appAlert(error.value) }
  finally { busy.value=false }
}
const remove = async () => {
  if (!editing.value || !await appConfirm(scope.value === 'single' ? '取消这一天的任务？' : '停止这个版本从所选日期起的安排？此前历史会保留。', { destructive:true })) return
  busy.value=true
  try { await store.remove(editing.value.taskId, scope.value === 'single' ? editing.value.date : form.startDate, scope.value); open.value=false }
  catch(e) { handleError(e) }
  finally { busy.value=false }
}
const openPlan = task => {
  let target = task.startDate > store.today ? task.startDate : store.today
  if (task.endsOn && target > task.endsOn) target=task.endsOn
  const direction = task.endsOn && task.endsOn < store.today ? -1 : 1
  for (let n=0; n<366; n++) {
    const found=getTodoDay(store.snapshot, target).find(i => i.taskId === task.id)
    if (found) { date.value=target; void showEditor(found); return }
    target=addDays(target, direction)
  }
  void appAlert('该版本已停止安排，历史与打卡记录仍保留')
}
const pickRecurrence = async () => { const value = await appChoose({ title:'重复规则', options:Object.entries(labels).map(([value,label]) => ({value,label})) }); if (value) form.type=value }
const toggleDay = day => { form.weekdays = form.weekdays.includes(day) ? form.weekdays.filter(d => d !== day) : [...form.weekdays,day].sort() }
</script>

<template>
  <div class="todo-page">
    <div class="todo-toolbar"><div class="todo-tabs"><button :class="{ active:tab==='day' }" @click="tab='day'">每日待办</button><button :class="{ active:tab==='plans' }" @click="tab='plans'">计划管理</button></div><button class="todo-add" :disabled="!store.isDataLoaded" @click="showEditor()">＋ 新建</button></div>
    <p v-if="store.loadError" class="todo-error">待办加载失败，原数据未覆盖。<button @click="store.load()">重试</button></p>
    <p v-if="store.reminderError" class="todo-warning">{{ store.reminderError }}</p>
    <template v-if="tab==='day'">
      <div class="todo-date-bar"><button aria-label="前一天" @click="date=addDays(date,-1)">‹</button><AppDateField v-model="date" aria-label="待办日期" /><button aria-label="后一天" @click="date=addDays(date,1)">›</button><button @click="date=store.today">今天</button></div>
      <TodoProgressCard :items="items" :target-task-id="targetTaskId" :label="date === store.today ? '今日待办' : `${date} 待办`" :disabled="busy" @complete="complete" @edit="showEditor" @open="showEditor()" />
    </template>
    <div v-else class="todo-plans">
      <p v-if="!plans.length" class="todo-empty">还没有计划，先安排一件小事吧。</p>
      <button v-for="task in plans" :key="task.id" class="todo-plan" @click="openPlan(task)"><span><strong>{{ task.title }}</strong><small>{{ recurrenceSummary(task.recurrence) }} · {{ task.startDate }}{{ task.endsOn ? ` ～ ${task.endsOn}` : ' 起' }}</small><small v-if="task.parentTaskId">修改后的版本 · 历史已保留</small></span><span>{{ task.archived || task.endsOn && task.endsOn < store.today ? '历史' : '›' }}</span></button>
    </div>
    <Teleport to="body">
      <div v-if="open" class="todo-editor-overlay" :style="{ top:`${viewport.top}px`, height:`${viewport.height}px` }" @click.self="!busy && (open=false)">
        <form class="todo-editor" :style="{ maxHeight:`${viewport.height * .88}px` }" role="dialog" aria-modal="true" :aria-label="editing ? '编辑待办' : '新建待办'" @submit.prevent="save">
          <header><button type="button" :disabled="busy" @click="open=false">取消</button><strong>{{ editing ? '编辑待办' : '新建待办' }}</strong><button type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存' }}</button></header>
          <div class="todo-editor-body">
            <p v-if="editing" class="todo-hint">{{ scope==='single' ? '仅修改这一天，打卡状态会保留' : '修改后创建新版本，旧名称和打卡历史保留' }}</p>
            <fieldset :disabled="busy">
              <label class="todo-name-label" for="todo-title">任务名称</label>
              <input id="todo-title" v-model="form.title" class="todo-name-input" maxlength="80" placeholder="今天想完成什么？" required />
              <section class="todo-form-section" aria-label="安排">
                <h4>安排</h4>
                <div class="todo-field-group">
                  <template v-if="!editing || scope!=='single'">
                    <div class="todo-field-row"><span>{{ editing ? '生效日期' : '开始日期' }}</span><AppDateField v-model="form.startDate" :min="historyMin" :aria-label="editing ? '新版本生效日期' : '开始日期'" /></div>
                    <p v-if="editing && historyMin" class="todo-field-hint">已有打卡记录，最早可从 {{ historyMin }} 起修改。</p>
                    <p v-if="error && errorCode==='TODO_HISTORY_PROTECTED'" class="todo-error todo-field-hint" role="alert">{{ error }}</p>
                    <div class="todo-field-row"><span>重复</span><button type="button" class="todo-recurrence-picker" @click="pickRecurrence">{{ ruleSummary }} <span aria-hidden="true">›</span></button></div>
                    <div v-if="form.type==='weekly'" class="todo-weekdays"><button v-for="(name,day) in weekdayLabels" :key="day" type="button" :class="{ active:form.weekdays.includes(day) }" :aria-label="`星期${name}`" :aria-pressed="form.weekdays.includes(day)" @click="toggleDay(day)">{{ name }}</button></div>
                    <label v-if="form.type==='custom'" class="todo-field-row"><span>间隔天数</span><input v-model.number="form.intervalDays" aria-label="间隔天数" type="number" min="1" max="365" step="1" required /><span class="todo-unit">天</span></label>
                  </template>
                  <div v-else class="todo-field-row"><span>本次日期</span><span class="todo-field-value">{{ editing.date }}</span></div>
                  <div class="todo-field-row"><span>时间</span><AppTimeField v-model="form.time" empty-label="不设置" aria-label="待办时间" /><button v-if="form.time" type="button" class="todo-clear-time" aria-label="清除时间" @click="form.time=''">×</button></div>
                  <label v-if="form.time" class="todo-field-row"><span>到时间通知我</span><input v-model="form.reminder" class="todo-switch" type="checkbox" role="switch" /></label>
                </div>
              </section>
              <section class="todo-form-section" aria-label="补充">
                <h4>补充</h4>
                <div class="todo-field-group">
                  <button type="button" class="todo-field-row todo-note-toggle" :aria-expanded="noteExpanded" @click="noteExpanded=!noteExpanded"><span>备注</span><span class="todo-field-value">{{ noteExpanded ? '收起' : form.note ? '查看备注' : '添加备注' }} <span aria-hidden="true">›</span></span></button>
                  <label v-if="noteExpanded" class="todo-note-body"><span class="todo-sr-only">备注内容</span><textarea v-model="form.note" maxlength="1000" rows="2" placeholder="补充一点说明（可选）" /></label>
                  <template v-if="!editing || scope!=='single'">
                    <label class="todo-field-row"><span>设置结束日期</span><input class="todo-switch" type="checkbox" role="switch" :checked="Boolean(form.endsOn)" @change="form.endsOn = form.endsOn ? '' : form.startDate" /></label>
                    <div v-if="form.endsOn" class="todo-field-row"><span>结束日期</span><AppDateField v-model="form.endsOn" :min="form.startDate" aria-label="结束日期" /></div>
                  </template>
                </div>
              </section>
            </fieldset>
            <p v-if="error && errorCode!=='TODO_HISTORY_PROTECTED'" class="todo-error" role="alert">{{ error }}</p>
            <button v-if="editing" type="button" class="todo-delete" :disabled="busy" @click="remove">{{ scope==='single' ? '取消这一天的任务' : '停止后续安排' }}</button>
          </div>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.todo-page { max-width:680px; margin:0 auto; padding:8px 0 28px; }.todo-toolbar { display:flex; align-items:center; gap:10px; justify-content:space-between; margin-bottom:18px; }.todo-tabs { display:flex; padding:4px; border-radius:16px; background:#ffffff80; }.todo-tabs button { border:0; background:none; color:var(--text-secondary,#747c8d); padding:11px; border-radius:12px; font-size:13px; }.todo-tabs button.active { background:#fff; color:#21574b; box-shadow:0 2px 6px #00000008; }.todo-add { padding:12px; border:0; border-radius:14px; background:#d8f0e8; color:#21574b; font-weight:700; white-space:nowrap; }
.todo-date-bar { display:flex; align-items:center; gap:8px; margin-bottom:16px; }.todo-date-bar > button { flex-shrink:0; background:#fff8; border:0; border-radius:12px; min-width:40px; height:44px; }.todo-date-bar :deep(.app-date-field) { flex:1; min-width:0; border:0; border-radius:12px; background:#fff8; padding:10px; height:44px; font-size:13px; }.todo-plan { display:flex; align-items:center; justify-content:space-between; gap:16px; text-align:left; width:100%; padding:18px; margin-bottom:10px; border:1px solid #00000008; background:#ffffffb0; border-radius:20px; color:var(--text-primary,#172033); }.todo-plan strong { display:block; overflow-wrap:anywhere; }.todo-plan small { display:block; margin-top:7px; color:#747c8d; line-height:1.5; font-size:11px; }
.todo-empty,.todo-hint { color:#747c8d; line-height:1.6; font-size:12px; }.todo-error { color:#bc3547; font-size:13px; line-height:1.6; }.todo-warning { color:#8d621c; font-size:12px; }
.todo-editor-overlay { position:fixed; left:0; right:0; z-index:3500; background:#13202170; display:flex; align-items:flex-end; justify-content:center; }
.todo-editor { width:100%; max-width:580px; max-height:88dvh; box-sizing:border-box; border-radius:24px 24px 0 0; background:#f5f8f7; color:#172033; display:flex; flex-direction:column; padding-bottom:env(safe-area-inset-bottom); overflow:hidden; }
.todo-editor header { flex-shrink:0; padding:8px 12px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #00000009; }
.todo-editor header button { min-height:48px; min-width:48px; background:none; border:0; color:#247365; font-size:14px; padding:8px; }
.todo-editor-body { padding:16px; overflow-y:auto; overscroll-behavior:contain; min-height:0; }
.todo-editor fieldset { border:0; padding:0; margin:0; min-width:0; }
.todo-name-label { display:block; font-size:12px; color:#657a74; margin-bottom:6px; }
.todo-name-input { width:100%; min-height:48px; box-sizing:border-box; padding:12px; border:1px solid #dce5e1; border-radius:12px; background:white; font:inherit; font-size:16px; color:#172033; }
.todo-form-section { margin-top:12px; }.todo-form-section h4 { margin:0 0 6px 4px; color:#657a74; font-size:12px; font-weight:500; }
.todo-field-group { border:1px solid #e4ebe7; border-radius:14px; background:white; overflow:hidden; }
.todo-field-row { display:flex; align-items:center; gap:8px; min-height:48px; padding:0 12px; box-sizing:border-box; color:#172033; font-size:14px; }
.todo-field-row + .todo-field-row { border-top:1px solid #edf1ee; }.todo-field-row > span:first-child { flex-shrink:0; }
.todo-field-value { margin-left:auto; text-align:right; color:#52786b; }
.todo-field-row :deep(.app-date-field),.todo-field-row :deep(.app-time-field),.todo-recurrence-picker { flex:1; min-width:0; min-height:48px; border:0; border-radius:0; background:none; padding:8px 0 8px 8px; box-sizing:border-box; font:inherit; color:#52786b; text-align:right; justify-content:flex-end; }
.todo-recurrence-picker { display:flex; align-items:center; justify-content:flex-end; gap:8px; }.todo-recurrence-picker > span { font-size:20px; }
.todo-clear-time { min-width:44px; min-height:48px; margin-right:-8px; border:0; background:none; color:#7b8c85; font-size:22px; }
.todo-field-row input[type=number] { min-width:0; flex:1; height:48px; border:0; padding:8px 0; background:none; font:inherit; color:#52786b; text-align:right; }.todo-unit { color:#7b8c85; }
.todo-switch { margin-left:auto; flex:0 0 36px; width:36px; height:22px; appearance:none; border-radius:20px; background:#dce5e0; position:relative; cursor:pointer; }
.todo-switch::after { content:''; position:absolute; width:18px; height:18px; top:2px; left:2px; border-radius:50%; background:white; box-shadow:0 1px 3px #0002; }.todo-switch:checked { background:#315956; }.todo-switch:checked::after { left:16px; }.todo-switch:focus-visible { outline:2px solid #52786b; outline-offset:4px; }
.todo-note-toggle { width:100%; text-align:left; background:none; border:0; }.todo-note-body { display:block; padding:0 12px 12px; }.todo-note-body textarea { width:100%; min-height:64px; box-sizing:border-box; resize:vertical; padding:10px; border:1px solid #dce5e1; border-radius:10px; background:#f8faf9; font:inherit; font-size:14px; color:#172033; }
.todo-weekdays { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:3px; padding:0 8px 8px; }.todo-weekdays button { min-height:48px; border:0; border-radius:10px; background:#edf2ef; color:#52786b; }.todo-weekdays .active { background:#315956; color:white; }
.todo-field-hint { margin:0; padding:0 12px 10px; color:#7a8983; font-size:11px; line-height:1.5; }.todo-field-hint.todo-error { color:#bc3547; }
.todo-delete { width:100%; margin-top:12px; min-height:48px; padding:12px; border:0; border-radius:14px; color:#bc3547; background:#f8e7e9; }
.todo-sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
button:disabled { opacity:.5; }
</style>
