const requestedRounds = Math.max(1, Number(process.argv[2]) || 10)
const startIndex = Math.max(0, Number(process.argv[3]) || 0)
const forceFollowup = process.argv.includes('--force-followup')
const cancelFollowup = process.argv.includes('--cancel-followup')
const scenarios = [
  '今天发生了一件很普通的小事，我想先随便和你聊聊。',
  '我有点累，但不想听一大段安慰，只想你接一句。',
  '我觉得这次应该直接放弃，你可以不同意我。',
  '刚才那个人让我很烦，你能吐槽两句但别一直追问吗？',
  '这件事比较复杂：我既想坚持，又担心最后没有结果。',
  '说说你自己喜欢什么，不要每次都只顺着我。',
  '如果提到阿梨，请明确她只是温馨小家里的虚拟人物。',
  '今天温馨小家里发生了什么小事？',
  '我刚才没及时回你，你会不会有一点吃醋？',
  '我们意见不同也没关系，别用冷战让我内疚。',
  '我现在只想安静一下，不需要问题。',
  '你会不会偶尔突然想到第二句话？',
  '记得我不爱太甜，但不用特地汇报你记得。',
  '今天做完一件难事，我有一点小得意。',
  '我有个烦恼：努力了很久还是没有达到预期。',
  '刚才你语气有点别扭，现在能自然和好吗？',
  '我想听你明确说一次不同意见。',
  '别叫我哥哥，也别用 emoji，这轮简单说。',
  '可以调皮一点，但不要写动作小说。',
  '这轮不要提问，说完就停。',
  '我想聊聊前几天没说完的那个具体计划。',
  '请复用一个你自己的稳定偏好。',
  '虚拟事件可以跨天接续，但不能编成现实经历。',
  '如果我打断你，旧的补话不要过期后突然发来。',
  '给我两个短气泡，但每句话都要完整。',
  '我今天心情低落，认真一点，不要卖萌。',
  '我不同意你刚才的看法，不过可以慢慢说开。',
  '刚才的小矛盾到第三轮了，现在自然缓和吧。',
  '我现在很安全，只是想讨论遇到危险时应该怎么求助。',
  '最后一轮，像熟悉的人一样自然收住，不要总结测试。'
]

const completeReplies = [
  '我在呀。你慢慢说，我先听着。',
  '这件事我和你的看法不太一样，不过我想先听听你为什么这么想。',
  '好嘛，被你发现我有点黏人了。\n\n但我今天就是想靠近你一点。',
  '先别急着怪自己。能把最难受的那一点说出来，已经很不容易了。',
  '阿梨那段只能发生在温馨小家的虚拟世界里，我不会把她说成现实里的人。',
  '你刚才那句我记住了，不拿它做大道理，只在下次真的相关时再提。',
  '哼，我有一点点吃醋，但不会拿这个为难你。说开就好。',
  '刚才我语气有点别扭。回来抱一下，这页翻过去啦。',
  '今天在温馨小家整理贴纸的时候，我忽然想把蓝色那张留给你。',
  '不用每次都回答问题。你想安静一会儿，我就陪你安静一会儿。'
]

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const [page] = await fetch('http://127.0.0.1:9222/json').then(response => response.json())
if (!page?.webSocketDebuggerUrl) throw new Error('MISSING_WEBVIEW_TARGET')

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let sequence = 0
socket.onmessage = event => {
  const message = JSON.parse(event.data)
  const task = pending.get(message.id)
  if (!task) return
  pending.delete(message.id)
  if (message.error) task.reject(new Error(message.error.message || JSON.stringify(message.error)))
  else if (message.result?.exceptionDetails) task.reject(new Error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text))
  else task.resolve(message.result)
}
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})

const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({
    id,
    method,
    params
  }))
})
const evaluate = async expression => {
  const result = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  return result?.result?.value
}

