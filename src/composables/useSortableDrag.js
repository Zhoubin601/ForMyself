import { computed, getCurrentInstance, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { registerBackHandler } from '../services/backNavigation.js'

export function useSortableDrag({
  items,
  disabled,
  listRef,
  itemSelector = '[data-drag-id]',
  idAttr = 'data-drag-id',
  onDrop,
  onInvalidDrop,
  resolveTarget,
  onHover,
  thresholdMs = 300,
  settleDuration = (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') ? 0 : 180
}) {
  const draggedId = ref(null)
  const previewIds = ref(null)
  const ghost = ref(null)
  const dragging = computed(() => draggedId.value !== null)

  let pending = null
  let timer = null
  let frame = null
  let settleTimer = null
  let scrollParent = null
  let lastFrame = 0
  let initialRect = null
  let lastCheckX = null
  let lastCheckY = null

  function isReducedMotion() {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function cleanupListeners() {
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', end)
    document.removeEventListener('pointercancel', cancel)
    document.removeEventListener('touchmove', preventScroll)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('blur', cancel)
    window.removeEventListener('resize', cancel)
  }

  function hardReset() {
    clearTimeout(timer)
    clearTimeout(settleTimer)
    cancelAnimationFrame(frame)
    if (pending?.handle?.hasPointerCapture?.(pending.pointerId)) {
      try { pending.handle.releasePointerCapture(pending.pointerId) } catch (_) {}
    }
    cleanupListeners()
    pending = null
    timer = frame = settleTimer = null
    scrollParent = null
    lastFrame = 0
    initialRect = null
    lastCheckX = null
    lastCheckY = null
    draggedId.value = null
    previewIds.value = null
    ghost.value = null
    onHover?.(null)
  }

  function visibility() {
    if (document.hidden) cancel()
  }

  function preventScroll(event) {
    if ((dragging.value || pending?.mode === 'scrolling') && event.cancelable) event.preventDefault()
  }

  function findScrollParent() {
    let parent = listRef.value?.parentElement
    while (parent && (
      !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)
      || parent.scrollHeight <= parent.clientHeight + 1
    )) {
      parent = parent.parentElement
    }
    return parent || document.scrollingElement || document.documentElement
  }

  function updatePosition(forceCheck = false) {
    if (!pending || !ghost.value || ghost.value.state === 'is-settling' || ghost.value.state === 'is-returning') return
    const top = pending.y - pending.offsetY
    ghost.value = {
      ...ghost.value,
      top
    }
    const target = resolveTarget?.({ x: pending.x, y: pending.y, id: draggedId.value })
    if (resolveTarget) {
      onHover?.(target)
      ghost.value = { ...ghost.value, invalid: target === null || target === undefined }
      if (target === null || target === undefined) return
    }
    if (!listRef.value) return

    // 避免微小抖动时频繁触发大量 getBoundingClientRect 导致掉帧卡顿
    if (!forceCheck && lastCheckY !== null && Math.hypot(pending.x - lastCheckX, pending.y - lastCheckY) < 4) {
      return
    }
    lastCheckX = pending.x
    lastCheckY = pending.y

    const attrName = idAttr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const nodes = [...listRef.value.querySelectorAll(itemSelector)]
      .filter(node => (node.dataset[attrName] || node.getAttribute(idAttr)) !== String(draggedId.value))

    const ids = new Map(items.value.map(item => [String(item.id), item.id]))
    const next = nodes.map(node => ids.get(node.dataset[attrName] || node.getAttribute(idAttr))).filter(Boolean)

    const isGrid = nodes.some(node => getComputedStyle(node.parentElement).display === 'grid')
    const index = nodes.findIndex(node => {
      const rect = node.getBoundingClientRect()
      if (!isGrid) return pending.y < rect.top + rect.height / 2
      if (pending.y < rect.top) return true
      return pending.y <= rect.bottom && pending.x < rect.left + rect.width / 2
    })

    next.splice(index < 0 ? next.length : index, 0, draggedId.value)
    if (next.join('|') !== previewIds.value?.join('|')) {
      previewIds.value = next
    }
  }

  function tick(time) {
    if (!pending || !dragging.value) return
    const elapsed = lastFrame ? Math.min(32, time - lastFrame) : 16
    lastFrame = time
    const bounds = scrollParent === document.scrollingElement
      ? { top: 0, bottom: window.innerHeight }
      : scrollParent.getBoundingClientRect()
    const top = Math.max(0, bounds.top)
    const bottom = Math.min(window.innerHeight, bounds.bottom)
    const edge = 64
    const speed = pending.y < top + edge ? -Math.min(1, (top + edge - pending.y) / edge)
      : pending.y > bottom - edge ? Math.min(1, (pending.y - bottom + edge) / edge) : 0
    if (speed) {
      const previousScrollTop = scrollParent.scrollTop
      scrollParent.scrollTop += speed * elapsed * 0.65
      if (Math.abs(scrollParent.scrollTop - previousScrollTop) > 0.5) {
        // Scroll changes item viewport positions even when the pointer is stationary.
        updatePosition(true)
      }
    }
    frame = requestAnimationFrame(tick)
  }

  function activate() {
    if (!pending || disabled.value) return hardReset()
    const card = pending.handle.closest(itemSelector)
    if (!card) return hardReset()

    const rect = card.getBoundingClientRect()
    pending.offsetY = pending.y - rect.top
    draggedId.value = pending.id
    previewIds.value = items.value.map(item => item.id)

    initialRect = { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
    ghost.value = {
      ...initialRect,
      state: 'is-lifting'
    }

    // Trigger subtle lift scale & deep shadow
    requestAnimationFrame(() => {
      if (ghost.value && ghost.value.state === 'is-lifting') {
        ghost.value.state = 'is-dragging'
      }
    })

    try { pending.handle.setPointerCapture?.(pending.pointerId) } catch (_) {}

    scrollParent ||= findScrollParent()

    if (pending.pointerType !== 'mouse') {
      try { navigator.vibrate?.(12) } catch (_) {}
    }
    frame = requestAnimationFrame(tick)
  }

  function start(event, id) {
    if (disabled.value || pending || (event.button !== undefined && event.button !== 0) || event.isPrimary === false) return
    hardReset()

    pending = {
      id,
      handle: event.currentTarget,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY
    }

    document.addEventListener('pointermove', move, { passive: false })
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', cancel)
    document.addEventListener('touchmove', preventScroll, { passive: false })
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', cancel)
    window.addEventListener('resize', cancel)

    if (event.pointerType === 'mouse') {
      // Mouse starts drag on movement threshold > 3px
    } else {
      timer = setTimeout(activate, thresholdMs)
    }
  }

  function move(event) {
    if (!pending || event.pointerId !== pending.pointerId) return
    const previousY = pending.y
    pending.x = event.clientX
    pending.y = event.clientY
    const distance = Math.hypot(pending.x - pending.startX, pending.y - pending.startY)
    let scrollDeltaY = pending.y - previousY

    if (!dragging.value) {
      if (pending.pointerType === 'mouse' && distance > 3) activate()
      else if (distance > 12 && pending.mode !== 'scrolling') {
        if (pending.pointerType === 'mouse') {
          hardReset()
          return
        }
        clearTimeout(timer)
        timer = null
        pending.mode = 'scrolling'
        scrollParent ||= findScrollParent()
        // The handle reserves touch input with touch-action:none, so reproduce
        // native vertical panning until the long-press threshold is reached.
      scrollDeltaY = pending.y - pending.startY
      }
    }

    if (dragging.value) {
      if (event.cancelable) event.preventDefault()
      updatePosition()
    } else if (pending?.mode === 'scrolling') {
      if (event.cancelable) event.preventDefault()
      scrollParent.scrollTop -= scrollDeltaY
    }
  }

  function end(event) {
    if (!pending || event.pointerId !== pending.pointerId) return
    cleanupListeners()

    if (!dragging.value) {
      hardReset()
      return
    }

    pending.x = event.clientX
    pending.y = event.clientY
    const bounds = listRef.value?.getBoundingClientRect()
    const hasMeasuredBounds = bounds && bounds.width > 0 && bounds.height > 0
    const isInsideList = !hasMeasuredBounds || (
      pending.x >= bounds.left && pending.x <= bounds.right &&
      pending.y >= bounds.top && pending.y <= bounds.bottom &&
      pending.y >= 0 && pending.y <= window.innerHeight
    )
    const target = resolveTarget ? resolveTarget({ x: pending.x, y: pending.y, id: draggedId.value }) : (isInsideList ? true : null)
    if (target === null || target === undefined) {
      onInvalidDrop?.()
      cancel({ invalid: true })
      return
    }

    const ids = previewIds.value ? [...previewIds.value] : null
    const droppedId = draggedId.value
    const dropMeta = { id: droppedId, targetId: target === true ? null : target }
    const effectiveSettle = isReducedMotion() ? 0 : settleDuration

    // Settle transition to target slot
    if (effectiveSettle > 0 && listRef.value && ghost.value) {
      const attrName = idAttr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      const targetNode = [...listRef.value.querySelectorAll(itemSelector)]
        .find(node => (node.dataset[attrName] || node.getAttribute(idAttr)) === String(draggedId.value))

      const targetRect = targetNode?.getBoundingClientRect() || initialRect
      if (targetRect) {
        ghost.value = {
          ...ghost.value,
          top: targetRect.top,
          left: targetRect.left,
          state: 'is-settling'
        }
      }

      settleTimer = setTimeout(() => {
        hardReset()
        if (ids && onDrop) onDrop(ids, dropMeta)
      }, effectiveSettle)
      return
    }

    hardReset()
    if (ids && onDrop) onDrop(ids, dropMeta)
  }

  function cancel({ invalid = false } = {}) {
    if (!pending && !ghost.value) return
    cleanupListeners()
    // A released item can still be in its settling window. Cancel that
    // pending commit before scheduling the return animation.
    clearTimeout(settleTimer)
    settleTimer = null

    if (!dragging.value) {
      hardReset()
      return
    }

    const effectiveSettle = isReducedMotion() ? 0 : settleDuration

    // Spring-back animation to initial coordinate
    if (effectiveSettle > 0 && initialRect && ghost.value) {
      ghost.value = {
        ...ghost.value,
        top: initialRect.top,
        left: initialRect.left,
        state: 'is-returning',
        invalid
      }

      settleTimer = setTimeout(() => {
        hardReset()
      }, effectiveSettle)
      return
    }

    hardReset()
  }

  const unregister = registerBackHandler(() => {
    cancel()
    return true
  }, {
    priority: 600,
    isActive: () => Boolean(pending || ghost.value)
  })

  const signature = computed(() => JSON.stringify(items.value.map(item => item.id)))
  watch(signature, hardReset)
  if (getCurrentInstance()) {
    onDeactivated(hardReset)
    onBeforeUnmount(() => {
      hardReset()
      unregister()
    })
  }

  return {
    start,
    cancel,
    dragging,
    draggedId,
    previewIds,
    ghost
  }
}
