import test from 'node:test'
import assert from 'node:assert/strict'
import {assessCapacity} from '../docs/qa/kanata-continuous/p7/capacity-evidence.mjs'
const fixture=(kind='production-android-actual-coordinator')=>({kind,count:100000,metrics:Object.fromEntries(['coldPageReloadAndProtectedLoad','saveHeader','diskPage50','indexedExactSearch','portableImportActualCoordinator','fullExportActualCoordinator','fullRestoreActualCoordinator','masterPasswordActualUiTransaction',...(kind==='production-android-actual-coordinator'?['restoreSyntheticCredentialActualUi']:[])].map(name=>[name,{ms:1,value:{protectedLoadMs:1},memory:{peakResidentMiB:100}}]))})
test('P7 both real password changes must meet the same frozen threshold, even when the first direction passes',()=>{
  const result=fixture();result.metrics.masterPasswordActualUiTransaction.ms=116779.4;result.metrics.restoreSyntheticCredentialActualUi.ms=148057.7
  assessCapacity(result,512)
  assert.equal(result.status,'FAIL_CAPACITY_GATE');assert.equal(result.timeGate,'FAIL');assert.equal(result.memoryGate,'PASS')
  assert.deepEqual(result.timeChecks.find(c=>c.name==='restoreSyntheticCredentialActualUi'),{name:'restoreSyntheticCredentialActualUi',actualMs:148057.7,limitMs:120000,status:'FAIL'})
})
test('P7 an unexecuted Android credential return is NOT_RUN and can never become capacity PASS',()=>{
  const result=fixture();delete result.metrics.restoreSyntheticCredentialActualUi
  assessCapacity(result,512)
  assert.equal(result.status,'FAIL_CAPACITY_GATE');assert.equal(result.timeChecks.find(c=>c.name==='restoreSyntheticCredentialActualUi').status,'NOT_RUN')
})
test('P7 fresh Web profiles have no return operation; any return actually measured still uses the same gate',()=>{
  const result=fixture('production-chrome-actual-coordinator');assessCapacity(result,768);assert.equal(result.status,'PASS')
  result.metrics.restoreSyntheticCredentialActualUi={ms:120001,memory:{peakResidentMiB:100}}
  assessCapacity(result,768);assert.equal(result.status,'FAIL_CAPACITY_GATE')
})
test('P7 missing/non-finite memory or unmeasured required operations cannot receive a pass',()=>{
  for(const missing of [undefined,NaN,Infinity]){
    const result=fixture();result.metrics.fullRestoreActualCoordinator.memory.peakResidentMiB=missing
    assessCapacity(result,512);assert.equal(result.memoryGate,'FAIL');assert.equal(result.status,'FAIL_CAPACITY_GATE')
  }
  const result=fixture();delete result.metrics.fullRestoreActualCoordinator
  assessCapacity(result,512);assert.equal(result.status,'FAIL_CAPACITY_GATE');assert.equal(result.timeGate,'FAIL')
})
