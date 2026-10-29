import {describe,it,expect,vi} from 'vitest'
import {deliverKanataNotification} from '../src/platform/kanataNotifications.js'
const fixture=()=>({checkPermissions:vi.fn(async()=>({display:'granted'})),requestPermissions:vi.fn(async()=>({display:'granted'})),createChannel:vi.fn(async()=>{}),schedule:vi.fn(async()=>({notifications:[]}))})
describe('P6 notification platform boundary',()=>{
  const target={notificationId:910000001,taskId:'synthetic-task'}
  it('uses a new namespace and generic lockscreen content without deleting other modules notifications',async()=>{
    const plugin=fixture();expect((await deliverKanataNotification(target,{plugin,platform:'android',now:()=>1000})).status).toBe('scheduled')
    const notification=plugin.schedule.mock.calls[0][0].notifications[0]
    expect(notification.channelId).toBe('formyself-kanata-v1');expect(notification.schedule.at.getTime()).toBe(3000)
    expect(notification.extra.url).toBe('formyself://open/chat');expect(notification.body).not.toContain('星野')
    expect(plugin.requestPermissions).not.toHaveBeenCalled()
  })
  it('respects denial without prompting during passive foreground work',async()=>{
    const plugin=fixture();plugin.checkPermissions.mockResolvedValue({display:'denied'})
    expect((await deliverKanataNotification(target,{plugin,platform:'android'})).status).toBe('denied')
    expect(plugin.schedule).not.toHaveBeenCalled();expect(plugin.requestPermissions).not.toHaveBeenCalled()
  })
  it('Web makes no native background notification promise',async()=>{
    const plugin=fixture();expect((await deliverKanataNotification(target,{plugin,platform:'web'})).status).toBe('unsupported');expect(plugin.checkPermissions).not.toHaveBeenCalled()
  })
  it('refuses legacy IDs before any platform call',async()=>{
    const plugin=fixture();await expect(deliverKanataNotification({...target,notificationId:820000000},{plugin,platform:'android'})).rejects.toThrow('INVALID_KANATA_NOTIFICATION_ID');expect(plugin.schedule).not.toHaveBeenCalled()
  })
})
