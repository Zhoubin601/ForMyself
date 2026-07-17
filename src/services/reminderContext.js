const MOOD_LABELS = {
  great: '非常好',
  good: '不错',
  normal: '一般',
  bad: '低落',
  terrible: '很糟糕'
}

const cleanText = (value, maxLength = 80) => String(value || '').trim().slice(0, maxLength)

export function buildMoodReminderContext(records = []) {
  return [...records]
    .filter(item => item?.date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3)
    .map(item => ({
      date: item.date,
      mood: MOOD_LABELS[item.mood] || '一般',
      note: cleanText(item.note)
    }))
}

export function buildWeightReminderContext(records = []) {
  return [...records]
    .filter(item => item?.date && Number.isFinite(Number(item.weight)))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3)
    .map(item => ({
      date: item.date,
      weight: Number(item.weight),
      note: cleanText(item.note, 50)
    }))
}

export function buildSavingsReminderContext(plans = []) {
  return plans
    .map(plan => {
      const records = Array.isArray(plan.records) ? plan.records : []
      const saved = records.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
      const total = Number(plan.totalAmount) || 0
      const latestRecord = [...records]
        .filter(item => item?.date)
        .sort((a, b) => b.date.localeCompare(a.date))[0]
      return {
        name: cleanText(plan.name, 30) || '未命名目标',
        saved,
        total,
        progress: total > 0 ? Math.min(100, Math.round((saved / total) * 100)) : 0,
        completed: plan.isCleared === true,
        latestDate: latestRecord?.date || plan.startDate || '',
        latestNote: cleanText(latestRecord?.note, 50)
      }
    })
    .sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      return b.latestDate.localeCompare(a.latestDate)
    })
    .slice(0, 3)
}

export function buildReminderContexts({ moodRecords = [], weightRecords = [], savedDebts = [] } = {}) {
  return {
    mood: buildMoodReminderContext(moodRecords),
    weight: buildWeightReminderContext(weightRecords),
    savings: buildSavingsReminderContext(savedDebts)
  }
}

export function getReminderContextFingerprint(context) {
  return JSON.stringify(context)
}

export function buildReminderPrompt(type, context) {
  const dataText = context.length ? JSON.stringify(context) : '暂无历史记录'
  const instructions = {
    mood: '结合最近三次心情评级和日记文字，先共情用户，再温柔提醒记录今天的心情。不要诊断心理疾病。',
    weight: '结合最近三次体重记录与备注，关心用户的坚持和感受，再温柔提醒记录体重。不要评价身材，不要给医疗结论。',
    savings: '结合最近的省钱计划、进度和记录，肯定用户的积累，再温柔提醒看看或记录省钱计划。不要制造财务焦虑。'
  }
  return `你正在为个人生活 App 生成一条手机通知正文。\n${instructions[type]}\n最近数据：${dataText}\n要求：只输出正文，35字以内，真诚自然，像熟悉用户的朋友，不要使用引号，不要声称你知道资料之外的事情。`
}
