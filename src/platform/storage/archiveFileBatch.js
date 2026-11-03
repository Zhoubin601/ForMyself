// @ts-check
import {Capacitor,registerPlugin} from '@capacitor/core'
import {Filesystem,Directory} from '@capacitor/filesystem'
/** @type {import('./archiveFileBatchTypes').ArchiveFileBatchDriver} */
const nativeBatch=registerPlugin('ArchiveFileBatch')
const MAX_CHARS=256*1024
const invalid=()=>Object.assign(new Error('ARCHIVE_FILE_BATCH_FAILED'),{code:'ARCHIVE_FILE_BATCH_FAILED'})
/** Preserve the injected Filesystem contract, while coalescing only this strict immutable
 * encrypted page namespace. Headers, journals, metadata and every other file stay on their
 * original driver. The application still hashes, decrypts and verifies every read-back.
 * @param {import('./archiveFileBatchTypes').ArchiveFilesystemDriver} filesystem
 * @param {string} directory
 * @param {{enabled?:boolean,batch?:import('./archiveFileBatchTypes').ArchiveFileBatchDriver}} [options]
 * @returns {import('./archiveFileBatchTypes').ArchiveFilesystemDriver}
 */
export function createArchiveFilesystem(filesystem,directory,{enabled=filesystem===Filesystem&&directory===Directory.Data&&Capacitor.isNativePlatform()&&Capacitor.isPluginAvailable('ArchiveFileBatch'),batch=nativeBatch}={}){
  if(!enabled)return filesystem
  /** @typedef {{command:import('./archiveFileBatchTypes').ArchiveFileCommand,original:()=>Promise<unknown>,resolve:(value:unknown)=>void,reject:(error:unknown)=>void}} Job */
  /** @type {Job[]} */
  const queue=[]
  let running=false,scheduled=false
  /** @param {import('./archiveFileBatchTypes').ArchiveFileCommand} command @param {()=>Promise<unknown>} original */
  const enqueue=(command,original)=>new Promise((resolve,reject)=>{queue.push({command,original,resolve,reject});schedule()})
  const schedule=()=>{if(!scheduled&&!running&&queue.length){scheduled=true;setTimeout(()=>{void pump()},0)}}
  const pump=async()=>{
    scheduled=false
    if(running||!queue.length)return
    running=true
    let limit=4
    if(queue[0].command.operation==='delete'){
      limit=0
      while(limit<64&&limit<queue.length&&queue[limit].command.operation==='delete')++limit
    }
    const jobs=queue.splice(0,limit)
    try{
      const response=await batch.execute({operations:jobs.map(job=>job.command)})
      if(!Array.isArray(response?.results)||response.results.length!==jobs.length)throw invalid()
      // Reject malformed batch responses before exposing any of them as successful I/O.
      response.results.forEach((row,index)=>{
        if(!row||typeof row.ok!=='boolean')throw invalid()
        if(!row.ok)return
        if(jobs[index].command.operation==='read'){
          if(row.oversized===true){if(row.data!==undefined)throw invalid()}
          else if(row.oversized!==undefined||typeof row.data!=='string')throw invalid()
        }else if(row.oversized!==undefined||row.data!==undefined)throw invalid()
      })
      const results=await Promise.allSettled(response.results.map(async(row,index)=>{
        if(!row.ok)throw invalid()
        // Large historical pages keep the pre-existing single-file path, selected before
        // native body allocation. Never fall back after a native read/write failure.
        if(row.oversized===true){if(jobs[index].command.operation!=='read')throw invalid();return jobs[index].original()}
        return jobs[index].command.operation==='read'?{data:row.data}:undefined
      }))
      results.forEach((row,index)=>row.status==='fulfilled'?jobs[index].resolve(row.value):jobs[index].reject(row.reason))
    }catch{jobs.forEach(job=>job.reject(invalid()))}
    finally{running=false;schedule()}
  }
  /** @param {string[]} keys */
  const deleteArchiveKeys=async keys=>{
    if(!Array.isArray(keys)||keys.some(key=>typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)))throw invalid()
    for(let start=0;start<keys.length;start+=64){
      const results=await Promise.allSettled(keys.slice(start,start+64).map(key=>enqueue({operation:'delete',key},()=>filesystem.deleteFile({path:'formyself/kanata-pages-v1/'+key+'.enc',directory}))))
      const failure=results.find(row=>row.status==='rejected')
      if(failure?.status==='rejected')throw failure.reason
    }
  }
  const adapter=Object.create(filesystem)
  Object.defineProperty(adapter,'deleteArchiveKeys',{value:deleteArchiveKeys})
  return new Proxy(adapter,{get(_target,property){
    if(property==='deleteArchiveKeys')return deleteArchiveKeys
    const original=Reflect.get(filesystem,property,filesystem)
    if(!['readFile','writeFile','deleteFile'].includes(String(property)))return typeof original==='function'?original.bind(filesystem):original
    /** @param {Record<string,any>} options */
    return options=>{
      const match=typeof options?.path==='string'&&/^formyself\/kanata-pages-v1\/([a-f0-9]{64})\.enc$/.exec(options.path)
      if(!match||options.directory!==directory||property!=='deleteFile'&&options.encoding!=='utf8'||property==='writeFile'&&(typeof options.data!=='string'||options.data.length>MAX_CHARS||options.recursive))return original.call(filesystem,options)
      const operation=property==='readFile'?'read':property==='writeFile'?'write':'delete'
      const command=/** @type {import('./archiveFileBatchTypes').ArchiveFileCommand} */({operation,key:match[1],...(operation==='write'?{data:options.data}:{})})
      return enqueue(command,()=>original.call(filesystem,options))
    }
  }})
}
