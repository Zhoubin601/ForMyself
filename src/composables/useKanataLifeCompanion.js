// @ts-check
import {onActivated,onDeactivated,onBeforeUnmount,ref} from 'vue'
/** @param {import('../features/chat/domain/kanataTypes').LifeModule} moduleId */
export function useKanataLifeCompanion(moduleId) {
  const text=ref(''),speaker=ref(''),busy=ref(false),error=ref('')
  let disposed=false,active=true,sequence=0,runtime=/** @type {ReturnType<typeof import('../application/kanataLifeCompanion.js').createKanataLifeCompanion>|null} */(null)
  const clear=()=>{text.value='';speaker.value=''}
  /** @param {string} task @param {boolean} [allowPrompt] */
  const request=async(task,allowPrompt=false)=>{
    if(disposed||!active||busy.value)return''
    const requestId=++sequence
    busy.value=true;error.value=''
    try{
      if(!runtime){const {createKanataLifeCompanion}=await import('../application/kanataLifeCompanion.js');if(disposed||!active||requestId!==sequence)return'';runtime=createKanataLifeCompanion({onRelease:clear})}
      const target=runtime
      // Authentication is allowed to advance a session only for this explicit click.
      const result=await target.request(moduleId,task,{allowPrompt})
      if(disposed||!active||runtime!==target||requestId!==sequence)return''
      if(result.status==='succeeded'){if(!target.isCurrent(result.sessionRevision))return'';text.value=result.text;speaker.value=result.speakerName||'';return result.text}
      const messages={unavailable:'已绑定角色不可用，请重新选择。',unselected:'请先在彼方的生活联动中选择角色。','requires-unlock':'验证后可使用所选角色。','permission-required':'请先给这个实例授予本模块读取权限。',cancelled:'已取消验证。'}
      if(allowPrompt)error.value=messages[result.status]||'暂时无法生成角色回应。'
      return''
    }catch{if(!disposed&&active&&requestId===sequence)error.value='角色回应未完成，请检查授权、全局配置或保存状态。';return''}
    finally{if(!disposed&&requestId===sequence)busy.value=false}
  }
  const cancel=()=>{runtime?.cancel();clear()}
  const release=()=>{sequence++;cancel();runtime?.dispose();runtime=null;busy.value=false;error.value=''}
  onActivated(()=>{active=true})
  onDeactivated(()=>{active=false;release()})
  onBeforeUnmount(()=>{disposed=true;active=false;release()})
  return{text,speaker,busy,error,request,cancel}
}
