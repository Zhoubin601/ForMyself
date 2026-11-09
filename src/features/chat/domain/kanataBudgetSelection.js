// @ts-check

/** Keep only contenders that can fit the original ranked greedy selection. If an
 * entry has floor(budget/cost) higher ranked entries of the same cost ahead of it,
 * either those entries spend the budget or one already cannot fit. In both cases
 * the discarded entry cannot fit. Each nonempty bucket retains at most budget bytes.
 * @template T
 * @param {number} budget
 * @param {(a:T,b:T)=>number} compare
 */
export function createKanataBudgetSelection(budget, compare) {
  /** @type {Map<number,T[]>} */
  const buckets = new Map()
  return {
    /** @param {T} value @param {number} cost */
    offer(value, cost) {
      if (cost > budget) return
      const bucket = buckets.get(cost) ?? []
      if (!buckets.has(cost)) buckets.set(cost, bucket)
      const capacity = Math.floor(budget / cost)
      if (bucket.length === capacity && compare(value, bucket[capacity - 1]) >= 0) return
      let left = 0, right = bucket.length
      while (left < right) {
        const middle = Math.floor((left + right) / 2)
        if (compare(value, bucket[middle]) < 0) right = middle
        else left = middle + 1
      }
      bucket.splice(left, 0, value)
      if (bucket.length > capacity) bucket.pop()
    },
    finish() {
      const ranked = [...buckets].flatMap(([cost, entries]) => entries.map(value => ({ value, cost })))
        .sort((a, b) => compare(a.value, b.value))
      buckets.clear()
      const entries = []
      let remaining = budget
      for (const { value, cost } of ranked) {
        if (cost > remaining) continue
        entries.push(value)
        remaining -= cost
      }
      return entries
    },
  }
}
