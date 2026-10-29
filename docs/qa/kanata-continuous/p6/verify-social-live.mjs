// Explicit user-authorized external test key. Synthetic scene, at most two completions.
import {readFile,writeFile} from 'node:fs/promises'
import preset from '../../../../src/features/chat/presets/abydos.v1.json' with {type:'json'}
import {createAIClient} from '../../../../src/platform/ai/client.js'
import {createEmptyKanataData} from '../../../../src/features/chat/domain/kanataCore.js'
import {instantiateWorldPreset} from '../../../../src/features/chat/domain/presetCore.js'
import {planKanataWorldWindow,completeKanataWorldWindow} from '../../../../src/features/chat/autonomy/kanataAutonomy.js'
import {planKanataSocial,beginKanataSocial,buildKanataSocialContext,completeKanataSocial} from '../../../../src/features/chat/autonomy/kanataSocial.js'
import {recordKanataAttempt} from '../../../../src/features/chat/domain/kanataConversation.js'
const result={status:'RUNNING',syntheticOnly:true,startedAt:new Date().toISOString(),attempts:[],responses:[]}
let counter=0,key=''
const now=Date.UTC(2026,9,29,4),tools={clock:()=>now,id:()=>`social-live-${++counter}`}
let data=instantiateWorldPreset(createEmptyKanataData('synthetic-social-user'),preset,{initializationKey:'first',now:now-3600000,timeZone:'Asia/Shanghai',idFactory:tools.id})
try{
  if(!process.argv[2])throw Object.assign(Error(),{code:'EXTERNAL_KEY_REQUIRED'})
  key=(await readFile(process.argv[2],'utf8')).trim()
  if(!/^sk-[A-Za-z0-9_-]+$/.test(key))throw Object.assign(Error(),{code:'INVALID_TEST_KEY_FORMAT'})
  const client=createAIClient(()=>({aiProviderUrl:'https://api.deepseek.com',aiApiKey:key,aiModel:'deepseek-flash'})),world=data.worlds[0]
  world.autonomyEnabled=true;world.lastSimulatedAt=now-1800000
  data.autonomyPolicies=[{worldId:world.id,revision:1,dailyDialogueLimit:1,maxCatchUpHours:3,freedom:'strict',quietStartMinute:1320,quietEndMinute:480}]
  data.virtualSchedules=data.instances.slice(0,2).map(i=>{i.autonomyEnabled=true;return{id:tools.id(),worldId:world.id,instanceId:i.id,days:[1,2,3,4,5,6,7],startMinute:0,endMinute:1440,location:'合成资料室',activity:'整理合成书架',resting:false,revision:1}})
  data=completeKanataWorldWindow(data,planKanataWorldWindow(data,world.id,now),tools)
  const plan=planKanataSocial(data,world.id,now);if(!plan)throw Object.assign(Error(),{code:'SOCIAL_PLAN_MISSING'})
  data=beginKanataSocial(data,plan,tools)
  const task=data.tasks.find(t=>t.social),replies=[]
  for(const speakerId of task.social.participantIds){
    const context=buildKanataSocialContext(data,task.id,speakerId,replies)
    const response=await client.completeChat({messages:context.messages,stream:false,maxTokens:512,timeoutMs:90000,onAttempt:async attempt=>{
      data=recordKanataAttempt(data,{...attempt,worldId:world.id,conversationId:task.conversationId,instanceId:speakerId,turnId:task.id,purpose:'world'})
      const index=result.attempts.findIndex(a=>a.id===attempt.id);if(index<0)result.attempts.push(attempt);else result.attempts[index]=attempt
    }})
    replies.push({speakerId,content:response.content,lifeSources:context.lifeSources});result.responses.push({speakerId,content:response.content})
  }
  data=completeKanataSocial(data,task.id,replies,tools)
  if(data.messages.length!==2||data.messages.some(m=>m.role!=='assistant')||data.tasks.find(t=>t.id===task.id).state!=='succeeded')throw Object.assign(Error(),{code:'SOCIAL_TRUTH_BOUNDARY_FAILED'})
  result.status='AWAITING_QUALITY_REVIEW';result.counts={messages:data.messages.length,characterConversations:data.conversations.filter(c=>c.type==='character').length,attempts:data.usageEvents.length}
  console.log('PASS actual two-speaker synthetic scene; quality review pending')
}catch(error){result.status='FAIL';result.errorCode=/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'SOCIAL_LIVE_FAILED';process.exitCode=1;console.log(result.errorCode)}
finally{key='';result.finishedAt=new Date().toISOString();await writeFile(new URL('social-live-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n')}
