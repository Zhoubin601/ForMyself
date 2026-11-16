import {afterEach,expect,it,vi} from 'vitest'
import {flushPromises,mount} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import {useKanataMessageText} from '../src/features/chat/useKanataMessageText.js'
import KanataMessageTextPanel from '../src/features/chat/KanataMessageTextPanel.vue'

let wrapper
afterEach(()=>{wrapper?.unmount();wrapper=null;document.body.innerHTML='';vi.restoreAllMocks()})
function setup(impl){
  let model,active=true
  const target={scope:{worldId:'world',conversationId:'conversation'},assertOwner(){if(!active)throw Error('OWNER_EXPIRED')}}
  const repository={textChunk:vi.fn(impl),get:vi.fn(()=>{throw Error('FULL_MESSAGE_FORBIDDEN')})}
  const read=vi.fn(async(owner,action)=>{owner.assertOwner();return action(repository)})
  wrapper=mount(defineComponent({setup(){
    model=useKanataMessageText({owner:()=>target,current:owner=>active&&owner===target,read})
    return ()=>h(KanataMessageTextPanel,{text:model,onClose:model.closeText})
  }}),{attachTo:document.body})
  return {model,repository,read,expire(){active=false;model.reset()}}
}
const message={id:'message',revision:7,content:'开头片段',contentChunked:true}
const next=offset=>({worldId:'world',conversationId:'conversation',id:'message',revision:7,kind:'text',field:'content',offset})

it('holds one text fragment, focuses its heading and closes without retaining the previous text',async()=>{
  const {model,repository}=setup(async(_scope,_id,_field,cursor)=>cursor.offset===0
    ?{fragment:'第一段合成正文',cursor:next(4096)}:{fragment:'末段合成正文',cursor:null})
  expect(await model.openText(message,'content')).toBe(true);await flushPromises()
  expect(wrapper.text()).toContain('第一段合成正文');expect(document.activeElement.tagName).toBe('H4')
  await wrapper.findAll('button').find(button=>button.text()==='下一段').trigger('click');await flushPromises()
  expect(wrapper.text()).toContain('末段合成正文');expect(wrapper.text()).not.toContain('第一段合成正文')
  expect(repository.get).not.toHaveBeenCalled();expect(model.detail.value.fragment).toBe('末段合成正文')
  await wrapper.findAll('button').find(button=>button.text()==='关闭分段阅读').trigger('click')
  expect(model.detail.value).toBeNull();expect(wrapper.text()).not.toContain('末段合成正文')
})

it('closing or unmounting an in-flight text read discards late plaintext and performs no more reads',async()=>{
  const pending=Promise.withResolvers(),{model,repository}=setup(()=>pending.promise)
  const reading=model.openText(message,'content')
  await flushPromises();model.closeText()
  pending.resolve({fragment:'迟到明文',cursor:next(4096)})
  expect(await reading).toBe(false);await flushPromises()
  expect(model.detail.value).toBeNull();expect(wrapper.text()).not.toContain('迟到明文')
  expect(await model.nextText()).toBe(false);expect(repository.textChunk).toHaveBeenCalledTimes(1)
  const late=Promise.withResolvers();repository.textChunk.mockImplementation(()=>late.promise)
  const last=model.openText(message,'content');wrapper.unmount();wrapper=null
  late.resolve({fragment:'卸载迟到明文',cursor:null})
  expect(await last).toBe(false);expect(model.detail.value).toBeNull()
})

it('a failed chunk keeps only its retry identity and cannot publish text after scope expiry',async()=>{
  const {model,repository,expire}=setup(()=>Promise.reject(Error('READ_FAILED')))
  expect(await model.openText(message,'senderName')).toBe(false)
  expect(model.detailError.value).toBe('READ_FAILED');expect(model.detail.value.fragment).toBe('')
  repository.textChunk.mockResolvedValue({fragment:'完整名称',cursor:null})
  expect(await model.retryText()).toBe(true);expect(model.detail.value.fragment).toBe('完整名称')
  expire();expect(model.detail.value).toBeNull()
  expect(await model.openText(message,'content')).toBe(false);expect(repository.textChunk).toHaveBeenCalledTimes(2)
})

it('an explicit revision draft reads the exact complete body up to the existing 64000-unit limit',async()=>{
  const raw='甲'.repeat(63996)+'尾部原文'
  const {model,repository}=setup(async(_scope,_id,_field,cursor)=>({fragment:raw.slice(cursor.offset,cursor.offset+4096),
    cursor:cursor.offset+4096<raw.length?next(cursor.offset+4096):null}))
  const draft=await model.editableText(message)
  expect(draft).toEqual({id:message.id,revision:7,content:raw})
  expect(draft.content).not.toBe(message.content);expect(repository.get).not.toHaveBeenCalled()
  const longer=raw+'甲'
  repository.textChunk.mockImplementation(async(_scope,_id,_field,cursor)=>({fragment:longer.slice(cursor.offset,cursor.offset+4096),
    cursor:cursor.offset+4096<longer.length?next(cursor.offset+4096):null}))
  expect(await model.editableText(message)).toBeNull()
  expect(model.editError.value).toBe('KANATA_MESSAGE_EDIT_BUDGET_EXCEEDED');expect(model.editing.value).toBe(false)
})

it('cancelling an editable read clears its pending buffer and ignores all later chunks',async()=>{
  const pending=Promise.withResolvers(),{model,repository}=setup(async(_scope,_id,_field,cursor)=>cursor.offset===0
    ?{fragment:'已载入但未交付的草稿'.repeat(100),cursor:next(4096)}:pending.promise)
  const reading=model.editableText(message);await flushPromises()
  expect(repository.textChunk).toHaveBeenCalledTimes(2);model.cancelEdit()
  pending.resolve({fragment:'不可发布的迟到原文',cursor:next(8192)})
  expect(await reading).toBeNull();expect(model.editError.value).toBe('');expect(model.editing.value).toBe(false)
  expect(repository.textChunk).toHaveBeenCalledTimes(2);expect(model.detail.value).toBeNull()
})
