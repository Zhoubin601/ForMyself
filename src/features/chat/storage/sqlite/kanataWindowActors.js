// @ts-check

/** Pick a rotating window in the existing locale order without retaining all
 * actor IDs. Each partition pass streams keys and keeps one reservoir sample.
 * Once the start rank is known, one pass retains just the head and the tail.
 * @param {()=>AsyncIterable<string>} visit @param {number} offset @param {number} count */
export async function selectKanataWindowActors(visit, offset, count) {
  const compare = (/** @type {string} */ a, /** @type {string} */ b) =>
    a.localeCompare(b, 'en') || (a < b ? -1 : a > b ? 1 : 0)
  if (count <= 8) {
    const actors = []
    for await (const id of visit()) actors.push(id)
    actors.sort(compare)
    return [...actors.slice(offset), ...actors.slice(0, offset)]
  }
  /** @type {string|null} */
  let low = null, high = null, start = null
  while (start === null) {
    let pivot = '', candidates = 0
    for await (const id of visit()) {
      if ((low !== null && compare(id, low) <= 0) || (high !== null && compare(id, high) >= 0)) continue
      if (Math.random() < 1 / ++candidates) pivot = id
    }
    if (!pivot) throw new Error('KANATA_AUTONOMY_RANK_INVALID')
    let less = 0
    for await (const id of visit()) {
      if (low !== null && compare(id, low) <= 0) continue
      if (compare(id, pivot) < 0) less++
    }
    if (offset === less) start = pivot
    else if (offset < less) high = pivot
    else { low = pivot; offset -= less + 1 }
  }
  /** @type {string[]} */
  const head = []
  /** @type {string[]} */
  const tail = []
  for await (const id of visit()) {
    const group = compare(id, start) < 0 ? head : tail
    group.push(id)
    group.sort(compare)
    if (group.length > 8) group.pop()
  }
  return [...tail, ...head].slice(0, 8)
}
