<script setup>
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import {useKanataStore} from '../kanataStore.js'
import {resolveKanataCharacter} from '../domain/kanataManagementCore.js'
import {kanataAutonomyPolicy} from './kanataAutonomy.js'
import {createKanataWorldRuntime} from '../../../application/kanataWorldRuntime.js'
import {createKanataSocialRuntime} from '../../../application/kanataSocialRuntime.js'
import {createKanataContactRuntime} from '../../../application/kanataContactRuntime.js'
import {requestKanataNotificationPermission} from '../../../platform/kanataNotifications.js'
import {appChoose,cancelOwnedFeedbackDialog} from '../../../services/uiFeedback.js'
import {registerBackHandler} from '../../../services/backNavigation.js'
import AppTimeField from '../../../components/AppTimeField.vue'
const props=defineProps({worldId:{type:String,required:true},blocked:Boolean})
const emit=defineEmits(['open-conversation'])
const store=useKanataStore(),worldRuntime=createKanataWorldRuntime(),socialRuntime=createKanataSocialRuntime(),contactRuntime=createKanataContactRuntime()
const data=computed(()=>store.snapshot),world=computed(()=>data.value?.worlds.find(w=>w.id===props.worldId)),members=computed(()=>data.value?.instances.filter(i=>i.worldId===props.worldId)||[])
const flags=ref({autonomyEnabled:false,proactiveEnabled:false,notificationsEnabled:false}),policy=ref(null),instanceFlags=ref([]),schedules=ref([]),scheduleDraft=ref(null),god=ref(false),transcript=ref(''),busy=ref(false),notice=ref(''),error=ref('')
const owner=Symbol('kanata-activity');let mounted=true,observedRevision=0
const refresh=()=>{if(!world.value)return;observedRevision=world.value.revision;flags.value={autonomyEnabled:world.value.autonomyEnabled,proactiveEnabled:world.value.proactiveEnabled,notificationsEnabled:world.value.notificationsEnabled};policy.value={...kanataAutonomyPolicy(data.value,props.worldId)};instanceFlags.value=members.value.map(i=>({id:i.id,autonomyEnabled:i.autonomyEnabled,proactiveEnabled:i.proactiveEnabled}));schedules.value=JSON.parse(JSON.stringify(data.value.virtualSchedules?.filter(s=>s.worldId===props.worldId)||[]))}
watch(()=>world.value?.revision,refresh,{immediate:true})
const name=id=>resolveKanataCharacter(data.value,id).name
const perform=async(action,message)=>{if(props.blocked||busy.value)return;busy.value=true;error.value='';try{await action();if(mounted){notice.value=message;refresh()}}catch{if(mounted)error.value='这次操作未完成。已有记录保留，请检查配置、模型与保存状态后再试。'}finally{if(mounted)busy.value=false}}
const saveFlags=()=>perform(()=>worldRuntime.setActivity(props.worldId,observedRevision,flags.value),'世界的三项独立开关已保存。关闭期间不补算；重新开启从当前时间起。')
const saveConfig=()=>perform(()=>worldRuntime.configure(props.worldId,observedRevision,{policy:policy.value,instanceFlags:instanceFlags.value,schedules:schedules.value}),'角色与虚拟日程已保存，从当前时间继续；不会按新日程改写旧历史。')
const freedom=async()=>{const value=await appChoose({sensitive:true,owner,title:'世界自主自由度',message:'核心人格、隐私和因果连续性始终保留。',options:[{value:'strict',label:'严格'},{value:'standard',label:'标准'},{value:'free',label:'自由'},{value:'unrestricted',label:'完全自由'}]});if(mounted&&value)policy.value.freedom=value}
const chooseSocialChannel=async()=>{const value=await appChoose({sensitive:true,owner,title:'自主交流保存位置',message:'独立会话默认不向用户公开；选择现有群聊后，这场交流会由群成员看到并关联同一条世界事件。',options:[{value:'private',label:'独立角色会话'},{value:'group',label:'本世界现有群聊'}]});if(mounted&&value)policy.value.socialChannel=value}
const requestNotifications=()=>perform(async()=>{const permission=await requestKanataNotificationPermission();if(permission!=='granted')throw Error('NOTIFICATION_PERMISSION_DENIED')},'系统通知权限已允许；世界通知开关仍需独立开启。')
const editSchedule=async schedule=>{
  const selected=schedule?.instanceId||await appChoose({sensitive:true,owner,title:'选择虚拟日程角色',options:members.value.map(i=>({value:i.id,label:name(i.id)}))})
  if(!mounted||!selected)return
  const s=schedule||{id:crypto.randomUUID(),worldId:props.worldId,instanceId:selected,days:[1,2,3,4,5],startMinute:9*60,endMinute:10*60,location:'',activity:'',resting:false,revision:0}
  const time=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')
  scheduleDraft.value={...s,days:[...s.days],start:time(s.startMinute),end:s.endMinute===1440?'23:59':time(s.endMinute)}
}
const keepSchedule=()=>{
  const draft=scheduleDraft.value,minute=value=>Number(value.split(':')[0])*60+Number(value.split(':')[1])
  if(!draft||!draft.location.trim()||!draft.activity.trim()||!draft.days.length||minute(draft.start)>=minute(draft.end)){error.value='请填写地点、活动和至少一天，结束时间需要晚于开始时间。';return}
  const {start,end,...fields}=draft,next={...fields,startMinute:minute(start),endMinute:minute(end),revision:draft.revision+1}
  const index=schedules.value.findIndex(s=>s.id===draft.id);if(index<0)schedules.value.push(next);else schedules.value[index]=next
  scheduleDraft.value=null;notice.value='日程已加入草稿，请保存角色与日程。'
}
const run=()=>perform(async()=>{const result=await worldRuntime.advance(props.worldId);const scene=await socialRuntime.run(props.worldId);notice.value=`处理 ${result.windows} 个时间窗口；${scene.status==='succeeded'?'完成一场角色交流':'没有需要生成的角色交流'}。`},'本次有限补算已结束。原文和每次模型调用均独立记录。')
const checkContact=()=>perform(()=>contactRuntime.run(props.worldId),'已检查主动联系。未到时间、免打扰或已过期时不会生成问候。')
const visibleEvents=computed(()=>data.value?.events.filter(e=>e.worldId===props.worldId&&(god.value||e.visibility==='public'||e.participantIds.some(id=>data.value.identities.some(u=>u.id===id)))).slice(-30).reverse()||[])
const visibleTranscript=computed(()=>god.value&&transcript.value?data.value?.messages.filter(m=>m.conversationId===transcript.value&&!m.deleted)||[]:[])
const sceneConversation=event=>data.value.tasks.find(t=>t.social&&t.resultEventIds.includes(event.id))?.conversationId
const groupScene=event=>data.value.conversations.some(c=>c.id===sceneConversation(event)&&c.type==='group')
watch(god,()=>{transcript.value=''})
const unregister=registerBackHandler(()=>{if(scheduleDraft.value){scheduleDraft.value=null;return true}if(transcript.value){transcript.value='';return true}return false},{priority:610,isActive:()=>!!scheduleDraft.value||!!transcript.value})
onBeforeUnmount(()=>{mounted=false;worldRuntime.dispose();socialRuntime.dispose();contactRuntime.dispose();cancelOwnedFeedbackDialog(owner);unregister();scheduleDraft.value=null;transcript.value='';schedules.value=[]})
</script>
<template>
  <section v-if="world&&policy" class="kanata-panel" aria-label="世界自主活动与视角">
    <h3>世界的日常</h3><p class="kanata-help">应用打开并解锁后才进行有限补算。关闭应用不会持续运行 AI。完整交流每场两位角色、各一段，使用全局 DeepSeek 并产生实际用量；每日设为 0 时只处理轻量规则事件。</p>
    <p v-if="notice" class="kanata-notice" role="status">{{ notice }}</p><p v-if="error" class="kanata-error" role="alert">{{ error }}</p>
    <fieldset class="kanata-permission-fields"><legend>三个独立开关</legend><label class="kanata-check"><input v-model="flags.autonomyEnabled" type="checkbox" :disabled="blocked||busy" />自主世界发展</label><label class="kanata-check"><input v-model="flags.proactiveEnabled" type="checkbox" :disabled="blocked||busy" />角色主动联系</label><label class="kanata-check"><input v-model="flags.notificationsEnabled" type="checkbox" :disabled="blocked||busy" />本地通知</label></fieldset><button type="button" :disabled="blocked||busy" @click="saveFlags">保存世界开关</button>
    <p class="kanata-help">主动联系需本世界和角色分别允许。超过六小时未交流后，恢复应用会排入两分钟等待；每天本世界至多一次。过期两小时的联系会取消。开启通知不会绕过系统权限，锁屏只显示通用消息提示。</p><button type="button" :disabled="blocked||busy" @click="requestNotifications">请求系统通知权限</button>
    <form class="kanata-form" @submit.prevent="saveConfig"><h4>补算与角色日程</h4><label>每日完整交流场次上限<input v-model.number="policy.dailyDialogueLimit" type="number" min="0" max="4" :disabled="blocked||busy" /></label><label>单次最多补算小时<input v-model.number="policy.maxCatchUpHours" type="number" min="1" max="24" :disabled="blocked||busy" /></label><p class="kanata-help">每次实际最多处理六个半小时窗口，较早离线时段会明确跳过，不补造完整历史。</p><button type="button" :disabled="blocked||busy" @click="freedom">自由度：{{ policy.freedom }}</button>
      <button type="button" :disabled="blocked||busy" @click="chooseSocialChannel">交流位置：{{ policy.socialChannel==='group'?'现有群聊':'独立角色会话' }}</button><article v-for="member in instanceFlags" :key="member.id" class="kanata-experience-card"><h4>{{ name(member.id) }}</h4><label class="kanata-check"><input v-model="member.autonomyEnabled" type="checkbox" :disabled="blocked||busy" />允许自主活动</label><label class="kanata-check"><input v-model="member.proactiveEnabled" type="checkbox" :disabled="blocked||busy" />允许主动联系</label></article>
      <button type="button" :disabled="blocked||busy||!members.length" @click="editSchedule(null)">添加虚拟日程</button><article v-for="schedule in schedules" :key="schedule.id" class="kanata-experience-card"><p>{{ name(schedule.instanceId) }} · {{ schedule.location }} · {{ schedule.activity }}</p><div class="kanata-actions"><button type="button" :disabled="blocked||busy" @click="editSchedule(schedule)">编辑虚拟日程</button><button type="button" :disabled="blocked||busy" @click="schedules=schedules.filter(s=>s.id!==schedule.id)">移除日程草稿</button></div></article><button type="submit" :disabled="blocked||busy">保存角色与日程</button>
    </form>
    <form v-if="scheduleDraft" class="kanata-form" @submit.prevent="keepSchedule"><h4>{{ name(scheduleDraft.instanceId) }} · 虚拟日程</h4><label>虚拟地点<input v-model="scheduleDraft.location" maxlength="200" /></label><label>活动内容<input v-model="scheduleDraft.activity" maxlength="200" /></label><AppTimeField v-model="scheduleDraft.start" aria-label="虚拟日程开始时间" /><AppTimeField v-model="scheduleDraft.end" aria-label="虚拟日程结束时间" /><div class="kanata-permission-fields"><label v-for="day in [1,2,3,4,5,6,7]" :key="day" class="kanata-check"><input v-model="scheduleDraft.days" type="checkbox" :value="day" />周{{ day }}</label></div><label class="kanata-check"><input v-model="scheduleDraft.resting" type="checkbox" />休息活动</label><div class="kanata-actions"><button type="submit">保留日程草稿</button><button type="button" @click="scheduleDraft=null">取消日程编辑</button></div></form>
    <div class="kanata-actions"><button type="button" :disabled="blocked||busy||!world.autonomyEnabled" @click="run">现在有限补算</button><button type="button" :disabled="blocked||busy||!world.proactiveEnabled" @click="checkContact">检查主动联系</button><button v-if="busy" type="button" @click="socialRuntime.cancel();contactRuntime.cancel()">停止生成</button></div><p class="kanata-help">主动联系任务：{{ data.tasks.filter(t=>t.worldId===worldId&&t.contact).map(t=>t.state).join('、')||'暂无' }}</p>
    <h4>世界动态</h4><div class="kanata-actions"><button type="button" :aria-pressed="!god" @click="god=false">普通视角</button><button type="button" :aria-pressed="god" @click="god=true">上帝视角</button></div><p class="kanata-help">{{ god?'这是用户管理查询；不会让角色知道其他私聊或隐藏事件。':'仅显示公开动态和你参与的事件。角色之间未分享的私人交流不会展示。' }}</p><p v-if="!visibleEvents.length" class="kanata-help">这个视角暂时没有可见事件。</p><article v-for="event in visibleEvents" :key="event.id" class="kanata-experience-card"><p>{{ event.summary }}</p><p class="kanata-help">{{ event.status }} · {{ new Date(event.effectiveAt).toLocaleString() }}</p><button v-if="groupScene(event)" type="button" @click="emit('open-conversation',sceneConversation(event))">打开关联群聊</button><button v-else-if="god&&sceneConversation(event)" type="button" @click="transcript=sceneConversation(event)">查看关联角色会话</button></article><section v-if="god&&transcript" aria-label="用户管理角色间交流"><h4>角色间交流 · 只读管理</h4><article v-for="message in visibleTranscript" :key="message.id" class="kanata-chat-message"><strong>{{ message.senderNameSnapshot }}</strong><p>{{ message.content }}</p><small>生成于 {{ new Date(message.createdAt).toLocaleString() }}，不代表离线实时发言</small></article><button type="button" @click="transcript=''">收起角色会话</button></section>
  </section>
</template>
