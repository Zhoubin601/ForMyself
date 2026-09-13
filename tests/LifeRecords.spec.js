import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'
import WeightView from '../src/components/WeightView.vue'
import MoodView from '../src/features/mood/MoodView.vue'
import CommonNoteField from '../src/components/CommonNoteField.vue'
import AppColorPalette from '../src/components/AppColorPalette.vue'
import SettingsCatalogs from '../src/components/settings/SettingsCatalogs.vue'
import { useCatalogSettings } from '../src/composables/settings/useCatalogSettings.js'
import { askAI } from '../src/services/aiEngine'
import { useWeightStore } from '../src/stores/weight.js'
import { useMoodStore } from '../src/features/mood/moodStore.js'
import { useSettingsStore } from '../src/stores/settings.js'
import { preferenceStorage } from '../src/platform/storage/preferences.js'
import { dispatchBackAction, resetBackHandlersForTests } from '../src/services/backNavigation.js'
vi.mock('../src/platform/storage/preferences.js', () => ({ preferenceStorage: { get: vi.fn(async () => ({ value: null })), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) } }))
vi.mock('../src/services/notificationService.js', () => ({ notifyWeightChange: vi.fn(async () => ({ scheduled: false })) }))
vi.mock('../src/services/aiEngine', () => ({ askAI: vi.fn(async () => '今天也辛苦了') }))
vi.mock('../src/services/uiFeedback', () => ({ appAlert: vi.fn(), appConfirm: vi.fn(async () => true), appToast: vi.fn() }))
let wrappers
beforeEach(() => {
  wrappers = []; setActivePinia(createPinia()); resetBackHandlersForTests(); vi.clearAllMocks()
  preferenceStorage.get.mockImplementation(async () => ({ value: null }))
  preferenceStorage.set.mockImplementation(async () => {})
})
afterEach(() => { wrappers.forEach(w => w.unmount()); document.body.innerHTML = ''; resetBackHandlersForTests() })
const render = (component, props = {}) => { const w = mount(component, { props, attachTo: document.body }); wrappers.push(w); return w }
const clickText = async text => {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  expect(button, text).toBeTruthy(); button.click(); await flushPromises()
}
it('历史列表独立于图表范围，全部趋势不显示密集圆点', async () => {
  useWeightStore().updateWeightRecords(Array.from({ length: 24 }, (_, i) => ({ id: String(i), date: `2025-01-${String(i + 1).padStart(2, '0')}`, weight: 60 + i / 10 })))
  const w = render(WeightView)
  expect(w.findAll('.record-item')).toHaveLength(10)
  expect(w.find('.pagination-bar').text()).toContain('1 / 3')
  await clickText('下一页 ›'); await clickText('全部')
  expect(w.find('.pagination-bar').text()).toContain('2 / 3')
  expect(w.findAll('.weight-chart circle')).toHaveLength(0)
  expect(w.findAll('.chart-weight-label')).toHaveLength(0)
  expect(w.find('.weight-chart path[fill="none"]').attributes('d')).toContain('L')
  await clickText('近 90 天'); await clickText('下一页 ›')
  expect(w.findAll('.record-item')).toHaveLength(4)
})
it('日历与当天详情不显示自动说明文字', async () => {
  const store = useMoodStore(); store.isDataLoaded = true
  const now = new Date(); const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  store.updateMoodRecords([{ id: 'auto', date, mood: 'normal', autoFilled: true }])
  const w = render(MoodView)
  expect(w.text()).not.toContain('自动')
  await w.find('.cal-day:not(.empty)').trigger('click')
  expect(document.querySelector('.mood-day-panel').textContent).not.toContain('自动')
  expect(document.querySelector('.mood-day-panel').textContent).toContain('补写日记')
})
it('体重空图可切换，新增多次、编辑和清空时间刷新最新值', async () => {
  const store = useWeightStore(); const w = render(WeightView)
  expect(w.find('.weight-range').exists()).toBe(true)
  await clickText('＋ 记录体重')
  let input = document.querySelector('[aria-label="体重 kg"]')
  input.value = '65.5'; input.dispatchEvent(new Event('input', { bubbles: true }))
  await clickText('保存')
  expect(store.weightRecords).toHaveLength(1)
  expect(store.weightRecords[0].time).toMatch(/^\d{2}:\d{2}$/)
  expect(w.findAll('.weight-chart circle')).toHaveLength(1)
  await clickText('编辑'); await clickText('清空')
  expect(document.body.textContent).toContain('未记录时间')
  input = document.querySelector('[aria-label="体重 kg"]')
  input.value = '66.0'; input.dispatchEvent(new Event('input', { bubbles: true }))
  await clickText('保存')
  expect(store.weightRecords).toHaveLength(1)
  expect(store.weightRecords[0].time).toBe('')
  expect(w.find('.hero-value').text()).toContain('66')
  await w.find('.delete-btn').trigger('click'); await flushPromises()
  expect(store.weightRecords).toHaveLength(0)
})
it('过去日期打开当天列表，按优先级显示并可新增、编辑、删除和返回', async () => {
  const store = useMoodStore(); store.isDataLoaded = true
  const now = new Date(); const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  store.updateMoodRecords([{ id: 'a', date, mood: 'bad', note: '第一条', createdAt: 1 }, { id: 'b', date, mood: 'good', note: '第二条', createdAt: 2 }])
  store.updateMoodDefinition('bad', { ...store.getMoodDefinition('bad'), displayPriority: 90 })
  const w = render(MoodView)
  await w.find('.cal-day:not(.empty)').trigger('click')
  expect(document.querySelector('.day-record').textContent).toContain('第一条')
  await clickText('＋ 新增当天日记')
  expect(document.querySelector('.mood-day-panel')).toBeNull()
  await clickText('保存')
  expect(store.getRecordsByDate(date)).toHaveLength(3)
  expect(document.querySelector('.mood-day-panel')).toBeTruthy()
  await clickText('删除')
  expect(store.getDayDisplayRecords(date).some(r => r.id === 'a')).toBe(false)
  await dispatchBackAction(); await nextTick()
  expect(document.querySelector('.mood-day-panel')).toBeNull()
})
it('常用备注选择、去重、改名、删除相互隔离且不修改输入中的历史备注', async () => {
  const settings = useSettingsStore()
  const w = render(CommonNoteField, { scope: 'weight', modelValue: ' 空腹 ' })
  await clickText('保存为常用'); await clickText('保存为常用')
  expect(settings.commonNotes.weight).toEqual(['空腹'])
  expect(settings.commonNotes.savings).toEqual([])
    await clickText('管理'); await clickText('改名')
    const input = document.querySelector('[aria-label="修改常用备注"]')
    input.value = '晨起'; input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick(); await clickText('保存')
  expect(settings.commonNotes.weight).toEqual(['晨起'])
  expect(w.props('modelValue')).toBe(' 空腹 ')
    await clickText('完成'); await w.find('[aria-label="展开常用备注"]').trigger('click'); await clickText('晨起')
  expect(w.emitted('update:modelValue').at(-1)).toEqual(['晨起'])
    expect(document.querySelector('.note-options')).toBeNull()
    await w.find('[aria-label="展开常用备注"]').trigger('click')
    await dispatchBackAction(); await nextTick()
    expect(document.querySelector('.note-options')).toBeNull()
    await w.find('[aria-label="展开常用备注"]').trigger('click')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); await nextTick()
    expect(document.querySelector('.note-options')).toBeNull()
    await clickText('管理'); await clickText('删除')
  expect(settings.commonNotes.weight).toEqual([])
})
it('调色盘支持键盘选色、合法 HEX 与非法 HEX 回退', async () => {
  const w = render(AppColorPalette, { modelValue: '#FF0000' })
  await w.find('.palette-board').trigger('keydown', { key: 'ArrowLeft' })
  expect(w.emitted('update:modelValue').at(-1)[0]).not.toBe('#ff0000')
  await w.find('.palette-hex input').setValue('#123ABC')
  expect(w.emitted('update:modelValue').at(-1)).toEqual(['#123ABC'])
  await w.find('.palette-hex input').setValue('invalid')
  expect(w.find('.palette-hex input').element.value).toBe('#FF0000')
})
it('改名目录、空默认与优先级在重载后保留，合并保留本地默认', async () => {
  const saved = new Map()
  preferenceStorage.get.mockImplementation(async ({ key }) => ({ value: saved.get(key) ?? null }))
  preferenceStorage.set.mockImplementation(async ({ key, value }) => { saved.set(key, value) })
  const store = useMoodStore(); await store.loadMoodRecords()
  store.renameTag('学习', '成长'); store.setDefaultTags([])
  store.updateMoodDefinition('bad', { ...store.getMoodDefinition('bad'), displayPriority: 20 })
  await flushPromises()
  setActivePinia(createPinia()); const restored = useMoodStore(); await restored.loadMoodRecords()
  expect(restored.builtInTags).toContain('成长'); expect(restored.builtInTags).not.toContain('学习')
  expect(restored.defaultTags).toEqual([])
  expect(restored.getMoodDefinition('bad').displayPriority).toBe(20)
  await restored.mergeMoodBackup([], { builtInTags: ['学习', '旅行'], defaultTags: ['学习'] })
  expect(restored.defaultTags).toEqual([]); expect(restored.customTags).toContain('旅行')
})

