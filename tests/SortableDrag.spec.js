import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useSortableDrag } from '../src/composables/useSortableDrag.js'
import { dispatchBackAction, resetBackHandlersForTests } from '../src/services/backNavigation.js'

describe('useSortableDrag 6种物理微动效交互调度器', () => {
  let listEl, scrollContainer, items, disabled, onDrop, drag

  beforeEach(() => {
    resetBackHandlersForTests()
    items = ref([
      { id: '1', name: 'Item 1' },
      { id: '2', name: 'Item 2' },
      { id: '3', name: 'Item 3' }
    ])
    disabled = ref(false)
    onDrop = vi.fn()

    scrollContainer = document.createElement('div')
    scrollContainer.style.overflowY = 'auto'
    Object.defineProperties(scrollContainer, {
      clientHeight: { value: 300, configurable: true },
      scrollHeight: { value: 900, configurable: true }
    })
    scrollContainer.getBoundingClientRect = () => ({ top: 0, bottom: 300, height: 300, width: 320, left: 0, right: 320 })

    listEl = document.createElement('div')
    listEl.className = 'test-list'
    items.value.forEach((item, i) => {
      const card = document.createElement('div')
      card.className = 'test-item'
      card.dataset.dragId = item.id
      card.getBoundingClientRect = () => ({
        top: i * 100 - scrollContainer.scrollTop,
        bottom: (i + 1) * 100 - scrollContainer.scrollTop,
        height: 100,
        width: 300,
        left: 0,
        right: 300
      })
      const handle = document.createElement('button')
      handle.className = 'test-handle'
      handle.addEventListener('pointerdown', e => drag?.start(e, item.id))
      card.appendChild(handle)
      listEl.appendChild(card)
    })
    scrollContainer.appendChild(listEl)
    document.body.appendChild(scrollContainer)
  })

  afterEach(() => {
    drag?.cancel()
    document.body.innerHTML = ''
    resetBackHandlersForTests()
    vi.useRealTimers()
  })

  function pointer(target, type, x, y, pointerType = 'touch') {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, { pointerId: 1, pointerType, clientX: x, clientY: y, button: 0, isPrimary: true })
    target.dispatchEvent(event)
  }

  it('移动端长按 300ms 触发抓取抬起感并伴随震动', async () => {
    vi.useFakeTimers()
    const vibrateSpy = vi.fn()
    navigator.vibrate = vibrateSpy

    drag = useSortableDrag({
      items,
      disabled,
      listRef: ref(listEl),
      onDrop,
      thresholdMs: 300,
      settleDuration: 180
    })

    const handle = listEl.querySelector('.test-handle')
    pointer(handle, 'pointerdown', 20, 20)

    // 299ms 不激活
    await vi.advanceTimersByTimeAsync(299)
    expect(drag.dragging.value).toBe(false)
    expect(drag.ghost.value).toBeNull()

    // 300ms 触发
    await vi.advanceTimersByTimeAsync(1)
    expect(drag.dragging.value).toBe(true)
    expect(drag.ghost.value).not.toBeNull()
    expect(drag.ghost.value.state).toBe('is-lifting')
    expect(vibrateSpy).toHaveBeenCalledWith(12)
  })

  it('长按前从手柄滑动会取消拖动并手动滚动列表', async () => {
    vi.useFakeTimers()
    drag = useSortableDrag({
      items,
      disabled,
      listRef: ref(listEl),
      onDrop,
      thresholdMs: 300,
      settleDuration: 180
    })

    const handle = listEl.querySelector('.test-handle')
    scrollContainer.scrollTop = 20
    pointer(handle, 'pointerdown', 20, 20)
    pointer(document, 'pointermove', 20, 5)
    expect(scrollContainer.scrollTop).toBe(35)
    pointer(document, 'pointermove', 20, -15)
    expect(scrollContainer.scrollTop).toBe(55)
    await vi.advanceTimersByTimeAsync(300)

    expect(drag.dragging.value).toBe(false)
    expect(drag.ghost.value).toBeNull()
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('拖拽中实时推挤让位并更新预览顺序', async () => {
    vi.useFakeTimers()
    drag = useSortableDrag({
      items,
      disabled,
      listRef: ref(listEl),
      onDrop,
      thresholdMs: 300,
      settleDuration: 180
    })

    const handle = listEl.querySelector('.test-handle')
    pointer(handle, 'pointerdown', 20, 20)
    await vi.advanceTimersByTimeAsync(300)

    // 拖向第二项 (y = 160)
    pointer(document, 'pointermove', 20, 160)
    expect(drag.previewIds.value).toEqual(['2', '1', '3'])

    // 拖向第三项 (y = 260)
    pointer(document, 'pointermove', 20, 260)
    expect(drag.previewIds.value).toEqual(['2', '3', '1'])
  })

  it('两列网格同一行按左右落点排序，横向移动也更新预览', async () => {
    vi.useFakeTimers()
    listEl.style.display = 'grid'
    const cards = [...listEl.children]
    cards.forEach((card, index) => {
      const left = index % 2 ? 160 : 0
      const top = Math.floor(index / 2) * 120
      card.getBoundingClientRect = () => ({ left, top, right: left + 150, bottom: top + 100, width: 150, height: 100 })
    })
    drag = useSortableDrag({ items, disabled, listRef: ref(listEl), onDrop, thresholdMs: 300, settleDuration: 0 })
    pointer(listEl.querySelector('.test-handle'), 'pointerdown', 20, 20)
    await vi.advanceTimersByTimeAsync(300)

    pointer(document, 'pointermove', 250, 60)
    expect(drag.previewIds.value).toEqual(['2', '1', '3'])
    pointer(document, 'pointermove', 170, 60)
    expect(drag.previewIds.value).toEqual(['1', '2', '3'])
    pointer(document, 'pointermove', 250, 60)
    pointer(document, 'pointerup', 250, 60)
    expect(onDrop).toHaveBeenCalledWith(['2', '1', '3'], { id: '1', targetId: null })
  })

  it('边缘自动滚动时手指不动也会重新计算目标槽位', async () => {
    vi.useFakeTimers()
    drag = useSortableDrag({
      items,
      disabled,
      listRef: ref(listEl),
      onDrop,
      thresholdMs: 300,
      settleDuration: 180
    })

    const handle = listEl.querySelector('.test-handle')
    pointer(handle, 'pointerdown', 20, 40)
    await vi.advanceTimersByTimeAsync(300)

    pointer(document, 'pointermove', 20, 249)
    expect(drag.previewIds.value).toEqual(['2', '1', '3'])

    // The first edge-scroll frame moves row 3 above the stationary pointer.
    await vi.advanceTimersByTimeAsync(17)
    expect(scrollContainer.scrollTop).toBeGreaterThan(0)
    expect(drag.previewIds.value).toEqual(['2', '3', '1'])
  })

  it('释放时执行落地沉降动画并在结束后调用 onDrop', async () => {
    vi.useFakeTimers()
    drag = useSortableDrag({
      items,
      disabled,
      listRef: ref(listEl),
      onDrop,
      thresholdMs: 300,
      settleDuration: 180
    })

    const handle = listEl.querySelector('.test-handle')
    pointer(handle, 'pointerdown', 20, 20)
    await vi.advanceTimersByTimeAsync(300)

    pointer(document, 'pointermove', 20, 160)
    expect(drag.previewIds.value).toEqual(['2', '1', '3'])

    // 松手释放
    pointer(document, 'pointerup', 20, 160)
    // 正在进入 is-settling 落地沉降状态
    expect(drag.ghost.value.state).toBe('is-settling')
    expect(onDrop).not.toHaveBeenCalled()

    // 落地动画 180ms 结束后正式完成并清理
    await vi.advanceTimersByTimeAsync(180)
    expect(onDrop).toHaveBeenCalledWith(['2', '1', '3'], { id: '1', targetId: null })
    expect(drag.ghost.value).toBeNull()
    expect(drag.dragging.value).toBe(false)
  })

  it('返回键或取消时执行回弹原位动画且不触发 onDrop', async () => {
    vi.useFakeTimers()
    drag = useSortableDrag({
      items,
      disabled,
      listRef: ref(listEl),
      onDrop,
      thresholdMs: 300,
      settleDuration: 180
    })

    const handle = listEl.querySelector('.test-handle')
    pointer(handle, 'pointerdown', 20, 20)
    await vi.advanceTimersByTimeAsync(300)

    pointer(document, 'pointermove', 20, 220)
    // 按 Android 返回键取消
    expect(await dispatchBackAction()).toBe(true)
    expect(drag.ghost.value.state).toBe('is-returning')

    await vi.advanceTimersByTimeAsync(180)
    expect(onDrop).not.toHaveBeenCalled()
    expect(drag.ghost.value).toBeNull()
  })

  it('落地沉降期间返回取消不会延迟保存顺序', async () => {
    vi.useFakeTimers()
    drag = useSortableDrag({
      items,
      disabled,
      listRef: ref(listEl),
      onDrop,
      thresholdMs: 300,
      settleDuration: 180
    })

    pointer(listEl.querySelector('.test-handle'), 'pointerdown', 20, 20)
    await vi.advanceTimersByTimeAsync(300)
    pointer(document, 'pointermove', 20, 160)
    pointer(document, 'pointerup', 20, 160)
    expect(drag.ghost.value.state).toBe('is-settling')

    await vi.advanceTimersByTimeAsync(40)
    expect(await dispatchBackAction()).toBe(true)
    expect(drag.ghost.value.state).toBe('is-returning')
    await vi.advanceTimersByTimeAsync(300)
    expect(onDrop).not.toHaveBeenCalled()
    expect(drag.ghost.value).toBeNull()
  })

  it('只在有效分组松手；无效落点回弹且不更改数据', async () => {
    vi.useFakeTimers()
    const invalidDrop = vi.fn()
    drag = useSortableDrag({
      items, disabled, listRef: ref(listEl), onDrop, onInvalidDrop: invalidDrop,
      resolveTarget: ({ y }) => y < 300 ? '旅行' : null,
      thresholdMs: 300, settleDuration: 180
    })
    const handle = listEl.querySelector('.test-handle')
    pointer(handle, 'pointerdown', 20, 20)
    await vi.advanceTimersByTimeAsync(300)
    pointer(document, 'pointermove', 20, 360)
    expect(drag.ghost.value.invalid).toBe(true)
    pointer(document, 'pointerup', 20, 360)
    expect(invalidDrop).toHaveBeenCalledTimes(1)
    expect(drag.ghost.value.state).toBe('is-returning')
    await vi.advanceTimersByTimeAsync(180)
    expect(onDrop).not.toHaveBeenCalled()

    scrollContainer.scrollTop = 0
    pointer(handle, 'pointerdown', 20, 20)
    await vi.advanceTimersByTimeAsync(300)
    pointer(document, 'pointermove', 20, 160)
    pointer(document, 'pointerup', 20, 160)
    await vi.advanceTimersByTimeAsync(180)
    expect(onDrop).toHaveBeenCalledWith(['2', '1', '3'], { id: '1', targetId: '旅行' })
  })
})
