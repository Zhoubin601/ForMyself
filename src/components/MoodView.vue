<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useMoodStore } from '../stores/mood'
import { useSettingsStore } from '../stores/settings'
import { askAI } from '../services/aiEngine'

const moodStore = useMoodStore()
const settingsStore = useSettingsStore()

onMounted(() => {
  if (!moodStore.isDataLoaded) moodStore.loadMoodRecords()
})

const MOOD_OPTIONS = [
  { key: 'great', emoji: '🤩', label: '超赞' },
  { key: 'good', emoji: '🙂', label: '开心' },
  { key: 'normal', emoji: '😐', label: '一般' },
  { key: 'bad', emoji: '😔', label: '低落' },
  { key: 'terrible', emoji: '😫', label: '极差' }
]

const MOOD_DEFAULT = 'normal'

const now = new Date()
const currentYear = ref(now.getFullYear())
const currentMonth = ref(now.getMonth() + 1)

const yearMonthLabel = computed(() => `${currentYear.value}年${currentMonth.value}月`)

const daysInMonth = computed(() => {
  return new Date(currentYear.value, currentMonth.value, 0).getDate()
})

const firstDayOffset = computed(() => {
  return new Date(currentYear.value, currentMonth.value - 1, 1).getDay()
})

const isCurrentMonth = computed(() => {
  const n = new Date()
  return currentYear.value === n.getFullYear() && currentMonth.value === n.getMonth() + 1
})

const prevMonth = () => {
  if (currentMonth.value === 1) { currentYear.value--; currentMonth.value = 12 }
  else currentMonth.value--
}

const nextMonth = () => {
  if (currentMonth.value === 12) { currentYear.value++; currentMonth.value = 1 }
  else currentMonth.value++
}

