import { reactive } from 'vue'

export const restoreState = reactive({ blocked: false, busy: false, message: '', syncError: '' })
export function assertOrdinaryWriteAllowed() {
  if (restoreState.blocked) throw new Error('完整数据恢复尚未完成，请先恢复数据再继续修改')
}
