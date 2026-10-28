import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import preset from '../src/features/chat/presets/abydos.v1.json'
import { instantiateWorldPreset } from '../src/features/chat/domain/presetCore.js'
import { createEmptyKanataData } from '../src/features/chat/domain/kanataCore.js'
import { createKanataWorld, importKanataCard, updateKanataCard, syncKanataCard, updateKanataIdentity } from '../src/features/chat/domain/kanataManagementCore.js'
import { saveKanataLoreEntry } from '../src/features/chat/lorebook/kanataLorebook.js'
import { dispatchBackAction, resetBackHandlersForTests } from '../src/services/backNavigation.js'
import { resetNativeActivityGuard } from '../src/services/nativeActivityGuard.js'

const mocked=vi.hoisted(()=>({store:null,management:null,settings:null,prompt:vi.fn(),confirm:vi.fn(),choose:vi.fn(),resolve:vi.fn(),probe:vi.fn(),initialize:vi.fn()}))
vi.mock('../src/features/chat/kanataStore.js',()=>({useKanataStore:()=>mocked.store}))
vi.mock('../src/application/kanataManagement.js',()=>({createKanataManagement:()=>mocked.management}))
vi.mock('../src/stores/settings.js',()=>({useSettingsStore:()=>mocked.settings}))
vi.mock('../src/application/kanataRuntime.js',()=>({createKanataRuntime:()=>({probeLegacy:mocked.probe,initialize:mocked.initialize})}))
vi.mock('../src/services/uiFeedback.js',()=>({appPrompt:(...args)=>mocked.prompt(...args),appConfirm:(...args)=>mocked.confirm(...args),appChoose:(...args)=>mocked.choose(...args),cancelOwnedFeedbackDialog:(...args)=>mocked.resolve(...args)}))
import KanataView from '../src/features/chat/KanataView.vue'
import KanataWorldManager from '../src/features/chat/KanataWorldManager.vue'
import KanataCardLibrary from '../src/features/chat/cards/KanataCardLibrary.vue'
import KanataLorebookPanel from '../src/features/chat/lorebook/KanataLorebookPanel.vue'
import { moduleRegistry } from '../src/application/moduleRegistry.js'

