// Test-only frozen adapter contract from 7b68849. Never import a production
// materializer: this deliberately uses complete synthetic rows as an Oracle.
export function historicalAction(extensions,row){
  const action={...extensions.action}
  for(const [key,column] of [['instanceId','action_instance_id'],['relationshipId','action_relationship_id'],['location','action_location']]){
    if(row[column]!==null)action[key]=String(row[column])
    else delete action[key]
  }
  return Object.keys(action).length||Object.hasOwn(extensions,'action')?{action}:{}
}

export function historicalExtensions(json){
  try{
    const value=JSON.parse(json)
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid root')
    const copy=(item,depth)=>{
      if(depth>64)throw new Error('depth')
      if(typeof item==='number'){
        if(!Number.isFinite(item))throw new Error('number')
        return item===0?0:item
      }
      if(!item||typeof item!=='object')return item
      if(Array.isArray(item))return item.map(child=>copy(child,depth+1))
      return Object.fromEntries(Object.entries(item).map(([key,child])=>[key,copy(child,depth+1)]))
    }
    return copy(value,0)
  }catch{throw new Error('KANATA_SQLITE_INTEGRITY_FAILED')}
}

export async function historicalEvent(tx,worldId,id){
  const [row]=await tx.query('SELECT * FROM world_events WHERE world_id=? AND id=?',[worldId,id])
  if(!row)return null
  const extensions=historicalExtensions(row.extensions_json)
  const specs=[
    ['participantIds','event_participants','participant_id',r=>r.participant_id],
    ['causedByEventIds','event_causes','cause_event_id',r=>r.cause_event_id],
    ['sourceRefs','event_sources','message_id',r=>({messageId:r.message_id,revision:r.message_revision})],
    ['lifeSources','event_life_sources','grant_id,grant_revision,fingerprint',r=>({grantId:r.grant_id,instanceId:r.instance_id,moduleId:r.module_id,revision:r.grant_revision,fingerprint:r.fingerprint})],
  ]
  const links={}
  for(const [field,table,order,project] of specs){
    const actual=(await tx.query(`SELECT * FROM ${table} WHERE world_id=? AND event_id=? ORDER BY ${order}`,[worldId,id])).map(project)
    const hint=extensions[field]
    if(hint!==undefined){
      const identity=field==='sourceRefs'?r=>JSON.stringify([r.messageId,r.revision])
        :field==='lifeSources'?r=>JSON.stringify([r.grantId,r.instanceId,r.moduleId,r.revision,r.fingerprint]):r=>r
      const remaining=new Set(actual.map(identity))
      if(!Array.isArray(hint)||hint.length!==actual.length||hint.some(item=>!remaining.delete(identity(item)))){
        throw new Error('KANATA_SQLITE_INTEGRITY_FAILED')
      }
    }
    links[field]=hint===undefined?actual:hint
  }
  const action=historicalAction(extensions,row)
  const life=links.lifeSources.length||Object.hasOwn(extensions,'lifeSources')?{lifeSources:links.lifeSources}:{}
  for(const field of ['action','lifeSources','causality','kind','replacesEventId'])delete extensions[field]
  return {...extensions,id:row.id,worldId:row.world_id,participantIds:links.participantIds,
    causedByEventIds:links.causedByEventIds,sourceRefs:links.sourceRefs,status:row.status,visibility:row.visibility,
    summary:row.summary,effectiveAt:row.effective_at,recordedAt:row.recorded_at,revision:row.revision,
    ...(row.causality!==null&&{causality:row.causality}),...(row.kind!==null&&{kind:row.kind}),
    ...(row.replaces_event_id!==null&&{replacesEventId:row.replaces_event_id}),...action,...life}
}

// Preserve historical SQLite ID order independently from the pure domain Set
// traversal. The two are separate Oracles and must not be silently conflated.
export async function historicalSelection(tx,worldId,eventId){
  const events=await tx.query('SELECT id,status,effective_at,causality FROM world_events WHERE world_id=? ORDER BY id',[worldId])
  const root=events.find(e=>e.id===eventId)
  if(!root||root.status==='revoked')throw new Error('EVENT_UNAVAILABLE')
  const edges=await tx.query('SELECT event_id,cause_event_id FROM event_causes WHERE world_id=?',[worldId])
  const affected=new Set([eventId])
  let changed=true
  while(changed){
    changed=false
    for(const edge of edges)if(affected.has(edge.cause_event_id)&&!affected.has(edge.event_id)){
      affected.add(edge.event_id);changed=true
    }
  }
  return {revokeIds:events.filter(e=>affected.has(e.id)).map(e=>e.id),
    uncertainIds:events.filter(e=>!affected.has(e.id)&&e.status==='committed'&&e.causality!=='explicit'&&e.effective_at>=root.effective_at).map(e=>e.id)}
}

export const actionCases=[
  ['empty',''],['ascii','ascii'],['bmp','界'],['pair','😀'],['high','\ud800'],['low','\udc00'],
  ['mixed','x😀界\ud800y\udc00'],['null',null],['array',['😀',null]],
  ['object',{'10':'ten','2':'two',future:null,location:'old'}],['missing',undefined],
]
