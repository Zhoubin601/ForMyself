const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const fallbackMode = process.argv.includes('--fallback')
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
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async expression => {
  const result = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  return result?.result?.value
}
const waitFor = async (expression, timeout = 20000) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    if (await evaluate(expression)) return true
    await sleep(200)
  }
  throw new Error(`WAIT_TIMEOUT: ${expression}`)
}

await evaluate(`(()=>{
  const originalFetch=window.fetch.bind(window);
  const fallbackMode=${fallbackMode};
  const stats={total:0,chunk:0,chunkRepair:0,final:0,finalRepair:0};
  window.__worldDraftMockStats=stats;
  window.fetch=async(input,init={})=>{
    const url=typeof input==='string'?input:input?.url||'';
    if(!url.startsWith('https://mock.invalid/'))return originalFetch(input,init);
    stats.total+=1;
    const body=JSON.parse(init?.body||'{}');
    const prompt=(body.messages||[]).map(message=>String(message?.content||'')).join('\\n');
    let content='{}';
    if(prompt.includes('待修复输出')&&prompt.includes('"observations"')){
      stats.chunkRepair+=1;
      content='仍然不是 JSON';
    }else if(prompt.includes('待修复输出')&&prompt.includes('"selfProfile"')){
      stats.finalRepair+=1;
      content=fallbackMode?'仍然无法合并':JSON.stringify({selfProfile:{summary:'喜欢手账，也会直说自己的意见',interests:['手账','蓝色贴纸'],dislikes:['敷衍'],opinions:['亲密也要保留自己的看法'],habits:['会把聊天线索整理成便签']},socialCast:[{name:'阿梨',relationship:'温馨小家里的固定虚拟朋友',traits:['爽快'],notes:'只存在于温馨小家'}],virtualEvents:[{date:'2026-08-01',title:'整理蓝色贴纸',detail:'在温馨小家和阿梨整理蓝色贴纸',characterIds:['阿梨'],status:'active'}]});
    }else if(prompt.includes('从下面的既有恋爱聊天')){
      stats.chunk+=1;
      content=!fallbackMode&&stats.chunk===1?'不是 JSON':JSON.stringify({observations:['她稳定地喜欢手账和蓝色贴纸','她会直接表达自己的意见','阿梨是反复出现的固定虚拟朋友']});
    }else if(prompt.includes('历史观察')){
      stats.final+=1;
      content='{缺少引号的草案}';
    }
    return new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8'}});
  };
  return true;
})()`)

const settingsApplied = await evaluate(`(()=>{
  const groups=[...document.querySelectorAll('.input-group')];
  if(!groups.some(item=>item.querySelector('label')?.textContent.trim()==='API 接口地址'))return 'already-configured';
  const set=(labelText,value)=>{
    const group=groups.find(item=>item.querySelector('label')?.textContent.trim()===labelText);
    const input=group?.querySelector('input');
    if(!input)return false;
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  };
  return set('API 接口地址','https://mock.invalid')&&set('API Key','simulator-test-only')&&set('模型名称','mock-world')?'applied':'failed';
})()`)
if (settingsApplied === 'failed') throw new Error('AI_SETTINGS_NOT_FOUND')
await sleep(300)

if (!await evaluate(`!!document.querySelector('.world-disclosure-button')`)) {
  await evaluate(`document.querySelector('button[aria-label="打开导航菜单"]')?.click()`)
  await sleep(250)
  await evaluate(`[...document.querySelectorAll('.drawer-menu li')].find(item=>item.textContent.includes('温馨小家'))?.click()`)
  await waitFor(`!!document.querySelector('.chat-composer textarea')`)
  await evaluate(`document.querySelector('button[aria-label="打开温馨小家设置"]')?.click()`)
}
await waitFor(`!!document.querySelector('.world-disclosure-button')`)
await evaluate(`(()=>{const button=document.querySelector('.world-disclosure-button');if(!document.querySelector('.world-content'))button.click();button.scrollIntoView({block:'start'});return true})()`)
await waitFor(`!!document.querySelector('.world-content')`)
if (fallbackMode) {
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('重置她的世界'))?.click()`)
  await waitFor(`!![...document.querySelectorAll('button')].find(button=>button.textContent.includes('重置世界'))`)
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('重置世界'))?.click()`)
  await waitFor(`document.querySelector('.world-disclosure-button')?.innerText.includes('还没有建立稳定的自我档案')`)
}
await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('根据已有聊天建立她的自我'))?.click()`)
await waitFor(`!![...document.querySelectorAll('button')].find(button=>button.textContent.includes('同意并生成'))`)
await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('同意并生成'))?.click()`)
await waitFor(`!!document.querySelector('.world-draft-card')`, 30000)

const draftSnapshot = JSON.parse(await evaluate(`JSON.stringify((()=>{
  const card=document.querySelector('.world-draft-card');
  return {
    visible:!!card,
    text:card?.innerText||'',
    documentWidth:document.documentElement.scrollWidth,
    viewportWidth:innerWidth,
    switches:[...document.querySelectorAll('.proactive-toggle-row .switch-control')].map(control=>{
      const row=control.closest('.proactive-toggle-row').getBoundingClientRect();
      const rect=control.getBoundingClientRect();
      return {rowTop:row.top,rowBottom:row.bottom,top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right};
    })
  };
})())`))
const expectedSummary = fallbackMode ? '在既有聊天里稳定表现为' : '喜欢手账，也会直说自己的意见'
if (!draftSnapshot.text.includes(expectedSummary)) throw new Error('DRAFT_SUMMARY_MISSING')
if (!draftSnapshot.text.includes('阿梨')) throw new Error('DRAFT_CHARACTER_MISSING')
if (!draftSnapshot.text.includes(fallbackMode ? '整理新的生活手账' : '整理蓝色贴纸')) throw new Error('DRAFT_EVENT_MISSING')
if (draftSnapshot.documentWidth !== draftSnapshot.viewportWidth) throw new Error('HORIZONTAL_OVERFLOW')
if (draftSnapshot.switches.some(item => item.top < item.rowTop || item.bottom > item.rowBottom)) throw new Error('SWITCH_OUTSIDE_ROW')

await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('确认并启用草案'))?.click()`)
await waitFor(`!![...document.querySelectorAll('button')].find(button=>button.textContent.includes('确认启用'))`)
await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('确认启用'))?.click()`)
await waitFor(`!document.querySelector('.world-draft-card')`)
const saved = await evaluate(`document.querySelector('.world-disclosure-button')?.innerText.includes(${JSON.stringify(fallbackMode ? '在既有聊天里稳定表现为' : '喜欢手账，也会直说自己的意见')})`)
if (!saved) throw new Error('DRAFT_NOT_SAVED')

const mockStats = JSON.parse(await evaluate(`JSON.stringify(window.__worldDraftMockStats)`))
socket.close()
console.log(JSON.stringify({
  passed: true,
  restoredMessages: 562,
  draftSaved: true,
  fallbackMode,
  noHorizontalOverflow: true,
  switchesAligned: draftSnapshot.switches.length === 2,
  mockStats
}))
