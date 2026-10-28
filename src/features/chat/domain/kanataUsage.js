// @ts-check
export const KANATA_PRICE_SOURCE = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'
export const KANATA_PRICE_VERSION = 'deepseek-cny-20261028-range-v1'
/** Range covers peak/off-peak without guessing Chinese holiday calendars. Unknown legacy
 * model aliases/custom providers are deliberately unpriced. Estimated tokens are upper bounds.
 * @param {import('./kanataTypes').KanataUsageEvent} event
 */
export function estimateKanataCost(event) {
  const rates = event.model === 'deepseek-flash' || ['deepseek-v4-flash','deepseek-v4-flash-vision-exp'].includes(event.model) ? [0.04,2,8]
    : event.model === 'deepseek-v4-pro' ? [0.30,9,27] : null
  if (!event.officialProvider || !rates) return { minimumCny:null,maximumCny:null,version:KANATA_PRICE_VERSION,source:KANATA_PRICE_SOURCE,basis:'unpriced' }
  const input = event.usage?.promptTokens ?? event.estimatedInputTokens, output = event.usage?.completionTokens ?? event.estimatedOutputTokens
  // Missing cache breakdown: min assumes all input cache hits, max assumes all misses.
  const hit = event.usage?.cacheHitTokens
  const lowInput = hit === null || hit === undefined ? input*rates[0] : hit*rates[0]+(input-hit)*rates[1]
  const highInput = hit === null || hit === undefined ? input*rates[1] : lowInput
  return {minimumCny:(lowInput+output*rates[2])/2e6,maximumCny:(highInput+output*rates[2])/1e6,
    version:KANATA_PRICE_VERSION,source:KANATA_PRICE_SOURCE,basis:event.status==='pending'?'pending-unknown':event.usage?'provider-tokens':'estimated-upper-bound'}
}
