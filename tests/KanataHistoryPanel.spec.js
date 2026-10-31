import {beforeEach,it,expect,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
import {reactive} from 'vue'
import {archiveData} from './helpers/kanataArchiveFixture.js'
import {restoreState} from '../src/platform/storage/restoreState.js'
const mocks=vi.hoisted(()=>({store:null,access:null,confirm:vi.fn(),cancel:vi.fn()}))
vi.mock('../src/features/chat/kanataStore.js',()=>({useKanataStore:()=>mocks.store}))
vi.mock('../src/stores/protectedAccess.js',()=>({useProtectedAccessStore:()=>mocks.access}))
vi.mock('../src/services/uiFeedback.js',()=>({appConfirm:(...args)=>mocks.confirm(...args),cancelOwnedFeedbackDialog:(...args)=>mocks.cancel(...args)}))
import Panel from '../src/features/chat/KanataHistoryPanel.vue'
const button=(wrapper,text)=>wrapper.findAll('button').find(b=>b.text()===text)
beforeEach(()=>{
  const data=archiveData(4)
  mocks.store=reactive({snapshot:data,isDataLoaded:true,hasPendingSave:false,saveError:'',archiveError:'',readHistory:vi.fn(async()=>({messages:[...data.messages].reverse(),cursor:null})),archiveHistory:vi.fn(async()=>({archivedCount:200,pages:4})),activateHistoryMessage:vi.fn(async()=>{})})
  mocks.access={runOperation:vi.fn(async(_ids,action)=>action())}
  mocks.confirm.mockReset().mockResolvedValue(true);mocks.cancel.mockReset();Object.assign(restoreState,{blocked:false,busy:false})
})
const mountPanel=()=>mount(Panel,{props:{conversationId:mocks.store.snapshot.conversations.find(c=>c.type==='private').id}})
it('P7 history only reads on explicit query, uses protected scope, renders bounded page and resets cursor when query changes',async()=>{
  const w=mountPanel();expect(mocks.store.readHistory).not.toHaveBeenCalled()
  await w.find('input').setValue('合成');await w.find('form').trigger('submit');await flushPromises()
  expect(mocks.access.runOperation).toHaveBeenCalledWith(['chat'],expect.any(Function));expect(mocks.store.readHistory).toHaveBeenCalledWith(expect.objectContaining({text:'合成',worldId:mocks.store.snapshot.worlds[0].id}))
  expect(w.findAll('article')).toHaveLength(4);expect(w.findAll('article')[0].text()).toContain('合成历史消息 0')
  await w.find('input').setValue('其他');expect(w.findAll('article')).toHaveLength(0);expect(button(w,'更早一页').attributes('disabled')).toBeDefined();w.unmount()
})
it('P7 archive cancellation is zero write and confirmed conversion explains retained references',async()=>{
  const w=mountPanel();mocks.confirm.mockResolvedValueOnce(false)
  await button(w,'整理较早聊天').trigger('click');await flushPromises();expect(mocks.store.archiveHistory).not.toHaveBeenCalled()
  await button(w,'整理较早聊天').trigger('click');await flushPromises();expect(mocks.store.archiveHistory).toHaveBeenCalledWith(expect.objectContaining({keepRecent:200}));expect(w.find('[role="status"]').text()).toContain('已整理 200 条消息');w.unmount()
})
it('P7 history failure does not claim no matches, and protected release clears visible bodies and draft search',async()=>{
  const w=mountPanel();await w.find('input').setValue('合成');await w.find('form').trigger('submit');await flushPromises();expect(w.findAll('article')).toHaveLength(4)
  mocks.store.isDataLoaded=false;await flushPromises();expect(w.findAll('article')).toHaveLength(0);expect(w.find('input').element.value).toBe('')
  mocks.store.isDataLoaded=true;mocks.store.readHistory.mockRejectedValueOnce(Object.assign(Error('synthetic corrupt page'),{code:'KANATA_ARCHIVE_VERIFY_FAILED'}))
  await w.find('form').trigger('submit');await flushPromises();expect(w.find('[role="alert"]').text()).toContain('未能安全读取');expect(w.text()).not.toContain('没有找到匹配');w.unmount()
})
it('P7 historical revision activates its full page before emitting a stable original ID/revision',async()=>{
  const w=mountPanel();await w.find('form').trigger('submit');await flushPromises()
  await button(w,'修订历史原文').trigger('click');await flushPromises()
  expect(mocks.store.activateHistoryMessage).toHaveBeenCalledWith(expect.objectContaining({messageId:'synthetic-message-0'}))
  expect(w.emitted('revise')[0][0]).toMatchObject({id:'synthetic-message-0',revision:1});w.unmount()
})
it('P7 unmount/conversation switch drops late disk results and archive confirmation; archived world remains read only',async()=>{
  const w=mountPanel();let finish;mocks.store.readHistory.mockReturnValueOnce(new Promise(resolve=>{finish=resolve}))
  await w.find('form').trigger('submit');w.unmount();finish({messages:[mocks.store.snapshot.messages[0]],cursor:null});await flushPromises();expect(mocks.cancel).toHaveBeenCalled()
  const v=mountPanel();mocks.store.snapshot.worlds[0].archived=true;await flushPromises();expect(button(v,'整理较早聊天').attributes('disabled')).toBeDefined()
  await v.find('form').trigger('submit');await flushPromises();expect(v.findAll('article')).toHaveLength(4);expect(button(v,'修订历史原文').attributes('disabled')).toBeDefined();v.unmount()
})
