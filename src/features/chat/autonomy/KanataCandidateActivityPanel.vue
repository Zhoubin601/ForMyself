<script setup>
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import AppTimeField from '../../../components/AppTimeField.vue'
import { registerBackHandler } from '../../../services/backNavigation.js'

const props = defineProps({ model: { type: Object, required: true }, worldId: { type: String, required: true }, archived: Boolean })
const emit = defineEmits(['updated'])
const config = shallowRef(null)
const actors = shallowRef(null)
const schedules = shallowRef(null)
const flags = ref({ autonomyEnabled: false, proactiveEnabled: false, notificationsEnabled: false })
const policy = ref(null)
const actorFlags = ref([])
const scheduleDraft = ref(null)
const busy = ref(false)
const notice = ref('')
const error = ref('')
const weekdays = [
  { id: 1, label: '一' }, { id: 2, label: '二' }, { id: 3, label: '三' },
  { id: 4, label: '四' }, { id: 5, label: '五' }, { id: 6, label: '六' }, { id: 7, label: '日' },
]
const removedScheduleIds = new Set()
let active = true
let generation = 0

async function perform(action, message) {
  if (busy.value) return
  const version = ++generation
  const guard = () => {
    if (!active || version !== generation) throw new Error('KANATA_ACTIVITY_OWNER_EXPIRED')
  }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await action(guard)
    guard()
    if (message) notice.value = message
    return result
  } catch (failure) {
    if (active && version === generation) {
      error.value = failure?.code === 'NOTIFICATION_PERMISSION_DENIED'
        ? '系统通知权限未授予，已保持关闭。'
        : '自治活动操作未完成，请检查版本或输入后再试。'
    }
    return null
  } finally {
    if (active && version === generation) busy.value = false
  }
}

function load() {
  void perform(async guard => {
    const [cfg, actorPage, schedulePage] = await Promise.all([
      props.model.readConfig(guard),
      props.model.actorFlagsPage('', guard),
      props.model.schedulesPage('', guard),
    ])
    guard()
    removedScheduleIds.clear()
    config.value = cfg
    flags.value = {
      autonomyEnabled: cfg.world.autonomyEnabled,
      proactiveEnabled: cfg.world.proactiveEnabled,
      notificationsEnabled: cfg.world.notificationsEnabled,
    }
    policy.value = { ...cfg.policy }
    actors.value = actorPage
    actorFlags.value = actorPage.entries.map(item => ({ ...item }))
    schedules.value = schedulePage
  })
}

function loadMoreActors() {
  const cursor = actors.value?.cursor
  if (!cursor) return
  void perform(async guard => {
    const page = await props.model.actorFlagsPage(cursor, guard)
    guard()
    const seen = new Set(actorFlags.value.map(item => item.id))
    const merged = [...actorFlags.value, ...page.entries.filter(item => !seen.has(item.id)).map(item => ({ ...item }))]
    actorFlags.value = merged
    actors.value = { entries: [...(actors.value?.entries || []), ...page.entries.filter(item => !seen.has(item.id))], cursor: page.cursor }
  })
}

function loadMoreSchedules() {
  const cursor = schedules.value?.cursor
  if (!cursor) return
  void perform(async guard => {
    const page = await props.model.schedulesPage(cursor, guard)
    guard()
    const current = schedules.value?.entries || []
    const seen = new Set(current.map(item => item.id))
    const additions = page.entries.filter(item => !seen.has(item.id) && !removedScheduleIds.has(item.id))
    schedules.value = { entries: [...current, ...additions], cursor: page.cursor }
  })
}

function saveFlags() {
  if (!config.value || props.archived) return
  const revision = config.value.world.revision
  const payload = { ...flags.value }
  void perform(async guard => {
    await props.model.setActivity(payload, revision, guard)
    const next = await props.model.readConfig(guard)
    guard()
    config.value = next
    emit('updated')
  }, '世界的三项独立开关已保存。')
}