let sequence=0
const idFactory=kind=>kind+'-ui-'+(++sequence)
const options=()=>({key:String(++sequence),now:2000,timeZone:'Asia/Shanghai',idFactory})
const button=(wrapper,text)=>wrapper.findAll('button').find(b=>b.text()===text)
const chooseFile=async(wrapper,file,label='导入角色卡')=>{
  await button(wrapper,label).trigger('click')
  const input=wrapper.find('input[type=file]')
  Object.defineProperty(input.element,'files',{value:[file],configurable:true})
  await input.trigger('change');await flushPromises()
}
const syntheticFile=()=>{
  const bytes=new TextEncoder().encode(JSON.stringify({name:'合成导入角色',description:'仅供UI测试',personality:'谨慎',mes_example:'简单表达',extensions:{script:'globalThis.uiExecuted=true'}}))
  return{name:'synthetic.json',type:'application/json',size:bytes.length,arrayBuffer:async()=>bytes.buffer}
}
beforeEach(()=>{
  sequence=0;resetBackHandlersForTests();resetNativeActivityGuard();vi.clearAllMocks()
  mocked.store=reactive({isDataLoaded:true,hasPendingSave:false,saveError:'',loadError:'',needsInitialization:false,
    snapshot:instantiateWorldPreset(createEmptyKanataData('user'),preset,{initializationKey:'first',now:1000,timeZone:'Asia/Shanghai',idFactory})})
  mocked.settings=reactive({currentView:'chat',currentRoute:{scrollTop:123},updateCurrentRouteScroll:vi.fn()})
  mocked.prompt.mockResolvedValue(null);mocked.confirm.mockResolvedValue(false);mocked.choose.mockResolvedValue(null)
  mocked.probe.mockResolvedValue({hasLegacy:false,pending:false})
  const apply=transform=>{mocked.store.snapshot=transform(mocked.store.snapshot)}
  mocked.management={
    createWorld:vi.fn(async fields=>apply(d=>createKanataWorld(d,fields,options()))),
    updateIdentity:vi.fn(async(id,fields)=>apply(d=>updateKanataIdentity(d,id,fields))),
    importCard:vi.fn(async parsed=>apply(d=>importKanataCard(d,parsed,options()))),
    updateCard:vi.fn(async(id,definition,expected)=>apply(d=>updateKanataCard(d,id,definition,expected,options()))),
    syncCard:vi.fn(async(id,selection)=>apply(d=>syncKanataCard(d,id,selection))),
    saveLore:vi.fn(async(entry,revision)=>apply(d=>saveKanataLoreEntry(d,entry,revision))),
    retrySave:vi.fn(async()=>{mocked.store.saveError='';mocked.store.hasPendingSave=false}),
    archiveWorld:vi.fn(),copyWorld:vi.fn(),createPresetWorld:vi.fn(),addCharacter:vi.fn(),updateCharacter:vi.fn(),attachCardLore:vi.fn(),archiveCard:vi.fn()
  }
  vi.stubGlobal('fetch',vi.fn())
})
afterEach(()=>{resetBackHandlersForTests();resetNativeActivityGuard();vi.unstubAllGlobals()})
const library=()=>mount(KanataCardLibrary,{props:{data:mocked.store.snapshot,management:mocked.management}})
describe('P3 world/card/lore management user interactions',()=>{
  it('loads the actual protected management entry lazily through the production registry',async()=>{
    const descriptor=moduleRegistry.get('chat'),loaded=await descriptor.loadView()
    expect(loaded.default).toBe(KanataView);expect(descriptor.access).toBe('protected');expect(descriptor.cache).toBe(false)
  })
  it('shows the five distinct roles and six real conversations with no fake reply or AI request',async()=>{
    const wrapper=mount(KanataWorldManager);await flushPromises()
    expect(wrapper.findAll('.kanata-character-grid article')).toHaveLength(5)
    expect(wrapper.findAll('.kanata-conversation-list li')).toHaveLength(6)
    expect(wrapper.findAll('.kanata-conversation-list button')).toHaveLength(6)
    expect(wrapper.text()).toContain('只有主动发送才调用全局 DeepSeek')
    expect(wrapper.text()).toContain('小鸟游星野');expect(wrapper.text()).toContain('奥空绫音')
    expect(fetch).not.toHaveBeenCalled();expect(mocked.store.snapshot.messages).toEqual([])
    wrapper.unmount()
  })
  it('creates an empty world through the protected facade and selects its independent identity',async()=>{
    const wrapper=mount(KanataWorldManager);mocked.prompt.mockResolvedValueOnce('合成新世界')
    await button(wrapper,'创建空白世界').trigger('click');await flushPromises()
    expect(mocked.management.createWorld).toHaveBeenCalledWith({name:'合成新世界',rules:'',displayName:'旅人',background:''})
    expect(mocked.store.snapshot.worlds).toHaveLength(2)
    expect(wrapper.findAll('.kanata-character-grid article')).toHaveLength(0)
    expect(wrapper.text()).toContain('当前世界称谓：旅人')
    wrapper.unmount()
  })
  it('failed identity save retains fields, shows a real retry and never reports success',async()=>{
    const wrapper=mount(KanataWorldManager)
    await button(wrapper,'编辑世界身份').trigger('click')
    await wrapper.get('.kanata-form input').setValue('待保存称谓')
    mocked.management.updateIdentity.mockImplementationOnce(async()=>{mocked.store.saveError='KANATA_SAVE_FAILED';mocked.store.hasPendingSave=true;throw Error('failed')})
    await wrapper.get('form').trigger('submit');await flushPromises()
    expect(wrapper.get('input').element.value).toBe('待保存称谓')
    expect(wrapper.text()).not.toContain('这个世界中的用户身份已更新')
    expect(wrapper.text()).toContain('更改尚未安全保存')
    await button(wrapper,'重试保存').trigger('click');await flushPromises()
    expect(mocked.management.retrySave).toHaveBeenCalledTimes(1)
    expect(mocked.store.hasPendingSave).toBe(false)
    wrapper.unmount()
  })
  it('imports only after a file preview is explicitly confirmed and leaves all world histories empty',async()=>{
    const wrapper=library()
    await chooseFile(wrapper,syntheticFile())
    expect(wrapper.text()).toContain('合成导入角色 · V1')
    expect(mocked.management.importCard).not.toHaveBeenCalled()
    await button(wrapper,'确认导入全局库').trigger('click');await flushPromises()
    expect(mocked.management.importCard).toHaveBeenCalledTimes(1)
    expect(mocked.store.snapshot.cards).toHaveLength(6)
    expect(mocked.store.snapshot.instances).toHaveLength(5);expect(mocked.store.snapshot.messages).toEqual([])
    expect(globalThis.uiExecuted).toBeUndefined();expect(fetch).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('cancel/back discards a preview and unmount removes its back handler',async()=>{
    const wrapper=library();await chooseFile(wrapper,syntheticFile())
    expect(await dispatchBackAction()).toBe(true);await flushPromises()
    expect(wrapper.find('.kanata-import-preview').exists()).toBe(false)
    expect(mocked.management.importCard).not.toHaveBeenCalled()
    wrapper.unmount();expect(await dispatchBackAction()).toBe(false)
  })
  it('a late file read after unmount cannot populate a new preview or write any data',async()=>{
    const wrapper=library(),file=syntheticFile();let resolve
    const original=file.arrayBuffer;file.arrayBuffer=()=>new Promise(r=>{resolve=r})
    await chooseFile(wrapper,file);wrapper.unmount();resolve(await original());await flushPromises()
    expect(mocked.management.importCard).not.toHaveBeenCalled();expect(mocked.store.snapshot.cards).toHaveLength(5)
  })
  it('native file chooser cancellation leaves no preview and no import',async()=>{
    const wrapper=library();await button(wrapper,'导入角色卡').trigger('click')
    await wrapper.get('input[type=file]').trigger('cancel');await flushPromises()
    expect(wrapper.find('.kanata-import-preview').exists()).toBe(false)
    expect(mocked.management.importCard).not.toHaveBeenCalled();wrapper.unmount()
  })
  it('editing a base card creates a version, retains pinned instances, and does not clear local fields on invalid input',async()=>{
    const wrapper=library(),old=mocked.store.snapshot.cards[0].currentVersionId
    await button(wrapper,'编辑基础卡').trigger('click')
    await wrapper.get('input[maxlength="200"]').setValue('')
    await wrapper.get('form').trigger('submit');await flushPromises()
    expect(wrapper.text()).toContain('人格锚点');expect(mocked.management.updateCard).not.toHaveBeenCalled()
    await wrapper.get('input[maxlength="200"]').setValue('合成新卡名')
    await wrapper.get('form').trigger('submit');await flushPromises()
    expect(mocked.management.updateCard).toHaveBeenCalledTimes(1)
    expect(mocked.store.snapshot.cards[0].currentVersionId).not.toBe(old)
    expect(mocked.store.snapshot.instances[0].cardVersionId).toBe(old)
    wrapper.unmount()
  })
  it('lore creation makes the chosen role the only knower by default and never creates world events',async()=>{
    const worldId=mocked.store.snapshot.worlds[0].id,who=mocked.store.snapshot.instances[1].id
    const wrapper=mount(KanataLorebookPanel,{props:{data:mocked.store.snapshot,worldId,management:mocked.management}})
    await button(wrapper,'新建设定').trigger('click')
    mocked.choose.mockResolvedValueOnce('character').mockResolvedValueOnce(who)
    await wrapper.findAll('button').find(b=>b.text().startsWith('知情范围')).trigger('click');await flushPromises()
    await wrapper.get('textarea').setValue('合成私人知识')
    await wrapper.get('form input:not([type])').setValue('私有关键词')
    await wrapper.get('form').trigger('submit');await flushPromises()
    expect(mocked.management.saveLore).toHaveBeenCalledTimes(1)
    const entry=mocked.store.snapshot.lorebookEntries.at(-1)
    expect(entry.ownerId).toBe(who);expect(entry.knownBy).toEqual([who]);expect(entry.visibility).toBe('private')
    expect(mocked.store.snapshot.events).toEqual([]);wrapper.unmount()
  })
  it('route scroll is restored/saved via navigation and hidden protected content is unmounted',async()=>{
    const wrapper=mount(KanataView);await flushPromises()
    expect(wrapper.get('.kanata-frame').element.scrollTop).toBe(123)
    wrapper.get('.kanata-frame').element.scrollTop=42;await wrapper.get('.kanata-frame').trigger('scroll')
    expect(mocked.settings.updateCurrentRouteScroll).toHaveBeenCalledWith(42)
    await wrapper.setProps({isVisible:false});expect(wrapper.find('.kanata-manager').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('小鸟游星野');expect(await dispatchBackAction()).toBe(false)
    wrapper.unmount()
  })
  it('first unsaved seed stays in setup; later save failure keeps the entered manager and its recovery action',async()=>{
    mocked.store.saveError='KANATA_SAVE_FAILED';mocked.store.hasPendingSave=true
    const wrapper=mount(KanataView);await flushPromises()
    expect(wrapper.find('.kanata-manager').exists()).toBe(false)
    mocked.store.saveError='';mocked.store.hasPendingSave=false;await flushPromises()
    expect(wrapper.find('.kanata-manager').exists()).toBe(true)
    mocked.store.saveError='KANATA_SAVE_FAILED';await flushPromises()
    expect(wrapper.find('.kanata-manager').exists()).toBe(true);expect(wrapper.text()).toContain('重试保存')
    wrapper.unmount()
  })
})
