import { Preferences } from '@capacitor/preferences'

export function createPreferenceStorage(driver = Preferences) {
  let mutationChain = Promise.resolve()
  const enqueueMutation = operation => {
    const result = mutationChain.catch(() => {}).then(operation)
    mutationChain = result.catch(() => {})
    return result
  }
  return Object.freeze({
    async get(options) {
      await mutationChain
      return driver.get(options)
    },
    set(options) {
      return enqueueMutation(() => driver.set(options))
    },
    remove(options) {
      return enqueueMutation(() => driver.remove(options))
    },
    async flush() {
      await mutationChain
    }
  })
}

export const preferenceStorage = createPreferenceStorage()

export const readJsonPreference = async (key, fallback) => {
  const { value } = await preferenceStorage.get({ key })
  return value == null ? fallback : JSON.parse(value)
}

export const writeJsonPreference = (key, value) => (
  preferenceStorage.set({ key, value: JSON.stringify(value) })
)
