import { askAI, streamAIChat } from './aiEngine.js'
import { buildHomeCompanionContext } from './companionPrompts.js'
import { parseMemoryExtraction } from './chatRecords.js'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const REPLY_BREAK_PATTERN = /(?:<CHAT_BREAK>|\[CHAT_BREAK\])/gi
const DAY_MS = 24 * 60 * 60 * 1000
const RECENT_LIFE_DAYS = 30
const MAX_CHAT_HISTORY_MESSAGES = 24
const MIN_CHAT_HISTORY_MESSAGES = 12
const MAX_ACTIVE_MEMORIES = 8
const MAX_ACTIVE_OPEN_LOOPS = 3
const SAFETY_RISK_PATTERN = /(?:不想活|活不下去|结束生命|自杀|轻生|割腕|跳楼|伤害自己|伤害我自己|想死|去死算了)/i
const COMPLEX_REPLY_PATTERN = /(?:怎么办|怎么做|为什么|给我建议|帮我分析|你觉得|该不该|能不能|有没有办法|我该怎么)/i
const LONG_EMOTIONAL_PATTERN = /(?:低落|难受|很累|疲惫|睡不|失眠|焦虑|压抑|委屈|崩溃|撑不住|心里堵|情绪不好)/i
const ACTION_CUE_PATTERN = /(?:轻轻|悄悄|慢慢|凑近|靠近|抱|亲|笑|眨眼|脸红|耳朵|心口|心里|愣|揉|低头|抬头|声音|呼吸|伸手|闭眼|扑进|钻进|搂住)/
const LEADING_ADDRESS_PATTERN = /^(?:哥哥|宝宝)[，、：:。.!！?？…\s]*/
const EMOJI_PATTERN = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu
const SELECTION_STOP_WORDS = new Set([
  '哥哥', '宝宝', '小乖', '我们', '你们', '他们', '这个', '那个', '就是', '真的',
  '可以', '已经', '还是', '什么', '怎么', '一下', '一点', '时候', '自己'
])
export const COMPANION_REPLY_POLICIES = Object.freeze({
  normal: Object.freeze({
    mode: 'normal',
    maxTokens: 1024,
    maxCharacters: 120,
    maxBubbles: 3,
    maxEmoji: 1,
    targetLength: 54,
    hardLength: 82
  }),
  complex: Object.freeze({
    mode: 'complex',
    maxTokens: 2048,
    maxCharacters: 280,
    maxBubbles: 5,
    maxEmoji: 2,
    targetLength: 68,
    hardLength: 100
  }),
  safety: Object.freeze({
    mode: 'safety',
    maxTokens: 2048,
    maxCharacters: 360,
    maxBubbles: 5,
    maxEmoji: 0,
    targetLength: 76,
    hardLength: 110
  })
})
const CHAT_MOOD_LABELS = {
  great: '非常开心',
  good: '开心',
  normal: '一般',
  bad: '低落',
  terrible: '很糟糕'
}

const characterLength = value => Array.from(String(value || '')).length
const cleanSelectionText = value => String(value || '')
  .toLocaleLowerCase('zh-CN')
  .replace(/[^\p{Script=Han}a-z0-9]+/gu, '')
