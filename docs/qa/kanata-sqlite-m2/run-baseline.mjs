// Existing M1/M1-R baseline verification only; never labels M2 implemented/PASS.
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
const evidence=path.resolve(process.argv[2]??'work/m2/baseline-'+Date.now())
if(!evidence.startsWith(path.resolve('work/m2')+path.sep))throw Error('QA_OUTPUT_PATH_DENIED')
await fs.mkdir(evidence,{recursive:false})
const commands=[
 ['directed',process.execPath,['--test','tests/kanataSqliteSchema.test.js','tests/kanataSqliteRemediation.test.js','tests/kanataSqliteMapping.test.js']],
 ['check',process.platform==='win32'?'npm.cmd':'npm',['run','check']],
 ['host',process.execPath,['docs/qa/kanata-sqlite-m1-r/verify-host.mjs',process.argv[3]??'work/m2/venv/bin/python']]
]
const receipt={scope:'UNCHANGED_M1_M1_R_BASELINE_NOT_M2_IMPLEMENTATION',commands:[]}
for(const [name,command,args] of commands){
 const log=await fs.open(path.join(evidence,name+'.txt'),'wx'),started=new Date().toISOString()
 const exitCode=await new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:['ignore',log.fd,log.fd]});child.once('error',reject);child.once('exit',resolve)
 })
 await log.close()
 const bytes=await fs.readFile(path.join(evidence,name+'.txt'))
 receipt.commands.push({command,args,started,ended:new Date().toISOString(),exitCode,log:name+'.txt',sha256:createHash('sha256').update(bytes).digest('hex')})
 await fs.writeFile(path.join(evidence,'receipt.json'),JSON.stringify(receipt,null,2)+'\n')
 if(exitCode!==0){process.exitCode=1;break}
}
console.log(JSON.stringify({evidence,receipt},null,2))
