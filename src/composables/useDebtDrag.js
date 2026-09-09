import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { registerBackHandler } from '../services/backNavigation.js'

// Native scrolling remains available until the handle's long press activates.
export function useDebtDrag({ items, disabled, listRef, onDrop }) {
  const draggedId = ref(null)
  const previewIds = ref(null)
  const ghost = ref(null)
  const dragging = computed(() => draggedId.value !== null)
  let pending = null
  let timer = null
  let frame = null
  let scrollParent = null
  let lastFrame = 0

  function stop() {
    clearTimeout(timer)
    cancelAnimationFrame(frame)
    if (pending?.handle.hasPointerCapture?.(pending.pointerId)) pending.handle.releasePointerCapture(pending.pointerId)
    pending = null
    timer = frame = null
    lastFrame = 0
    draggedId.value = null
    previewIds.value = null
    ghost.value = null
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', end)
    document.removeEventListener('pointercancel', stop)
    document.removeEventListener('touchmove', preventScroll)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('blur', stop)
    window.removeEventListener('resize', stop)
  }

  function visibility() { if (document.hidden) stop() }
  function preventScroll(event) { if (dragging.value && event.cancelable) event.preventDefault() }

  function updatePosition() {
    if (!pending || !ghost.value) return
    ghost.value = { ...ghost.value, top: pending.y - pending.offsetY }
    const nodes = [...listRef.value.querySelectorAll('[data-debt-id]')]
      .filter(node => node.dataset.debtId !== String(draggedId.value))
    const ids = new Map(items.value.map(item => [String(item.id), item.id]))
    const next = nodes.map(node => ids.get(node.dataset.debtId))
    const index = nodes.findIndex(node => pending.y < node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2)
    next.splice(index < 0 ? next.length : index, 0, draggedId.value)
    if (next.join('|') !== previewIds.value?.join('|')) previewIds.value = next
  }

  function tick(time) {
    if (!pending || !dragging.value) return
    const elapsed = lastFrame ? Math.min(32, time - lastFrame) : 16
    lastFrame = time
    const bounds = scrollParent === document.scrollingElement
      ? { top: 0, bottom: window.innerHeight } : scrollParent.getBoundingClientRect()
    const top = Math.max(0, bounds.top)
    const bottom = Math.min(window.innerHeight, bounds.bottom)
    const edge = 64
    const speed = pending.y < top + edge ? -Math.min(1, (top + edge - pending.y) / edge)
      : pending.y > bottom - edge ? Math.min(1, (pending.y - bottom + edge) / edge) : 0
    if (speed) {
      scrollParent.scrollTop += speed * elapsed * 0.65
      updatePosition()
    }
    frame = requestAnimationFrame(tick)
  }

  function activate() {
    if (!pending || disabled.value) return stop()
    const card = pending.handle.closest('[data-debt-id]')
    if (!card) return stop()
    const rect = card.getBoundingClientRect()
    pending.offsetY = pending.y - rect.top
    draggedId.value = pending.id
    previewIds.value = items.value.map(item => item.id)
    ghost.value = { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
    pending.handle.setPointerCapture?.(pending.pointerId)
    scrollParent = listRef.value.parentElement
    while (scrollParent && !/(auto|scroll)/.test(getComputedStyle(scrollParent).overflowY)) scrollParent = scrollParent.parentElement
    scrollParent ||= document.scrollingElement || document.documentElement
    if (pending.pointerType !== 'mouse') navigator.vibrate?.(12)
    frame = requestAnimationFrame(tick)
  }

  function start(event, id) {
    if (disabled.value || pending || (event.button !== undefined && event.button !== 0) || event.isPrimary === false) return
    pending = { id, handle: event.currentTarget, pointerId: event.pointerId, pointerType: event.pointerType,
      x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY }
    document.addEventListener('pointermove', move, { passive: false })
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', stop)
    document.addEventListener('touchmove', preventScroll, { passive: false })
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', stop)
    window.addEventListener('resize', stop)
    if (event.pointerType !== 'mouse') timer = setTimeout(activate, 350)
  }

  function move(event) {
    if (!pending || event.pointerId !== pending.pointerId) return
    pending.x = event.clientX
    pending.y = event.clientY
    const distance = Math.hypot(pending.x - pending.startX, pending.y - pending.startY)
    if (!dragging.value) {
      if (pending.pointerType === 'mouse' && distance > 3) activate()
      else if (distance > 8) stop()
    }
    if (dragging.value) {
      if (event.cancelable) event.preventDefault()
      updatePosition()
    }
  }

  function end(event) {
    if (!pending || event.pointerId !== pending.pointerId) return
    const ids = previewIds.value ? [...previewIds.value] : null
    stop()
    if (ids) onDrop(ids)
  }

  const unregister = registerBackHandler(() => { stop(); return true }, { priority: 600, isActive: () => Boolean(pending) })
  const signature = computed(() => JSON.stringify(items.value.map(item => item.id)))
  watch(signature, stop)
  onDeactivated(stop)
  onBeforeUnmount(() => { stop(); unregister() })
  return { start, cancel: stop, dragging, draggedId, previewIds, ghost }
}
