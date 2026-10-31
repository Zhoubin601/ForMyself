import {readFile,writeFile} from 'node:fs/promises'
export async function preserveCapacityEvidence(url){
  let text
  try{text=await readFile(url,'utf8')}catch(error){if(error.code==='ENOENT')return;throw error}
  const value=JSON.parse(text),stamp=value.at.replace(/[^0-9TZ]/g,''),status=value.status.replace(/[^A-Za-z0-9_-]/g,'_')
  const name=url.pathname.split('/').pop().replace(/\.json$/,`-${stamp}-${status}.json`)
  try{await writeFile(new URL(name,url),text,{flag:'wx'})}catch(error){if(error.code!=='EEXIST')throw error}
}
export function assessCapacity(result,threshold){
  const metrics=result.metrics,loadLimit={1000:5000,10000:10000,100000:30000}[result.count]
  const requirements=[
    ['protectedColdLoad',metrics.coldPageReloadAndProtectedLoad?.value?.protectedLoadMs,loadLimit],
    ['saveHeader',metrics.saveHeader?.ms,loadLimit],
    ['diskPage50',metrics.diskPage50?.ms,1000],
    ['indexedExactSearch',metrics.indexedExactSearch?.ms,2000],
    ['portableImportActualCoordinator',metrics.portableImportActualCoordinator?.ms,120000],
    ['fullExportActualCoordinator',metrics.fullExportActualCoordinator?.ms,120000],
    ['fullRestoreActualCoordinator',metrics.fullRestoreActualCoordinator?.ms,120000],
    ['masterPasswordActualUiTransaction',metrics.masterPasswordActualUiTransaction?.ms,120000]
  ]
  // Returning the Android fixture to its known credential is also a real password
  // transaction. Never cherry-pick only the faster direction. Fresh Web profiles do
  // not have this cleanup step; if measured there, it receives the same threshold.
  if(result.kind==='production-android-actual-coordinator'||metrics.restoreSyntheticCredentialActualUi)requirements.push(['restoreSyntheticCredentialActualUi',metrics.restoreSyntheticCredentialActualUi?.ms,120000])
  result.timeChecks=requirements.map(([name,actualMs,limitMs])=>({name,actualMs,limitMs,status:!Number.isFinite(actualMs)?'NOT_RUN':actualMs<=limitMs?'PASS':'FAIL'}))
  const readings=Object.values(metrics).map(m=>m.memory?.peakResidentMiB),peak=Math.max(...readings)
  result.peakAppProcessResidentMiB=peak;result.memoryThresholdMiB=threshold
  result.memoryGate=readings.length>0&&readings.every(Number.isFinite)&&Number.isFinite(peak)&&peak<=threshold?'PASS':'FAIL'
  result.timeGate=result.timeChecks.every(check=>check.status==='PASS')?'PASS':'FAIL'
  result.status=result.memoryGate==='PASS'&&result.timeGate==='PASS'?'PASS':'FAIL_CAPACITY_GATE'
  result.assessmentVersion='capacity-gates-v2-return-rekey'
}