function saveConfig() {
  if (!config.value || !policy.value || props.archived || !schedules.value) return
  const revision = config.value.world.revision
  const basePolicy = { ...policy.value, dailyDialogueLimit: Number(policy.value.dailyDialogueLimit), maxCatchUpHours: Number(policy.value.maxCatchUpHours) }
  void perform(async guard => {
    let mergedActors = actorFlags.value.map(item => ({ id: item.id, autonomyEnabled: Boolean(item.autonomyEnabled), proactiveEnabled: Boolean(item.proactiveEnabled) }))
    const actorIds = new Set(mergedActors.map(item => item.id))
    let nextActorCursor = actors.value?.cursor || null
    while (nextActorCursor) {
      const page = await props.model.actorFlagsPage(nextActorCursor, guard)
      guard()
      for (const item of page.entries) {
        if (!actorIds.has(item.id)) {
          actorIds.add(item.id)
          mergedActors.push({ id: item.id, autonomyEnabled: Boolean(item.autonomyEnabled), proactiveEnabled: Boolean(item.proactiveEnabled) })
        }
      }
      nextActorCursor = page.cursor
    }
    let mergedSchedules = [...schedules.value.entries]
    const scheduleIds = new Set(mergedSchedules.map(item => item.id))
    let nextScheduleCursor = schedules.value?.cursor || null
    while (nextScheduleCursor) {
      const page = await props.model.schedulesPage(nextScheduleCursor, guard)
      guard()
      for (const item of page.entries) {
        if (!scheduleIds.has(item.id) && !removedScheduleIds.has(item.id)) {
          scheduleIds.add(item.id)
          mergedSchedules.push(item)
        }
      }
      nextScheduleCursor = page.cursor
    }
    await props.model.configure({ policy: basePolicy, instanceFlags: mergedActors, schedules: mergedSchedules }, revision, guard)
    const [next, refreshedActors, refreshedSchedules] = await Promise.all([
      props.model.readConfig(guard),
      props.model.actorFlagsPage('', guard),
      props.model.schedulesPage('', guard),
    ])
    guard()
    removedScheduleIds.clear()
    config.value = next
    policy.value = { ...next.policy }
    actors.value = refreshedActors
    actorFlags.value = refreshedActors.entries.map(item => ({ ...item }))
    schedules.value = refreshedSchedules
    emit('updated')
  }, '角色开关与虚拟日程已保存。')
}

function editSchedule(entry) {
  if (!actors.value?.entries.length || props.archived) return
  const item = entry || {
    id: 'sched-' + crypto.randomUUID(),
    worldId: props.worldId,
    instanceId: actors.value.entries[0].id,
    days: [1, 2, 3, 4, 5],
    startMinute: 9 * 60,
    endMinute: 10 * 60,
    location: '',
    activity: '',
    resting: false,
    revision: 0,
  }
  const time = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
  scheduleDraft.value = { ...item, days: [...item.days], start: time(item.startMinute), end: item.endMinute === 1440 ? '23:59' : time(item.endMinute) }
}

function toggleScheduleDay(day) {
  if (!scheduleDraft.value) return
  const exists = scheduleDraft.value.days.includes(day)
  scheduleDraft.value.days = exists
    ? scheduleDraft.value.days.filter(d => d !== day)
    : [...scheduleDraft.value.days, day].sort((a, b) => a - b)
}

function removeScheduleDraft(id) {
  if (!schedules.value) return
  removedScheduleIds.add(id)
  schedules.value = { ...schedules.value, entries: schedules.value.entries.filter(s => s.id !== id) }
}

