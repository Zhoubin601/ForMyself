// Explicit test-only synthetic acceptance sinks. Never import into src/.
export async function auditOracle(events,worldId,eventId){
  const headers=await events.audits(worldId,eventId)
  if(headers.cursor)throw Error('QA_SINGLE_EVENT_AUDIT_EXPECTATION')
  const snapshots=[]
  for(const header of headers.entries){
    const audit={id:header.id}
    for(const side of ['previous','next']){
      let cursor,json=''
      do{
        const page=await events.jsonChunk(worldId,eventId,{kind:'audit',auditId:header.id,side,
          snapshotRevision:side==='previous'?header.previousRevision:header.nextRevision},null,cursor)
        if(Array.from(page.part).length>4096)throw Error('QA_AUDIT_CHUNK_LIMIT')
        json+=page.part;cursor=page.cursor
      }while(cursor)
      audit[side]=JSON.parse(json)
    }
    snapshots.push(audit)
  }
  return snapshots
}
export async function correctionOracle(events,worldId,id){
  let after='',header
  for(;;){
    const page=await events.list(worldId,after)
    header=page.events.find(row=>row.id===id)
    if(header||!page.cursor)break
    after=page.cursor
  }
  if(!header)throw Error('QA_CORRECTION_MISSING')
  const result={...header}
  for(const relation of ['sourceRefs','lifeSources']){
    let cursor;result[relation]=[]
    do{
      const page=await events.relations(worldId,id,relation,null,cursor)
      if(page.entries.length>50)throw Error('QA_RELATION_PAGE_LIMIT')
      for(const entry of page.entries){
        if(entry.chunked)throw Error('QA_EXPECTED_SMALL_RELATION')
        result[relation].push(entry.value)
      }
      cursor=page.cursor
    }while(cursor)
  }
  return result
}
