import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import SettingsCatalogs from '../src/components/settings/SettingsCatalogs.vue'

describe('省钱计划设置中的分组入口', () => {
  it('在设置中添加分组并显示数量', async () => {
    const model = reactive({
      settingsScope: 'debts',
      isGeneralSection: () => false,
      editingMoodId: '',
      moodStore: { activeMoodDefinitions: [] },
      debtStore: {
        debtGroups: ['未分组'],
        savedDebts: [{ id: 'a', name: '现有计划' }],
        addDebtGroup: vi.fn(async name => { model.debtStore.debtGroups.push(name) })
      }
    })
    const wrapper = mount(SettingsCatalogs, { props: { model } })
    expect(wrapper.find('.savings-group-setting-row').text()).toContain('未分组')
    expect(wrapper.find('.savings-group-setting-row').text()).toContain('1 项')
    await wrapper.find('input[aria-label="新省钱计划分组名称"]').setValue('旅行')
    await wrapper.find('.taxonomy-add-button').trigger('click')
    await flushPromises()
    expect(model.debtStore.addDebtGroup).toHaveBeenCalledWith('旅行')
    expect(wrapper.findAll('.savings-group-setting-row').map(row => row.text())).toEqual(['未分组1 项', '旅行0 项'])
    expect(wrapper.find('input[aria-label="新省钱计划分组名称"]').element.value).toBe('')
    wrapper.unmount()
  })
})
