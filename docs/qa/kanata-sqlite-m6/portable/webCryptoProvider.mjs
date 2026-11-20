import { createHash, webcrypto } from 'node:crypto'

const { subtle } = webcrypto

/**
 * Independent WebCrypto provider (PBKDF2, HKDF, AES-GCM via subtle; SHA-256 via Node crypto hash)
 * for cross-checking vectors without sharing Node cipher/KDF implementations.
 * @returns {import('../../../../src/features/chat/backup/portable/contracts').PortableCryptoProvider}
 */
export function createWebCryptoProvider() {
  return {
    randomBytes(length) {
      const out = new Uint8Array(length)
      webcrypto.getRandomValues(out)
      return out
    },
    async pbkdf2Sha256(passwordBytes, salt, iterations, keyLength) {
      const rawKey = await subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits'])
      const bits = await subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        rawKey,
        keyLength * 8,
      )
      return new Uint8Array(bits)
    },
    async hkdfSha256(ikm, salt, info, keyLength) {
      const rawKey = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
      const bits = await subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt, info },
        rawKey,
        keyLength * 8,
      )
      return new Uint8Array(bits)
    },
    async aesGcmEncrypt(key, nonce, plaintext, aad) {
      const cryptoKey = await subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt'])
      const encrypted = await subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
        cryptoKey,
        plaintext,
      )
      return new Uint8Array(encrypted)
    },
    async aesGcmDecrypt(key, nonce, ciphertextAndTag, aad) {
      const cryptoKey = await subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt'])
      const decrypted = await subtle.decrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
        cryptoKey,
        ciphertextAndTag,
      )
      return new Uint8Array(decrypted)
    },
    createSha256() {
      const hash = createHash('sha256')
      return {
        update(chunk) {
          hash.update(chunk)
        },
        digest() {
          return new Uint8Array(hash.digest())
        },
      }
    },
  }
}
