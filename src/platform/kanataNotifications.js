// @ts-check
import {Capacitor} from '@capacitor/core'
import {LocalNotifications} from '@capacitor/local-notifications'
import {withNativeActivityGuard} from '../services/nativeActivityGuard.js'
export const KANATA_NOTIFICATION_CHANNEL='formyself-kanata-v1'
/** Explicit UI permission action, no AI and no test notification. */
export async function requestKanataNotificationPermission() {
  if(Capacitor.getPlatform()==='web')return 'unsupported'
  return withNativeActivityGuard(async()=>{const permission=await LocalNotifications.requestPermissions();return permission.display})
}
/** Generic lockscreen text, no persona, user message or world name in platform storage.
 * @param {{notificationId:number,taskId:string}} target
 * @param {{plugin?:typeof LocalNotifications,platform?:string,now?:()=>number,requestPermission?:boolean}} [options] */
export async function deliverKanataNotification(target,options={}) {
  const plugin=options.plugin||LocalNotifications,platform=options.platform||Capacitor.getPlatform()
  if(!Number.isSafeInteger(target.notificationId)||target.notificationId<910000000||target.notificationId>=911000000)throw Error('INVALID_KANATA_NOTIFICATION_ID')
  if(platform==='web')return{status:/** @type {const} */('unsupported')}
  let permission=await plugin.checkPermissions()
  if(permission.display!=='granted'&&options.requestPermission)permission=await plugin.requestPermissions()
  if(permission.display!=='granted')return{status:/** @type {const} */('denied')}
  if(platform==='android')await plugin.createChannel({id:KANATA_NOTIFICATION_CHANNEL,name:'彼方消息',description:'已生成的新消息提醒',importance:3,visibility:0})
  await plugin.schedule({notifications:[{id:target.notificationId,channelId:KANATA_NOTIFICATION_CHANNEL,title:'彼方 · Kanata',body:'有一条新的角色消息，解锁后查看。',schedule:{at:new Date((options.now||Date.now)()+2000)},extra:{kanataTaskId:target.taskId,url:'formyself://open/chat'}}]})
  return{status:/** @type {const} */('scheduled')}
}
