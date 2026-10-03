import { describe, it, expect, vi } from 'vitest'
import { createTodoRepository } from '../src/features/todo/todoRepository.js'
import { normalizeTodoData } from '../src/features/todo/todoCore.js'

describe('待办仓库持久化',()=>{
  it('串行写入并在失败后保留旧快照，下一次修改可以恢复',async()=>{
    let value=JSON.stringify(normalizeTodoData())
    const storage={get:vi.fn(async()=>({value})),set:vi.fn(async args=>{value=args.value})}
    const repo=createTodoRepository(storage)
    const add=id=>({type:'add',task:{id,title:id,startDate:'2026-10-01',recurrence:{type:'daily'}}})
    await Promise.all([repo.apply(add('a')),repo.apply(add('b'))])
    expect((await repo.read()).tasks).toHaveLength(2)
    storage.set.mockRejectedValueOnce(new Error('disk full'))
    await expect(repo.apply(add('c'))).rejects.toThrow('disk full')
    expect((await repo.read()).tasks).toHaveLength(2)
    await repo.apply(add('d'))
    expect((await repo.read()).tasks.map(t=>t.id)).toEqual(['a','b','d'])
  })
  it('原生桌面先写入时重新读取并保留桌面完成记录',async()=>{
    let data=normalizeTodoData({tasks:[{id:'a',title:'a',startDate:'2026-10-01',recurrence:{type:'daily'}}]})
    let raced=false
    const native={read:async()=>structuredClone(data),write:async args=>{
      if(!raced){raced=true;data.completions.push({key:'a@2026-10-01',taskId:'a',date:'2026-10-01',completedAt:1});data.revision++;throw Object.assign(new Error('conflict'),{code:'TODO_CONFLICT'})}
      expect(args.expectedRevision).toBe(data.revision);data=args.data;return data
    }}
    const repo=createTodoRepository(null,native)
    await repo.apply({type:'edit',taskId:'a',date:'2026-10-01',scope:'single',changes:{title:'new'}})
    expect(data.completions).toHaveLength(1)
    expect(data.overrides[0].changes.title).toBe('new')
  })
})