function keepSchedule() {
  const draft = scheduleDraft.value
  if (!draft || !schedules.value) return
  const minute = value => Number(value.split(':')[0]) * 60 + Number(value.split(':')[1])
  const startMinute = minute(draft.start)
  const endMinute = minute(draft.end)
  if (!draft.location.trim() || !draft.activity.trim() || !draft.days.length || startMinute >= endMinute) {
    error.value = '请填写地点、活动和至少一天，结束时间需要晚于开始时间。'
    return
  }
  const { start: _s, end: _e, ...fields } = draft
  const next = { ...fields, startMinute, endMinute, revision: draft.revision + 1 }
  removedScheduleIds.delete(next.id)
  const entries = [...schedules.value.entries]
  const idx = entries.findIndex(row => row.id === next.id)
  if (idx < 0) entries.push(next)
  else entries[idx] = next
  schedules.value = { ...schedules.value, entries }
  scheduleDraft.value = null
  notice.value = '日程已加入草稿，请保存角色与日程。'
}

function requestNotifications() {
  void perform(async () => {
    const res = await props.model.requestNotificationPermission()
    if (res !== 'granted') throw Object.assign(new Error('NOTIFICATION_PERMISSION_DENIED'), { code: 'NOTIFICATION_PERMISSION_DENIED' })
  }, '系统通知权限已允许。')
}

function runAdvance() {
  void perform(async guard => {
    const res = await props.model.advance(guard)
    guard()
    emit('updated')
    notice.value = `已有限补算 ${res.windows} 个时间窗口。`
  })
}

function runSocial() {
  void perform(async guard => {
    const res = await props.model.runSocial(guard)
    guard()
    emit('updated')
    notice.value = res.status === 'succeeded' ? '已完成一场角色间交流。' : '当前没有达到条件的角色间交流。'
  })
}

function runContact() {
  void perform(async guard => {
    const res = await props.model.runContact(guard)
    guard()
    emit('updated')
    notice.value = res.status === 'succeeded' ? '已生成并发送一次主动联系。' : '未到联系时间、处于免打扰或已过期。'
  })
}

const unregister = registerBackHandler(() => {
  if (!scheduleDraft.value) return false
  scheduleDraft.value = null
  return true
}, { priority: 615, isActive: () => Boolean(scheduleDraft.value) })

onBeforeUnmount(() => {
  active = false
  generation++
  props.model.cancel()
  unregister()
  scheduleDraft.value = null
  config.value = actors.value = schedules.value = policy.value = null
  actorFlags.value = []
})

load()
</script>

