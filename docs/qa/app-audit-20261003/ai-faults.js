(async()=>{
  const [{askAI,streamAIChat},{useSettingsStore}]=await Promise.all([import('/src/services/aiEngine.js'),import('/src/stores/settings.js')])
  const settings=useSettingsStore(), saved={key:settings.aiApiKey,url:settings.aiProviderUrl,model:settings.aiModel},originalFetch=window.fetch,result=[]
  try {
    settings.aiApiKey=crypto.randomUUID();settings.aiProviderUrl='http://qa.invalid';settings.aiModel='qa-model'
    let calls=0,protocol=''
    window.fetch=async(url)=>{calls++;protocol=new URL(url).protocol;return new Response(JSON.stringify({error:{message:'QA unauthorized'}}),{status:401,headers:{'Content-Type':'application/json'}})}
    let error='';try {await streamAIChat({messages:[{role:'user',content:'synthetic'}]})}catch(e){error=e.code}
    result.push({test:'auth-failure-stream-fallback',calls,error,protocol,httpsRequired:protocol==='https:'})
    window.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'QA partial output'},finish_reason:'length'}]}),{headers:{'Content-Type':'application/json'}})
    let truncatedThrown=false,output='';try{output=await streamAIChat({messages:[{role:'user',content:'synthetic'}]})}catch(e){truncatedThrown=e.code==='OUTPUT_TRUNCATED'}
    result.push({test:'non-sse-truncation',truncatedThrown,partialAccepted:output==='QA partial output'})
    window.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'',reasoning_content:'QA internal reasoning without filtered keywords'}}]}),{headers:{'Content-Type':'application/json'}})
    result.push({test:'reasoning-display',internalReasoningAccepted:(await askAI('synthetic')).includes('internal reasoning')})
    let signalProvided=false
    window.fetch=async(_url,options)=>{signalProvided=Boolean(options.signal);return new Promise(()=>{})}
    const pending=await Promise.race([askAI('synthetic').then(()=>false,()=>false),new Promise(r=>setTimeout(()=>r(true),300))])
    result.push({test:'ask-ai-stall',pendingAfter300ms:pending,abortSignalProvided:signalProvided})
  } finally {window.fetch=originalFetch;settings.aiApiKey=saved.key;settings.aiProviderUrl=saved.url;settings.aiModel=saved.model;await settings.flushPendingSettingsWrites()}
  return result
})()
