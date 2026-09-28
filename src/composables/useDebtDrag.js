import { useSortableDrag } from './useSortableDrag.js'

// Native scrolling remains available until the handle's long press activates.
// Upgraded with 6 micro-interactions: grab lift, follow ghost, push shift, target proximity, magnetic snap, drop settle and cancel spring-back.
export function useDebtDrag({ items, disabled, listRef, onDrop, onInvalidDrop, resolveTarget, onHover }) {
  return useSortableDrag({
    items,
    disabled,
    listRef,
    itemSelector: '[data-debt-id]',
    idAttr: 'data-debt-id',
    onDrop,
    onInvalidDrop,
    resolveTarget,
    onHover,
    thresholdMs: 300
  })
}