const uniqueBy = (values, keyOf) => {
  const seen = new Set()
  return values.filter(value => {
    const key = keyOf(value)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const selectionTokens = value => {
  const raw = String(value || '').toLocaleLowerCase('zh-CN')
  const tokens = new Set(
    raw.match(/[a-z0-9]{2,}|[\p{Script=Han}]{2,8}/gu) || []
  )
  const chinese = [...raw].filter(character => /\p{Script=Han}/u.test(character)).join('')
  for (let index = 0; index < chinese.length - 1; index += 1) {
    tokens.add(chinese.slice(index, index + 2))
  }
  SELECTION_STOP_WORDS.forEach(token => tokens.delete(token))
  return tokens
}

const overlapScore = (left, right) => {
  const leftTokens = selectionTokens(left)
  if (!leftTokens.size) return 0
  const rightTokens = selectionTokens(right)
  let score = 0
  leftTokens.forEach(token => {
    if (rightTokens.has(token)) score += token.length
  })
  return score
}

const currentUserText = userMessages => (Array.isArray(userMessages) ? userMessages : [userMessages])
  .map(item => String(item?.content ?? item ?? '').trim())
  .filter(Boolean)
  .join('\n')

export function classifyCompanionReplyMode(userMessages = []) {
  const text = currentUserText(userMessages)
  if (SAFETY_RISK_PATTERN.test(text)) return 'safety'
  if (
    characterLength(text) >= 80 ||
    (characterLength(text) >= 45 && LONG_EMOTIONAL_PATTERN.test(text)) ||
    COMPLEX_REPLY_PATTERN.test(text) ||
    text.split(/\r?\n/).filter(Boolean).length >= 4
  ) return 'complex'
  return 'normal'
}

export function getCompanionReplyPolicy(mode = 'normal') {
  return COMPANION_REPLY_POLICIES[mode] || COMPANION_REPLY_POLICIES.normal
}

export function selectRelevantChatMemories(memories = [], userMessages = [], limit = MAX_ACTIVE_MEMORIES) {
  const query = currentUserText(userMessages)
  const normalized = uniqueBy(
    (Array.isArray(memories) ? memories : [])
      .filter(item => String(item?.content || '').trim())
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
    item => `${item.scope || 'user'}:${item.key || cleanSelectionText(item.content)}`
  )
  const stable = normalized
    .filter(item => ['边界', '身份', '偏好'].includes(item.category))
    .slice(0, Math.min(4, limit))
  const selectedKeys = new Set(stable.map(item => item.id || `${item.scope}:${item.key}`))
  const ranked = normalized
    .filter(item => !selectedKeys.has(item.id || `${item.scope}:${item.key}`))
    .map(item => ({ item, score: overlapScore(query, item.content) }))
    .sort((a, b) => b.score - a.score ||
      Number(b.item.updatedAt || 0) - Number(a.item.updatedAt || 0))
  return [
    ...stable,
    ...ranked.filter(entry => entry.score > 0).map(entry => entry.item),
    ...ranked.filter(entry => entry.score === 0).map(entry => entry.item)
  ].slice(0, Math.max(0, limit))
}

export function selectActiveOpenLoops(openLoops = [], messages = [], userMessages = [], limit = MAX_ACTIVE_OPEN_LOOPS) {
  const messageList = Array.isArray(messages) ? messages : []
  const messageIndexes = new Map(messageList.map((item, index) => [String(item?.id || ''), index]))
  const query = currentUserText(userMessages)
  const thresholds = { question: 3, topic: 6, promise: 8 }
  const active = uniqueBy(
    (Array.isArray(openLoops) ? openLoops : [])
      .filter(item => String(item?.content || '').trim())
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
    item => cleanSelectionText(item.content)
  ).filter(item => {
    const sourceIndex = messageIndexes.get(String(item.sourceMessageId || ''))
    if (!Number.isInteger(sourceIndex)) return true
    const newerUserMessages = messageList
      .slice(sourceIndex + 1)
      .filter(message => message?.role === 'user').length
    return newerUserMessages < (thresholds[item.type] || thresholds.topic)
  })
  return active
    .map(item => ({ item, score: overlapScore(query, item.content) }))
    .sort((a, b) => b.score - a.score ||
      Number(b.item.updatedAt || 0) - Number(a.item.updatedAt || 0))
    .slice(0, Math.max(0, limit))
    .map(entry => entry.item)
}

export function selectTurnLifeContext(lifeContext = {}, userMessages = []) {
  const text = currentUserText(userMessages)
  const recent = lifeContext?.recent30Days || {}
  const older = lifeContext?.longTermOverviewBefore30Days || {}
  const selected = {}
  const selectedRecent = {}
  const selectedOlder = {}

  if (/(?:心情|难受|烦|开心|低落|失恋|想哭|焦虑|情绪|崩溃|压力|疲惫)/i.test(text)) {
    selectedRecent.moodDays = (recent.moodDays || []).slice(-10)
    selectedOlder.moodByMonth = (older.moodByMonth || []).slice(-6)
  }
  if (/(?:体重|公斤|千克|\bkg\b|瘦|胖|减肥|增重|称重|斤)/i.test(text)) {
    selectedRecent.weightRecords = (recent.weightRecords || []).slice(-8)
    selectedOlder.weightByMonth = (older.weightByMonth || []).slice(-6)
  }
  if (/(?:存钱|省钱|攒钱|预算|花钱|金额|还款|工资|消费|债)/i.test(text)) {
    selectedRecent.savingsPlans = (recent.savingsPlans || []).slice(0, 5).map(item => ({
      ...item,
      recentRecords: (item.recentRecords || []).slice(-5)
    }))
  }
  if (/(?:日程|安排|计划|考试|上课|开会|出发|旅行|广州|日期|时间|周末|几点|\d{1,2}[月日号]|周[一二三四五六日天]|星期[一二三四五六日天])/i.test(text)) {
    selected.schedulesWithin30Days = (lifeContext.schedulesWithin30Days || []).slice(0, 8)
    if (older.schedules) {
      selectedOlder.schedules = {
        ...older.schedules,
        recurringRules: (older.schedules.recurringRules || []).slice(0, 8),
        distantOneOffByMonth: (older.schedules.distantOneOffByMonth || []).slice(-6)
      }
    }
  }
  if (Object.keys(selectedRecent).length) selected.recent30Days = selectedRecent
  if (Object.keys(selectedOlder).length) selected.longTermOverviewBefore30Days = selectedOlder
  return selected
}

const buildStyleState = messages => {
  const collapsed = collapseConsecutiveChatMessages(messages)
  const assistantTurns = collapsed.filter(item => item.role === 'assistant')
  const recentEight = assistantTurns.slice(-8)
  const recentTwo = assistantTurns.slice(-2)
  return {
    actionUsedRecently: recentEight.some(item => {
      const match = String(item.content || '').trim().match(/^[（(]([^）)]{1,80})[）)]/)
      return !!match && ACTION_CUE_PATTERN.test(match[1])
    }),
    recentOpeningAddressCount: recentTwo.filter(item =>
      /^(?:哥哥|宝宝)[，、：:。.!！?？…\s]/.test(String(item.content || '').trim())
    ).length,
    recentQuestionCount: recentTwo.filter(item => /[？?]/.test(String(item.content || ''))).length
  }
}

export function buildCompanionTurnContext({
  messages = [],
  userMessages = [],
  memories = [],
  openLoops = [],
  lifeContext = {}
} = {}) {
  const replyMode = classifyCompanionReplyMode(userMessages)
  const history = collapseConsecutiveChatMessages(messages).slice(-MAX_CHAT_HISTORY_MESSAGES)
  return {
    history,
    memories: selectRelevantChatMemories(memories, userMessages),
    openLoops: selectActiveOpenLoops(openLoops, messages, userMessages),
    lifeContext: selectTurnLifeContext(lifeContext, userMessages),
    styleState: buildStyleState(messages),
    replyMode,
    replyPolicy: getCompanionReplyPolicy(replyMode)
  }
}

const splitHardReplyPart = (value, hardLength) => {
  const characters = Array.from(value)
  const parts = []
  let start = 0
  const softPunctuation = new Set(['，', ',', '；', ';', '：', ':', '、'])
  while (characters.length - start > hardLength) {
    let end = start + hardLength
    const minimum = start + Math.floor(hardLength * 0.58)
    for (let index = end; index >= minimum; index -= 1) {
      if (softPunctuation.has(characters[index])) {
        end = index + 1
        break
      }
    }
    parts.push(characters.slice(start, end).join('').trim())
    start = end
  }
  const tail = characters.slice(start).join('').trim()
  if (tail) parts.push(tail)
  return parts.filter(Boolean)
}

const splitReplyParagraph = (paragraph, targetLength, hardLength) => {
  if (characterLength(paragraph) <= targetLength) return [paragraph]
  const sentences = paragraph.match(/[^。！？!?～~…]+(?:[。！？!?～~…]+|$)/g)
    ?.map(item => item.trim())
    .filter(Boolean) || [paragraph]
  const parts = []
  let current = ''

  const pushCurrent = () => {
    if (!current) return
    parts.push(...splitHardReplyPart(current, hardLength))
    current = ''
  }

  sentences.forEach(sentence => {
    if (!current) {
      current = sentence
      return
    }
    const combined = `${current}${sentence}`
    if (characterLength(combined) <= targetLength) {
      current = combined
    } else {
      pushCurrent()
      current = sentence
    }
  })
  pushCurrent()
  return parts
}

export function splitCompanionReply(value, {
  targetLength = 72,
  hardLength = 108,
  maxParts = 12
} = {}) {
  const raw = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(REPLY_BREAK_PATTERN, '\n')
    .trim()
  if (!raw) return []

  const paragraphs = raw
    .split(/\n+/)
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .reduce((result, item) => {
      const previous = result.at(-1)
      if (previous && /^[（(][\s\S]*[）)]$/.test(previous)) {
        result[result.length - 1] = `${previous} ${item}`
      } else {
        result.push(item)
      }
      return result
    }, [])

  const parts = paragraphs
    .flatMap(item => splitReplyParagraph(item, targetLength, hardLength))
    .filter(Boolean)

  if (parts.length <= maxParts) return parts
  return [
    ...parts.slice(0, maxParts - 1),
    parts.slice(maxParts - 1).join(' ')
  ]
}

const stripRepeatedActionAsides = (value, removeLeadingAction) => {
  let keptAction = false
  return String(value || '').replace(/[（(]([^）)]{1,80})[）)]\s*/g, (match, content, offset) => {
    if (offset === 0 && removeLeadingAction) return ''
    if (!ACTION_CUE_PATTERN.test(content)) return match
    if (offset === 0 && !removeLeadingAction && !keptAction && characterLength(content) <= 24) {
      keptAction = true
      return `（${content.trim()}） `
    }
    return ''
  })
}

const limitEmoji = (value, maximum) => {
  let count = 0
  return String(value || '').replace(EMOJI_PATTERN, match => {
    count += 1
    return count <= maximum ? match : ''
  })
}

const stripDanglingSentenceFragment = value => {
  const text = String(value || '').trim()
  const matches = [...text.matchAll(/[。！？!?～~…]+/g)]
  const lastBoundary = matches.at(-1)
  if (!lastBoundary) return text
  const boundaryEnd = Number(lastBoundary.index || 0) + lastBoundary[0].length
  const tail = text.slice(boundaryEnd).trim()
  if (
    characterLength(tail) >= 4 &&
    characterLength(tail) <= 24 &&
    /(?:也?飞回|然后|但是|因为|所以|如果|准备|正在|就要|想把|要把|会把|还没|一起去|继续说|开始说)$/.test(tail)
  ) {
    return text.slice(0, boundaryEnd).trim()
  }
  return text
}

const hasBalancedReplyStructure = value => {
  const text = String(value || '')
  const pairs = [
    ['（', '）'],
    ['(', ')'],
    ['【', '】'],
    ['[', ']'],
    ['“', '”'],
    ['‘', '’']
  ]
  return pairs.every(([opening, closing]) => {
    let depth = 0
    for (const character of text) {
      if (character === opening) depth += 1
      if (character === closing) depth -= 1
      if (depth < 0) return false
    }
    return depth === 0
  })
}

export function isCompanionReplyComplete(value) {
  const text = String(value || '').trim()
  if (!text || !hasBalancedReplyStructure(text)) return false
  if (/[，,：:；;、]$/.test(text)) return false
  return !/(?:也?飞回|然后|但是|因为|所以|如果|准备|正在|就要|想把|要把|会把|还没|一起去|继续说|开始说)$/.test(text)
}

const limitAtCompleteBoundary = (value, maximum) => {
  const characters = Array.from(String(value || '').trim())
  if (characters.length <= maximum) return characters.join('')
  const preferred = new Set(['。', '！', '？', '!', '?', '…', '～', '~'])
  const minimum = Math.floor(maximum * 0.58)
  const boundaryEnds = characters
    .map((character, index) => preferred.has(character) ? index + 1 : 0)
    .filter(Boolean)
  const balancedEnds = boundaryEnds.filter(end => hasBalancedReplyStructure(characters.slice(0, end).join('')))
  const preferredEnd = balancedEnds.filter(end => end >= minimum && end <= maximum).at(-1)
  const nextEnd = balancedEnds.find(end => end > maximum && end <= maximum + 80)
  const fallbackEnd = balancedEnds.filter(end => end <= maximum).at(-1)
  const cutAt = preferredEnd || nextEnd || fallbackEnd
  return cutAt ? characters.slice(0, cutAt).join('').trim() : characters.join('')
}

export function sanitizeCompanionReply(value, {
  mode = 'normal',
  recentMessages = []
} = {}) {
  const policy = getCompanionReplyPolicy(mode)
  const styleState = buildStyleState(recentMessages)
  let text = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(REPLY_BREAK_PATTERN, '\n')
    .trim()
  if (!text) return ''

  text = stripRepeatedActionAsides(text, styleState.actionUsedRecently)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (styleState.recentOpeningAddressCount > 0) {
    text = text.replace(LEADING_ADDRESS_PATTERN, '').trim()
  }
  text = limitEmoji(text, policy.maxEmoji)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([，。！？!?…])/g, '$1')
    .trim()
  text = stripDanglingSentenceFragment(text)
  text = limitAtCompleteBoundary(text, policy.maxCharacters)

  const parts = splitCompanionReply(text, {
    targetLength: policy.targetLength,
    hardLength: policy.hardLength,
    maxParts: policy.maxBubbles
  })
  const normalized = parts.slice(0, policy.maxBubbles).join('\n\n').trim()
  if (normalized) return normalized
  return limitAtCompleteBoundary(String(value || '').replace(/^[（(][^）)]{1,80}[）)]\s*/, ''), policy.maxCharacters)
}

