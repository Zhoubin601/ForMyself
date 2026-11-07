import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync,execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {KANATA_SCHEMA_MIGRATIONS} from '../../../src/features/chat/storage/sqlite/kanataSchema.js'
import {kanataSqliteFixture} from '../../../tests/helpers/kanataSqliteFixture.js'

// Unique output directory prevents parallel/interrupted runs corrupting evidence.
fs.mkdirSync('work/m0',{recursive:true})
const dir=fs.mkdtempSync(path.resolve('work/m0/m1-r-regression-'))
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const receipt={startedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 node:process.version,platform:process.platform,arch:process.arch,kernel:os.release(),
 schemaSha256:digest(KANATA_SCHEMA_MIGRATIONS),fixtureSha256:digest(kanataSqliteFixture()),steps:[]}
const steps=[
 ['directed',process.execPath,['--test','tests/kanataSqliteSchema.test.js','tests/kanataSqliteRemediation.test.js','tests/kanataSqliteMapping.test.js']],
 ['check',process.platform==='win32'?'npm.cmd':'npm',['run','check']]
]
for(const [name,command,args] of steps){
 const fd=fs.openSync(path.join(dir,name+'.txt'),'w'),startedAt=new Date().toISOString()
 let result
 try{result=spawnSync(command,args,{stdio:['ignore',fd,fd]})}finally{fs.closeSync(fd)}
 receipt.steps.push({name,command,args,startedAt,finishedAt:new Date().toISOString(),exitCode:result.status,signal:result.signal})
 fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n')
 if(result.status!==0){console.log(JSON.stringify({dir,status:'FAIL',step:name}));process.exit(result.status??1)}
}
console.log(JSON.stringify({dir,status:'PASS_REGRESSION',steps:receipt.steps}))
