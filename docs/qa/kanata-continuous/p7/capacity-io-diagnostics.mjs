// Diagnostic only. Aggregate fixed method/category labels and elapsed time; never retain
// arguments, paths, passwords, plaintext, ciphertext or native responses in evidence.
export async function installCapacityIODiagnostics(page){
  await page.evaluate(()=>{
    const cap=window.Capacitor
    if(!cap?.nativePromise)throw Error('DIAGNOSTIC_NATIVE_BRIDGE_MISSING')
    if(window.__capacityIO)throw Error('DIAGNOSTIC_ALREADY_INSTALLED')
    let rows={},active=0,peak=0
    const original=cap.nativePromise
    const wrapped=function(plugin,method,options){
      if(plugin!=='Filesystem'&&plugin!=='ArchiveFileBatch')return original.apply(this,arguments)
      const category=plugin==='ArchiveFileBatch'?'batch':typeof options?.path==='string'&&options.path.startsWith('formyself/kanata-pages-v1')?'archive':'other'
      const key=(['readFile','writeFile','deleteFile','readdir','stat','mkdir','rename','execute'].includes(method)?method:'other')+':'+category
      const row=rows[key]??={calls:0,failed:0,totalMs:0,maxMs:0}
      ++row.calls;++active;peak=Math.max(peak,active)
      const start=performance.now()
      const end=()=>{const ms=performance.now()-start;row.totalMs+=ms;row.maxMs=Math.max(row.maxMs,ms);--active}
      try{return Promise.resolve(original.apply(this,arguments)).then(value=>{end();return value},error=>{++row.failed;end();throw error})}
      catch(error){++row.failed;end();throw error}
    }
    cap.nativePromise=wrapped
    window.__capacityIO={reset(){if(active)throw Error('DIAGNOSTIC_IO_STILL_ACTIVE');rows={};peak=0},snapshot(){return{rows,active,peakConcurrentCalls:peak}},dispose(){if(cap.nativePromise===wrapped)cap.nativePromise=original;delete window.__capacityIO}}
  })
}