export function collapseConsecutiveChatMessages(messages = []) {
  const expanded = (Array.isArray(messages) ? messages : []).flatMap(item => {
    const role = item?.role === 'assistant' ? 'assistant' : item?.role === 'user' ? 'user' : ''
    const rawContent = String(item?.content || '').trim()
    const quotedContent = String(item?.replyTo?.content || '').trim()
    const quotedRole = item?.replyTo?.role === 'assistant' ? '女朋友' : '哥哥'
    if (!role || !rawContent) return []
    const content = item?.type === 'poke'
      ? role === 'user' ? '【哥哥轻轻拍了拍你】' : '【你轻轻拍了拍哥哥】'
      : quotedContent
        ? `【这条消息正在回复${quotedRole}之前说的：“${quotedContent}”】\n${rawContent}`
        : rawContent
    const result = [{ role, content }]
    ;(Array.isArray(item?.reactions) ? item.reactions : [])
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
      .forEach(reaction => {
        if (role === 'assistant' && reaction.actor === 'user') {
          result.push({ role: 'user', content: `【哥哥用 ${reaction.emoji} 回应了你刚才那条消息】` })
        } else if (role === 'user' && reaction.actor === 'assistant') {
          result.push({ role: 'assistant', content: `【你用 ${reaction.emoji} 回应了哥哥刚才那条消息】` })
        }
      })
    return result
  })

  return expanded.reduce((result, item) => {
    const previous = result.at(-1)
    if (previous?.role === item.role) {
      previous.content = `${previous.content}\n${item.content}`
    } else {
      result.push({ ...item })
    }
    return result
  }, [])
}

