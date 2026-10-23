export async function changeMasterPasswordTransaction({
  currentPassword,
  newPassword,
  reencryptors = [],
  commit
}) {
  const completed = []
  try {
    for (const reencrypt of reencryptors) {
      completed.push(reencrypt)
      await reencrypt(newPassword)
    }
    return await commit(newPassword)
  } catch (error) {
    for (const reencrypt of [...completed].reverse()) {
      try {
        await reencrypt(currentPassword)
      } catch {
        error.rollbackFailed = true
      }
    }
    throw error
  }
}
