// Creates a fresh QA app under work/m0. Does not modify production dependencies/Android.
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawn} from 'node:child_process'
const version=process.argv[2]??'8.3.1'
if(!['8.3.1','8.4.1'].includes(version))throw Error('QA_VERSION_DENIED')
const source=new URL('./prototype/',import.meta.url).pathname
await fs.mkdir('work/m0',{recursive:true})
const root=await fs.mkdtemp(path.resolve(`work/m0/android-${version}-`))
for(const file of ['package.json','capacitor.config.json','app.mjs','configure-android.mjs','SqlCipherM0Test.java'])await fs.copyFile(path.join(source,file),path.join(root,file))
await fs.mkdir(path.join(root,'www'));await fs.copyFile(path.join(source,'www/index.html'),path.join(root,'www/index.html'))
const manifest=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'))
for(const section of ['dependencies','devDependencies'])for(const key of ['@capacitor/core','@capacitor/android','@capacitor/cli'])if(manifest[section]?.[key])manifest[section][key]=version
await fs.writeFile(path.join(root,'package.json'),JSON.stringify(manifest,null,2)+'\n')
if(version==='8.3.1')await fs.copyFile(path.join(source,'package-lock.json'),path.join(root,'package-lock.json'))
else {
  const frozen=new URL('./evidence/prototype-8.4.1-lock.json',import.meta.url).pathname
  try{await fs.copyFile(frozen,path.join(root,'package-lock.json'))}catch(e){if(e.code!=='ENOENT')throw e}
}
const log=await fs.open(path.join(root,'build.txt'),'w')
const commands=[]
async function run(cmd,args) {
  commands.push({cmd,args});await log.write(JSON.stringify({cmd,args})+'\n')
  const code=await new Promise((resolve,reject)=>{const p=spawn(cmd,args,{cwd:root,env:process.env,stdio:['ignore',log.fd,log.fd]});p.on('error',reject);p.on('exit',resolve)})
  if(code!==0)throw Object.assign(Error('QA_BUILD_FAILED'),{exitCode:code})
}
let status='FAIL',exitCode=1
try {
  try {await fs.access(path.join(root,'package-lock.json'))}catch {await run('npm',['install','--package-lock-only','--registry=https://registry.npmjs.org'])}
  await run('npm',['ci','--registry=https://registry.npmjs.org'])
  await run('npm',['run','build'])
  await run('npx',['--no-install','cap','add','android'])
  await run(process.execPath,['configure-android.mjs'])
  await run('npx',['--no-install','cap','sync','android'])
  await run('./android/gradlew',['-p','android','--no-daemon','--max-workers=2',':app:assembleDebug',':app:assembleDebugAndroidTest'])
  status='BUILD_ONLY_DEVICE_BLOCKED';exitCode=0
}catch(error){exitCode=error.exitCode??1}
await log.close()
await fs.writeFile(path.join(root,'build-result.json'),JSON.stringify({status,exitCode,capacitor:version,plugin:'8.1.1',commands,root,deviceRuntime:'NOT RUN; adb devices empty'},null,2))
console.log(JSON.stringify({root,status,exitCode}))
process.exitCode=exitCode
