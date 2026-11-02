import {chromium} from 'playwright-core'
import {mkdtemp,writeFile,readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
export async function connectCapacityWeb(count,build){
  const prefix=resolve(tmpdir(),'kanata-p7-web-capacity-synthetic-'),profile=await mkdtemp(prefix),marker=resolve(profile,'kanata-qa.json'),execute=promisify(execFile)
  await writeFile(marker,JSON.stringify({syntheticOnly:true,count,build}))
  let context,page,system,pageCdp
  const open=async()=>{
    if(!profile.startsWith(prefix)||!JSON.parse(await readFile(marker,'utf8')).syntheticOnly)throw Error('UNOWNED_WEB_CAPACITY_PROFILE')
    context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:375,height:812},reducedMotion:'reduce'})
    page=context.pages()[0];page.setDefaultTimeout(180000)
    const browser=context.browser();if(!browser)throw Error('MISSING_CAPACITY_BROWSER')
    system=await browser.newBrowserCDPSession();pageCdp=await context.newCDPSession(page)
  }
  await open()
  return{
    get page(){return page},profile,
    async cold(){await context.close();await open();return page},
    async memory(){
      const processes=(await system.send('SystemInfo.getProcessInfo')).processInfo.filter(p=>p.type==='renderer').map(p=>Number(p.id)).filter(id=>Number.isSafeInteger(id)&&id>0)
      if(!processes.length)throw Error('RENDERER_MEMORY_UNAVAILABLE')
      const {stdout}=await execute('powershell.exe',['-NoProfile','-Command',`Get-Process -Id ${processes.join(',')} | Select-Object Id,PeakWorkingSet64,WorkingSet64 | ConvertTo-Json -Compress`],{timeout:15000,maxBuffer:16384})
      const rows=JSON.parse(stdout),values=Array.isArray(rows)?rows:[rows]
      return{windowsRendererProcesses:values,peakResidentMiB:Math.max(...values.map(p=>p.PeakWorkingSet64))/1048576,heapPoint:await pageCdp.send('Runtime.getHeapUsage')}
    },
    async startAllocationProfile(){
      await pageCdp.send('HeapProfiler.startSampling',{samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true})
    },
    async stopAllocationProfile(){
      const {profile}=await pageCdp.send('HeapProfiler.stopSampling'),totals=new Map()
      const visit=node=>{
        const {functionName,url,lineNumber,columnNumber}=node.callFrame,key=JSON.stringify({functionName,url,lineNumber,columnNumber})
        totals.set(key,(totals.get(key)||0)+node.selfSize)
        for(const child of node.children)visit(child)
      }
      visit(profile.head)
      return [...totals].sort((a,b)=>b[1]-a[1]).slice(0,40).map(([key,bytes])=>({...JSON.parse(key),sampledAllocatedMiB:bytes/1048576}))
    },
    async close(){await context.close()}
  }
}
