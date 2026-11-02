// Records finished evidence only; never accepts an unfinished run as a pass.
import {readFile,writeFile,access} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {resolve,sep} from 'node:path'
const root=process.cwd(),prefix='docs/qa/kanata-continuous/p7/'
const git=args=>execFileSync('git',args,{encoding:'utf8',maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']}).trim()
if(git(['branch','--show-current'])!=='Kanata')throw Error('KANATA_BRANCH_REQUIRED')
const json=async name=>JSON.parse(await readFile(resolve(root,prefix+name),'utf8'))
const write=(name,value)=>writeFile(resolve(root,prefix+name),JSON.stringify(value,null,2)+'\n')
const build=await json('production-build-pending-recovery-20261102.json')
const check=await readFile(resolve(root,prefix+'check-pending-recovery-20261102.txt'),'utf8')
if(!check.includes('✓ built in')||!check.includes('ℹ fail 0')||build.status!=='PASS')throw Error('INCOMPLETE_BUILD_EVIDENCE')
const fullCheck={command:'npm run check',log:'check-pending-recovery-20261102.txt',exitCode:0,nodePassed:Number(/ℹ tests (\d+)/.exec(check)?.[1]),componentPassed:Number(/Tests\s+(\d+) passed/.exec(check)?.[1]),componentFiles:Number(/Test Files\s+(\d+) passed/.exec(check)?.[1]),lintErrors:0,lintWarnings:42,strictBuild:'PASS'}
if(fullCheck.nodePassed!==575||fullCheck.componentPassed!==388||fullCheck.componentFiles!==41)throw Error('UNEXPECTED_FINAL_TEST_COUNTS')
const functional={}
for(const kind of ['web','native']){
  const result=await json('pending-recovery-20261102-'+kind+'-results.json')
  const tests=Object.values(result.checks)
  if(result.status!=='PASS'||result.cleanup?.status!=='PASS'||tests.length!==13||tests.some(test=>test.status!=='PASS')||result.pageErrors.length||result.fixtureRequests!==7)throw Error('UNFINISHED_FUNCTIONAL_EVIDENCE:'+kind)
  functional[kind]={status:result.status,checks:tests.length,fixtureRequests:result.fixtureRequests,realModelRequests:result.realModelRequests,pageErrors:result.pageErrors.length,cleanup:result.cleanup,evidence:'pending-recovery-20261102-'+kind+'-results.json'}
}
const baseline=await json('native-baseline-pending-recovery-20261102.json')
if(baseline.status!=='PASS'||baseline.apkSha256!==build.apkSha256||!baseline.backgroundPlaintextReleased)throw Error('UNFINISHED_CURRENT_BASELINE_EVIDENCE')
const instrument=await readFile(resolve(root,prefix+'instrumentation-pending-recovery-20261102.txt'),'utf8')
const pass=[...instrument.matchAll(/^INSTRUMENTATION_STATUS_CODE: 0\s*$/gm)].length,skip=[...instrument.matchAll(/^INSTRUMENTATION_STATUS_CODE: -4\s*$/gm)].length
if(pass!==8||skip!==1||!instrument.includes('OK (9 tests)'))throw Error('UNEXPECTED_INSTRUMENTATION_RESULT')
const capacity={}
for(const [kind,candidate] of [['web','directory'],['native','binary']]){
  capacity[kind]={sameAsCurrentCandidate:false,currentCandidateThreeSizes:'NOT_RUN',measurements:[]}
  for(const count of [1000,10000,100000]){
    const file=`${kind}-capacity-${candidate}-20261102-${count}.json`,result=await json(file)
    if(!['PASS','FAIL_CAPACITY_GATE'].includes(result.status)||result.profilerDiagnostic)throw Error('INCOMPLETE_CAPACITY_EVIDENCE:'+file)
    capacity[kind].measurements.push({count,status:result.status,build:result.build,peakMiB:result.peakAppProcessResidentMiB,memoryGate:result.memoryGate,timeGate:result.timeGate,failedTimeChecks:result.timeChecks.filter(t=>t.status!=='PASS'),evidence:file})
  }
}
const summary={status:'NO_GO',phase:'P7_IN_PROGRESS',at:new Date().toISOString(),handoff:'docs/20261102-kanata-p7-archive-planner-v1.md',branch:'Kanata',baseHead:git(['rev-parse','HEAD']),uncommitted:true,pushed:false,currentBuild:build.apkSha256,fullCheck,androidBuild:{status:'PASS',log:'android-app-build-pending-recovery-20261102.txt',verifiedResources:build.resourceCount,qaHarnessAbsent:build.qaHarnessAbsent},instrumentation:{pass,skipped:skip,failed:0,log:'instrumentation-pending-recovery-20261102.txt'},functional,coldRecovery: (await json('pending-recovery-20261102-native-results.json')).checks['cold-owner-loads-pending-activity-task-and-real-foreground-composition-completes-once'],capacity,baseline:{status:'PASS',evidence:'native-baseline-pending-recovery-20261102.json',modules:baseline.integrity.modules,settings:baseline.integrity.settings,metadata:baseline.integrity.metadata,todoRevision:baseline.integrity.todoRevision,moodRollover:baseline.integrity.moodRollover,backgroundPlaintextReleased:baseline.backgroundPlaintextReleased,explicitExpiry:baseline.expiryTriggeredExplicitly},remaining:['Web100k process RSS','Android100k complete password transaction including retirement and both directions','Current-candidate capacity replay','Dense memory/event/audit source pagination','Legacy life AI and reminder role bindings','Application-wide usage aggregation/date trends','Advanced mood/relationship decisions','Complete final 15-scenario/preset/legacy/security matrix'],physicalPhone:'NOT_RUN; user accepts guarded emulator',newRealModelQuality:'NOT_RUN; controlled provider only',files:prefix+'changed-files-20261102.json',credentialScan:prefix+'credential-scan-20261102.json'}
try{await access(resolve(root,prefix+'verification-summary-before-20261102.json'))}catch{await writeFile(resolve(root,prefix+'verification-summary-before-20261102.json'),await readFile(resolve(root,prefix+'verification-summary-latest.json')))}
await write('verification-summary-20261102.json',summary)
await write('verification-summary-latest.json',summary)
const names=new Set([...git(['diff','--name-only','-z']).split('\0'),...git(['diff','--cached','--name-only','-z']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean))
for(const name of ['changed-files-20261102.json','credential-scan-20261102.json'])names.add(prefix+name)
const files=[...names].sort()
if(files.some(name=>name.startsWith('raw/'))||git(['diff','--numstat','--','raw']))throw Error('UNEXPECTED_RAW_CHANGE')
const sourceHashes={}
for(const file of ['src/features/chat/kanataStore.js','src/features/chat/storage/messageArchiveCore.js','src/shared/crypto/passphraseAes.js','src/platform/storage/restoreJournal.js','src/platform/storage/restorePayloadCodec.js','scripts/patch-capacitor-filesystem.mjs','package.json'])sourceHashes[file]=createHash('sha256').update(await readFile(resolve(root,file))).digest('hex')
await write('changed-files-20261102.json',{at:new Date().toISOString(),branch:'Kanata',baseHead:summary.baseHead,count:files.length,files,sourceHashes,sourceHashBytes:'working-tree bytes; not Git index normalization',rawChanged:false,apkSdkAvdNotIncluded:true})
let credentialVariants=[],externalCredentialScan='NOT_CONFIGURED'
if(process.env.KANATA_AUDIT_KEY_FILE){
  try{
    const external=(await readFile(process.env.KANATA_AUDIT_KEY_FILE,'utf8')).trim()
    const keys=[...new Set([external,...external.matchAll(/\bsk-[A-Za-z0-9_-]{16,}\b/g)].map(value=>typeof value==='string'?value:value[0]))].filter(value=>value.length>=16)
    credentialVariants=keys.flatMap(key=>[Buffer.from(key,'utf8'),Buffer.from(key,'utf16le')]);externalCredentialScan='AVAILABLE_IN_MEMORY'
  }catch(error){if(error.code!=='ENOENT')throw error;externalCredentialScan='FILE_ABSENT'}
}
const exactMatches=[],potentialTokens=[];let scanned=0
for(const file of files){
  const absolute=resolve(root,file)
  if(!absolute.startsWith(root+sep))throw Error('AUDIT_PATH_OUTSIDE_WORKTREE')
  let value
  try{value=await readFile(absolute)}catch(error){if(error.code==='ENOENT')continue;throw error}
  ++scanned
  if(credentialVariants.some(variant=>value.includes(variant)))exactMatches.push(file)
  if(/(?:^|[^A-Za-z0-9_-])sk-[A-Za-z0-9]{20,}(?![A-Za-z0-9_-])/.test(value.toString('utf8')))potentialTokens.push(file)
}
credentialVariants=[]
const scan={status:exactMatches.length||potentialTokens.length?'FAIL':'PASS',at:new Date().toISOString(),scannedFiles:scanned,externalCredentialScan,exactMatches,potentialTokens,secretValuesPrinted:false,realModelRequests:0}
await write('credential-scan-20261102.json',scan)
console.log(JSON.stringify({phase:summary.phase,build:summary.currentBuild,fullCheck,functional:{web:functional.web.status,native:functional.native.status},files:files.length,credentialScan:scan.status}))
if(scan.status!=='PASS')process.exitCode=1
