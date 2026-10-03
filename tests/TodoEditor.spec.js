import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TodoView from '../src/features/todo/TodoView.vue'
import AppTimeField from '../src/components/AppTimeField.vue'
import { formatLocalDate, normalizeTodoData } from '../src/features/todo/todoCore.js'

const context = vi.hoisted(() => ({ store:null, settings:null }))
vi.mock('../src/features/todo/todoStore.js', () => ({ useTodoStore: () => context.store }))
vi.mock('../src/stores/settings.js', () => ({ useSettingsStore: () => context.settings }))
vi.mock('../src/services/uiFeedback.js', () => ({ appAlert:vi.fn(), appChoose:vi.fn(), appConfirm:vi.fn(), appToast:vi.fn() }))
import { appChoose } from '../src/services/uiFeedback.js'

let wrapper
beforeEach(() => {
  context.store=reactive({ snapshot:normalizeTodoData(), today:formatLocalDate(), isDataLoaded:true, load:vi.fn(), add:vi.fn(), edit:vi.fn(), remove:vi.fn(), complete:vi.fn(), syncReminders:vi.fn() })
  context.settings=reactive({ todoTarget:{ item:'', date:'' }, currentView:'todo' })
  appChoose.mockReset()
})
afterEach(() => { wrapper?.unmount(); document.body.innerHTML='' })
const render=() => { wrapper=mount(TodoView,{attachTo:document.body,global:{stubs:{Teleport:true}}});return wrapper }
const task=() => {
  context.store.snapshot=normalizeTodoData({tasks:[{id:'a',title:'喝水',note:'原备注',startDate:formatLocalDate(),time:'09:30',reminder:true,recurrence:{type:'daily'}}]})
}

describe('紧凑待办表单', () => {
  it('选择星期、备注收起后保留内容，清除时间关闭提醒，并保存完整规则', async () => {
    render()
    await wrapper.find('.todo-add').trigger('click')
    expect(wrapper.find('textarea').exists()).toBe(false)
    await wrapper.find('#todo-title').setValue('阅读')
    appChoose.mockResolvedValueOnce('weekly')
    await wrapper.find('.todo-recurrence-picker').trigger('click'); await flushPromises()
    for (const day of [1,3,5]) await wrapper.findAll('.todo-weekdays button')[day].trigger('click')
    expect(wrapper.find('.todo-recurrence-picker').text()).toContain('每周一、三、五')
    await wrapper.find('.todo-note-toggle').trigger('click')
    await wrapper.find('textarea').setValue('完成第三章')
    await wrapper.find('.todo-note-toggle').trigger('click')
    wrapper.findComponent(AppTimeField).vm.$emit('update:modelValue','09:30'); await flushPromises()
    await wrapper.find('.todo-switch').setValue(true)
    await wrapper.find('.todo-clear-time').trigger('click')
    expect(wrapper.find('.todo-editor').text()).not.toContain('到时间通知我')
    await wrapper.find('.todo-editor').trigger('submit'); await flushPromises()
    expect(context.store.add).toHaveBeenCalledWith(expect.objectContaining({title:'阅读',note:'完成第三章',time:'',reminder:false,recurrence:{type:'weekly',weekdays:[1,3,5],intervalDays:2}}))
  })
  it('仅本次编辑不暴露重复及结束规则，已有备注展开，保存不改规则', async () => {
    task(); appChoose.mockResolvedValueOnce('single'); render()
    await wrapper.find('.todo-task-title').trigger('click'); await flushPromises()
    expect(wrapper.find('textarea').element.value).toBe('原备注')
    expect(wrapper.find('.todo-recurrence-picker').exists()).toBe(false)
    expect(wrapper.find('.todo-editor').text()).not.toContain('设置结束日期')
    await wrapper.find('#todo-title').setValue('喝温水')
    await wrapper.find('.todo-editor').trigger('submit'); await flushPromises()
    expect(context.store.edit).toHaveBeenCalledWith('a',formatLocalDate(),{title:'喝温水',note:'原备注',time:'09:30',reminder:true},'single')
  })
  it('历史保护失败将最早日期显示在生效日期组，并保留未保存输入', async () => {
    task(); appChoose.mockResolvedValueOnce('future'); render()
    context.store.edit.mockRejectedValueOnce({code:'TODO_HISTORY_PROTECTED',earliestDate:'2026-10-06'})
    await wrapper.find('.todo-task-title').trigger('click'); await flushPromises()
    await wrapper.find('#todo-title').setValue('喝咖啡')
    await wrapper.find('.todo-editor').trigger('submit'); await flushPromises()
    expect(wrapper.find('.todo-field-group [role="alert"]').text()).toContain('2026-10-06')
    expect(wrapper.find('#todo-title').element.value).toBe('喝咖啡')
  })
})