it('设置表单新增和编辑优先级、调色盘，内置标签可改名及取消默认', async () => {
  const model = reactive({ ...useCatalogSettings({ newScheduleCategoryColor: ref('#123456') }), settingsScope: 'mood', isGeneralSection: () => false })
  const w = render(SettingsCatalogs, { model })
  await w.find('.mood-definition-add input[placeholder="心情名称"]').setValue('平静')
  await w.find('[aria-label="新心情显示优先级"]').setValue(40)
  await w.find('.palette-hex input').setValue('#123ABC')
  await w.find('.mood-definition-add button').trigger('click')
  const definition = model.moodStore.moodDefinitions.find(d => d.label === '平静')
  expect(definition.displayPriority).toBe(40); expect(definition.color).toBe('#123ABC')
  const row = w.findAll('.mood-definition-row').find(row => row.text().includes('平静'))
  await row.findAll('button').find(b => b.text() === '编辑').trigger('click')
  await w.find('[aria-label="编辑心情显示优先级"]').setValue(50)
  await w.find('.mood-definition-editor .palette-hex input').setValue('#654321')
  await w.findAll('.mood-definition-editor button').find(b => b.text() === '保存').trigger('click')
  expect(model.moodStore.getMoodDefinition(definition.id).displayPriority).toBe(50)
  expect(model.moodStore.getMoodDefinition(definition.id).color).toBe('#654321')
  const tag = w.findAll('.tag-row').find(row => row.text().includes('学习'))
  await tag.find('button').trigger('click')
  await w.find('[aria-label="修改标签名称"]').setValue('成长')
  await clickText('保存')
  expect(model.moodStore.defaultTags).toEqual(['成长'])
  await w.find('[aria-label="默认勾选成长"]').setValue(false)
  expect(model.moodStore.defaultTags).toEqual([])
})

it('关闭生成中的 AI 回应后，迟到结果不会重新打开面板', async () => {
  let resolveReply
  askAI.mockImplementationOnce(() => new Promise(resolve => { resolveReply = resolve }))
  const store = useMoodStore(); store.isDataLoaded = true
  useSettingsStore().aiApiKey = 'synthetic-test-key'
  render(MoodView)
  await clickText('记录今天的第一个事件')
  const textarea = document.querySelector('.mood-textarea')
  textarea.value = '虚构记录'; textarea.dispatchEvent(new Event('input', { bubbles: true }))
  await clickText('保存')
  expect(document.querySelector('.echo-bubble')).toBeTruthy()
  await dispatchBackAction(); await nextTick()
  resolveReply('迟到的回应'); await flushPromises()
  expect(document.querySelector('.echo-bubble')).toBeNull()
  expect(document.querySelector('.mood-day-panel')).toBeTruthy()
})
