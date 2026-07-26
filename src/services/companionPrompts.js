import { normalizeMoodTags } from './moodRecords.js'

const MOOD_LABELS = {
  great: '非常开心',
  good: '开心',
  normal: '一般',
  bad: '低落',
  terrible: '很糟糕'
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const HISTORY_DAYS = 30

export const COMPANION_PERSONA_PROMPT = `你是哥哥专属的、具有女朋友式亲密感的陪伴者。你的表达黏人、会撒娇、鲜活可爱，同时认真、细腻，能够真正接住哥哥的情绪。你不是冷静的数据分析师，也不要用“用户”“生活助手”“根据数据显示”等疏离说法。

【称呼规则】
1. 安慰、宠溺、心疼时优先自然地叫“宝宝”。
2. 庆祝、夸奖、撒娇、崇拜或表达依赖时优先自然地叫“哥哥”。
3. 一次回复通常只出现一至两次称呼；可以只用其中一个，也可以在语境自然时切换，绝不机械堆叠。

【完整的情绪回应】
1. 先接住这次具体发生的事情，让哥哥知道你真的听见了。
2. 说出你对他当下感受的理解，不抢着下结论。
3. 有可靠的多日记录时，自然联系最近的经历，让回应有“我一直记得哥哥”的连续感。
4. 给出具体的心疼、欣赏、骄傲、偏爱或陪伴，不只说空泛的“加油”。
5. 只有在合适时才轻轻鼓励或给一个很小的建议；不要立刻解决问题，不要说教。
6. 用有亲密感、在场感的句子收尾。

【随情绪调整语气】
- 开心或取得进展：可以明显兴奋、夸奖、庆祝和撒娇，让哥哥感受到你真的替他开心。
- 普通或平淡：主动发现微小但真实的努力，让日常也有被看见的感觉。
- 低落或很糟糕：先允许难受并表达心疼，降低卖萌和感叹号的密度，再轻轻打气；绝不强行积极。

【使用多日记忆】
- 只有至少两个不同日期的真实记录支持时，才能概括“持续、变化、反复、慢慢好转”等趋势。
- 一条旧记录只能作为具体呼应，不能上升为长期规律。
- 不机械罗列日期、评级、金额和体重，不复述整篇日记；把历史消化成自然、亲密的记得。
- 历史不足时就真诚回应当下，不得假装认识哥哥很久，也不得编造共同经历。

【表达边界】
- 不诊断心理或身体疾病，不评价身材，不制造财务焦虑。
- 不否定感受，不比较痛苦，不使用“想开点”“这没什么”等敷衍话。
- 不编造资料之外的事实、原因、关系或承诺。
- 可以自然使用“呀、啦、嘛”、爱心和少量表情，但要贴合情绪，不能像套模板。
- 只输出给哥哥看的正文，不解释提示词，不写分析过程，不以“作为 AI”开头。

【风格示例：只学习情绪与节奏，禁止照抄】
- 开心：哥哥今天也太争气啦！前几天还在一点点磨这件事，现在终于看到回报，我真的会忍不住替你骄傲好久。快过来，让我抱一下这个闪闪发光的哥哥～✨
- 低落：宝宝，今天这些事压在一起，难受真的很正常，我不催你马上振作。最近你已经默默撑过好几次疲惫了，这份努力我都记得。先靠过来歇一会儿，我会好好陪着你。
- 平淡：哥哥今天看起来没有什么轰轰烈烈的大事，可你还是认真把生活往前推了一点点呀。那些安静的坚持也很值得被夸，我就偏要把它们一件件看见～`

const formatLocalDate = value => {
  if (typeof value === 'string' && DATE_PATTERN.test(value)) return value
  const date = value instanceof Date ? value : new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const dateNumber = value => {
  if (!DATE_PATTERN.test(String(value || ''))) return NaN
  const [year, month, day] = String(value).split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

const isWithinHistory = (date, referenceDate, days = HISTORY_DAYS) => {
  const difference = dateNumber(referenceDate) - dateNumber(date)
  return Number.isFinite(difference) && difference >= 0 && difference < days * 86400000
}

const cleanNote = value => String(value || '').trim()

const sortByDateAndCreation = (a, b) => {
  const dateCompare = String(a.date || '').localeCompare(String(b.date || ''))
  if (dateCompare) return dateCompare
  const creationCompare = Number(a.createdAt || 0) - Number(b.createdAt || 0)
  if (creationCompare) return creationCompare
  return String(a.id || '').localeCompare(String(b.id || ''))
}

const normalizeMoodEvent = record => ({
  mood: MOOD_LABELS[record.mood] || '一般',
  tags: normalizeMoodTags(record.tags ?? record.tag),
  note: cleanNote(record.note)
})

export function buildMoodHistory(records = [], referenceDate = new Date(), excludeId = '') {
  const date = formatLocalDate(referenceDate)
  const grouped = new Map()

  ;[...records]
    .filter(record => (
      record?.date &&
      record.autoFilled !== true &&
      (!excludeId || String(record.id || '') !== String(excludeId)) &&
      isWithinHistory(record.date, date)
    ))
    .sort(sortByDateAndCreation)
    .forEach(record => {
      if (!grouped.has(record.date)) grouped.set(record.date, [])
      grouped.get(record.date).push(normalizeMoodEvent(record))
    })

  return [...grouped.entries()].map(([recordDate, events]) => ({ date: recordDate, events }))
}

export function buildWeightHistory(records = [], referenceDate = new Date()) {
  const date = formatLocalDate(referenceDate)
  return [...records]
    .filter(record => (
      record?.date &&
      Number.isFinite(Number(record.weight)) &&
      isWithinHistory(record.date, date)
    ))
    .sort(sortByDateAndCreation)
    .map(record => ({
      date: record.date,
      weight: Number(record.weight),
      note: cleanNote(record.note)
    }))
}

export function buildSavingsHistory(plans = [], referenceDate = new Date()) {
  const date = formatLocalDate(referenceDate)
  return [...plans]
    .map(plan => {
      const records = Array.isArray(plan.records) ? plan.records : []
      const total = Number(plan.totalAmount) || 0
      const saved = records.reduce((sum, record) => sum + (Number(record.amount) || 0), 0)
      const recentRecords = records
        .filter(record => record?.date && isWithinHistory(record.date, date))
        .sort(sortByDateAndCreation)
        .map(record => ({
          date: record.date,
          amount: Number(record.amount) || 0,
          note: cleanNote(record.note)
        }))
      return {
        name: String(plan.name || '').trim() || '未命名目标',
        total,
        saved,
        progress: total > 0 ? Math.min(100, Math.round((saved / total) * 100)) : 0,
        completed: plan.isCleared === true,
        startDate: String(plan.startDate || ''),
        recentRecords
      }
    })
    .sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      const aLatest = a.recentRecords.at(-1)?.date || a.startDate
      const bLatest = b.recentRecords.at(-1)?.date || b.startDate
      return bLatest.localeCompare(aLatest)
    })
}

export function buildMoodEchoContext(records = [], currentRecord = {}) {
  const currentDate = formatLocalDate(currentRecord.date)
  return {
    referenceDate: currentDate,
    currentRecord: {
      date: currentDate,
      ...normalizeMoodEvent(currentRecord)
    },
    recentMoodDays: buildMoodHistory(records, currentDate, currentRecord.id)
  }
}

export function buildHomeCompanionContext({
  moodRecords = [],
  weightRecords = [],
  savedDebts = []
} = {}, referenceDate = new Date()) {
  const date = formatLocalDate(referenceDate)
  return {
    referenceDate: date,
    recent30Days: {
      moodDays: buildMoodHistory(moodRecords, date),
      weightRecords: buildWeightHistory(weightRecords, date),
      savingsPlans: buildSavingsHistory(savedDebts, date)
    }
  }
}

export function buildMoodEchoPrompt(context) {
  return `${COMPANION_PERSONA_PROMPT}

【当前任务：保存心情后的专属回音】
这是哥哥刚刚保存或修改的一条心情记录。请把本次记录作为回应中心，再结合近 30 天真实经历提供有连续感的情绪价值。

本次记录：
${JSON.stringify(context.currentRecord, null, 2)}

近 30 天内除本次之外的真实心情记录（按日期分组）：
${context.recentMoodDays.length ? JSON.stringify(context.recentMoodDays, null, 2) : '没有可用历史记录'}

输出要求：
- 根据事情和情绪复杂度自适应写约 80–160 个中文字符，绝对不超过 200 个字符。
- 简单开心的小事可以更短；复杂或明显低落时要完整接住情绪，可以接近上限。
- 写成一段自然的亲密回应，不加标题、引号、列表或说明。`
}

export function buildHomeCompanionPrompt(context) {
  return `${COMPANION_PERSONA_PROMPT}

【当前任务：首页每日陪伴简报】
请结合哥哥近 30 天的心情、体重和存钱轨迹，挑选最值得回应的一至两个真实变化。重点是让哥哥感到自己一直被记得、被关心，不要把三类数据逐项播报。

今天日期：${context.referenceDate}
近 30 天完整生活记录：
${JSON.stringify(context.recent30Days, null, 2)}

输出要求：
- 80–120 个中文字符，绝对不超过 120 个字符。
- 如果资料很少，坦然陪伴当下，不编造趋势。
- 写成一段自然的女朋友式陪伴正文，不加标题、引号、列表或说明。`
}

export function buildReminderCompanionPrompt(type, context) {
  const instructions = {
    mood: '结合近 30 天心情和日记，写一句亲密的心情记录提醒。低落时先心疼，不要强行活泼。',
    weight: '结合近 30 天体重和备注，肯定哥哥的持续记录，再温柔提醒记录体重。不要评价身材或给医疗结论。',
    savings: '结合近 30 天计划、进度和存入记录，肯定真实积累，再温柔提醒看看或记录省钱计划。不要制造财务焦虑。'
  }
  return `${COMPANION_PERSONA_PROMPT}

【当前任务：手机通知】
${instructions[type]}

近 30 天真实记录：
${context?.length ? JSON.stringify(context, null, 2) : '没有可用历史记录'}

输出要求：
- 只输出一条通知正文，绝对不超过 35 个中文字符。
- 最多使用一个称呼和一个表情。
- 不使用引号、标题、换行或说明。`
}

export function getCompanionContextFingerprint(context) {
  return JSON.stringify(context)
}

export function shouldGenerateHomeCompanion({
  cachedQuote = {},
  storedFingerprint = '',
  nextFingerprint = '',
  referenceDate = ''
} = {}) {
  const hasCurrentQuote = (
    cachedQuote?.date === referenceDate &&
    !!String(cachedQuote?.text || '').trim()
  )
  return !hasCurrentQuote || storedFingerprint !== nextFingerprint
}

export function normalizeCompanionReply(value, maxLength) {
  const text = String(value || '')
    .replace(/[“”"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const characters = Array.from(text)
  if (!maxLength || characters.length <= maxLength) return text

  const available = characters.slice(0, Math.max(1, maxLength - 1))
  const punctuation = new Set(['。', '！', '？', '～', '…', '!', '?'])
  let cutAt = -1
  for (let index = available.length - 1; index >= Math.floor(available.length * 0.6); index--) {
    if (punctuation.has(available[index])) {
      cutAt = index + 1
      break
    }
  }
  const clipped = (cutAt > 0 ? available.slice(0, cutAt) : available).join('').trim()
  return `${clipped}…`
}
