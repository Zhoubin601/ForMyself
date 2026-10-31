// QA only: the existing mood Store fills missing past days on a later cold start.
// Originals must stay byte-for-byte equivalent; only exact rule-generated placeholders qualify.
export function compareMoodBaseline(expected,actual,{trackingStartDate,today,defaultMoodId,minimumCreatedAt,now}){
  const need=(value)=>{if(!value)throw Error('BASELINE_MOOD_ROLLOVER_MISMATCH')}
  const stable=value=>JSON.stringify((function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v})(value))
  need(Array.isArray(expected)&&Array.isArray(actual)&&/^\d{4}-\d{2}-\d{2}$/.test(today))
  const ids=new Set(expected.map(r=>r.id));need(ids.size===expected.length&&new Set(actual.map(r=>r.id)).size===actual.length)
  need(stable(actual.filter(r=>ids.has(r.id)))===stable(expected))
  const dates=new Set(expected.map(r=>r.date)),missing=new Set()
  if(trackingStartDate){
    need(/^\d{4}-\d{2}-\d{2}$/.test(trackingStartDate))
    for(const date=new Date(trackingStartDate+'T00:00:00Z'),end=new Date(today+'T00:00:00Z');date<end;date.setUTCDate(date.getUTCDate()+1)){
      const day=date.toISOString().slice(0,10);if(!dates.has(day))missing.add(day)
    }
  }
  const added=actual.filter(r=>!ids.has(r.id));need(added.length===missing.size)
  const keys=['id','date','mood','note','tags','autoFilled','createdAt'].sort()
  for(const row of added){
    need(stable(Object.keys(row).sort())===stable(keys)&&typeof row.id==='string'&&row.id.length>0&&missing.delete(row.date))
    need(row.autoFilled===true&&row.mood===defaultMoodId&&row.note===''&&Array.isArray(row.tags)&&row.tags.length===0)
    need(Number.isSafeInteger(row.createdAt)&&row.createdAt>=minimumCreatedAt&&row.createdAt<=now)
  }
  return{originalRows:expected.length,originalsPreserved:true,automaticMoodRows:added.map(r=>({id:r.id,date:r.date})),basis:'existing-moodStore-autoFillMissingDays'}
}
