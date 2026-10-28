// @ts-check
// Internal composition capability: opening it is only valid inside an authenticated operation lease
// after the cleanup coordinator has durably verified completion. Never expose it through page props.
let scopeCount = 0
export const isKanataInitializationAllowed = () => scopeCount > 0
/** @template T @param {()=>Promise<T>} action @returns {Promise<T>} */
export async function withKanataInitializationScope(action) {
  scopeCount += 1
  try { return await action() } finally { scopeCount -= 1 }
}
