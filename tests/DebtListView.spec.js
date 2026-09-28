import { DOMWrapper, mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import DebtListView from '../src/components/DebtListView.vue'
import { dispatchBackAction, resetBackHandlersForTests } from '../src/services/backNavigation.js'
import { preferenceStorage as Preferences } from '../src/platform/storage/preferences.js'
import { STORAGE_KEYS } from '../src/platform/storage/keys.js'

const mocks = vi.hoisted(() => ({ store: null, settings: null, auth: null, askAI: vi.fn(), toast: vi.fn() }))
vi.mock('../src/stores/debt', () => ({ useDebtStore: () => mocks.store }))
vi.mock('../src/stores/settings', () => ({ useSettingsStore: () => mocks.settings }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => mocks.auth }))
vi.mock('../src/services/aiEngine', () => ({ askAI: mocks.askAI }))
vi.mock('../src/services/uiFeedback', () => ({ appAlert: vi.fn(), appConfirm: vi.fn(), appToast: mocks.toast }))
let wrapper
beforeEach(() => {
  mocks.store = reactive({ savedDebts: Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `计划${i}`, totalAmount: 100, records: [{ amount: i }], startDate: '2026-09-08' })), debtGroups: ['未分组'], isDataLoaded: true,
    addDebt: vi.fn(item => { mocks.store.savedDebts.push(item) }),
    updateDebts: vi.fn(items => { mocks.store.savedDebts = items }),
    reorderDebtGroups: vi.fn(async names => { mocks.store.debtGroups = [...names] }),
    arrangeDebts: vi.fn(async ({ orderedIds, movedId, targetGroup }) => { mocks.store.savedDebts = orderedIds.map(id => {
      const item = mocks.store.savedDebts.find(record => record.id === id)
      return id === movedId && targetGroup ? { ...item, group: targetGroup } : item
    }) }) })
  mocks.settings = reactive({ lastEncouragement: '', aiApiKey: '', bannerSettings: { prefix: '旧自定义标题', subtitle: '旧自定义鼓励词' } })
  mocks.auth = reactive({ isLocked: false })
  mocks.askAI.mockReset()
  mocks.toast.mockReset()
  resetBackHandlersForTests()
})
afterEach(() => { wrapper?.unmount(); vi.useRealTimers(); document.body.innerHTML = ''; resetBackHandlersForTests() })
function render() { wrapper = mount(DebtListView, { attachTo: document.body, global: { stubs: { AppDateField: true } } }); return wrapper }
function modal(selector) { return new DOMWrapper(document.querySelector(`.apple-modal-card ${selector}`)) }
function pointer(target, type, y, pointerType = 'touch') {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 1, pointerType, clientX: 100, clientY: y, button: 0 })
  target.dispatchEvent(event)
}
function geometry() {
  wrapper.findAll('[data-debt-id]').forEach((card, i) => {
    card.element.getBoundingClientRect = () => ({ top: i * 200, bottom: (i + 1) * 200, height: 200, width: 360, left: 0 })
  })
}
function touchList(element, type, distance) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', { value: distance === null ? [] : [
    { clientX: 100, clientY: 100 },
    { clientX: 100 + distance, clientY: 100 }
  ] })
  element.dispatchEvent(event)
}

