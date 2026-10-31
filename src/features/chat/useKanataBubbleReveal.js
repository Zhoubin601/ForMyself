import {computed,onBeforeUnmount,ref,watch} from 'vue'

// Presentation only. Complete reply batches are already durably saved by the chat runtime.
// Neither a timer nor "show all" sends requests, modifies messages, or changes source revisions.
export function useKanataBubbleReveal(messages) {
  const pending=ref([]),motion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
  let timer=null,initialized=false,latest=0,known=new Map()
  const cancelTimer=()=>{clearTimeout(timer);timer=null}
  const showAll=()=>{cancelTimer();pending.value=[]}
  const advance=()=>{
    cancelTimer()
    pending.value=pending.value.slice(1)
    if(pending.value.length)timer=setTimeout(advance,650)
  }
  const schedule=()=>{if(!timer&&pending.value.length)timer=setTimeout(advance,650)}
  const stop=watch(()=>messages.value.map(row=>({...row})),rows=>{
    const byId=new Map(rows.map(row=>[row.id,row]))
    pending.value=pending.value.filter(id=>{
      const row=byId.get(id)
      return row&&row.revision===known.get(id)&&!row.deleted&&row.status==='complete'
    })
    const additions=rows.filter(row=>!known.has(row.id)&&row.role==='assistant'&&!row.deleted&&row.status==='complete'&&row.createdAt>=latest)
    known=new Map(rows.map(row=>[row.id,row.revision]))
    latest=Math.max(latest,...rows.map(row=>row.createdAt))
    if(!initialized||motion?.matches||document.hidden){initialized=true;showAll();return}
    const wasWaiting=pending.value.length>0
    pending.value.push(...additions.map(row=>row.id))
    // The first bubble arrives immediately; later bubbles in that saved batch follow naturally.
    if(!wasWaiting&&pending.value.length)pending.value=pending.value.slice(1)
    if(pending.value.length)schedule();else cancelTimer()
  },{immediate:true})
  const onMotion=()=>{if(motion.matches)showAll()}
  const onVisibility=()=>{if(document.hidden)showAll()}
  motion?.addEventListener('change',onMotion)
  document.addEventListener('visibilitychange',onVisibility)
  onBeforeUnmount(()=>{stop();showAll();known.clear();motion?.removeEventListener('change',onMotion);document.removeEventListener('visibilitychange',onVisibility)})
  return{
    visibleMessages:computed(()=>{const hidden=new Set(pending.value);return messages.value.filter(row=>!hidden.has(row.id))}),
    waitingCount:computed(()=>pending.value.length),
    nextSenderId:computed(()=>messages.value.find(row=>row.id===pending.value[0])?.senderId),
    showAll
  }
}