<template>
  <section v-if="config && policy" aria-label="候选世界自治管理">
    <h4>世界开关与自治调度</h4>
    <p v-if="notice" class="kanata-notice" role="status">{{ notice }}</p>
    <p v-if="error" class="kanata-error" role="alert">{{ error }}</p>
    <fieldset class="kanata-permission-fields" :disabled="busy||archived">
      <legend>三个独立开关</legend>
      <label class="kanata-check"><input v-model="flags.autonomyEnabled" type="checkbox" />自主世界发展</label>
      <label class="kanata-check"><input v-model="flags.proactiveEnabled" type="checkbox" />角色主动联系</label>
      <label class="kanata-check"><input v-model="flags.notificationsEnabled" type="checkbox" />本地通知</label>
    </fieldset>
    <div class="kanata-actions">
      <button type="button" :disabled="busy||archived" @click="saveFlags">保存世界开关</button>
      <button type="button" :disabled="busy||archived" @click="requestNotifications">请求系统通知权限</button>
    </div>
    <form class="kanata-form" aria-label="自治策略与虚拟日程" @submit.prevent="saveConfig">
      <label>每日交流上限<input v-model.number="policy.dailyDialogueLimit" type="number" min="0" max="4" :disabled="busy||archived" /></label>
      <label>单次最大补算小时<input v-model.number="policy.maxCatchUpHours" type="number" min="1" max="24" :disabled="busy||archived" /></label>
      <fieldset class="kanata-fieldset">
        <legend>自由度</legend>
        <div role="radiogroup" aria-label="自由度">
          <button v-for="opt in [{id:'strict',label:'严格'},{id:'standard',label:'标准'},{id:'free',label:'自由'},{id:'unrestricted',label:'完全自由'}]"
            :key="opt.id" type="button" :aria-pressed="policy.freedom===opt.id" :disabled="busy||archived"
            @click="policy.freedom=opt.id">
            {{ opt.label }}
          </button>
        </div>
      </fieldset>
      <fieldset class="kanata-fieldset">
        <legend>交流位置</legend>
        <div role="radiogroup" aria-label="交流位置">
          <button v-for="opt in [{id:'private',label:'独立角色会话'},{id:'group',label:'本世界现有群聊'}]"
            :key="opt.id" type="button" :aria-pressed="policy.socialChannel===opt.id" :disabled="busy||archived"
            @click="policy.socialChannel=opt.id">
            {{ opt.label }}
          </button>
        </div>
      </fieldset>
      <div v-for="member in actorFlags" :key="member.id" :data-autonomy-actor="member.id">
        <strong>{{ member.name }}</strong>
        <label><input v-model="member.autonomyEnabled" type="checkbox" :disabled="busy||archived" />允许自主活动</label>
        <label><input v-model="member.proactiveEnabled" type="checkbox" :disabled="busy||archived" />允许主动联系</label>
      </div>
      <button v-if="actors?.cursor" type="button" :disabled="busy" @click="loadMoreActors">下一页角色开关</button>
      <ul v-if="schedules">
        <li v-for="row in schedules.entries" :key="row.id">
          <span>{{ row.location }} · {{ row.activity }}</span>
          <button type="button" :disabled="busy||archived" @click="editSchedule(row)">编辑虚拟日程</button>
          <button type="button" :disabled="busy||archived" @click="removeScheduleDraft(row.id)">移除日程草稿</button>
        </li>
      </ul>
      <button v-if="schedules?.cursor" type="button" :disabled="busy" @click="loadMoreSchedules">下一页虚拟日程</button>
      <button type="button" :disabled="busy||archived||!actorFlags.length" @click="editSchedule(null)">添加虚拟日程</button>
      <button type="submit" :disabled="busy||archived">保存角色与日程</button>
    </form>
    <form v-if="scheduleDraft" class="kanata-form" aria-label="编辑虚拟日程" @submit.prevent="keepSchedule">
      <fieldset class="kanata-fieldset">
        <legend>角色</legend>
        <div role="radiogroup" aria-label="角色">
          <button v-for="member in actorFlags" :key="member.id" type="button"
            :aria-pressed="scheduleDraft.instanceId===member.id"
            @click="scheduleDraft.instanceId=member.id">
            {{ member.name }}
          </button>
        </div>
      </fieldset>
      <fieldset class="kanata-fieldset">
        <legend>生效星期</legend>
        <div role="group" aria-label="生效星期">
          <button v-for="day in weekdays" :key="day.id" type="button"
            :aria-pressed="scheduleDraft.days.includes(day.id)"
            @click="toggleScheduleDay(day.id)">
            周{{ day.label }}
          </button>
        </div>
      </fieldset>
      <label>虚拟地点<input v-model="scheduleDraft.location" maxlength="200" /></label>
      <label>活动内容<input v-model="scheduleDraft.activity" maxlength="200" /></label>
      <AppTimeField v-model="scheduleDraft.start" aria-label="开始时间" />
      <AppTimeField v-model="scheduleDraft.end" aria-label="结束时间" />
      <label><input v-model="scheduleDraft.resting" type="checkbox" />休息活动</label>
      <button type="submit">保留日程草稿</button>
      <button type="button" @click="scheduleDraft=null">取消日程编辑</button>
    </form>
    <div class="kanata-actions">
      <button type="button" :disabled="busy||archived||!config.world.autonomyEnabled" @click="runAdvance">现在有限补算</button>
      <button type="button" :disabled="busy||archived||!config.world.autonomyEnabled" @click="runSocial">生成角色交流</button>
      <button type="button" :disabled="busy||archived||!config.world.proactiveEnabled" @click="runContact">检查主动联系</button>
      <button v-if="busy" type="button" @click="model.cancel()">停止调度</button>
    </div>
  </section>
</template>
