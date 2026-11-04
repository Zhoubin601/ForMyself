import fs from 'node:fs/promises'
const [input,output]=process.argv.slice(2)
const result=JSON.parse(await fs.readFile(input,'utf8'))
if(result.status!=='HOST_COMPLETED_ANDROID_BLOCKED'||result.repetitions!==5||result.runs.length!==30)throw Error('QA_INCOMPLETE_BENCHMARK')
const quantile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]
const operations=['bulk_write','single_write','recent_50','history_page_50','locate_id','single_update','single_delete','conversation_count','cold_open','hot_open','close','batch_read_all']
const rows=[]
for(const count of [1000,10000,100000])for(const engine of ['json-archive','sqlcipher'])for(const operation of operations){
  const runs=result.runs.filter(r=>r.count===count&&r.engine===engine),samples=runs.map(run=>[...run.imported.records,...run.queried.records].find(r=>r.operation===operation))
  if(samples.length!==5||samples.some(s=>!s))throw Error('QA_MISSING_SAMPLES')
  rows.push({count,engine,operation,n:5,p50Ms:quantile(samples.map(s=>s.ms),.5),p95Ms:quantile(samples.map(s=>s.ms),.95),cpuP50Ms:quantile(samples.map(s=>s.cpuMs),.5),cpuP95Ms:quantile(samples.map(s=>s.cpuMs),.95),heapEndpointMaxBytes:Math.max(...samples.map(s=>s.jsHeapUsed)),rssLifetimeUpperKiB:Math.max(...samples.map(s=>s.nodePeakRssKiB+s.enginePeakRssKiB)),maxDbBytes:engine==='sqlcipher'?Math.max(...samples.map(s=>s.dbBytes)):null,maxWalBytes:engine==='sqlcipher'?Math.max(...samples.map(s=>s.walBytes)):null})
}
let md='以下均为 Linux 主机观察，非 Android / Capacitor 性能验收。单位 ms；P95 使用 nearest-rank，n=5 时即最大值。\n\n| 消息数 | 操作 | JSON/归档 P50 / P95 | SQLCipher P50 / P95 |\n|---:|---|---:|---:|\n'
for(const count of [1000,10000,100000])for(const operation of operations){const a=rows.find(r=>r.count===count&&r.engine==='json-archive'&&r.operation===operation),b=rows.find(r=>r.count===count&&r.engine==='sqlcipher'&&r.operation===operation);md+=`| ${count} | ${operation} | ${a.p50Ms.toFixed(3)} / ${a.p95Ms.toFixed(3)} | ${b.p50Ms.toFixed(3)} / ${b.p95Ms.toFixed(3)} |\n`}
await fs.writeFile(output+'.md',md)
await fs.writeFile(output+'.json',JSON.stringify(rows,null,2))
await fs.writeFile(output+'.csv',Object.keys(rows[0]).join(',')+'\n'+rows.map(r=>Object.values(r).join(',')).join('\n')+'\n')
console.log(JSON.stringify({rows:rows.length,source:input,output}))
