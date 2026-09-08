export const MASTER_PASSWORD_VERIFIER_VERSION = 1
export const MASTER_PASSWORD_MIN_LENGTH = 4
export const MASTER_PASSWORD_PBKDF2_ITERATIONS = 210_000

const cleanPassword = value => String(value || '')
const textEncoder = new TextEncoder()

const bytesToHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

const hexToBytes = value => {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16)
  }
  return bytes
}

const randomSalt = cryptoProvider => {
  if (!cryptoProvider?.getRandomValues) throw new Error('SECURE_RANDOM_UNAVAILABLE')
  return bytesToHex(cryptoProvider.getRandomValues(new Uint8Array(16)))
}

const deriveWithWebCrypto = async (password, salt, iterations, cryptoProvider) => {
  const key = await cryptoProvider.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await cryptoProvider.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: hexToBytes(salt),
    iterations
  }, key, 256)
  return bytesToHex(new Uint8Array(bits))
}

const defaultWorkerFactory = () => {
  if (typeof Worker !== 'function') return null
  return new Worker(new URL('../workers/masterPasswordWorker.js', import.meta.url), { type: 'module' })
}

const deriveWithWorker = (password, salt, iterations, workerFactory) => new Promise((resolve, reject) => {
  const worker = workerFactory?.()
  if (!worker) return reject(new Error('PASSWORD_DERIVATION_UNAVAILABLE'))
  const cleanup = () => worker.terminate()
  worker.onmessage = event => {
    cleanup()
    if (event.data?.error) reject(new Error(event.data.error))
    else resolve(String(event.data?.verifier || ''))
  }
  worker.onerror = () => {
    cleanup()
    reject(new Error('PASSWORD_DERIVATION_WORKER_FAILED'))
  }
  worker.postMessage({ password, salt, iterations })
})

async function derivePasswordVerifier(password, salt, iterations, options = {}) {
  const cryptoProvider = options.cryptoProvider ?? globalThis.crypto
  if (cryptoProvider?.subtle) {
    return deriveWithWebCrypto(password, salt, iterations, cryptoProvider)
  }
  return deriveWithWorker(password, salt, iterations, options.workerFactory ?? defaultWorkerFactory)
}

export async function createMasterPasswordVerifier(password, options = {}) {
  const normalized = cleanPassword(password)
  if (normalized.length < MASTER_PASSWORD_MIN_LENGTH) throw new Error('MASTER_PASSWORD_TOO_SHORT')
  const cryptoProvider = options.cryptoProvider ?? globalThis.crypto
  const salt = options.salt || randomSalt(cryptoProvider)
  const iterations = Number(options.iterations) || MASTER_PASSWORD_PBKDF2_ITERATIONS
  const verifier = await derivePasswordVerifier(normalized, salt, iterations, options)
  return {
    version: MASTER_PASSWORD_VERIFIER_VERSION,
    algorithm: 'PBKDF2-HMAC-SHA256',
    iterations,
    salt,
    verifier
  }
}

export function normalizeMasterPasswordVerifier(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.version !== MASTER_PASSWORD_VERIFIER_VERSION) return null
  if (value.algorithm !== 'PBKDF2-HMAC-SHA256') return null
  const iterations = Number(value.iterations)
  const salt = String(value.salt || '')
  const verifier = String(value.verifier || '')
  if (!Number.isInteger(iterations) || iterations < 1) return null
  if (!/^[0-9a-f]{32}$/i.test(salt) || !/^[0-9a-f]{64}$/i.test(verifier)) return null
  return { ...value, iterations, salt: salt.toLowerCase(), verifier: verifier.toLowerCase() }
}

const timingSafeEqual = (left, right) => {
  if (left.length !== right.length) return false
  let different = 0
  for (let index = 0; index < left.length; index += 1) {
    different |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return different === 0
}

export function masterPasswordVerifierEquals(left, right) {
  const first = normalizeMasterPasswordVerifier(left)
  const second = normalizeMasterPasswordVerifier(right)
  if (!first || !second) return false
  return first.version === second.version
    && first.algorithm === second.algorithm
    && first.iterations === second.iterations
    && timingSafeEqual(first.salt, second.salt)
    && timingSafeEqual(first.verifier, second.verifier)
}

export async function verifyMasterPassword(password, value, options = {}) {
  const normalized = normalizeMasterPasswordVerifier(value)
  if (!normalized) return false
  try {
    const candidate = await createMasterPasswordVerifier(password, {
      ...options,
      salt: normalized.salt,
      iterations: normalized.iterations
    })
    return timingSafeEqual(candidate.verifier, normalized.verifier)
  } catch {
    return false
  }
}

export function validateNewMasterPassword(password, confirmation) {
  if (cleanPassword(password).length < MASTER_PASSWORD_MIN_LENGTH) return '新密码至少为 4 位'
  if (password !== confirmation) return '两次输入的密码不一致'
  return null
}