describe('省钱计划页面', () => {
  it('空列表、单项、长名称和超额金额保持完整展示并限制排序', async () => {
    mocks.store.savedDebts = []
    render()
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    mocks.store.savedDebts = [{ id: 'long', name: '非常长的省钱目标'.repeat(12), totalAmount: 1, records: [{ amount: 999999999.99 }], startDate: '2026-09-08', isCleared: true }]
    await wrapper.findAll('.segment')[1].trigger('click')
    expect(wrapper.find('.drag-handle').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.goal-heading h2').text()).toBe(mocks.store.savedDebts[0].name)
    expect(wrapper.find('.saved-amount').text()).toBe('¥999,999,999.99')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('100')
  })
  it('撤销写入失败保留当前顺序，分类变化取消撤销入口', async () => {
    render()
    await wrapper.find('.more-button').trigger('click')
    await wrapper.findAll('.card-menu button')[2].trigger('click')
    await flushPromises()
    mocks.store.arrangeDebts.mockRejectedValueOnce(new Error('disk'))
    document.querySelector('.order-toast button').click()
    await flushPromises()
    expect(mocks.store.savedDebts[0].id).toBe('1')
    expect(mocks.toast).toHaveBeenCalledWith('撤销失败，顺序未改变', { tone: 'danger' })
    await wrapper.findAll('.segment')[1].trigger('click')
    expect(document.querySelector('.order-toast')).toBeNull()
  })
  it('固定标题、默认鼓励、真实进度与连续列表，取消旧自定义内容', () => {
    render()
    expect(wrapper.find('h1').text()).toBe('省钱计划')
    expect(wrapper.text()).toContain('小小改变，大大未来')
    expect(wrapper.text()).not.toContain('旧自定义')
    expect(wrapper.find('.density-controls').exists()).toBe(false)
    expect(wrapper.find('.savings-group-tools').exists()).toBe(false)
    expect(wrapper.find('.sort-hint').exists()).toBe(false)
    expect(wrapper.findAll('[data-debt-id]')).toHaveLength(12)
    expect(wrapper.findAll('[role="progressbar"]')[1].attributes('aria-valuenow')).toBe('1')
  })
  it('新建和编辑计划可保存 emoji 或短标签，清空后恢复默认图标', async () => {
    render()
    await wrapper.find('.add-btn').trigger('click')
    await modal('#new-debt-icon').setValue('👩🏽‍🚀')
    await modal('input[placeholder="例如：换新电脑"]').setValue('火箭计划')
    await modal('input[type="number"]').setValue('1000')
    await modal('.button-primary.full-width').trigger('click')
    expect(mocks.store.savedDebts.at(-1).iconLabel).toBe('👩🏽‍🚀')
    let card = wrapper.findAll('[data-debt-id]').find(item => item.find('.goal-heading h2').text() === '火箭计划')
    expect(card.find('.goal-icon').text()).toBe('👩🏽‍🚀')

    await card.find('.more-button').trigger('click')
    await card.find('.card-menu button').trigger('click')
    await modal('#edit-debt-icon').setValue('旅行计划')
    await modal('.button-primary.full-width').trigger('click')
    expect(mocks.store.savedDebts.at(-1).iconLabel).toBe('旅行')
    card = wrapper.findAll('[data-debt-id]').find(item => item.find('.goal-heading h2').text() === '火箭计划')
    expect(card.find('.goal-icon').text()).toBe('旅行')

    await card.find('.more-button').trigger('click')
    await card.find('.card-menu button').trigger('click')
    await modal('#edit-debt-icon').setValue('')
    await modal('.button-primary.full-width').trigger('click')
    expect(card.find('.goal-icon').text()).toBe('◎')
  })
  it('移除显示方式选择栏后仍可双指捏合逐档调整卡片密度', async () => {
    render()
    await flushPromises()
    const list = wrapper.find('.record-list').element
    expect(list.classList.contains('density-full')).toBe(true)
    touchList(list, 'touchstart', 120)
    touchList(list, 'touchmove', 70)
    await flushPromises()
    expect(list.classList.contains('density-grid')).toBe(true)
    touchList(list, 'touchend', null)
    touchList(list, 'touchstart', 120)
    touchList(list, 'touchmove', 70)
    await flushPromises()
    expect(list.classList.contains('density-rows')).toBe(true)
    touchList(list, 'touchend', null)
    touchList(list, 'touchstart', 70)
    touchList(list, 'touchmove', 120)
    await flushPromises()
    expect(list.classList.contains('density-grid')).toBe(true)
  })
  it('捏合切换时直接动画化卡片和分组高度，完成后清理动画标记', async () => {
    await Preferences.remove({ key: STORAGE_KEYS.savingsDensity })
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
    let finish
    const finished = new Promise(resolve => { finish = resolve })
    const animate = vi.fn(() => ({ finished, cancel: vi.fn() }))
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate })
    try {
      render()
      await flushPromises()
      const list = wrapper.find('.record-list').element
      touchList(list, 'touchstart', 120)
      touchList(list, 'touchmove', 70)
      await flushPromises()
      expect(list.classList.contains('density-grid')).toBe(true)
      expect(list.classList.contains('density-animating')).toBe(true)
      expect(animate).toHaveBeenCalledTimes(13)
      expect(animate.mock.calls.some(([frames]) => frames[0].height != null)).toBe(true)
      expect(animate.mock.calls.some(([frames]) => frames[0].transform != null)).toBe(true)
      finish()
      await flushPromises()
      expect(list.classList.contains('density-animating')).toBe(false)
      expect(list.querySelector('.savings-group').style.overflow).toBe('')
    } finally {
      if (original) Object.defineProperty(Element.prototype, 'animate', original)
      else delete Element.prototype.animate
    }
  })
  it('长按分组手柄可调整分组顺序并撤销', async () => {
    vi.useFakeTimers()
    mocks.store.debtGroups = ['未分组', '旅行']
    render()
    await flushPromises()
    const headers = wrapper.findAll('[data-group-drag-id]')
    headers[0].element.getBoundingClientRect = () => ({ top: 0, bottom: 40, height: 40, width: 360, left: 0 })
    headers[1].element.getBoundingClientRect = () => ({ top: 400, bottom: 440, height: 40, width: 360, left: 0 })
    pointer(headers[0].find('.group-drag-handle').element, 'pointerdown', 20)
    await vi.advanceTimersByTimeAsync(300)
    expect(document.querySelector('.savings-group-drag-ghost')).not.toBeNull()
    pointer(document, 'pointermove', 430)
    pointer(document, 'pointerup', 430)
    await flushPromises()
    expect(mocks.store.reorderDebtGroups).toHaveBeenCalledWith(['旅行', '未分组'])
    expect(mocks.store.debtGroups).toEqual(['旅行', '未分组'])
    document.querySelector('.order-toast button').click()
    await flushPromises()
    expect(mocks.store.debtGroups).toEqual(['未分组', '旅行'])
  })
  it('更多中下移自动保存并可撤销；搜索时禁用排序', async () => {
    render()
    await wrapper.find('.more-button').trigger('click')
    await wrapper.findAll('.card-menu button')[2].trigger('click')
    await flushPromises()
    expect(mocks.store.savedDebts[0].id).toBe('1')
    expect(document.querySelector('.order-toast').textContent).toContain('顺序已更新')
    document.querySelector('.order-toast button').click()
    await flushPromises()
    expect(mocks.store.savedDebts[0].id).toBe('0')
    await wrapper.find('.search-input').setValue('计划1')
    expect(wrapper.find('.drag-handle').attributes('disabled')).toBeDefined()
  })
  it('排序不请求 AI，金额变化刷新一次，失败保留已生成文案', async () => {
    mocks.settings.aiApiKey = 'test-only'
    mocks.askAI.mockResolvedValueOnce('你的小坚持，都在发光').mockRejectedValueOnce(new Error('offline'))
    render()
    await flushPromises()
    await wrapper.find('.more-button').trigger('click')
    await wrapper.findAll('.card-menu button')[2].trigger('click')
    await flushPromises()
    expect(mocks.askAI).toHaveBeenCalledTimes(1)
    mocks.store.savedDebts[0].records.push({ amount: 10 })
    await flushPromises()
    expect(mocks.askAI).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.encouragement').text()).toBe('你的小坚持，都在发光')
  })
  it('写入失败不给撤销或成功提示', async () => {
    mocks.store.arrangeDebts.mockRejectedValueOnce(new Error('disk'))
    render()
    await wrapper.find('.more-button').trigger('click')
    await wrapper.findAll('.card-menu button')[2].trigger('click')
    await flushPromises()
    expect(document.querySelector('.order-toast')).toBeNull()
    expect(mocks.store.savedDebts[0].id).toBe('0')
    expect(mocks.toast).toHaveBeenCalledWith('顺序未保存，请重新拖动', { tone: 'danger' })
  })
  it('短按和提前滑动不拖动，长按后返回取消且不保存', async () => {
    vi.useFakeTimers()
    render(); geometry()
    const handle = wrapper.find('.drag-handle').element
    pointer(handle, 'pointerdown', 40)
    await vi.advanceTimersByTimeAsync(299)
    expect(document.querySelector('.savings-drag-ghost')).toBeNull()
    pointer(document, 'pointerup', 40)
    pointer(handle, 'pointerdown', 40)
    pointer(document, 'pointermove', 60)
    pointer(document, 'pointerup', 60)
    await vi.advanceTimersByTimeAsync(300)
    expect(document.querySelector('.savings-drag-ghost')).toBeNull()
    pointer(handle, 'pointerdown', 40)
    await vi.advanceTimersByTimeAsync(300)
    expect(document.querySelector('.savings-drag-ghost')).not.toBeNull()
    expect(await dispatchBackAction()).toBe(true)
    await flushPromises()
    expect(document.querySelector('.savings-drag-ghost')).toBeNull()
    expect(mocks.store.arrangeDebts).not.toHaveBeenCalled()
  })
  it('长按拖过下一项后松手保存，pointercancel 和锁屏清理拖动', async () => {
    vi.useFakeTimers()
    render(); geometry()
    pointer(wrapper.find('.drag-handle').element, 'pointerdown', 40)
    await vi.advanceTimersByTimeAsync(300)
    pointer(document, 'pointermove', 350)
    pointer(document, 'pointerup', 350)
    await flushPromises()
    expect(mocks.store.savedDebts[0].id).toBe('1')
    pointer(wrapper.find('.drag-handle').element, 'pointerdown', 40)
    await vi.advanceTimersByTimeAsync(300)
    pointer(document, 'pointercancel', 40)
    await flushPromises()
    expect(document.querySelector('.savings-drag-ghost')).toBeNull()
    pointer(wrapper.find('.drag-handle').element, 'pointerdown', 40)
    await vi.advanceTimersByTimeAsync(300)
    mocks.auth.isLocked = true
    await flushPromises()
    expect(document.querySelector('.savings-drag-ghost')).toBeNull()
    expect(document.querySelector('.order-toast')).toBeNull()
    expect(mocks.store.arrangeDebts).toHaveBeenCalledTimes(1)
  })
})
