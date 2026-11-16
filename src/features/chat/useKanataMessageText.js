// @ts-check
import {getCurrentScope,onScopeDispose,shallowRef} from 'vue'

/** @typedef {import('./storage/sqlite/kanataRepositoryTypes').KanataMessageScope} Scope */
/** @typedef {import('./storage/sqlite/kanataRepositoryTypes').KanataMessageRepository} Repository */
/** @typedef {import('./storage/sqlite/kanataRepositoryTypes').KanataMessageTextCursor} Cursor */
/** @typedef {import('./storage/sqlite/kanataRepositoryTypes').KanataMessagePreview} Message */
/** @typedef {{scope:Scope,assertOwner():void}} Request */
/** @typedef {{id:string,revision:number,field:Cursor['field'],start:Cursor,next:Cursor|null,fragment:string}} Detail */
/** @param {unknown} error */
function failureCode(error){
  if(error&&typeof error==='object'&&'code'in error&&typeof error.code==='string')return error.code
  return error instanceof Error?error.message:'MESSAGE_LOAD_FAILED'
}

/** One displayed fragment, or an explicitly requested editable draft with the
 * existing 64000 UTF-16-unit revision limit. Closing drops both pending text
 * and late results; no ordinary path reconstructs a message compatibility DTO.
 * @param {{owner:()=>Request|null,current:(target:Request)=>boolean,
 * read:<T>(target:Request,work:(repository:Repository)=>Promise<T>)=>Promise<T>}} options */
export function useKanataMessageText({owner,current,read}){
  const detail=shallowRef(/** @type {Detail|null} */(null)),detailBusy=shallowRef(false),detailError=shallowRef('')
  const editing=shallowRef(false),editError=shallowRef('')
  let detailGeneration=0,editGeneration=0
  /** @type {Request|null} */let detailOwner=null
  /** @type {(()=>void)|null} */let dropEdit=null
  function closeText(){detailGeneration++;detailOwner=null;detail.value=null;detailBusy.value=false;detailError.value=''}
  function cancelEdit(){editGeneration++;dropEdit?.();dropEdit=null;editing.value=false;editError.value=''}
  function reset(){closeText();cancelEdit()}
  /** @param {Request} target @param {Pick<Message,'id'|'revision'>} message @param {Cursor['field']} field @returns {Cursor} */
  const start=(target,message,field)=>({...target.scope,id:message.id,revision:message.revision,kind:'text',field,offset:0})
  /** @param {Cursor} cursor */
  async function loadText(cursor){
    const target=detailOwner,version=detailGeneration
    if(!detail.value||!target||detailBusy.value||!current(target))return false
    // Do not retain the previous fragment in an asynchronous closure.
    const identity={id:detail.value.id,revision:detail.value.revision,field:detail.value.field}
    detail.value={...identity,start:cursor,next:null,fragment:''}
    detailBusy.value=true;detailError.value=''
    try{
      const page=await read(target,repository=>repository.textChunk(target.scope,identity.id,identity.field,cursor))
      if(version!==detailGeneration||!current(target))return false
      detail.value={...identity,start:cursor,next:page.cursor,fragment:page.fragment}
      return true
    }catch(error){if(version===detailGeneration&&current(target))detailError.value=failureCode(error);return false}
    finally{if(version===detailGeneration)detailBusy.value=false}
  }
  /** @param {Pick<Message,'id'|'revision'>} message @param {Cursor['field']} field */
  async function openText(message,field){
    closeText();const target=owner()
    if(!target||!current(target))return false
    const cursor=start(target,message,field)
    detailOwner=target;detail.value={id:message.id,revision:message.revision,field,start:cursor,next:null,fragment:''}
    return loadText(cursor)
  }
  /** @param {Pick<Message,'id'|'revision'|'content'|'contentChunked'>} message */
  async function editableText(message){
    cancelEdit();const target=owner(),version=editGeneration
    if(!target||!current(target))return null
    const selected={id:message.id,revision:message.revision},cursor=start(target,selected,'content')
    const chunked=Boolean(message.contentChunked)
    let content=chunked?'':message.content
    message={...selected,content:''}
    dropEdit=()=>{content=''};editing.value=true
    const assertCurrent=()=>{if(version!==editGeneration||!current(target))throw Error('MESSAGE_EDIT_OWNER_EXPIRED')}
    try{
      if(chunked)await read(target,async repository=>{
        /** @type {Cursor|null} */let next=cursor
        while(next){
          assertCurrent()
          const page=await repository.textChunk(target.scope,selected.id,'content',next)
          assertCurrent();content+=page.fragment
          if(content.length>64000)throw Error('KANATA_MESSAGE_EDIT_BUDGET_EXCEEDED')
          next=page.cursor
        }
      })
      assertCurrent()
      if(content.length>64000)throw Error('KANATA_MESSAGE_EDIT_BUDGET_EXCEEDED')
      return {...selected,content}
    }catch(error){if(version===editGeneration&&current(target))editError.value=failureCode(error);return null}
    finally{content='';if(version===editGeneration){dropEdit=null;editing.value=false}}
  }
  if(getCurrentScope())onScopeDispose(reset)
  return {detail,detailBusy,detailError,editing,editError,openText,closeText,editableText,cancelEdit,reset,
    nextText:()=>detail.value?.next?loadText(detail.value.next):Promise.resolve(false),
    restartText:()=>detail.value&&detailOwner?loadText(start(detailOwner,detail.value,detail.value.field)):Promise.resolve(false),
    retryText:()=>detail.value?loadText(detail.value.start):Promise.resolve(false)}
}