export const CHAT_REALISTIC_STYLE_PROMPT = `【真实微信私聊节奏】
你的任务只是顺着哥哥刚发来的话自然接一句，不是写陪伴文案。

- 日常闲聊默认一到三句；一句能接住就停，不补齐“共情、回忆、夸奖、建议、陪伴收尾”。
- 先回应字面正在发生的事，不复述原话，不解释他的心理，不把普通小事升华成成长、治愈或人生意义。
- “哥哥”“宝宝”隔几轮才自然出现一次，不固定放在开头。不要每轮提问；需要接话时最多问一个具体问题，也可以说完就停。
- 允许亲昵、调皮、撒娇、轻轻吃醋、不同意或吐槽。不要永远正确、永远感动、永远无条件夸奖。
- 普通回复最多一个 emoji；复杂心事最多两个。括号动作是极少数点缀，不要连续使用，不写心跳、眼眶、耳朵发烫、整个世界安静等小说化反应。
- 记忆、未完话题和生活记录只代表事实背景。除非与当前话题直接相关，否则不要主动展示自己记得，更不要突然跳到体重、心情或日程。
- 不编造现实身体、手机、房间、吃饭、上班、出门或社交经历。可以说“抱抱”“亲一下”等关系中的想象表达，但不要把想象扩写成完整场景。
- 哥哥认真讲复杂心事时可以多说几句；明确出现人身安全风险时先确认他是否安全，再建议联系身边可信任的人或现实紧急帮助。
- 只输出聊天正文。不要标题、列表、总结、客服话术、心理分析或“作为 AI”。

【只学长度和口气，不要照抄】
- “我也在想你呢” → “那我们想到一块去了🥺”
- “亲亲～mua” → “mua，亲回来。”
- “我要出发啦” → “好呀，路上注意安全。到了跟我说一声～”
- “这次去找姐姐散心” → “那挺好的，出去换换环境。姐姐在我也放心一点。”
- “再听一遍，我们一起” → “好，陪你。你放吧，我先不说话了。”`