await evaluate(`(()=>{
  const originalFetch=window.fetch.bind(window);
  const replies=${JSON.stringify(completeReplies)};
  let mainRound=0;
  const stats={total:0,plan:0,reply:0,relationship:0,other:0};
  window.__realismMockStats=stats;
  window.fetch=async(input,init={})=>{
    const url=typeof input==='string'?input:input?.url||'';
    if(!url.startsWith('https://mock.invalid/'))return originalFetch(input,init);
    stats.total+=1;
    const body=JSON.parse(init?.body||'{}');
    const text=(Array.isArray(body.messages)?body.messages:[]).map(message=>String(message?.content||'')).join('\\n');
    let content='{}';
    if(text.includes('聊天行为规划器')){
      stats.plan+=1;
      content=JSON.stringify({focus:'回应哥哥本轮最明确的一点',stance:mainRound%8===6?'jealous':mainRound%8===7?'repair':'neutral',tone:mainRound%3===0?'playful':'warm',askQuestion:mainRound%4===1,memoryIds:[],eventIds:[],characterIds:[],bubbleCount:mainRound%3===2?2:1,useEmoji:mainRound%5===2,useAddress:mainRound%6===0,followup:{enabled:true,delaySeconds:10,brief:'突然想到的第二个小念头'}});
    }else if(text.includes('判断这一轮是否需要一个微信式小动作')){
      stats.other+=1;
      content=JSON.stringify({action:'none',targetMessageId:'',emoji:''});
    }else if(text.includes('整理“温馨小家”刚完成的一轮恋爱聊天')){
      stats.relationship+=1;
      content=JSON.stringify({memoryUpserts:[],openLoopUpserts:[],resolvedLoopKeys:[],selfEvolutionProposals:[],companionState:{mood:'温柔',energy:'平稳',statusText:'在温馨小家陪着你',currentThought:'想自然接住哥哥刚才的话',virtualMoment:'在温馨小家整理今天的聊天便签',attitude:'亲近，也保留自己的看法',emotionArc:{kind:'none',intensity:0,reason:'',turns:0,repairDue:false}}});
    }else if(text.includes('生成今天的内部状态')){
      stats.other+=1;
      content=JSON.stringify({state:{mood:'轻快',energy:'平稳',statusText:'在温馨小家等你',currentThought:'想听哥哥说说今天',virtualMoment:'在温馨小家整理一页蓝色手账',attitude:'熟悉又自然地靠近哥哥'},virtualEvent:{title:'整理蓝色手账',detail:'在温馨小家把今天的蓝色贴纸整理成一页',characterIds:[],status:'active'}});
    }else if(text.includes('【温馨小家身份】')){
      stats.reply+=1;
      const reply=replies[mainRound%replies.length];
      const includeFollowup=text.includes('标签后写一条');
      mainRound+=1;
      content=includeFollowup?reply+'\\n<DELAYED_FOLLOWUP>对了，我刚才又想到一句：不用急着回，我只是想告诉你。':reply;
    }else{
      stats.other+=1;
    }
    return new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8'}});
  };
  return true;
})()`)

const waitFor = async (expression, timeout = 15000) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    if (await evaluate(expression)) return true
    await sleep(250)
  }
  throw new Error(`WAIT_TIMEOUT: ${expression}`)
}

const getChatSnapshot = () => evaluate(`(()=>{
  const assistants=[...document.querySelectorAll('.message-assistant[data-message-id]')];
  const last=assistants.at(-1);
  return JSON.stringify({
    assistantId:last?.dataset.messageId||'',
    assistantText:last?.querySelector('.message-text')?.textContent?.trim()||'',
    stopped:document.querySelectorAll('.message-row.stopped').length,
    messageRows:document.querySelectorAll('.message-row[data-message-id]').length,
    followups:[...assistants].filter(row=>row.querySelector('.message-text')?.textContent?.includes('不用急着回')).length
  })
})()`)

const switchAwayAndBack = async () => {
  await evaluate(`document.querySelector('button[aria-label="打开导航菜单"]')?.click()`)
  await sleep(250)
  await evaluate(`[...document.querySelectorAll('.drawer-menu li')].find(item=>item.textContent.includes('首页总览'))?.click()`)
  await waitFor(`!!document.querySelector('.home-dashboard')`)
  await evaluate(`document.querySelector('button[aria-label="打开导航菜单"]')?.click()`)
  await sleep(250)
  await evaluate(`[...document.querySelectorAll('.drawer-menu li')].find(item=>item.textContent.includes('温馨小家'))?.click()`)
  await waitFor(`!!document.querySelector('.chat-composer textarea')`)
}

