import CryptoJS from 'crypto-js'
import { Filesystem } from '@capacitor/filesystem'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Capacitor } from '@capacitor/core'
import { preferenceStorage } from '../platform/storage/preferences.js'
import { restoreJournal } from '../platform/storage/restoreJournal.js'
import { restoreState } from '../platform/storage/restoreState.js'
import { useAuthStore } from '../stores/auth.js'
import { useProtectedAccessStore } from '../stores/protectedAccess.js'
import { useChatStore as useLegacyChatStore } from '../features/chat/chatStore.js'
import { useKanataStore } from '../features/chat/kanataStore.js'
import { createLegacyChatCleanup } from '../features/chat/legacy/legacyChatCleanup.js'
import { withKanataInitializationScope } from '../features/chat/domain/initializationGate.js'
import preset from '../features/chat/presets/abydos.v1.json'

/** Protected composition root. File deletion exists only in the explicitly confirmed cleanup coordinator. */
export function createKanataRuntime(adapters = {}) {
  const auth = adapters.auth || useAuthStore()
  const access = adapters.protectedAccess || useProtectedAccessStore()
  const store = adapters.store || useKanataStore()
  const legacy = adapters.legacyStore || useLegacyChatStore()
  const state = adapters.restoreState || restoreState
  const plugin = adapters.notifications || LocalNotifications
  // Android channels do not exist on Web/iOS; keep cancellation on the platform plugin.
  const notifications = {
    getPending: () => plugin.getPending(),
    cancel: options => plugin.cancel(options),
    listChannels: () => Capacitor.getPlatform() === 'android' || adapters.notifications ? plugin.listChannels() : Promise.resolve({ channels: [] }),
    deleteChannel: options => plugin.deleteChannel(options)
  }
  const cleanup = createLegacyChatCleanup({
    filesystem: adapters.filesystem || Filesystem, preferences: adapters.preferences || preferenceStorage,
    notifications, protectedAccess: access, restoreState: state,
    inspectRestoreJournal: adapters.inspectRestoreJournal || (() => restoreJournal.inspect()),
    legacyRuntime: {
      stop: () => legacy.retireForKanata(),
      assertStopped: () => legacy.isRetiredForKanata()
    },
    getSessionRevision: () => auth.sessionRevision,
    isAuthenticated: () => access.authenticated
  })
  return {
    probeLegacy: () => cleanup.probe(),
    async initialize({ confirm }) {
      if (state.blocked || state.busy) throw new Error('RESTORE_RECOVERY_REQUIRED')
      if (!await access.ensureModule('chat')) return { status: 'cancelled' }
      const result = await cleanup.run({ confirm })
      if (!result || result.status !== 'complete') return { status: 'cancelled' }
      const initialized = await access.runOperation(['chat'], async (_password, revision) => {
        if (state.blocked || state.busy || revision !== auth.sessionRevision) throw new Error('KANATA_SESSION_EXPIRED')
        // A previous seed can be visible while its disk write failed. Never label it successful until flush.
        await store.flush()
        if (store.snapshot?.worlds.length) return { status: 'already-initialized' }
        await withKanataInitializationScope(() => store.initializePreset(preset, {
          initializationKey: 'initial-abydos-v1', now: Date.now(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          idFactory: (kind, key) => kind + '-' + CryptoJS.SHA256(key).toString().slice(0, 32)
        }))
        await store.flush()
        return { status: 'initialized' }
      })
      return initialized || { status: 'cancelled' }
    }
  }
}