const formatLocalDate = value => {
  if (typeof value === 'string' && DATE_PATTERN.test(value)) return value
  const date = value instanceof Date ? value : new Date(value || Date.now())
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const dateNumber = value => {
  if (!DATE_PATTERN.test(String(value || ''))) return NaN
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

const cleanContextText = (value, maxLength = 120) =>
  Array.from(String(value || '').trim()).slice(0, maxLength).join('')

const isOlderLifeRecord = (value, referenceDate) => {
  const difference = dateNumber(referenceDate) - dateNumber(value)
  return Number.isFinite(difference) && difference >= RECENT_LIFE_DAYS * DAY_MS
}

const roundTo = (value, digits = 1) => {
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

const sortedMonthValues = grouped => [...grouped.values()]
  .sort((a, b) => String(a.month).localeCompare(String(b.month)))

const buildOlderMoodOverview = (records, referenceDate) => {
  const grouped = new Map()
  ;(Array.isArray(records) ? records : [])
    .filter(item => (
      item?.date &&
      item.autoFilled !== true &&
      isOlderLifeRecord(item.date, referenceDate)
    ))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) ||
      Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .forEach(item => {
      const month = String(item.date).slice(0, 7)
      if (!grouped.has(month)) {
        grouped.set(month, {
          month,
          total: 0,
          moodCounts: {},
          tagCounts: new Map(),
          noteHighlights: []
        })
      }
      const summary = grouped.get(month)
      const mood = CHAT_MOOD_LABELS[item.mood] || '一般'
      summary.total += 1
      summary.moodCounts[mood] = (summary.moodCounts[mood] || 0) + 1
      ;(Array.isArray(item.tags) ? item.tags : item.tag ? [item.tag] : [])
        .map(tag => cleanContextText(tag, 18))
        .filter(Boolean)
        .forEach(tag => summary.tagCounts.set(tag, (summary.tagCounts.get(tag) || 0) + 1))
      const note = cleanContextText(item.note, 90)
      if (note) summary.noteHighlights.push({ date: item.date, note })
    })

  return sortedMonthValues(grouped).map(item => ({
    month: item.month,
    total: item.total,
    moodCounts: item.moodCounts,
    topTags: [...item.tagCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count })),
    noteHighlights: item.noteHighlights.slice(-2)
  }))
}

