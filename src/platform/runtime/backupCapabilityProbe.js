// @ts-check
// Platform runtime & WebView / Capacitor Bridge capability probe for encrypted backup & restore.
// Never relies on Capacitor.isPluginAvailable() alone: requires a live Native handshake round-trip
// on Android, validates WebView version against Capacitor 8 thresholds (55 hard / 60 default),
// and preserves Web's existing encrypted file adapter without forcing SQLite WASM/OPFS.

import { Capacitor, registerPlugin } from '@capacitor/core'

export const CAPACITOR_HARD_MIN_WEBVIEW = 55
export const CAPACITOR_DEFAULT_MIN_WEBVIEW = 60

const NativeCapabilityPlugin = registerPlugin('KanataRuntimeCapability')

/**
 * Parse major integer version from a WebView version string (e.g. "113.0.5672.136" -> 113).
 * @param {unknown} versionName
 * @returns {number | null}
 */
export function parseWebViewMajorVersion(versionName) {
  if (typeof versionName !== 'string' || !versionName.trim()) return null
  const match = versionName.trim().match(/^(\d+)/)
  if (!match) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * Pure deterministic capability evaluation from platform + native handshake evidence.
 * @param {{
 *   platform: string,
 *   pluginAvailable: boolean,
 *   handshakeOk: boolean,
 *   handshakeErrorCode?: string,
 *   nativeInfo?: Record<string, unknown> | null,
 *   now?: number,
 * }} input
 * @returns {import('../../application/contracts').BackupRuntimeCapability}
 */
export function evaluateBackupCapability({
  platform,
  pluginAvailable,
  handshakeOk,
  handshakeErrorCode = '',
  nativeInfo = null,
  now = Date.now(),
}) {
  if (platform === 'web') {
    return {
      platform: 'web',
      checkedAt: now,
      androidApi: null,
      androidRelease: '',
      webviewPackage: '',
      webviewVersion: '',
      webviewMajorVersion: null,
      bridgeStatus: 'not_applicable',
      bridgeHandshakeOk: false,
      sqlitePluginStatus: 'web_encrypted_file_adapter',
      safStatus: 'browser_file_api',
      // F03: Web stays on the existing encrypted .json file adapter without forcing WASM/OPFS.
      // Because Web does NOT implement KPB1 isolated SQLCipher restore, it must honestly report
      // portableRestoreAvailable=false rather than conflating legacy JSON restore availability.
      portableRestoreAvailable: false,
      unavailableCode: 'WEB_KPB1_RESTORE_UNAVAILABLE',
      unavailableReason: '当前 Web 浏览器沿用加密 .json 文件适配器，未启用 KPB1 隔离 SQLCipher 恢复；请继续使用上方现有加密 .json 备份与恢复。',
    }
  }

  if (platform !== 'android') {
    return {
      platform: platform === 'ios' ? 'ios' : 'unknown',
      checkedAt: now,
      androidApi: null,
      androidRelease: '',
      webviewPackage: '',
      webviewVersion: '',
      webviewMajorVersion: null,
      bridgeStatus: 'unavailable',
      bridgeHandshakeOk: false,
      sqlitePluginStatus: 'missing',
      safStatus: 'unavailable',
      portableRestoreAvailable: false,
      unavailableCode: 'UNSUPPORTED_PLATFORM',
      unavailableReason: '当前平台尚未启用 SQLCipher 隔离恢复桥接能力。',
    }
  }

  const info = nativeInfo && typeof nativeInfo === 'object' ? nativeInfo : {}
  const androidApi = typeof info.androidApi === 'number' && Number.isInteger(info.androidApi) ? info.androidApi : null
  const androidRelease = typeof info.androidRelease === 'string' ? info.androidRelease : ''
  const webviewPackage = typeof info.webviewPackage === 'string' ? info.webviewPackage : ''
  const webviewVersion = typeof info.webviewVersion === 'string' ? info.webviewVersion : ''
  const parsedMajor = typeof info.webviewMajorVersion === 'number' && info.webviewMajorVersion > 0
    ? info.webviewMajorVersion
    : parseWebViewMajorVersion(webviewVersion)

  const sqliteRegistered = info.sqlitePluginRegistered === true
  const sqliteActivated = info.sqlitePluginActivated === true
  const safAvailable = info.safAvailable === true

  /** @type {'ready' | 'registered_not_activated' | 'missing'} */
  const sqlitePluginStatus = sqliteActivated
    ? 'ready'
    : (sqliteRegistered ? 'registered_not_activated' : 'missing')
  /** @type {'available' | 'unavailable'} */
  const safStatus = safAvailable ? 'available' : 'unavailable'

  if (parsedMajor !== null && parsedMajor < CAPACITOR_DEFAULT_MIN_WEBVIEW) {
    return {
      platform: 'android',
      checkedAt: now,
      androidApi,
      androidRelease,
      webviewPackage,
      webviewVersion,
      webviewMajorVersion: parsedMajor,
      bridgeStatus: 'blocked_webview',
      bridgeHandshakeOk: false,
      sqlitePluginStatus,
      safStatus,
      portableRestoreAvailable: false,
      unavailableCode: 'WEBVIEW_BELOW_CAPACITOR_FLOOR',
      unavailableReason: parsedMajor < CAPACITOR_HARD_MIN_WEBVIEW
        ? `系统 WebView 版本（${webviewVersion || parsedMajor}）低于 Capacitor 8 硬性最低要求（>= ${CAPACITOR_HARD_MIN_WEBVIEW}，建议 >= ${CAPACITOR_DEFAULT_MIN_WEBVIEW}），Bridge 不可初始化，已阻止隔离恢复操作。`
        : `系统 WebView 版本（${webviewVersion || parsedMajor}）低于 Capacitor 8 默认兼容要求（>= ${CAPACITOR_DEFAULT_MIN_WEBVIEW}），已阻止隔离恢复操作。`,
    }
  }

  if (!pluginAvailable) {
    return {
      platform: 'android',
      checkedAt: now,
      androidApi,
      androidRelease,
      webviewPackage,
      webviewVersion,
      webviewMajorVersion: parsedMajor,
      bridgeStatus: 'unavailable',
      bridgeHandshakeOk: false,
      sqlitePluginStatus,
      safStatus,
      portableRestoreAvailable: false,
      unavailableCode: 'BRIDGE_UNAVAILABLE',
      unavailableReason: 'Capacitor Native Bridge 或能力探测插件不可用（常见于低版本系统 WebView），已阻止隔离恢复操作。',
    }
  }

  if (!handshakeOk) {
    const code = handshakeErrorCode === 'HANDSHAKE_TIMEOUT'
      ? 'HANDSHAKE_TIMEOUT'
      : (handshakeErrorCode === 'HANDSHAKE_NONCE_MISMATCH' ? 'HANDSHAKE_NONCE_MISMATCH' : 'HANDSHAKE_FAILED')
    return {
      platform: 'android',
      checkedAt: now,
      androidApi,
      androidRelease,
      webviewPackage,
      webviewVersion,
      webviewMajorVersion: parsedMajor,
      bridgeStatus: 'handshake_failed',
      bridgeHandshakeOk: false,
      sqlitePluginStatus,
      safStatus,
      portableRestoreAvailable: false,
      unavailableCode: code,
      unavailableReason: code === 'HANDSHAKE_TIMEOUT'
        ? 'Native Bridge 握手超时，无法确认原生 SQLCipher 与 SAF 可用性。'
        : 'Native Bridge 实测握手失败，无法安全执行隔离恢复。',
    }
  }

  if (!sqliteRegistered) {
    return {
      platform: 'android',
      checkedAt: now,
      androidApi,
      androidRelease,
      webviewPackage,
      webviewVersion,
      webviewMajorVersion: parsedMajor,
      bridgeStatus: 'ready',
      bridgeHandshakeOk: true,
      sqlitePluginStatus: 'missing',
      safStatus,
      portableRestoreAvailable: false,
      unavailableCode: 'SQLITE_PLUGIN_MISSING',
      unavailableReason: '原生 KanataSqlite 插件未注册，无法创建隔离 SQLCipher 临时库。',
    }
  }

  if (!sqliteActivated) {
    return {
      platform: 'android',
      checkedAt: now,
      androidApi,
      androidRelease,
      webviewPackage,
      webviewVersion,
      webviewMajorVersion: parsedMajor,
      bridgeStatus: 'ready',
      bridgeHandshakeOk: true,
      sqlitePluginStatus: 'registered_not_activated',
      safStatus,
      portableRestoreAvailable: false,
      unavailableCode: 'SQLITE_PLUGIN_NOT_ACTIVATED',
      unavailableReason: '当前普通构建保持 legacy 存储隔离（SQLCipher 候选未激活），不可执行 SQLCipher 便携恢复。',
    }
  }

  if (!safAvailable) {
    return {
      platform: 'android',
      checkedAt: now,
      androidApi,
      androidRelease,
      webviewPackage,
      webviewVersion,
      webviewMajorVersion: parsedMajor,
      bridgeStatus: 'ready',
      bridgeHandshakeOk: true,
      sqlitePluginStatus: 'ready',
      safStatus: 'unavailable',
      portableRestoreAvailable: false,
      unavailableCode: 'SAF_UNAVAILABLE',
      unavailableReason: '系统文档选择器（SAF）不可用，无法安全流式读取加密备份文件。',
    }
  }

  return {
    platform: 'android',
    checkedAt: now,
    androidApi,
    androidRelease,
    webviewPackage,
    webviewVersion,
    webviewMajorVersion: parsedMajor,
    bridgeStatus: 'ready',
    bridgeHandshakeOk: true,
    sqlitePluginStatus: 'ready',
    safStatus: 'available',
    portableRestoreAvailable: true,
    unavailableCode: '',
    unavailableReason: '',
  }
}

/**
 * Probe current runtime capabilities with a real Native Bridge handshake on Android.
 * @param {{
 *   capacitor?: Pick<typeof Capacitor, 'getPlatform' | 'isPluginAvailable'>,
 *   plugin?: { handshake(options: { nonce: string }): Promise<Record<string, unknown>> },
 *   timeoutMs?: number,
 *   now?: () => number,
 *   createNonce?: () => string,
 * }} [options]
 * @returns {Promise<import('../../application/contracts').BackupRuntimeCapability>}
 */
export async function probeBackupRuntimeCapability({
  capacitor = Capacitor,
  plugin = NativeCapabilityPlugin,
  timeoutMs = 3000,
  now = Date.now,
  createNonce = () => `probe-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
} = {}) {
  const platform = typeof capacitor?.getPlatform === 'function' ? capacitor.getPlatform() : 'web'
  if (platform !== 'android') {
    return evaluateBackupCapability({
      platform,
      pluginAvailable: false,
      handshakeOk: false,
      now: now(),
    })
  }

  const pluginAvailable = typeof capacitor?.isPluginAvailable === 'function'
    ? Boolean(capacitor.isPluginAvailable('KanataRuntimeCapability'))
    : false

  if (!pluginAvailable || typeof plugin?.handshake !== 'function') {
    return evaluateBackupCapability({
      platform: 'android',
      pluginAvailable: false,
      handshakeOk: false,
      now: now(),
    })
  }

  const nonce = createNonce()
  let timerId = null
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => plugin.handshake({ nonce })),
      new Promise((_, reject) => {
        timerId = setTimeout(() => reject(Object.assign(new Error('HANDSHAKE_TIMEOUT'), { code: 'HANDSHAKE_TIMEOUT' })), timeoutMs)
      }),
    ])
    const res = response && typeof response === 'object' ? /** @type {Record<string, unknown>} */ (response) : null
    if (!res || res.ok !== true || res.bridgeHandshakeOk !== true || res.nonce !== nonce) {
      return evaluateBackupCapability({
        platform: 'android',
        pluginAvailable: true,
        handshakeOk: false,
        handshakeErrorCode: res && res.nonce !== nonce ? 'HANDSHAKE_NONCE_MISMATCH' : 'HANDSHAKE_FAILED',
        nativeInfo: res,
        now: now(),
      })
    }
    return evaluateBackupCapability({
      platform: 'android',
      pluginAvailable: true,
      handshakeOk: true,
      nativeInfo: res,
      now: now(),
    })
  } catch (error) {
    const errCode = error && typeof error === 'object' && 'code' in error && error.code === 'HANDSHAKE_TIMEOUT'
      ? 'HANDSHAKE_TIMEOUT'
      : 'HANDSHAKE_FAILED'
    return evaluateBackupCapability({
      platform: 'android',
      pluginAvailable: true,
      handshakeOk: false,
      handshakeErrorCode: errCode,
      now: now(),
    })
  } finally {
    if (timerId !== null) clearTimeout(timerId)
  }
}

/** @type {Set<() => void>} */
const capabilityResumeListeners = new Set()

/**
 * Subscribe to app foreground-resume notifications dispatched by the composition root.
 * Keeps native Capacitor App event ownership centralized in useAppController.
 * @param {() => void} listener
 * @returns {() => void}
 */
export function subscribeBackupCapabilityResume(listener) {
  if (typeof listener !== 'function') return () => {}
  capabilityResumeListeners.add(listener)
  return () => {
    capabilityResumeListeners.delete(listener)
  }
}

/**
 * Notify active backup-capability consumers that the app resumed to the foreground.
 */
export function notifyBackupCapabilityResume() {
  for (const listener of [...capabilityResumeListeners]) {
    try {
      listener()
    } catch {
      // Listener errors must never interrupt app resume lifecycle.
    }
  }
}
