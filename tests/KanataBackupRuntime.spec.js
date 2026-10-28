import { beforeEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { createKanataBackupRuntime } from '../src/application/kanataBackupRuntime.js'
import { createRestoreJournal } from '../src/platform/storage/restoreJournal.js'
import preset from '../src/features/chat/presets/abydos.v1.json'
import { createEmptyKanataData } from '../src/features/chat/domain/kanataCore.js'
import { instantiateWorldPreset } from '../src/features/chat/domain/presetCore.js'
import { buildFullBackupSnapshot } from '../src/services/fullBackup.js'
const clone=value=>JSON.parse(JSON.stringify(value))
const seed=()=>instantiateWorldPreset(createEmptyKanataData('user-local'),preset,{initializationKey:'one',now:1000,timeZone:'Asia/Shanghai',idFactory:(kind,key)=>kind+'-'+[...key].reduce((v,c)=>(v*31+c.charCodeAt(0))>>>0,1).toString(16)})
beforeEach(()=>vi.stubGlobal('crypto',webcrypto))
function harness() {
  const files=new Map(), calls=[], state={blocked:false,busy:false,message:'',syncError:''}
  const missing=()=>new Error('File does not exist')
  const filesystem={
    async readFile({path}){if(!files.has(path))throw missing();return{data:files.get(path)}},
    async writeFile({path,data}){files.set(path,data)},
    async rename({from,to}){files.set(to,files.get(from));files.delete(from)},
    async deleteFile({path}){if(!files.has(path))throw missing();files.delete(path)}
  }
  const parts={savings:{data:[],metadata:{groups:[]}},weight:{data:[{id:'previous-weight',weight:60,date:'2026-01-01'}]},mood:{data:[],metadata:{}},passwords:{data:[],metadata:{categories:[]}},schedules:{data:{}},chat:{data:seed()},settings:{data:{}}}
  const control={failTarget:false,failRollback:false}
  const participants=Object.entries(parts).map(([id])=>({id,ready:()=>true,flush:async()=>{},
    export:()=>clone(parts[id]),restore:async part=>{
      calls.push(id)
      if(id==='weight' && control.failTarget && part.data[0]?.id==='target-weight')throw new Error('target-failed')
      if(id==='weight' && control.failRollback && part.data[0]?.id==='previous-weight')throw new Error('rollback-failed')
      parts[id]=clone(part)
    }}))
  const journal=createRestoreJournal(filesystem)
  const runtime=createKanataBackupRuntime({participants,journal,state,prepare:async()=>{}})
  return {runtime,parts,calls,files,state,control,journal}
}
it('P2 actual coordinator: legacy restore requires discard consent and never restores chat',async()=>{
  const h=harness(), previous=clone(h.parts.chat)
  const old=buildFullBackupSnapshot({weight:[{id:'target-weight',weight:70,date:'2026-01-02'}],chat:{messages:[{id:'legacy',role:'user',content:'synthetic old conversation',createdAt:1}]}})
  expect(()=>h.runtime.restore(old,'synthetic-password')).toThrow('LEGACY_CHAT_DISCARD_CONFIRMATION_REQUIRED')
  expect(h.calls).toEqual([])
  await h.runtime.restore(old,'synthetic-password',{legacyChat:'discard'})
  expect(h.parts.weight.data[0].id).toBe('target-weight')
  expect(h.parts.chat).toEqual(previous);expect(h.calls).not.toContain('chat');expect(h.state.blocked).toBe(false)
  expect(h.files.size).toBe(0)
})
it('P2 actual coordinator: new backup target failure restores full previous graph and preserves tasks',async()=>{
  const h=harness(), previous=clone(h.parts)
  const target=await h.runtime.exportFull();target.data.weight=[{id:'target-weight',weight:70,date:'2026-01-02'}]
  target.data.chat.worlds[0].name='target-world';h.control.failTarget=true
  await expect(h.runtime.restore(target,'synthetic-password')).rejects.toThrow('target-failed')
  expect(h.parts.chat).toEqual(previous.chat);expect(h.parts.weight).toEqual(previous.weight)
  expect(h.state.blocked).toBe(false);expect(h.files.size).toBe(0)
})
it('P2 actual coordinator: rollback failure retains encrypted journal/barrier and can recover',async()=>{
  const h=harness(), target=await h.runtime.exportFull()
  target.data.weight=[{id:'target-weight',weight:70,date:'2026-01-02'}];h.control.failTarget=true;h.control.failRollback=true
  await expect(h.runtime.restore(target,'synthetic-password')).rejects.toHaveProperty('rollbackFailed',true)
  expect(h.state.blocked).toBe(true)
  expect([...h.files.values()].join('')).not.toContain('previous-weight')
  h.control.failTarget=false;h.control.failRollback=false
  await h.runtime.recover('synthetic-password')
  expect(h.parts.weight.data[0].id).toBe('previous-weight');expect(h.state.blocked).toBe(false);expect(h.files.size).toBe(0)
})
it('P2 actual coordinator: invalid new graph is zero-write before journal',async()=>{
  const h=harness(), target=await h.runtime.exportFull();target.data.chat.instances[0].worldId='missing'
  expect(()=>h.runtime.restore(target,'synthetic-password')).toThrow('ORPHAN_WORLD')
  expect(h.calls).toEqual([]);expect(h.files.size).toBe(0);expect(h.state.blocked).toBe(false)
})