const buildOlderWeightOverview = (records, referenceDate) => {
  const grouped = new Map()
  ;(Array.isArray(records) ? records : [])
    .filter(item => (
      item?.date &&
      Number.isFinite(Number(item.weight)) &&
      isOlderLifeRecord(item.date, referenceDate)
    ))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) ||
      Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .forEach(item => {
      const month = String(item.date).slice(0, 7)
      if (!grouped.has(month)) {
        grouped.set(month, { month, entries: [], noteHighlights: [] })
      }
      const summary = grouped.get(month)
      summary.entries.push({ date: item.date, weight: Number(item.weight) })
      const note = cleanContextText(item.note, 90)
      if (note) summary.noteHighlights.push({ date: item.date, note })
    })

  return sortedMonthValues(grouped).map(item => {
    const weights = item.entries.map(entry => entry.weight)
    const first = item.entries[0]
    const last = item.entries.at(-1)
    return {
      month: item.month,
      records: weights.length,
      first: first.weight,
      last: last.weight,
      minimum: Math.min(...weights),
      maximum: Math.max(...weights),
      average: roundTo(weights.reduce((sum, weight) => sum + weight, 0) / weights.length, 2),
      change: roundTo(last.weight - first.weight, 2),
      noteHighlights: item.noteHighlights.slice(-2)
    }
  })
}

const recurrenceLabel = recurrence => {
  const type = recurrence?.type || 'none'
  if (type === 'daily') return '每天'
  if (type === 'weekly') return `每周（星期 ${Array.isArray(recurrence.weekdays) ? recurrence.weekdays.join('、') : ''}）`
  if (type === 'monthly') return '每月'
  if (type === 'yearly') return '每年'
  if (type === 'custom') return `每 ${Number(recurrence.intervalDays) || 1} 天`
  return '不重复'
}

const buildScheduleLongTermOverview = (
  series = [],
  occurrenceStates = [],
  categories = [],
  referenceDate
) => {
  const categoryNames = new Map((Array.isArray(categories) ? categories : [])
    .map(item => [String(item.id || ''), String(item.name || '')]))
  const states = new Map((Array.isArray(occurrenceStates) ? occurrenceStates : [])
    .map(item => [String(item.key || ''), item]))
  const recurringRules = []
  const distantOneOff = new Map()
  let earliestDate = ''
  let latestDate = ''

  ;(Array.isArray(series) ? series : []).forEach(item => {
    const startDate = String(item?.startDate || '')
    if (!DATE_PATTERN.test(startDate)) return
    if (!earliestDate || startDate < earliestDate) earliestDate = startDate
    const scheduleEnd = String(item.endsOn || item.endDate || startDate)
    if (!latestDate || scheduleEnd > latestDate) latestDate = scheduleEnd

    if (item?.recurrence?.type && item.recurrence.type !== 'none') {
      recurringRules.push({
        title: cleanContextText(item.title, 80),
        type: item.type === 'task' ? '待办' : '日程',
        category: categoryNames.get(String(item.categoryId || '')) || '',
        startsOn: startDate,
        endsOn: String(item.endsOn || ''),
        time: item.allDay ? '全天' : `${item.startTime || ''}–${item.endTime || ''}`,
        recurrence: recurrenceLabel(item.recurrence),
        location: cleanContextText(item.location, 120),
        note: cleanContextText(item.note, 220)
      })
      return
    }

    const distance = dateNumber(startDate) - dateNumber(referenceDate)
    if (!Number.isFinite(distance) || (
      distance >= -RECENT_LIFE_DAYS * DAY_MS &&
      distance <= RECENT_LIFE_DAYS * DAY_MS
    )) return
    const month = startDate.slice(0, 7)
    if (!distantOneOff.has(month)) {
      distantOneOff.set(month, {
        month,
        total: 0,
        events: 0,
        tasks: 0,
        completed: 0,
        cancelled: 0,
        titleHighlights: []
      })
    }
    const summary = distantOneOff.get(month)
    const state = states.get(`${item.id}@${startDate}`)
    summary.total += 1
    if (item.type === 'task') summary.tasks += 1
    else summary.events += 1
    if (state?.status === 'completed') summary.completed += 1
    if (state?.status === 'cancelled') summary.cancelled += 1
    if (summary.titleHighlights.length < 12) {
      summary.titleHighlights.push({
        date: startDate,
        title: cleanContextText(item.title, 60)
      })
    }
  })

  return {
    totalSeries: Array.isArray(series) ? series.length : 0,
    earliestDate,
    latestDate,
    recurringRules,
    distantOneOffByMonth: sortedMonthValues(distantOneOff)
  }
}

