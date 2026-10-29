import {reactive} from 'vue'
import {vi} from 'vitest'
import preset from '../../src/features/chat/presets/abydos.v1.json'
import {createEmptyKanataData} from '../../src/features/chat/domain/kanataCore.js'
import {instantiateWorldPreset} from '../../src/features/chat/domain/presetCore.js'
import {createKanataStore} from '../../src/features/chat/kanataStore.js'
import {createKanataExperienceRuntime} from '../../src/application/kanataExperienceRuntime.js'
import {createKanataLifeCompanion} from '../../src/application/kanataLifeCompanion.js'
let sequence=0
export async function experienceFixture(){
  const id=()=> 'test-'+(++sequence)
  const data=instantiateWorldPreset(createEmptyKanataData('user'),preset,{initializationKey:'first',now:1000,timeZone:'Asia/Shanghai',idFactory:kind=>kind+'-'+(++sequence)})
  let disk=JSON.parse(JSON.stringify(data)),fail=false
  const state={loaded:false,loadError:'',saveError:'',hasPendingSave:false}
  const repository={getState:()=>({...state}),read:async()=>{state.loaded=true;return{status:'ready',data:disk,recovered:false}},write:async value=>{if(fail){state.saveError='KANATA_SAVE_FAILED';state.hasPendingSave=true;throw Object.assign(Error('KANATA_SAVE_FAILED'),{code:'KANATA_SAVE_FAILED'})}disk=JSON.parse(JSON.stringify(value));state.saveError='';state.hasPendingSave=false},flush:async()=>{},release:async()=>{},reencrypt:async()=>{}}
  const store=createKanataStore(repository,'experience-'+id())();await store.load('synthetic-password')
  const auth=reactive({sessionRevision:0}),settings=reactive({aiApiKey:'synthetic-not-a-key'})
  const access={authenticated:true,status:{chat:'ready'},ensureModule:vi.fn(async()=>true),runOperation:vi.fn(async(_modules,action)=>action())}
  const readers={mood:vi.fn(async()=>[{id:'synthetic-diary',date:'2026-10-28',note:'只有授权后可读的合成记录'}]),todo:vi.fn(async()=>[{id:'synthetic-todo',title:'合成待办'}])}
  const completion=vi.fn(async options=>{
    const a={id:'usage-'+id(),model:'deepseek-flash',officialProvider:true,startedAt:1000,finishedAt:null,status:'pending',transport:'json',errorCode:'',finishReason:'',usage:null,estimatedInputTokens:100,estimatedOutputTokens:0}
    await options.onAttempt(a)
    const instruction=options.messages[0].content
    const content=instruction.includes('文字记忆整理器')?(instruction.includes('{"summary"')?'{"summary":"合成的阶段摘要"}':'{"memories":[{"key":"合成偏好","content":"合成候选偏好","confidence":"statement"}]}'):'合成角色回应，尊重当前授权。'
    await options.onAttempt({...a,status:'succeeded',finishedAt:2000,finishReason:'stop',usage:{promptTokens:100,completionTokens:20,cacheHitTokens:0}})
    return{content,attemptId:a.id}
  })
  const adapters={store,auth,settings,access,completion,clock:()=>2000,idFactory:id}
  const runtime=createKanataExperienceRuntime(adapters),onRelease=vi.fn(),life=createKanataLifeCompanion({...adapters,readers,onRelease})
  const binding={worldId:data.worlds[0].id,instanceId:data.instances[0].id}
  const addUser=async(content='记住这条合成偏好')=>{const c=data.conversations[0];const message={id:id(),worldId:c.worldId,conversationId:c.id,role:'user',senderType:'user',senderId:data.identities[0].id,senderNameSnapshot:'老师',content,createdAt:1000,revision:1,status:'complete',turnId:id(),batchId:id()};await store.update(d=>{d.messages.push(message)});return message}
  const grant=async(module='mood',flags={read:true,remember:false,share:false},instanceId=binding.instanceId)=>runtime.setGrant(binding.worldId,instanceId,module,flags)
  return{store,data,auth,access,settings,readers,completion,runtime,life,onRelease,binding,adapters,addUser,grant,disk:()=>disk,fail:()=>{fail=true},dispose:()=>{runtime.dispose();life.dispose()}}
}
