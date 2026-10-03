import { preferenceStorage } from '../../platform/storage/preferences.js'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { applyTodoCommand, normalizeTodoData } from './todoCore.js'

export const TODO_STORAGE_KEY = 'my_todo_data_v1'
export const TodoNative = registerPlugin('Todo')
export function createTodoRepository(storage = preferenceStorage, nativeDriver = null) {
  let chain = Promise.resolve()
  const read = async () => {
    if (nativeDriver) return normalizeTodoData(await nativeDriver.read())
    const { value } = await storage.get({ key: TODO_STORAGE_KEY })
    return normalizeTodoData(value ? JSON.parse(value) : {})
  }
  return {
    read: () => chain.then(read),
    apply(command) {
      const result = chain.catch(() => {}).then(async () => {
        for (let attempt = 0; attempt < 8; attempt++) {
          const current = await read()
          const next = applyTodoCommand(current, command)
          try {
            if (nativeDriver) return normalizeTodoData(await nativeDriver.write({ expectedRevision:current.revision, data:next }))
            await storage.set({ key: TODO_STORAGE_KEY, value: JSON.stringify(next) })
            return next
          } catch(e) { if (e.code !== 'TODO_CONFLICT') throw e }
        }
        throw new Error('其他位置正在修改待办，请重试')
      })
      chain = result.catch(() => {})
      return result
    },
    flush: () => chain
  }
}
export const todoRepository = createTodoRepository(preferenceStorage, Capacitor.getPlatform() === 'android' ? TodoNative : null)
