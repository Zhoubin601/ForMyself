// One process owns each synthetic password, passing it to the two QA phases via stdin.
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomBytes,createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const project=process.argv[2]
const repetitions=Number(process.argv[3]??5)
if(!project||![1,5].includes(repetitions))throw Error('QA_DIRECT_ARGUMENTS')
const workRoot=await fs.realpath('work/m0')
const buildRoot=await fs.realpath(project)
if(!buildRoot.startsWith(workRoot+path.sep)||!path.basename(buildRoot).startsWith('android-8.4.1-'))throw Error('QA_BUILD_DIR_DENIED')
const app=await fs.readFile(path.join(buildRoot,'android/app/build/outputs/apk/debug/app-debug.apk'))
const apkSha256=createHash('sha256').update(app).digest('hex')
const driver=fileURLToPath(new URL('./verify-emulator.mjs',import.meta.url))
const dir=await fs.mkdtemp(path.join(workRoot,'direct-'))
const runs=[]
let complete=false
try{
  for(let sample=1;sample<=repetitions;sample++){
    const password='合成-'+randomBytes(24).toString('base64url')
    const round={sample}
    runs.push(round)
    for(const phase of ['seed','resume']){
      const args=[driver,'8.4.1','--build-dir',buildRoot,'--bridge-only','--direct-session',phase]
      if(phase==='resume')args.push('--prior-pid',round.seed.pid)
      const child=spawnSync(process.execPath,args,
        {input:password,encoding:'utf8',timeout:930000,stdio:['pipe','pipe','pipe']})
      const output=child.stdout?.trim().split(/\r?\n/).at(-1)
      const state=output?JSON.parse(output):{}
      console.log(JSON.stringify({sample,phase,status:state.status??'FAIL',code:state.code??child.error?.code}))
      if(state.dir){
        try{round[phase]=JSON.parse(await fs.readFile(path.join(state.dir,'direct.json'),'utf8'))}
        catch(error){if(error.code!=='ENOENT')throw error}
      }
      if(child.status!==0)throw Error('QA_DIRECT_RUN_FAILED')
    }
    if(round.seed.pid===round.resume.pid)throw Error('QA_DIRECT_RESTART_NOT_OBSERVED')
  }
  complete=true
}finally{
  await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({complete,repetitions,apkSha256,runs},null,2)+'\n')
  console.log(JSON.stringify({dir,complete,runs:runs.length}))
}
