export function reorderDebtRecords(records, { orderedIds, isCleared }) {
  const selected = records.filter(item => Boolean(item.isCleared) === isCleared)
  const byId = new Map(selected.map(item => [item.id, item]))
  if (typeof isCleared !== 'boolean' || !Array.isArray(orderedIds) ||
    byId.size !== selected.length || orderedIds.length !== selected.length ||
    new Set(orderedIds).size !== orderedIds.length || orderedIds.some(id => !byId.has(id))) {
    throw new Error('DEBT_ORDER_CHANGED')
  }
  let index = 0
  return records.map(item => Boolean(item.isCleared) === isCleared ? byId.get(orderedIds[index++]) : item)
}

export function getSavingsProgress(debt) {
  const saved = (debt.records || []).reduce((sum, record) => sum + (Number(record.amount) || 0), 0)
  const target = Number(debt.totalAmount) || 0
  return { saved, target, remaining: Math.max(0, target - saved),
    percent: target > 0 ? Math.max(0, Math.min(100, Math.round(saved / target * 100))) : 0 }
}
