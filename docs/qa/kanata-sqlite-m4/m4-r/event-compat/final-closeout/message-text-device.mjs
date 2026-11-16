import {createKanataMessageRepository} from '../../../../../../src/features/chat/storage/sqlite/kanataMessageRepository.js'
import {messageDetailQueries} from '../../../../../../src/features/chat/storage/sqlite/kanataMessageDetailRead.js'
import {messageQueries} from '../../../../../../src/features/chat/storage/sqlite/kanataRepositorySql.js'
import {createKanataSqliteChatRuntime} from '../../../../../../src/application/kanataSqliteChatRuntime.js'
import {sha256Text} from '../../../../../../src/shared/crypto/sha256Text.js'

export const messageTextAppendSql='UPDATE messages SET content=content||?,revision=revision+1 WHERE world_id=? AND id=?'
const textChunkHash=sha256Text(messageDetailQueries[4])
const check=(condition,code)=>{if(!condition)throw Error(code)}
async function rejects(action,code){
  try{await action()}
  catch(error){check((error.code??error.message).includes(code),'UNEXPECTED_'+(error.code??error.message));return}
  throw Error('EXPECTED_'+code)
}
const settle=async(predicate,code='MESSAGE_TEXT_UI_TIMEOUT')=>{
  const deadline=performance.now()+15000
  while(!predicate()){
    if(performance.now()>deadline)throw Error(code)
    await new Promise(resolve=>setTimeout(resolve,25))
  }
}
const deferred=()=>{let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej});return {promise,resolve,reject}}