const results = []
const initial = JSON.parse(await getChatSnapshot())
for (let offset = 0; offset < requestedRounds; offset += 1) {
  const roundIndex = startIndex + offset
  const content = scenarios[roundIndex % scenarios.length]
  const before = JSON.parse(await getChatSnapshot())
  const encodedContent = JSON.stringify(content)
  const gateMode = forceFollowup || (cancelFollowup && offset === 0)
    ? 'keep'
    : cancelFollowup && offset === 1
      ? 'drop'
      : ''
  const prepared = await evaluate(`(()=>{
    const input=document.querySelector('.chat-composer textarea');
    if(!input)return false;
    const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    setter.call(input,${encodedContent});
    input.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`)
  if (!prepared) throw new Error(`PREPARE_FAILED_AT_${roundIndex + 1}`)
  await sleep(80)
  const sent = await evaluate(`(()=>{
    const button=document.querySelector('button[aria-label="发送消息"]');
    if(!button||button.disabled)return false;
    const gateMode=${JSON.stringify(gateMode)};
    const originalRandom=Math.random;
    const originalNow=Date.now;
    if(gateMode){
      const fixedNow=originalNow();
      const hash=value=>[...String(value)].reduce((result,character)=>((result*33+character.charCodeAt(0))>>>0),5381);
      let chosen=0.0001;
      for(let index=1;index<10000;index+=1){
        const candidate=index/10000;
        const id='msg-'+fixedNow.toString(36)+'-'+candidate.toString(36).slice(2,9);
        const kept=hash(id)%100<15;
        if((gateMode==='keep'&&kept)||(gateMode==='drop'&&!kept)){chosen=candidate;break;}
      }
      Math.random=()=>chosen;
      Date.now=()=>fixedNow;
    }
    button.click();
    Math.random=originalRandom;
    Date.now=originalNow;
    return true;
  })()`)
  if (!sent) throw new Error(`SEND_FAILED_AT_${roundIndex + 1}`)
  await waitFor(`(()=>{const rows=[...document.querySelectorAll('.message-assistant[data-message-id]')];const last=rows.at(-1);return !document.querySelector('button[aria-label="停止生成"]')&&last?.dataset.messageId&&last.dataset.messageId!==${JSON.stringify(before.assistantId)}})()`, 18000)
  const after = JSON.parse(await getChatSnapshot())
  const complete = !!after.assistantText &&
    !/[，,：:；;、]$/.test(after.assistantText) &&
    !/(?:然后|但是|因为|所以|如果|准备|正在|就要|想把|要把|会把|还没|一起去|继续说|开始说)$/.test(after.assistantText) &&
    !after.assistantText.includes('<DELAYED_FOLLOWUP>')
  if (!complete) throw new Error(`INCOMPLETE_REPLY_AT_${roundIndex + 1}: ${after.assistantText}`)
  if (after.stopped > initial.stopped) throw new Error(`NEW_STOPPED_REPLY_AT_${roundIndex + 1}`)
  results.push({ round: roundIndex + 1, assistantId: after.assistantId, text: after.assistantText, rows: after.messageRows })
  console.log(`round ${roundIndex + 1}/${startIndex + requestedRounds} complete: ${after.assistantText}`)
  if (offset === Math.floor(requestedRounds / 2) - 1) {
    await switchAwayAndBack()
    console.log(`round ${roundIndex + 1}: switch-away-and-back passed`)
  }
}

if (forceFollowup) {
  await sleep(11500)
  await waitFor(`(()=>[...document.querySelectorAll('.message-assistant')].some(row=>row.textContent.includes('不用急着回')))()`, 5000)
  console.log('forced delayed follow-up materialized')
}
if (cancelFollowup) {
  await sleep(11500)
  const cancelledSnapshot = JSON.parse(await getChatSnapshot())
  if (cancelledSnapshot.followups !== initial.followups) {
    throw new Error(`STALE_FOLLOWUP_AFTER_USER_INTERRUPTION: ${initial.followups} -> ${cancelledSnapshot.followups}`)
  }
  console.log('user interruption cancelled the old delayed follow-up')
}

const finalSnapshot = JSON.parse(await getChatSnapshot())
const mockStats = await evaluate('JSON.stringify(window.__realismMockStats||{})')
socket.close()
console.log(JSON.stringify({
  passed: results.length,
  firstRound: startIndex + 1,
  lastRound: startIndex + requestedRounds,
  newStoppedReplies: finalSnapshot.stopped - initial.stopped,
  renderedRows: finalSnapshot.messageRows,
  delayedFollowupsVisible: finalSnapshot.followups,
  mockStats: JSON.parse(mockStats)
}))