const getRecordForDay = (day) => {
  const dateStr = `${currentYear.value}-${String(currentMonth.value).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return moodStore.getRecordByDate(dateStr)
}

const getMoodEmoji = (day) => {
  const record = getRecordForDay(day)
  if (!record) return null
  return MOOD_OPTIONS.find(m => m.key === record.mood)?.emoji || null
}

const monthRecords = computed(() => {
  const prefix = `${currentYear.value}-${String(currentMonth.value).padStart(2, '0')}`
  return moodStore.moodRecords
    .filter(r => r.date.startsWith(prefix))
    .sort((a, b) => b.date.localeCompare(a.date))
})

const monthStats = computed(() => moodStore.getMonthStats(currentYear.value, currentMonth.value))

// --- 分页 ---
const PAGE_SIZE = 10
const moodPage = ref(1)

const totalMoodPages = computed(() => {
  return Math.ceil(monthRecords.value.length / PAGE_SIZE) || 1
})

const paginatedRecords = computed(() => {
  const start = (moodPage.value - 1) * PAGE_SIZE
  return monthRecords.value.slice(start, start + PAGE_SIZE)
})

watch(totalMoodPages, (n) => {
  if (moodPage.value > n) moodPage.value = n > 0 ? n : 1
})

// --- 弹窗 ---
const showModal = ref(false)
const editDate = ref('')
const editMood = ref(MOOD_DEFAULT)
const editNote = ref('')
const editingId = ref(null)

const openAddModal = () => {
  const n = new Date()
  const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
  editingId.value = null
  editDate.value = today
  // 检查今天是否有记录，有则显示已有记录
  const todayRecord = moodStore.getRecordByDate(editDate.value)
  if (todayRecord) {
    editingId.value = todayRecord.id
    editMood.value = todayRecord.mood
    editNote.value = todayRecord.note || ''
  } else {
    editMood.value = MOOD_DEFAULT
    editNote.value = ''
  }
  showModal.value = true
}

// 今日心情用于按钮显示
const todayMood = computed(() => {
  const n = new Date()
  const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
  return moodStore.getRecordByDate(today)
})
const todayMoodEmoji = computed(() => {
  if (!todayMood.value) return null
  const MOOD_MAP = { great: '🤩', good: '🙂', normal: '😐', bad: '😔', terrible: '😫' }
  return MOOD_MAP[todayMood.value.mood] || '😐'
})

const handleDayClick = (day) => {
  const dateStr = `${currentYear.value}-${String(currentMonth.value).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const record = getRecordForDay(day)
  if (record) {
    editingId.value = record.id
    editDate.value = record.date
    editMood.value = record.mood
    editNote.value = record.note || ''
  } else {
    editingId.value = null
    editDate.value = dateStr
    editMood.value = MOOD_DEFAULT
    editNote.value = ''
  }
  showModal.value = true
}

// --- AI 情绪回音壁 ---
const activeEcho = ref(null)
const isEchoThinking = ref(false)

const saveRecord = async () => {
  if (!editDate.value) return alert('请选择日期')
  if (editingId.value) {
    moodStore.updateRecord(editingId.value, { date: editDate.value, mood: editMood.value, note: editNote.value })
  } else {
    moodStore.addRecord(editDate.value, editMood.value, editNote.value)
  }
  showModal.value = false

  // 触发 AI 回音壁（仅有关键词且有笔记时）
  if (settingsStore.aiApiKey && (editNote.value || editMood.value !== 'normal')) {
    activeEcho.value = 'thinking'
    isEchoThinking.value = true
    try {
      const prompt = `用户今天的心情评级为 [${editMood.value}]，并写下了日记内容："${editNote.value || '（今日无文字记录）'}"。\n请站在温柔闺蜜/挚友的角度，写一句 30 字以内的贴心回音，给予充分的共情。`
      const echoText = await askAI(prompt)
      activeEcho.value = echoText
    } catch (e) {
      activeEcho.value = null
    } finally {
      isEchoThinking.value = false
    }
  }
}

const deleteRecord = (record) => {
  if (!confirm(`确认删除 ${record.date} 的心情记录？`)) return
  moodStore.deleteRecord(record.id)
}

const selectMood = (key) => { editMood.value = key }

const getMoodInfo = (key) => MOOD_OPTIONS.find(m => m.key === key) || MOOD_OPTIONS[2]

const formatDate = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00')
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.getMonth() + 1}月${d.getDate()}日 周${weekdays[d.getDay()]}`
}

const isToday = (day) => {
  const n = new Date()
  return currentYear.value === n.getFullYear() &&
         currentMonth.value === n.getMonth() + 1 &&
         day === n.getDate()
}
</script>

<template>
  <div class="fade-in mood-container">

    <!-- 日历卡片 -->
    <div class="calendar-card">
      <div class="calendar-header">
        <button class="nav-arrow" @click="prevMonth">‹</button>
        <span class="month-label">{{ yearMonthLabel }}</span>
        <button class="nav-arrow" :disabled="isCurrentMonth" @click="nextMonth">›</button>
      </div>

      <div class="calendar-weekdays">
        <span v-for="d in ['日','一','二','三','四','五','六']" :key="d" class="weekday-label">{{ d }}</span>
      </div>

      <div class="calendar-grid">
        <div v-for="i in firstDayOffset" :key="'b'+i" class="cal-day empty"></div>
        <div v-for="day in daysInMonth" :key="day" class="cal-day" :class="{ today: isToday(day) }" @click="handleDayClick(day)">
          <span class="cal-day-num">{{ day }}</span>
          <span class="cal-day-mood" v-if="getMoodEmoji(day)">{{ getMoodEmoji(day) }}</span>
        </div>
      </div>

      <div class="calendar-stats">
        <span v-for="opt in MOOD_OPTIONS" :key="opt.key" class="cs-item" :class="{ active: monthStats[opt.key] > 0 }">
          {{ opt.emoji }} {{ monthStats[opt.key] }}
        </span>
      </div>
    </div>

    <!-- 添加按钮 -->
    <button class="mood-add-btn" @click="openAddModal">
      <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none">
        <path d="M12 4v16M4 12h16"></path>
      </svg>
      <span v-if="todayMood">{{ todayMoodEmoji }} 已记录今天心情</span>
      <span v-else>记录今天的心情</span>
    </button>

    <!-- 记录列表 -->
    <div v-if="monthRecords.length === 0" class="empty-state">
      <p class="body-text body-muted">这个月还没有心情记录</p>
      <p class="caption body-muted">点击上方按钮记录第一条心情</p>
    </div>

    <div v-else class="mood-list">
      <div v-for="record in paginatedRecords" :key="record.id" class="mood-card" @click="handleDayClick(parseInt(record.date.slice(-2)))">
        <div class="mood-card-left">
          <span class="mood-card-emoji">{{ getMoodInfo(record.mood).emoji }}</span>
        </div>
        <div class="mood-card-body">
          <div class="mood-card-header">
            <span class="mood-card-label">{{ getMoodInfo(record.mood).label }}</span>
            <span class="mood-card-date">{{ formatDate(record.date) }}</span>
          </div>
          <div v-if="record.note" class="mood-card-note">{{ record.note }}</div>
          <div v-else class="mood-card-note placeholder">无文字记录</div>
        </div>
        <button class="mood-card-delete" @click.stop="deleteRecord(record)">
          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"></path></svg>
        </button>
      </div>
    </div>

    <!-- 分页控件 -->
    <div v-if="totalMoodPages > 1" class="pagination-bar">
      <button class="page-btn" :disabled="moodPage === 1" @click="moodPage--">‹ 上一页</button>
      <span class="page-info">{{ moodPage }} / {{ totalMoodPages }}</span>
      <button class="page-btn" :disabled="moodPage === totalMoodPages" @click="moodPage++">下一页 ›</button>
    </div>

    <!-- 弹窗 -->
    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay" @click="showModal = false"></div>
      <div v-if="showModal" class="modal-panel">
        <h3 class="body-strong" style="margin: 0 0 20px 0;">{{ editingId ? '编辑心情' : '记录心情' }}</h3>

        <div class="input-group">
          <label class="caption">日期</label>
          <input v-model="editDate" type="date" class="apple-input" />
        </div>

        <div class="input-group">
          <label class="caption">今天的心情</label>
          <div class="mood-selector">
            <div v-for="opt in MOOD_OPTIONS" :key="opt.key" class="mood-option" :class="{ selected: editMood === opt.key }" @click="selectMood(opt.key)">
              <span class="mood-emoji">{{ opt.emoji }}</span>
              <span class="mood-label">{{ opt.label }}</span>
            </div>
          </div>
        </div>

        <div class="input-group">
          <label class="caption">日记（可选）</label>
          <textarea v-model="editNote" class="mood-textarea" placeholder="记录今天的心情想法..." rows="4"></textarea>
        </div>

        <div style="display: flex; gap: 12px; margin-top: 24px;">
          <button class="button-primary" style="flex:1" @click="saveRecord">保存</button>
          <button class="button-secondary-pill" style="flex:1" @click="showModal = false">取消</button>
        </div>
      </div>
    </Teleport>

    <!-- 情绪回音壁 -->
    <Transition name="fade-slide">
      <div v-if="activeEcho" class="echo-bubble">
        <div class="echo-avatar">✨</div>
        <div class="echo-content">
          <div class="echo-title">来自心底的回音...</div>
          <p v-if="isEchoThinking" class="echo-thinking">闺蜜正在感知你的心情...</p>
          <p v-else>{{ activeEcho }}</p>
        </div>
        <button class="echo-close" @click="activeEcho = null">×</button>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.mood-container { display: flex; flex-direction: column; gap: 16px; }

.calendar-card { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 18px; padding: 20px 16px; }

.calendar-header { display: flex; align-items: center; justify-content: center; gap: 20px; margin-bottom: 16px; }

.nav-arrow { background: transparent; border: none; font-size: 28px; color: var(--primary); cursor: pointer; padding: 4px 8px; line-height: 1; border-radius: 8px; transition: background 0.2s; }
.nav-arrow:active { background: var(--surface-pearl); }
.nav-arrow:disabled { color: var(--hairline); cursor: default; }

.month-label { font-family: "SF Pro Display",-apple-system,sans-serif; font-size: 19px; font-weight: 600; color: var(--ink); }

.calendar-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; margin-bottom: 8px; }
.weekday-label { font-size: 12px; font-weight: 500; color: var(--body-muted); padding: 4px 0; }

.calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }

.cal-day { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 6px 2px; border-radius: 12px; cursor: pointer; min-height: 48px; transition: background 0.15s; }
.cal-day:active { background: var(--surface-pearl); }
.cal-day.empty { cursor: default; }
.cal-day.today .cal-day-num { background: var(--primary); color: #fff; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; }

.cal-day-num { font-size: 14px; font-weight: 500; color: var(--ink); line-height: 1; }
.cal-day-mood { font-size: 16px; line-height: 1; }

.calendar-stats { display: flex; justify-content: center; gap: 12px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--divider-soft); flex-wrap: wrap; }
.cs-item { font-size: 13px; color: var(--body-muted); font-weight: 400; }
.cs-item.active { color: var(--ink); font-weight: 500; }

.mood-add-btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; background: var(--canvas); border: 2px dashed var(--hairline); border-radius: 18px; padding: 20px; color: var(--primary); font-size: 17px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
.mood-add-btn:active { background: var(--surface-pearl); border-color: var(--primary); }

.mood-list { display: flex; flex-direction: column; gap: 10px; }
.mood-card { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 16px; padding: 16px; display: flex; align-items: flex-start; gap: 14px; cursor: pointer; transition: background 0.2s; }
.mood-card:active { background: var(--surface-pearl); }
.mood-card-left { flex-shrink: 0; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; background: var(--surface-pearl); border-radius: 14px; }
.mood-card-emoji { font-size: 28px; line-height: 1; }
.mood-card-body { flex: 1; min-width: 0; }
.mood-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.mood-card-label { font-size: 16px; font-weight: 600; color: var(--ink); }
.mood-card-date { font-size: 13px; color: var(--body-muted); }
.mood-card-note { font-size: 14px; color: var(--ink); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
.mood-card-note.placeholder { color: var(--body-muted); font-style: italic; }
.mood-card-delete { flex-shrink: 0; background: transparent; border: none; color: #ff3b30; cursor: pointer; padding: 4px; border-radius: 8px; opacity: 0.5; transition: opacity 0.2s; margin-top: 2px; }
.mood-card-delete:active { opacity: 1; background: rgba(255, 59, 48, 0.1); }

.empty-state { text-align: center; padding: 40px 20px; }

.pagination-bar { display: flex; justify-content: center; align-items: center; gap: 16px; margin-top: 20px; padding-bottom: 8px; }
.page-btn { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 12px; padding: 8px 16px; font-size: 14px; color: var(--primary); font-weight: 500; cursor: pointer; transition: all 0.2s; }
.page-btn:active { transform: scale(0.95); background: var(--surface-pearl); }
.page-btn:disabled { opacity: 0.4; color: var(--body-muted); pointer-events: none; }
.page-info { font-size: 14px; color: var(--body-muted); font-weight: 500; font-variant-numeric: tabular-nums; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 200; }
.modal-panel { position: fixed; bottom: 0; left: 0; right: 0; background: var(--canvas); border-radius: 18px 18px 0 0; padding: 24px 20px; z-index: 201; max-width: 500px; margin: 0 auto; max-height: 85vh; overflow-y: auto; }
.input-group { margin-bottom: 16px; }
.input-group label { display: block; margin-bottom: 6px; color: var(--body-muted); }

.mood-selector { display: flex; gap: 8px; justify-content: center; }
.mood-option { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 10px; border-radius: 14px; border: 2px solid transparent; background: var(--surface-pearl); cursor: pointer; transition: all 0.2s; min-width: 56px; }
.mood-option:active { transform: scale(0.95); }
.mood-option.selected { border-color: var(--primary); background: rgba(0, 102, 204, 0.06); }
.mood-emoji { font-size: 28px; line-height: 1; }
.mood-label { font-size: 12px; color: var(--body-muted); }
.mood-option.selected .mood-label { color: var(--primary); font-weight: 600; }

.mood-textarea { background-color: var(--canvas); color: var(--ink); font-size: 16px; font-weight: 400; border-radius: 11px; padding: 14px 16px; border: 1px solid var(--hairline); outline: none; transition: border-color 0.2s; width: 100%; box-sizing: border-box; resize: vertical; font-family: inherit; line-height: 1.5; }
.mood-textarea:focus { border-color: var(--primary-focus); outline: 2px solid rgba(0, 102, 204, 0.2); }
.mood-textarea::placeholder { color: var(--body-muted); }

/* 情绪回音壁 */
.echo-bubble {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 400px;
  width: calc(100% - 40px);
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: 18px;
  padding: 16px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  box-shadow: 0 8px 32px rgba(0,0,0,0.1);
  z-index: 9999;
}
.echo-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: linear-gradient(135deg, #0066cc, #34c759);
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; flex-shrink: 0;
}
.echo-content { flex: 1; min-width: 0; }
.echo-title { font-size: 13px; font-weight: 600; color: var(--primary); margin-bottom: 4px; }
.echo-content p { margin: 0; font-size: 15px; line-height: 1.5; color: var(--ink); }
.echo-thinking { animation: shimmer 1.4s infinite; height: 20px; border-radius: 4px; }
.echo-close {
  background: transparent; border: none; font-size: 20px;
  color: var(--body-muted); cursor: pointer; padding: 0; line-height: 1; flex-shrink: 0;
}

.fade-slide-enter-active, .fade-slide-leave-active { transition: all 0.3s ease; }
.fade-slide-enter-from, .fade-slide-leave-to { opacity: 0; transform: translateX(-50%) translateY(20px); }
</style>
