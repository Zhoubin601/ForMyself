import { protectedModules } from '../application/protectedModules.js'
import { assertOrdinaryWriteAllowed } from '../platform/storage/restoreState.js'
import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useAuthStore } from './auth.js'
import { appAlert, appChoose, appPrompt, resolveFeedbackDialog } from '../services/uiFeedback.js'
import { markAppPerformance, measureAppPerformance } from '../services/appPerformance.js'

export const createProtectedAccessStore = (registry = protectedModules, id = 'protectedAccess') => defineStore(id, () => {
  const auth = useAuthStore()
  const status = reactive(Object.fromEntries(registry.ids.map(id => [id, 'idle'])))
  const revision = ref(0)
  const recoveryRequired = ref(false)
  const releaseError = ref('')
  const authenticated = computed(() => Boolean(auth.savedMasterPwd) && !auth.isLocked)
  const stores = {}
  const pending = {}
  let authenticationPromise = null
  let dialogActive = false
  let releasePromise = Promise.resolve()
  const operations = new Set()
  let operationQueue = Promise.resolve()

  const authenticate = ({ force = false } = {}) => {
    if (!force && authenticated.value) return Promise.resolve(true)
    if (authenticationPromise) return authenticationPromise
    const session = auth.sessionRevision
    const task = (async () => {
      if (auth.isLocked || auth.loadError) return false
      dialogActive = true
      let method = 'password'
      try {
        if (auth.canUnlockWithBiometric) {
          method = await appChoose({ title: '验证身份', message: '验证后继续使用受保护功能。', options: [
            { value: 'biometric', label: '指纹验证' }, { value: 'password', label: '主密码验证' }
          ] })
        }
        if (!method || session !== auth.sessionRevision) return false
        let ok = false
        if (method === 'biometric') ok = await auth.unlockWithBiometric({ unlockApp: false })
        else {
          const password = await appPrompt('请输入主密码以继续。', '', {
            title: '安全验证', placeholder: '主密码', inputType: 'password', confirmText: '验证'
          })
          if (password === null || session !== auth.sessionRevision) return false
          ok = await auth.unlockWithPassword(password, { unlockApp: false })
        }
        if (session !== auth.sessionRevision) return false
        if (!ok) void appAlert('身份验证未通过，请重试。')
        return ok
      } finally {
        dialogActive = false
      }
    })()
    authenticationPromise = task
    task.finally(() => { if (authenticationPromise === task) authenticationPromise = null }).catch(() => {})
    return task
  }

  const runtime = async module => {
    if (!stores[module]) stores[module] = await registry.resolve(module)
    return stores[module]
  }

  const ensureModule = module => {
    if (!registry.has(module)) return Promise.resolve(false)
    if (recoveryRequired.value) return Promise.resolve(false)
    if (authenticated.value && status[module] === 'ready') return Promise.resolve(true)
    if (pending[module]) return pending[module]
    const session = auth.sessionRevision
    const task = (async () => {
      if (!await authenticate()) return false
      await releasePromise
      if (session !== auth.sessionRevision || !authenticated.value) return false
      status[module] = 'loading'
      markAppPerformance(`protected:${module}:start`)
      try {
        const target = await runtime(module)
        if (session !== auth.sessionRevision) return false
        await target.load(auth.savedMasterPwd)
        if (session !== auth.sessionRevision) return false
        if (target.loadError || !target.isDataLoaded) throw new Error('PROTECTED_DATA_LOAD_FAILED')
        status[module] = 'ready'
        if (Object.values(stores).every(target => !target.saveError)) releaseError.value = ''
        markAppPerformance(`protected:${module}:ready`)
        measureAppPerformance(`protected:${module}:load`, `protected:${module}:start`, `protected:${module}:ready`)
        if (registry.ids.every(id => status[id] === 'ready')) await auth.finalizeLegacyMigration()
        return session === auth.sessionRevision
      } catch {
        if (session === auth.sessionRevision) {
          status[module] = 'error'
          void appAlert('受保护数据无法安全载入，请保留现有数据并重试。', { title: '数据加载失败' })
        }
        return false
      }
    })().catch(() => false)
    pending[module] = task
    task.finally(() => { if (pending[module] === task) delete pending[module] }).catch(() => {})
    return task
  }

  const ensureModules = async (modules = registry.ids) => {
    if (!modules.length) return authenticate()
    const results = await Promise.all(modules.map(ensureModule))
    return results.every(Boolean)
  }

  // Keep existing data available to an already-started write transaction until it finishes.
  // UI access is revoked immediately; reloads wait for these writes and the subsequent release.
  const performOperation = async (modules, action) => {
    if (recoveryRequired.value) return false
    if (!await ensureModules(modules) || !authenticated.value) return false
    const password = auth.savedMasterPwd
    const session = auth.sessionRevision
    let finish
    const lease = new Promise(resolve => { finish = resolve })
    operations.add(lease)
    try {
      return await action(password, session)
    } catch (error) {
      if (error.rollbackFailed) {
        recoveryRequired.value = true
        registry.ids.forEach(id => { status[id] = 'error' })
        Object.values(stores).forEach(target => target.suspendPersistence())
      }
      throw error
    } finally {
      operations.delete(lease)
      finish()
    }
  }
  const runOperation = (modules, action, { recovering = false } = {}) => {
    const task = operationQueue.catch(() => {}).then(() => { if (!recovering) assertOrdinaryWriteAllowed(); return performOperation(modules, action) })
    operationQueue = task
    return task
  }

  watch(() => auth.sessionRevision, () => {
    revision.value += 1
    registry.ids.forEach(id => { status[id] = 'idle' })
    if (dialogActive) resolveFeedbackDialog(null)
    authenticationPromise = null
    registry.ids.forEach(id => { delete pending[id] })
    const previous = releasePromise
    const targets = Object.values(stores)
    const finishRelease = results => {
      if (results.some(result => result.status === 'rejected')) {
        releaseError.value = '部分数据尚未保存，请重新验证后重试；恢复前请勿强制结束或卸载应用。'
        void appAlert(releaseError.value, { title: '数据尚未保存' })
      }
    }
    if (operations.size) {
      releasePromise = Promise.all([previous, ...operations]).then(() => Promise.allSettled(targets.map(target => target.release()))).then(finishRelease)
    } else {
      const releases = targets.map(target => target.release())
      releasePromise = Promise.allSettled([previous, ...releases]).then(finishRelease)
    }
  }, { flush: 'sync' })

  const prepareRecovery = async () => {
    if (!await authenticate()) return false
    if (recoveryRequired.value) {
      recoveryRequired.value = false
      for (const module of Object.keys(status)) status[module] = 'idle'
    }
    return ensureModules()
  }

  const reencryptors = async () => Promise.all(registry.ids.map(async id => (await runtime(id)).reencrypt))
  const getRuntimeStore = async id => (await runtime(id)).store

  const persistenceIssues = computed(() => registry.ids.flatMap(id => status[id] === 'ready' && stores[id]?.saveError
    ? [{ id, message: stores[id].saveError, action: '重试保存', retry: () => stores[id].flush() }] : []))

  return { persistenceIssues, moduleIds: registry.ids, reencryptors, getRuntimeStore, prepareRecovery, status, revision, recoveryRequired, releaseError, authenticated, authenticate, ensureModule, ensureModules, runOperation }
})

export const useProtectedAccessStore = createProtectedAccessStore()
