import preset from '../../src/features/chat/presets/abydos.v1.json' with { type: 'json' }
import { createEmptyKanataData } from '../../src/features/chat/domain/kanataCore.js'
import { instantiateWorldPreset } from '../../src/features/chat/domain/presetCore.js'
import { createKanataRepository } from '../../src/features/chat/storage/kanataRepository.js'
export const ARCHIVE_PASSWORD = 'synthetic-archive-only-password'
let sequence = 0
export function archiveData(count = 400) {
  const data = instantiateWorldPreset(createEmptyKanataData('synthetic-user'), preset, { initializationKey:'archive-test',now:1000,timeZone:'Asia/Shanghai',idFactory:kind => kind + '-' + (++sequence) })
  const c = data.conversations.find(c => c.type === 'private'), identity = data.identities[0], character = data.instances.find(i => c.participantIds.includes(i.id))
  for (let i=0;i<count;i++) {
    const assistant = i % 2 === 1
    data.messages.push({id:'synthetic-message-'+i,worldId:c.worldId,conversationId:c.id,role:assistant?'assistant':'user',senderType:assistant?'character':'user',senderId:assistant?character.id:identity.id,senderNameSnapshot:assistant?'合成角色':'合成用户',content:i===26?'唯一检索词：星河🚀 Cafe\u0301':'合成历史消息 '+i,createdAt:1000+i,revision:1,status:'complete',turnId:'turn-'+Math.floor(i/2),batchId:'batch-'+Math.floor(i/2),...(assistant?{replyToMessageId:'synthetic-message-'+(i-1),replyToRevision:1}:{})})
  }
  return data
}
export function archiveFilesystem() {
  const files = new Map(), values = new Map(), calls = [], control = {failure:null, pause:null}
  const missing = () => Object.assign(Error('File does not exist.'), {code:'ENOENT'})
  const hit = async (operation,path) => {
    calls.push({operation,path})
    if (control.pause?.operation === operation && path.includes(control.pause.contains)) { const pause=control.pause;control.pause=null;pause.onEnter?.();await pause.wait }
    if (control.failure?.operation === operation && path.includes(control.failure.contains)) throw Object.assign(Error('synthetic failure'),{code:'SYNTHETIC_IO_FAILED'})
  }
  const filesystem = {
    async stat({path}){await hit('stat',path);if(!files.has(path))throw missing();return{type:'file',size:files.get(path).length}},
    async readFile({path}){await hit('read',path);if(!files.has(path))throw missing();return{data:files.get(path)}},
    async writeFile({path,data}){await hit('write',path);files.set(path,data)},
    async mkdir({path}){await hit('mkdir',path)},
    async rename({from,to}){await hit('rename',from);if(!files.has(from))throw missing();files.set(to,files.get(from));files.delete(from)},
    async deleteFile({path}){await hit('delete',path);if(!files.has(path))throw missing();files.delete(path)},
    async readdir({path}){await hit('list',path);return{files:[...files.keys()].filter(key=>key.startsWith(path+'/')).map(key=>({name:key.slice(path.length+1),type:'file',size:files.get(key).length}))}}
  }
  const journal = {async get({key}){return{value:values.get(key)??null}},async set({key,value}){values.set(key,value)},async remove({key}){values.delete(key)}}
  return {files,values,calls,control,filesystem,journal,repository:()=>createKanataRepository({filesystem,journal,directory:'DATA'})}
}
