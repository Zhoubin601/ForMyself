import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  pbkdf2,
  randomBytes,
} from 'node:crypto'
import { promisify } from 'node:util'
import { PORTABLE_TAG_SIZE } from '../../../../src/features/chat/backup/portable/constants.js'

const pbkdf2Async = promisify(pbkdf2)

/**
 * Create a Node.js `node:crypto` provider implementing PortableCryptoProvider.
 * @returns {import('../../../../src/features/chat/backup/portable/contracts').PortableCryptoProvider}
 */
export function createNodeCryptoProvider() {
  return {
    randomBytes(length) {
      return new Uint8Array(randomBytes(length))
    },
    async pbkdf2Sha256(passwordBytes, salt, iterations, keyLength) {
      const derived = await pbkdf2Async(passwordBytes, salt, iterations, keyLength, 'sha256')
      return new Uint8Array(derived)
    },
    hkdfSha256(ikm, salt, info, keyLength) {
      return new Uint8Array(hkdfSync('sha256', ikm, salt, info, keyLength))
    },
    aesGcmEncrypt(key, nonce, plaintext, aad) {
      const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: PORTABLE_TAG_SIZE })
      cipher.setAAD(aad)
      const c1 = cipher.update(plaintext)
      const c2 = cipher.final()
      const tag = cipher.getAuthTag()
      return new Uint8Array(Buffer.concat([c1, c2, tag]))
    },
    aesGcmDecrypt(key, nonce, ciphertextAndTag, aad) {
      if (ciphertextAndTag.byteLength < PORTABLE_TAG_SIZE) {
        throw new Error('TAG_MISSING')
      }
      const split = ciphertextAndTag.byteLength - PORTABLE_TAG_SIZE
      const ciphertext = ciphertextAndTag.subarray(0, split)
      const tag = ciphertextAndTag.subarray(split)
      const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: PORTABLE_TAG_SIZE })
      decipher.setAAD(aad)
      decipher.setAuthTag(tag)
      const p1 = decipher.update(ciphertext)
      const p2 = decipher.final()
      return new Uint8Array(Buffer.concat([p1, p2]))
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
