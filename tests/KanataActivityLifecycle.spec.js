import {describe,it,expect,vi,afterEach} from 'vitest'
import {reactive} from 'vue'
import {createKanataActivityLifecycle} from '../src/application/kanataActivityLifecycle.js'
const pending=[]
afterEach(()=>{pending.splice(0).forEach(l=>l.dispose());vi.useRealTimers()})
function fixture(){
  const auth=reactive({sessionRevision:0,isLocked:false}),access=reactive({status:{chat:'ready'}}),settings=reactive({warmHomeEnabled:true})
  const world={advance:vi.fn(async()=>{}),dispose:vi.fn()},social={run:vi.fn(async()=>{}),dispose:vi.fn()},contact={run:vi.fn(async()=>{}),dispose:vi.fn()}
  const runtime={snapshot:{worlds:[{id:'a',autonomyEnabled:true},{id:'b',proactiveEnabled:true},{id:'c',autonomyEnabled:true}]},world,social,contact}
  const load=vi.fn(async()=>runtime),onError=vi.fn(),lifecycle=createKanataActivityLifecycle({auth,access,settings,load,onError,visible:()=>true});pending.push(lifecycle)
  return{auth,access,settings,world,social,contact,runtime,load,onError,lifecycle}
}
describe('P6 lazy foreground lifecycle participant',()=>{
  it('never resolves protected data while chat is locked or unloaded',async()=>{
    const f=fixture();f.access.status.chat='idle';await f.lifecycle.initialize();expect(f.load).not.toHaveBeenCalled()
    f.access.status.chat='ready';f.auth.isLocked=true;await f.lifecycle.resume();expect(f.load).not.toHaveBeenCalled()
  })
  it('processes two worlds at most and rotates fairly across later resumes',async()=>{
    const f=fixture();await f.lifecycle.initialize()
    expect(f.world.advance.mock.calls.map(c=>c[0])).toEqual(['a']);expect(f.contact.run.mock.calls.map(c=>c[0])).toEqual(['a','b'])
    await f.lifecycle.resume();expect(f.world.advance.mock.calls.map(c=>c[0])).toEqual(['a','c','a'])
  })
  it('background flush disposes AI owners and suppresses timer work until resume',async()=>{
    vi.useFakeTimers();const f=fixture();await f.lifecycle.initialize();const cleanup=f.lifecycle.subscribe();f.lifecycle.flush()
    expect(f.social.dispose).toHaveBeenCalled();await vi.advanceTimersByTimeAsync(90000);expect(f.load).toHaveBeenCalledTimes(1)
    await f.lifecycle.resume();expect(f.load).toHaveBeenCalledTimes(2);cleanup()
  })
  it('a failing world does not starve an independent world',async()=>{
    const f=fixture();f.world.advance.mockRejectedValueOnce(Error('synthetic'))
    await f.lifecycle.initialize();expect(f.onError).toHaveBeenCalledWith('KANATA_ACTIVITY_FAILED');expect(f.contact.run).toHaveBeenCalledWith('b')
  })
  it('late lazy imports are released after a background transition',async()=>{
    const f=fixture();let finish
    f.load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    const task=f.lifecycle.initialize();f.lifecycle.flush();finish(f.runtime);await task
    expect(f.world.advance).not.toHaveBeenCalled();expect(f.world.dispose).toHaveBeenCalled()
  })
})
