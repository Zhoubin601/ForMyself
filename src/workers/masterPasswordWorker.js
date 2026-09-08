import CryptoJS from 'crypto-js'

self.onmessage = event => {
  try {
    const password = String(event.data?.password || '')
    const salt = String(event.data?.salt || '')
    const iterations = Number(event.data?.iterations)
    const verifier = CryptoJS.PBKDF2(password, CryptoJS.enc.Hex.parse(salt), {
      keySize: 256 / 32,
      iterations,
      hasher: CryptoJS.algo.SHA256
    }).toString()
    self.postMessage({ verifier })
  } catch {
    self.postMessage({ error: 'PASSWORD_DERIVATION_WORKER_FAILED' })
  }
}