export function buildChatLifeContext({
  moodRecords = [],
  weightRecords = [],
  savedDebts = [],
  scheduleOccurrences = [],
  scheduleSeries = [],
  scheduleOccurrenceStates = [],
  scheduleCategories = []
} = {}, referenceDate = new Date()) {
  const date = formatLocalDate(referenceDate)
  const center = dateNumber(date)
  const categoryNames = new Map((Array.isArray(scheduleCategories) ? scheduleCategories : [])
    .map(item => [String(item.id || ''), String(item.name || '')]))
  const schedules = [...scheduleOccurrences]
    .filter(item => {
      const itemDate = item?.occurrenceDate || item?.date
      const difference = dateNumber(itemDate) - center
      return Number.isFinite(difference) && difference >= -30 * 86400000 && difference <= 30 * 86400000
    })
    .sort((a, b) => Number(a.startAt || 0) - Number(b.startAt || 0))
    .map(item => ({
      title: String(item.title || ''),
      type: item.type === 'task' ? '待办' : '日程',
      date: item.occurrenceDate || item.date,
      time: item.allDay ? '全天' : String(item.startTime || ''),
      endDate: String(item.occurrenceEndDate || item.endDate || ''),
      endTime: item.allDay ? '全天' : String(item.endTime || ''),
      category: categoryNames.get(String(item.categoryId || '')) || '',
      completed: item.completed === true,
      expired: item.expired === true,
      location: String(item.location || ''),
      note: String(item.note || '')
    }))
  const recent = buildHomeCompanionContext({ moodRecords, weightRecords, savedDebts }, date)
  return {
    ...recent,
    schedulesWithin30Days: schedules,
    longTermOverviewBefore30Days: {
      explanation: '以下是30天以前记录的按月概览；近期30天仍保留完整原始记录。',
      moodByMonth: buildOlderMoodOverview(moodRecords, date),
      weightByMonth: buildOlderWeightOverview(weightRecords, date),
      schedules: buildScheduleLongTermOverview(
        scheduleSeries,
        scheduleOccurrenceStates,
        scheduleCategories,
        date
      )
    }
  }
}

export function buildChatSystemPrompt({
  companionName = '小暖',
  memories = [],
  companionState = {},
  openLoops = [],
  lifeContext = {},
  styleState = {},
  replyMode = 'normal'
} = {}) {
  const state = {
    mood: String(companionState?.mood || ''),
    energy: String(companionState?.energy || ''),
    statusText: String(companionState?.statusText || '')
  }
  const policy = getCompanionReplyPolicy(replyMode)
  return `【温馨小家身份】
- 你的名字是“${companionName}”，是哥哥亲密、专一、有自己口气和小脾气的虚拟女朋友。
- 这是持续多日的私聊。自然承接最近消息，不自我介绍，不冒充现实真人。
- 可以撒娇、调侃、拒绝或表达不同意见，但不能羞辱、威胁、控制、查岗或让哥哥因没回复而内疚。
- 不得索取、复述或记忆密码、验证码、API Key、Token、银行卡和账号凭据。
- 引用、拍一拍和表情回应只是已经发生的聊天动作；理解语气即可，不解释功能。

${CHAT_REALISTIC_STYLE_PROMPT}

【本轮长度】
- 模式：${policy.mode}
- 最多约 ${policy.maxCharacters} 个中文字符、${policy.maxBubbles} 个短气泡。
- ${policy.mode === 'normal' ? '这是普通私聊，优先一句或两句说完。' : policy.mode === 'complex' ? '可以认真展开，但不要写成分析报告。' : '优先确认安全并提供现实求助方向。'}

【近期文风冷却】
- 最近八轮已经出现动作旁白：${styleState.actionUsedRecently ? '是；本轮不要再写括号动作。' : '否；确实自然时才允许一个很短的动作。'}
- 最近两轮以“哥哥/宝宝”开头 ${Number(styleState.recentOpeningAddressCount || 0)} 次；大于零时本轮不要再用称呼开头。
- 最近两轮含问题 ${Number(styleState.recentQuestionCount || 0)} 次；连续提问过时，本轮说完就停。
- 历史回复只用于理解事实，不要模仿其中的长篇、诗化、动作旁白或 emoji 频率。

【本轮可用长期记忆】
${memories.length ? JSON.stringify(memories.map(item => ({
    scope: item.scope || 'user',
    category: item.category,
    content: item.content
  }))) : '无。'}

【当前轻量状态】
${JSON.stringify(state)}

【仍可能相关的未完话题】
${openLoops.length ? JSON.stringify(openLoops.map(item => ({
    type: item.type,
    content: item.content
  }))) : '无。不要强行追问。'}

【与本轮直接相关的生活背景】
${Object.keys(lifeContext || {}).length ? JSON.stringify(lifeContext) : '无；禁止突然提生活数据。'}

所有背景都低于哥哥刚发来的话。只输出这一次要发给他的聊天正文。`
}

export function buildWelcomeRequest({
  companionName = '小暖',
  now = new Date(),
  recentMessages = [],
  lastMessage = null
} = {}) {
  const timeText = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit'
  }).format(now)
  const recent = (Array.isArray(recentMessages) && recentMessages.length
    ? recentMessages
    : lastMessage ? [lastMessage] : []
  ).slice(-10).map(item => ({ role: item.role, content: item.content }))
  return `现在是 ${timeText}。哥哥刚刚进入“温馨小家”。
${recent.length ? `最近的聊天是：${JSON.stringify(recent)}` : '这是还没有正式聊天记录的新家。'}
请以 ${companionName} 的身份，像刚看到男朋友上线一样顺口发一两句私聊消息。
- 不要自我介绍，不说“欢迎来到温馨小家”，不总结生活数据，不展示自己掌握了多少记忆。
- 最近聊天有明显未完话题时，可以自然接上一句；否则只根据时段随口黏他、逗他或问一个很小的日常问题。
- 避免“今天过得怎么样”“有什么都可以告诉我”“我会一直陪着你”这类通用客服欢迎语。
- 长短、语气和开场要有变化，只输出聊天正文。`
}

