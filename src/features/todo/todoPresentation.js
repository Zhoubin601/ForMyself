const names = ['日', '一', '二', '三', '四', '五', '六']
export function recurrenceSummary(rule = {}) {
  if (rule.type === 'daily') return '每天'
  if (rule.type === 'weekly') return rule.weekdays?.length ? `每周${rule.weekdays.map(day => names[day]).join('、')}` : '选择星期'
  if (rule.type === 'custom') return `每隔 ${rule.intervalDays || 2} 天`
  return '仅一天'
}
