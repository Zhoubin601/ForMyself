// @ts-check

/** @param {string} password @param {string} salt */
export async function deriveKanataSqliteKek(password, salt) {
  if (typeof salt !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(salt)) {
    throw new Error('KANATA_SQLITE_UNLOCK_FAILED')
  }
  const decoded = atob(salt)
  if (decoded.length !== 16 || btoa(decoded) !== salt) throw new Error('KANATA_SQLITE_UNLOCK_FAILED')
  const encoder = new TextEncoder()
  const domain = encoder.encode('ForMyself/Kanata/KEK/v1\u0000')
  const domainSalt = new Uint8Array(domain.length + decoded.length)
  domainSalt.set(domain)
  for (let i = 0; i < decoded.length; i++) domainSalt[domain.length + i] = decoded.charCodeAt(i)
  const bytes = encoder.encode(password)
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveBits'])
    const key = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: domainSalt, iterations: 600000 },
      material, 256,
    )
    return new Uint8Array(key)
  } finally {
    bytes.fill(0)
  }
}
