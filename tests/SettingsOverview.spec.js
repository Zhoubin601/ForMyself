import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import SettingsOverview from '../src/components/settings/SettingsOverview.vue'

describe('SettingsOverview', () => {
  it('展示分类并把点击交给设置导航控制器', async () => {
    const openGeneralSettingsCategory = vi.fn()
    const model = reactive({
      scopeMeta: null,
      showGeneralSettingsHome: true,
      generalSettingsCategories: [
        { id: 'security', icon: '⌑', title: '安全与解锁', description: '立即锁定' },
        { id: 'data', icon: '⇅', title: '数据与备份', description: '加密导入导出' }
      ],
      openGeneralSettingsCategory
    })
    const wrapper = mount(SettingsOverview, { props: { model } })
    expect(wrapper.findAll('.general-settings-card')).toHaveLength(2)
    await wrapper.findAll('.general-settings-card')[0].trigger('click')
    expect(openGeneralSettingsCategory).toHaveBeenCalledWith('security')
  })
})
