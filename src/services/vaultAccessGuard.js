export const VAULT_ACCESS_RESULT = {
  GRANTED: 'GRANTED',
  BIOMETRIC_UNAVAILABLE: 'BIOMETRIC_UNAVAILABLE',
  BIOMETRIC_REJECTED: 'BIOMETRIC_REJECTED'
}

export async function verifyVaultSecretAccess({ checkAvailability, verifyIdentity }) {
  try {
    const availability = await checkAvailability()
    if (!availability?.isAvailable) {
      return {
        granted: false,
        code: VAULT_ACCESS_RESULT.BIOMETRIC_UNAVAILABLE,
        biometricErrorCode: availability?.errorCode ?? null
      }
    }
  } catch (error) {
    return { granted: false, code: VAULT_ACCESS_RESULT.BIOMETRIC_UNAVAILABLE, error }
  }

  try {
    await verifyIdentity()
    return { granted: true, code: VAULT_ACCESS_RESULT.GRANTED }
  } catch (error) {
    return { granted: false, code: VAULT_ACCESS_RESULT.BIOMETRIC_REJECTED, error }
  }
}
