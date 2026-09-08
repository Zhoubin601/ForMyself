export async function changeMasterPasswordTransaction({
  currentPassword,
  newPassword,
  reencryptors = [],
  commit
}) {
  const completed = []
  try {
    for (const reencrypt of reencryptors) {
      await reencrypt(newPassword)
      completed.push(reencrypt)
    }
    return await commit(newPassword)
  } catch (error) {
    const rollbackResults = await Promise.allSettled(
      [...completed].reverse().map(reencrypt => reencrypt(currentPassword))
    )
    if (rollbackResults.some(result => result.status === 'rejected')) {
      error.rollbackFailed = true
    }
    throw error
  }
}
