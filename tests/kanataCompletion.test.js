import test from 'node:test'
import assert from 'node:assert/strict'
import { createAIClient } from '../src/platform/ai/client.js'
import { parseCompletionUsage } from '../src/platform/ai/completion.js'
const json=(content='Synthetic response',usage={prompt_tokens:10,completion_tokens:5},finish='stop')=>new Response(JSON.stringify({choices:[{message:{content},finish_reason:finish}],usage}),{headers:{'content-type':'application/json'}})
const sse=events=>new Response(events.map(e=>'data: '+(typeof e==='string'?e:JSON.stringify(e))+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}})
const client=()=>createAIClient(()=>({aiProviderUrl:'https://api.deepseek.com',aiApiKey:'synthetic-key',aiModel:'deepseek-flash'}))
async function run(handler,options={}){
  const previous=globalThis.fetch,attempts=[],payloads=[]
  globalThis.fetch=async(url,request)=>{payloads.push(JSON.parse(request.body));return handler(url,request,payloads.length)}
  try{return{result:await client().completeChat({messages:[{role:'user',content:'Synthetic input'}],onAttempt:async value=>attempts.push(structuredClone(value)),...options}),attempts,payloads}}
  finally{globalThis.fetch=previous}
}
test('P4 transport JSON actual usage, stream ignored response and legacy methods stay compatible',async()=>{
  const result=await run(()=>json())
  assert.equal(result.result.content,'Synthetic response');assert.equal(result.attempts.length,2)
  assert.equal(result.attempts[0].id,result.attempts[1].id);assert.equal(result.attempts[0].status,'pending')
  assert.deepEqual(result.attempts[1].usage,{promptTokens:10,completionTokens:5,cacheHitTokens:null})
  assert.equal(typeof client().askAI,'function');assert.equal(typeof client().streamAIChat,'function')
  assert.equal(JSON.stringify(result.attempts).includes('synthetic-key'),false)
})
test('P4 SSE collects usage-only chunk once and never exposes reasoning',async()=>{
  const deltas=[]
  const result=await run(()=>sse([{choices:[{delta:{reasoning_content:'PRIVATE REASONING'}}]},{choices:[{delta:{content:'Hello'}}]},{choices:[],usage:{prompt_tokens:12,completion_tokens:3,prompt_cache_hit_tokens:4}},'[DONE]']),{onDelta:text=>deltas.push(text)})
  assert.deepEqual(deltas,['Hello']);assert.equal(result.attempts.length,2);assert.equal(result.attempts[1].usage.cacheHitTokens,4)
  assert.equal(result.payloads[0].stream_options.include_usage,true)
})
test('P4 missing or invalid usage stays null rather than actual zero',async()=>{
  assert.equal(parseCompletionUsage({prompt_tokens:-1,completion_tokens:2}),null)
  assert.equal(parseCompletionUsage(null),null)
  const result=await run(()=>json('Synthetic',null),{stream:false})
  assert.equal(result.attempts[1].usage,null);assert.ok(result.attempts[1].estimatedInputTokens>0)
})
test('P4 unsupported stream fallback creates two separately identified attempts',async()=>{
  const result=await run((_url,_request,n)=>n===1?new Response('{}',{status:415}):json())
  assert.equal(result.attempts.length,4);assert.notEqual(result.attempts[0].id,result.attempts[2].id)
  assert.equal(result.attempts[1].errorCode,'HTTP_415');assert.equal(result.payloads[1].stream,false)
})
test('P4 truncation retry records both charges and returns only complete attempt',async()=>{
  const result=await run((_url,_request,n)=>json(n===1?'Partial':'Complete',{prompt_tokens:10,completion_tokens:10},n===1?'length':'stop'),{stream:false,maxTokens:128})
  assert.equal(result.result.content,'Complete');assert.equal(result.attempts.length,4)
  assert.equal(result.attempts[1].errorCode,'OUTPUT_TRUNCATED');assert.equal(result.attempts[1].usage.completionTokens,10)
  assert.equal(result.payloads[1].max_tokens,256)
})
test('P4 repeated truncation is bounded and throws safe code',async()=>{
  let calls=0
  await assert.rejects(run(()=>{calls++;return json('Partial',null,'length')},{stream:false}),{code:'OUTPUT_TRUNCATED'})
  assert.equal(calls,2)
})
test('P4 timeout aborts fetch and finalizes attempt without leaking provider text',async()=>{
  const attempts=[]
  await assert.rejects(run((_url,request)=>new Promise((_resolve,reject)=>request.signal.addEventListener('abort',()=>reject(new DOMException('Secret provider data','AbortError')))),{timeoutMs:10,onAttempt:async a=>attempts.push(a)}),{code:'TIMEOUT'})
  assert.equal(attempts.at(-1).errorCode,'TIMEOUT');assert.equal(JSON.stringify(attempts).includes('Secret'),false)
})
test('P4 caller cancellation and persistence-before-request failure make zero extra calls',async()=>{
  const controller=new AbortController();controller.abort();let calls=0
  await assert.rejects(run(()=>{calls++;return json()},{signal:controller.signal}),{code:'ABORTED'})
  await assert.rejects(run(()=>{calls++;return json()},{onAttempt:async()=>{throw Error('SAVE_FAILED')}}),/SAVE_FAILED/)
  assert.equal(calls,0)
})
test('P4 interrupted partial stream does not auto replay or count partial output as complete',async()=>{
  let calls=0
  await assert.rejects(run(()=>{calls++;return sse([{choices:[{delta:{content:'Partial'}}]}])}),{code:'STREAM_INTERRUPTED'})
  assert.equal(calls,1)
})
test('P4 HTTP errors never serialize provider credentials or private payload',async()=>{
  const attempts=[]
  await assert.rejects(run(()=>new Response(JSON.stringify({error:{message:'synthetic-key private input'}}),{status:401}),{onAttempt:async a=>attempts.push(a)}),{code:'HTTP_401'})
  assert.equal(JSON.stringify(attempts).includes('synthetic-key'),false)
})