export async function runMessageTextDevice(context,fixture,commands){
  const {candidate,auth,pinia,createApp,h,nextTick,ref,reactive,KanataConversationView,AppFeedbackHost,setTrace,setQueryIntercept}=context
  const health=await candidate.run({create:true},async operation=>{
    await operation.transaction(async tx=>{for(const {sql,parameters}of commands)await tx.execute(sql,parameters)})
    return operation.health()
  })
  const base=fixture.messages[0],scope={worldId:base.worldId,conversationId:base.conversationId}
  const world2=fixture.worlds.find(row=>row.id!==scope.worldId).id
  const world1Actors=fixture.instances.filter(row=>row.worldId===scope.worldId).map(row=>row.id)
  const instanceId=world1Actors[0]
  const otherConv=fixture.conversations.find(row=>row.worldId===world2&&row.type!=='character').id
  const {lifeSources:_unused,...clean}=base
  let traceState={queries:0,writes:0,maxRows:0,maxPoints:0,maxText:0}
  const resetTrace=(mode='ordinary')=>{
    traceState={queries:0,writes:0,maxRows:0,maxPoints:0,maxText:0,observeQuery(rows){
      for(const row of rows)for(const value of Object.values(row)){
        if(typeof value!=='string')continue
        const points=Array.from(value).length
        traceState.maxPoints=Math.max(traceState.maxPoints,points)
        traceState.maxText=Math.max(traceState.maxText,value.length)
        if(mode==='ordinary')check(points<=4097&&value.length<=8194,'BRIDGE_TEXT_CAP_'+points)
      }
    }}
    setTrace(traceState)
  }
  try{
    // 1-3: Preview, chunked reading, cursor/offset bounds, NUL/Unicode/emoji/UTF-8 boundaries.
    const cases=[
      'x'.repeat(4094)+'😀界\u0000tail',
      '头\u0000合成尾部',
      'e'.repeat(4095)+'e\u0301合成',
      '甲'.repeat(63998)+'合成',
    ]
    const senderName='名\u0000'+'姓名😀'.repeat(1000)
    for(const [index,content]of cases.entries()){
      const input={...clean,id:'mt-preview-'+index,revision:1,createdAt:1800000+index,content,senderNameSnapshot:senderName,lifeSources:[]}
      await candidate.withRepositories({},messages=>messages.insert(input))
    }
    const replyInput={...clean,id:'mt-preview-reply',revision:1,createdAt:1800010,replyToMessageId:'mt-preview-0',replyToRevision:1,
      content:'r'.repeat(4095)+'😀\u0000replyTail',senderNameSnapshot:senderName,lifeSources:[]}
    await candidate.withRepositories({},messages=>messages.insert(replyInput))
    resetTrace('ordinary')
    const verifiedChunks=[]
    for(const [index,content]of cases.entries()){
      const id='mt-preview-'+index
      const previewRows=await candidate.withRepositories({},async messages=>{
        const recent=(await messages.recent(scope)).messages.find(row=>row.id===id)
        const older=(await messages.older(scope,{version:1,...scope,id:'mt-preview-reply',createdAt:1800010},10)).messages.find(row=>row.id===id)
        const located=(await messages.locate(scope,id)).messages.find(row=>row.id===id)
        const got=await messages.get(scope,id)
        const quote=await messages.quote(scope,id)
        return [recent,older,located,got,quote]
      })
      for(const row of previewRows){
        check(row?.contentChunked===true&&row?.senderNameChunked===true,'PREVIEW_FLAG_MISSING_'+id)
        check(Array.from(row.content).length<=4096&&Array.from(row.senderNameSnapshot).length<=256,'PREVIEW_BOUND_'+id)
      }
      for(const field of ['content','senderName']){
        let cursor,text='',chunks=0
        do{
          const page=await candidate.withRepositories({},messages=>messages.textChunk(scope,id,field,cursor))
          check(new TextEncoder().encode(page.fragment).length<=4096,'UTF8_CHUNK_CAP')
          text+=page.fragment;cursor=page.cursor??undefined;chunks++
        }while(cursor)
        check(text===(field==='content'?content:senderName)&&chunks>0,'CHUNK_EXACT_MISMATCH_'+id+'_'+field)
        verifiedChunks.push({id,field,chunks,utf16:text.length})
      }
    }
    const repliesPage=await candidate.withRepositories({},messages=>messages.replies(scope,'mt-preview-0'))
    check(repliesPage.messages[0]?.id==='mt-preview-reply'&&repliesPage.messages[0]?.contentChunked===true,'REPLIES_PREVIEW_FLAG')
    check(traceState.maxRows<=51,'ORDINARY_ROWS_CAP')
    const headCursor=await candidate.withRepositories({},messages=>messages.textChunk(scope,'mt-preview-0','content'))
    check(Boolean(headCursor.cursor),'HEAD_CURSOR_EXPECTED')
    await rejects(()=>candidate.withRepositories({},messages=>messages.textChunk(scope,'mt-preview-0','senderName',headCursor.cursor)),'CURSOR_INVALID')
    await rejects(()=>candidate.withRepositories({},messages=>messages.textChunk(scope,'mt-preview-0','content',{...headCursor.cursor,offset:4095})),'CURSOR_INVALID')
    await rejects(()=>candidate.withRepositories({},messages=>messages.textChunk(scope,'mt-preview-0','content',{...headCursor.cursor,offset:-1})),'CURSOR_INVALID')
    await candidate.withRepositories({},messages=>messages.setStatus(scope,'mt-preview-0',1,'stopped'))
    await rejects(()=>candidate.withRepositories({},messages=>messages.textChunk(scope,'mt-preview-0','content',headCursor.cursor)),'CURSOR_INVALID')

    // 4 & 10: Cross-chunk NFKC search + Native 262144/262145 parameter boundary.
    const nfkcInput={...clean,id:'mt-search-nfkc',revision:1,createdAt:1800020,
      content:'甲'.repeat(4095)+'e\u0301'+'甲'.repeat(6000)+'\u0000ＴＡＩＬ合成',
      senderNameSnapshot:'名'.repeat(5000),lifeSources:[]}
    await candidate.withRepositories({},messages=>messages.insert(nfkcInput))
    resetTrace('ordinary')
    for(const query of ['é','tail合成','\u0000tail']){
      const found=(await candidate.withRepositories({},messages=>messages.searchHistory(scope,query))).messages.find(row=>row.id===nfkcInput.id)
      check(found&&found.contentChunked&&found.senderNameChunked&&Array.from(found.content).length===4096,'NFKC_SEARCH_'+query)
    }
    const maxInput={...clean,id:'mt-native-262144',revision:1,createdAt:1800025,
      content:'甲'.repeat(262140)+'ＴＡＩＬ',senderNameSnapshot:'合成',lifeSources:[]}
    await candidate.withRepositories({},messages=>messages.insert(maxInput))
    check((await candidate.withRepositories({},messages=>messages.searchHistory(scope,'tail'))).messages.some(row=>row.id===maxInput.id),'SEARCH_262144')
    await rejects(()=>candidate.withRepositories({},messages=>messages.insert({
      ...clean,id:'mt-native-262145',revision:1,createdAt:1800026,content:'甲'.repeat(262145),lifeSources:[],
    })),'STATEMENT_DENIED')
    check((await candidate.withRepositories({},messages=>messages.get(scope,'mt-native-262145')))===null,'NATIVE_CAP_NO_ROW')
    await candidate.run({},op=>op.transaction(tx=>tx.execute(messageTextAppendSql,['甲',scope.worldId,maxInput.id])))
    await rejects(()=>candidate.withRepositories({},messages=>messages.searchHistory(scope,'tail')),'TEXT_BUDGET_EXCEEDED')
    check((await candidate.withRepositories({},messages=>messages.searchHistory(scope,''))).messages.some(row=>row.id===maxInput.id),'BROWSE_262145_OK')
    let read262145='',c262145
    do{
      const page=await candidate.withRepositories({},messages=>messages.textChunk(scope,maxInput.id,'content',c262145))
      read262145+=page.fragment;c262145=page.cursor??undefined
    }while(c262145)
    check(read262145.length===262145&&read262145.endsWith('ＴＡＩＬ甲'),'TEXT_CHUNK_READS_262145')

    // 5 & 6: Full prompt history, tail lorebook keyword activation, and exact 8000-unit retry source.
    const promptConv='mt-prompt-conv',retryConv='mt-retry-conv'
    await candidate.withDomains({},async domains=>{
      await domains.conversations.createGroup(scope.worldId,{title:'提示词长文本',instanceIds:world1Actors.slice(0,2)},{id:promptConv,commandId:'cmd-'+promptConv})
      await domains.conversations.createGroup(scope.worldId,{title:'重试长文本',instanceIds:world1Actors.slice(0,2)},{id:retryConv,commandId:'cmd-'+retryConv})
      await domains.lorebook.save({id:'mt-prompt-lore',worldId:scope.worldId,scope:'world',ownerId:scope.worldId,
        keys:['尾部激活词'],content:'长消息尾部世界书命中',priority:20,activationRule:'keyword',visibility:'public',
        sourceTag:'synthetic',revision:1,enabled:true,knownBy:[]},null)
    })
    const promptScope={worldId:scope.worldId,conversationId:promptConv}
    const promptLong={...clean,...promptScope,id:'mt-prompt-long',role:'assistant',senderType:'character',senderId:instanceId,
      senderNameSnapshot:'名\u0000'+'😀'.repeat(6000),content:'甲'.repeat(63994)+'尾部激活词',createdAt:80000,revision:1,lifeSources:[]}
    await candidate.withRepositories({},messages=>messages.insert(promptLong))
    let capturedPrompts=[],appendKeys=[]
    const promptRuntime=createKanataSqliteChatRuntime({
      candidate,auth,clock:()=>1800000,id:()=>crypto.randomUUID(),
      completion:async options=>{capturedPrompts.push(options.messages);return {content:'合成提示词回复'}},
    })
    resetTrace('ordinary')
    const origObserve=traceState.observeQuery
    traceState.observeQuery=(rows,command)=>{
      origObserve(rows,command)
      if(command.statement===sha256Text(messageQueries.transcriptForAppend)&&rows.length){
        appendKeys.push(Object.keys(rows[0]).sort().join(','))
      }
    }
    try{
      const historyRead=await candidate.withRepositories({},messages=>messages.historyForSpeaker(promptScope,instanceId,10))
      const historyEntry=historyRead.find(row=>row.id===promptLong.id)
      check(historyEntry&&historyEntry.content===promptLong.content&&historyEntry.senderNameSnapshot===promptLong.senderNameSnapshot
        &&historyEntry.contentChunked===undefined&&historyEntry.senderNameChunked===undefined,'HISTORY_FOR_SPEAKER_FULL_LONG_TEXT')
      promptRuntime.activate(promptScope)
      await promptRuntime.send(promptConv,{text:'普通继续',timing:'immediate'})
      check(capturedPrompts.length===1,'PROMPT_CALL_COUNT')
      check(capturedPrompts[0][0].content.includes('长消息尾部世界书命中'),'TAIL_KEYWORD_LORE_HIT')
      check(capturedPrompts[0].some(row=>row.content.includes('普通继续')),'PROMPT_CURRENT_TURN')
      check(!capturedPrompts[0].some(row=>row.content.includes(promptLong.content)),'PROMPT_CONTEXT_BUDGET_PRESERVED')
      check(appendKeys.length>0&&appendKeys.every(keys=>keys==='id,revision'),'APPEND_PROJECTION_ONLY')
    }finally{await promptRuntime.dispose()}

    const retryScope={worldId:scope.worldId,conversationId:retryConv}
    const retryCjk='甲'.repeat(7994)+'😀\u0000尾部文'
    const retryBody='x'.repeat(7994)+'😀\u0000尾部文'
    check(retryCjk.length===8000&&retryBody.length===8000,'RETRY_8K_LENGTH')
    const retryCjkRow={...clean,...retryScope,id:'mt-retry-8k-cjk',senderNameSnapshot:'名'.repeat(9000),
      content:retryCjk,createdAt:84999,revision:1,lifeSources:[]}
    const retryLong={...clean,...retryScope,id:'mt-retry-8k',senderNameSnapshot:'名'.repeat(300),
      content:retryBody,createdAt:85000,revision:1,lifeSources:[]}
    await candidate.withRepositories({},async messages=>{await messages.insert(retryCjkRow);await messages.insert(retryLong)})
    setTrace({queries:0,writes:0,maxRows:0,observeQuery(rows){
      for(const row of rows)for(const value of Object.values(row)){
        if(typeof value==='string')check(value.length<=32002,'RETRY_QUERY_CAP')
      }
    }})
    const retryCjkDto=await candidate.withRepositories({},messages=>messages.retrySource(retryScope,retryCjkRow.id))
    check(retryCjkDto&&retryCjkDto.content===retryCjk&&retryCjkDto.contentChunked===undefined
      &&retryCjkDto.senderNameSnapshot.length===256&&retryCjkDto.senderNameChunked===true,'RETRY_SOURCE_CJK_EXACT')
    const retryDto=await candidate.withRepositories({},messages=>messages.retrySource(retryScope,retryLong.id))
    check(retryDto&&retryDto.content===retryBody&&retryDto.contentChunked===undefined
      &&retryDto.senderNameSnapshot.length===256&&retryDto.senderNameChunked===true,'RETRY_SOURCE_EXACT')
    const retryPrompts=[]
    const retryRuntime=createKanataSqliteChatRuntime({
      candidate,auth,clock:()=>1800001,id:()=>crypto.randomUUID(),
      completion:async options=>{retryPrompts.push(options.messages);return {content:'合成重试回复'}},
    })
    try{
      retryRuntime.activate(retryScope)
      await retryRuntime.send(retryConv,{retryMessageId:retryLong.id,timing:'immediate'})
      check(retryPrompts.length===1&&retryPrompts[0].some(row=>row.content.endsWith('：'+retryBody)),'RETRY_SENT_EXACT_8K')
    }finally{await retryRuntime.dispose()}
    await candidate.withRepositories({},messages=>messages.revise(retryScope,retryLong.id,1,{content:retryBody+'甲',deleted:false}))
    await rejects(()=>candidate.withRepositories({},messages=>messages.retrySource(retryScope,retryLong.id)),'INVALID_MESSAGE')
    resetTrace('ordinary')
    await candidate.run({},op=>op.transaction(tx=>tx.execute(messageTextAppendSql,['甲'.repeat(200000),scope.worldId,promptLong.id])))
    await rejects(()=>candidate.withRepositories({},messages=>messages.historyForSpeaker(promptScope,instanceId,10)),'TEXT_BUDGET_EXCEEDED')

    // 7-9: Real mounted KanataConversationView UI + revision draft + cancellation + close + unmount + scope change + late result rejection.
    const uiConv='mt-ui-conv'
    await candidate.withDomains({},async domains=>{
      await domains.conversations.createGroup(scope.worldId,{title:'UI长文本',instanceIds:world1Actors.slice(0,2)},{id:uiConv,commandId:'cmd-'+uiConv})
    })
    const uiScope={worldId:scope.worldId,conversationId:uiConv}
    const ui64k='甲'.repeat(63996)+'尾部原文'
    const ui64kId='mt-ui-64k',uiOverId='mt-ui-over'
    await candidate.withRepositories({},async messages=>{
      await messages.insert({...clean,...uiScope,id:ui64kId,content:ui64k,senderNameSnapshot:senderName,createdAt:90000,revision:1,lifeSources:[]})
      await messages.insert({...clean,...uiScope,id:uiOverId,content:'甲'.repeat(64000),senderNameSnapshot:'超限消息',createdAt:89999,revision:1,lifeSources:[]})
    })
    await candidate.run({},op=>op.transaction(tx=>tx.execute(messageTextAppendSql,['甲',scope.worldId,uiOverId])))
    const uiRuntime=createKanataSqliteChatRuntime({
      candidate,auth,clock:()=>1800010,id:()=>crypto.randomUUID(),
      completion:async()=>({content:'合成UI回复'}),
    })
    const activeConv=ref(uiConv),activeWorld=ref(scope.worldId)
    const container=document.createElement('div')
    document.body.append(container)
    let vueErr=''
    let app=createApp({render:()=>[h(KanataConversationView,{
      conversationId:activeConv.value,
      candidate:{runtime:uiRuntime,scope:{worldId:activeWorld.value}},
    }),h(AppFeedbackHost)]}).use(pinia)
    app.config.errorHandler=err=>{vueErr+=(err?.stack??err?.message??String(err))+'\n'}
    const btn=(text,root=container)=>[...root.querySelectorAll('button')].find(node=>node.textContent.trim()===text)
    const article=id=>container.querySelector('article[data-message-id="'+id+'"]')
    let textQueries=0
    try{
      uiRuntime.activate(uiScope)
      app.mount(container)
      try{await settle(()=>Boolean(article(ui64kId))&&Boolean(article(uiOverId)),'UI_MOUNT_TIMEOUT')}
      catch(error){throw Error(error.message+':text='+container.textContent.slice(0,200)+':html='+container.innerHTML.slice(0,200)+':vueErr='+vueErr+':isAvail='+uiRuntime.isAvailable())}
      // Panel read + next + restart + close focus
      const openBodyBtn=btn('分段阅读原文',article(ui64kId))
      openBodyBtn.click()
      await nextTick()
      await settle(()=>Boolean(container.querySelector('[aria-label="消息分段阅读"] .kanata-text')),'PANEL_OPEN_TIMEOUT')
      check(document.activeElement?.tagName==='H4','PANEL_HEADING_FOCUS')
      let guard=0
      while(!btn('下一段').disabled&&guard++<120){
        btn('下一段').click()
        await nextTick()
        await settle(()=>Boolean(container.querySelector('[aria-label="消息分段阅读"] .kanata-text'))||Boolean(container.querySelector('[aria-label="消息分段阅读"] .kanata-error')),'PANEL_NEXT_TIMEOUT')
        check(!container.querySelector('[aria-label="消息分段阅读"] .kanata-error'),'PANEL_NEXT_ERROR')
      }
      check(btn('下一段').disabled,'PANEL_REACHED_END')
      const lastPanelText=container.querySelector('[aria-label="消息分段阅读"] .kanata-text').textContent
      check(lastPanelText.endsWith('尾部原文')&&Array.from(lastPanelText).length<2048,'PANEL_LAST_FRAGMENT_BOUND')
      btn('从头阅读').click()
      await nextTick()
      await settle(()=>Boolean(container.querySelector('[aria-label="消息分段阅读"] .kanata-text'))&&btn('从头阅读').disabled&&!btn('下一段').disabled,'PANEL_RESTART_TIMEOUT')
      btn('关闭分段阅读').click()
      await settle(()=>!container.querySelector('[aria-label="消息分段阅读"]'),'PANEL_CLOSE_TIMEOUT')
      check(document.activeElement===openBodyBtn,'PANEL_FOCUS_RESTORED')
      btn('分段查看名称',article(ui64kId)).click()
      await nextTick()
      await settle(()=>Boolean(container.querySelector('[aria-label="消息分段阅读"] .kanata-text')),'NAME_PANEL_TIMEOUT')
      check(container.querySelector('[aria-label="消息分段阅读"] .kanata-text').textContent.startsWith('名\u0000姓名😀'),'NAME_PANEL_NUL')
      btn('关闭分段阅读').click()
      await settle(()=>!container.querySelector('[aria-label="消息分段阅读"]'),'NAME_PANEL_CLOSE_TIMEOUT')

      // Failed chunk retry in UI
      let failOnce=true
      setQueryIntercept(async command=>{
        if(command.statement===textChunkHash&&failOnce){failOnce=false;throw Error('UI_CHUNK_FAULT')}
      })
      btn('分段阅读原文',article(ui64kId)).click()
      await nextTick()
      await settle(()=>Boolean(btn('重试这一段')),'PANEL_ERROR_TIMEOUT')
      btn('重试这一段').click()
      await nextTick()
      await settle(()=>Boolean(container.querySelector('[aria-label="消息分段阅读"] .kanata-text')),'PANEL_RETRY_TIMEOUT')
      btn('关闭分段阅读').click()
      await settle(()=>!container.querySelector('[aria-label="消息分段阅读"]'),'PANEL_RETRY_CLOSE_TIMEOUT')

      // Full editable revision draft + >64000 rejection
      setQueryIntercept(undefined)
      btn('修订这条原文',article(ui64kId)).click()
      await settle(()=>Boolean(container.querySelector('form textarea[maxlength="64000"]')),'REV_FORM_TIMEOUT')
      const revArea=container.querySelector('form textarea[maxlength="64000"]')
      check(revArea.value===ui64k,'REV_EXACT_64K')
      const updated64k='甲'.repeat(63996)+'新尾原文'
      revArea.value=updated64k
      revArea.dispatchEvent(new Event('input',{bubbles:true}))
      await nextTick()
      revArea.closest('form').requestSubmit()
      await settle(()=>!container.querySelector('form textarea[maxlength="64000"]'),'REV_SAVE_TIMEOUT')
      check((await candidate.withRepositories({},messages=>messages.get(uiScope,ui64kId))).revision===2,'REV_SAVED_DB')
      btn('修订这条原文',article(uiOverId)).click()
      await settle(()=>container.textContent.includes('原文超过 64000 字符的修订上限'),'REV_OVER_BUDGET_ALERT')
      check(!container.querySelector('form textarea[maxlength="64000"]'),'REV_OVER_NO_FORM')

      // In-flight pause -> close -> late resolution ignored
      let hold=null,inFlight=0
      setQueryIntercept(async command=>{
        if(command.statement!==textChunkHash)return
        inFlight++
        hold=deferred()
        await hold.promise
      })
      btn('分段阅读原文',article(ui64kId)).click()
      await settle(()=>inFlight===1,'PAUSE_OPEN_TIMEOUT')
      btn('关闭分段阅读').click()
      hold.resolve()
      await new Promise(resolve=>setTimeout(resolve,80))
      check(!container.querySelector('[aria-label="消息分段阅读"]')&&inFlight===1,'LATE_CLOSE_IGNORED')

      // In-flight editableText -> cancel -> late resolution ignored
      hold=null
      btn('修订这条原文',article(ui64kId)).click()
      await settle(()=>inFlight===2,'PAUSE_EDIT_TIMEOUT')
      btn('取消读取原文').click()
      hold.resolve()
      await new Promise(resolve=>setTimeout(resolve,80))
      check(!container.querySelector('form textarea[maxlength="64000"]')&&inFlight===2,'LATE_CANCEL_EDIT_IGNORED')

      // In-flight read -> scope switch -> late resolution ignored
      hold=null
      btn('分段阅读原文',article(ui64kId)).click()
      await settle(()=>inFlight===3,'PAUSE_SCOPE_TIMEOUT')
      uiRuntime.activate({worldId:world2,conversationId:otherConv})
      activeWorld.value=world2
      activeConv.value=otherConv
      await nextTick()
      hold.resolve()
      await new Promise(resolve=>setTimeout(resolve,80))
      check(!container.querySelector('[aria-label="消息分段阅读"]')&&inFlight===3,'LATE_SCOPE_IGNORED')

      // Switch back -> in-flight read -> unmount -> late resolution ignored
      uiRuntime.activate(uiScope)
      activeWorld.value=scope.worldId
      activeConv.value=uiConv
      await nextTick()
      await settle(()=>Boolean(article(ui64kId)),'REOPEN_SCOPE_TIMEOUT')
      hold=null
      btn('分段阅读原文',article(ui64kId)).click()
      await settle(()=>inFlight===4,'PAUSE_UNMOUNT_TIMEOUT')
      app.unmount();app=null
      hold.resolve()
      await new Promise(resolve=>setTimeout(resolve,80))
      check(container.innerHTML===''&&inFlight===4,'LATE_UNMOUNT_IGNORED')
      textQueries=inFlight
    }finally{
      setQueryIntercept(undefined)
      if(app)app.unmount()
      container.remove()
      await uiRuntime.dispose()
    }
    return {status:'PASS',health,verifiedChunks,textQueries,realModelCalls:0,maxRows:traceState.maxRows,maxText:traceState.maxText}
  }finally{
    setQueryIntercept(undefined)
    setTrace(undefined)
  }
}

export async function verifyMessageTextColdReopen(candidate,fixture){
  const base=fixture.messages[0],scope={worldId:base.worldId,conversationId:base.conversationId}
  const uiScope={worldId:scope.worldId,conversationId:'mt-ui-conv'}
  let text64k='',cursor
  do{
    const page=await candidate.withRepositories({},messages=>messages.textChunk(uiScope,'mt-ui-64k','content',cursor))
    text64k+=page.fragment;cursor=page.cursor??undefined
  }while(cursor)
  check(text64k==='甲'.repeat(63996)+'新尾原文','COLD_REOPEN_64K_REVISED')
  let textNul='',nulCursor
  do{
    const page=await candidate.withRepositories({},messages=>messages.textChunk(scope,'mt-preview-0','content',nulCursor))
    textNul+=page.fragment;nulCursor=page.cursor??undefined
  }while(nulCursor)
  check(textNul==='x'.repeat(4094)+'😀界\u0000tail','COLD_REOPEN_NUL_EMOJI')
  return {coldReopen64kLength:text64k.length,coldReopenNulMatched:true}
}
