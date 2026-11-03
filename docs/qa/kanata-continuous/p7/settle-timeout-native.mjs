// After a failed capacity observation, wait for the real app transaction before any restart.
import {writeFile} from 'node:fs/promises'
import {attachGuardedNative} from './attach-guarded-native.mjs'
import {PASSWORD} from '../p3/management-scenarios.mjs'
const native=await attachGuardedNative(),page=native.page
page.setDefaultTimeout(1200000)
const result={status:'WAITING_FOR_PRODUCT_SETTLEMENT',syntheticOnly:true,at:new Date().toISOString(),acceptanceEvidence:false}
const target=new URL('native-timeout-settlement-closure-20261102.json',import.meta.url)
const save=()=>writeFile(target,JSON.stringify(result,null,2)+'\n')
try{
  await save()
  await page.waitForFunction(()=>{
    const stores=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s,store=stores?.get('kanata'),access=stores?.get('protectedAccess')
    if(access?.recoveryRequired||store?.saveError)throw Error('PRODUCT_REKEY_REQUIRES_RECOVERY')
    return store?.isDataLoaded&&!store.hasPendingSave&&store.saveStatus==='saved'&&!document.querySelector('input[placeholder="原主密码"]')
  },{},{timeout:1200000,polling:1000})
  result.settled=await page.evaluate(({old,next})=>{
    const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s,a=s.get('auth'),k=s.get('kanata')
    return{oldSyntheticCredential:a.savedMasterPwd===old,nextSyntheticCredential:a.savedMasterPwd===next,active:k.snapshot.messages.length,archived:k.snapshot.messageArchives?.reduce((n,p)=>n+p.messages.length,0)||0,pending:k.hasPendingSave,saveError:k.saveError}
  },{old:PASSWORD,next:'Synthetic-Kanata-P7-capacity-next'})
  await save()
  if(!result.settled.oldSyntheticCredential&&!result.settled.nextSyntheticCredential)throw Error('UNEXPECTED_SYNTHETIC_CREDENTIAL_STATE')
  if(result.settled.nextSyntheticCredential){
    await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').openGeneralSettingsSection('security'))
    await page.getByRole('button',{name:'传统密码验证修改',exact:true}).click()
    await page.getByPlaceholder('原主密码',{exact:true}).fill('Synthetic-Kanata-P7-capacity-next')
    await page.getByPlaceholder('新主密码',{exact:true}).fill(PASSWORD)
    await page.getByPlaceholder('确认新主密码',{exact:true}).fill(PASSWORD)
    const start=performance.now()
    await page.getByRole('button',{name:'保存',exact:true}).click()
    await page.getByPlaceholder('原主密码',{exact:true}).waitFor({state:'hidden',timeout:1200000})
    result.returnCredentialMs=Math.round(performance.now()-start)
    result.returnTimeGate=result.returnCredentialMs<=120000?'PASS':'FAIL'
  }
  result.restoredCredential=await page.evaluate(password=>{
    const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
    return s.get('auth').savedMasterPwd===password&&!s.get('kanata').hasPendingSave&&!s.get('kanata').saveError&&!s.get('protectedAccess').recoveryRequired
  },PASSWORD)
  if(!result.restoredCredential)throw Error('SYNTHETIC_CREDENTIAL_NOT_SETTLED')
  result.status='SETTLED_READY_FOR_BASELINE_COORDINATOR'
}catch(error){result.status='NO_GO_PRESERVE_STATE';result.error=error.message;process.exitCode=1}
finally{await save();await native.close()}
process.exit(process.exitCode||0)
