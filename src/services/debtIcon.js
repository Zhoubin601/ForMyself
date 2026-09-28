const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh', { granularity: 'grapheme' })
  : null

export function debtIconGraphemes(value) {
  const text = String(value ?? '').replace(/\s+/gu, '')
  return segmenter
    ? Array.from(segmenter.segment(text), part => part.segment)
    : Array.from(text)
}

export function normalizeDebtIconLabel(value) {
  return debtIconGraphemes(value).slice(0, 2).join('')
}