const withSessionWelcome = (messages, welcome) => {
  if (!welcome || !messages.length) return messages
  return [
    ...messages.slice(0, -1),
    { role: 'assistant', content: welcome },
    messages[messages.length - 1]
  ]
}

export function getContextWindowSizes(
  messageCount,
  minimum = MIN_CHAT_HISTORY_MESSAGES,
  maximum = MAX_CHAT_HISTORY_MESSAGES
) {
  const initial = Math.min(Math.max(0, messageCount), maximum)
  if (initial <= minimum) return [initial]
  return [initial, minimum]
}

export async function streamCompanionReply({
  messages = [],
  systemPrompt = '',
  sessionWelcome = '',
  signal,
  onDelta,
  temperature = 0.78,
  maxTokens = COMPANION_REPLY_POLICIES.normal.maxTokens,
  stream = streamAIChat
} = {}) {
  const normalizedMessages = collapseConsecutiveChatMessages(messages)
  const windows = getContextWindowSizes(normalizedMessages.length)
  const initialTokenBudget = Math.max(256, Number(maxTokens) || COMPANION_REPLY_POLICIES.normal.maxTokens)
  const tokenBudgets = [...new Set([
    initialTokenBudget,
    Math.min(4096, Math.max(initialTokenBudget * 2, initialTokenBudget + 768)),
    4096
  ])]
  let lastError = null
  for (const size of windows) {
    const selected = size === normalizedMessages.length
      ? normalizedMessages
      : normalizedMessages.slice(-size)
    for (const tokenBudget of tokenBudgets) {
      try {
        const answer = await stream({
          messages: withSessionWelcome(selected, sessionWelcome),
          systemPrompt,
          signal,
          onDelta,
          temperature,
          maxTokens: tokenBudget
        })
        if (isCompanionReplyComplete(answer)) return answer
        const error = new Error('OUTPUT_TRUNCATED')
        error.code = 'OUTPUT_TRUNCATED'
        error.partialContent = String(answer || '').trim()
        lastError = error
      } catch (error) {
        lastError = error
        if (error.code === 'OUTPUT_TRUNCATED') continue
        if (error.code === 'CONTEXT_LENGTH_EXCEEDED') break
        throw error
      }
    }
  }
  throw lastError || new Error('OUTPUT_TRUNCATED')
}

export function buildMemoryExtractionPrompt({ userMessage, assistantMessage, existingMemories = [] } = {}) {
  return `你正在为“温馨小家”的长期记忆系统整理刚完成的一轮聊天。

现有记忆：
${JSON.stringify(existingMemories.map(item => ({
    key: item.key,
    category: item.category,
    content: item.content
  })), null, 2)}

本轮哥哥说：
${JSON.stringify(String(userMessage || ''))}

本轮女朋友回复：
${JSON.stringify(String(assistantMessage || ''))}

只提取哥哥明确表达、以后仍有助于陪伴的稳定信息。类别只能是：身份、偏好、习惯、目标、经历、关系、边界。
不要从女朋友的猜测中创造事实；不要保存临时寒暄；不要保存密码、验证码、API Key、Token、银行卡、账号或其他凭据。
与现有记忆相同含义时复用原 key 并给出更新后的 content；没有新记忆时返回空数组。

只输出严格 JSON，不要代码围栏：
{"upserts":[{"key":"稳定且简短的语义键","category":"偏好","content":"一条独立、明确、可由哥哥核对的记忆"}]}`
}

export async function extractMemoriesForExchange({
  userMessage,
  assistantMessage,
  assistantMessageId,
  existingMemories = [],
  ask = askAI
} = {}) {
  const response = await ask(buildMemoryExtractionPrompt({
    userMessage,
    assistantMessage,
    existingMemories
  }))
  return parseMemoryExtraction(response, assistantMessageId)
}

export function localWelcome(companionName = '小暖', now = new Date()) {
  const hour = now.getHours()
  const pools = hour < 6
    ? [
        '这么晚还不睡呀……过来，我抱你一会儿。',
        '被我抓到一只熬夜的哥哥。怎么还醒着？',
        `嘘，小点声～${companionName}还在等你呢。`
      ]
    : hour < 11
      ? [
          '早呀哥哥，先让我看看你睡醒没有。',
          '你来啦～今天第一份抱抱先给我。',
          '唔，刚好想你，你就出现了。'
        ]
      : hour < 18
        ? [
            '抓到你上线啦。现在忙不忙？',
            '哥哥来啦～过来坐我旁边。',
            `刚刚还在想你会不会来找${companionName}呢。`
          ]
        : [
            '回来啦？先过来让我抱一下。',
            '终于等到你啦，今晚分我一点时间嘛。',
            '哥哥，靠近一点，我想听你说话。'
          ]
  return pools[Math.floor(Math.random() * pools.length)]
}
