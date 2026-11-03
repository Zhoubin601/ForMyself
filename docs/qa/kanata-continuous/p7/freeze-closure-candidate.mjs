import {readFile,writeFile,readdir,cp,access} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
const root=process.cwd(),tag=process.argv[2]||'p7-batch-closure-20261102',buildName=process.argv[3]||'production-build-closure-20261102.json',sourceCheck=process.argv[4]||'check-closure-reviewed-20261102.txt'
if(!/^p7-[a-z0-9-]+$/.test(tag)||!/^production-build-[a-z0-9-]+\.json$/.test(buildName)||!/^check-[a-z0-9-]+\.txt$/.test(sourceCheck))throw Error('INVALID_FROZEN_CANDIDATE_NAME')
const frozen=resolve('.kanata-web-dist.local',tag)
try{await access(frozen);throw Error('FROZEN_CANDIDATE_ALREADY_EXISTS')}catch(error){if(error.code!=='ENOENT')throw error}
const directory=new URL('./',import.meta.url),specific=new URL(buildName,directory)
const build=JSON.parse(await readFile(specific,'utf8'))
if(build.status!=='PASS'||!build.qaHarnessAbsent)throw Error('VERIFIED_PRODUCTION_BUILD_REQUIRED')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const apkHash=hash(await readFile('android/app/build/outputs/apk/debug/app-debug.apk'))
if(apkHash!==build.apkSha256)throw Error('APK_CHANGED_BEFORE_FREEZE')
const files=[]
async function collect(path){for(const entry of await readdir(path,{withFileTypes:true})){const name=path+'/'+entry.name;if(entry.isDirectory())await collect(name);else if(entry.isFile())files.push(name)}}
for(const path of ['src','scripts','android/app/src/main/java','android/app/src/androidTest/java'])await collect(path)
files.push('package.json','package-lock.json','capacitor.config.json','vite.config.js','android/app/build.gradle','android/variables.gradle')
const sources=[]
for(const path of files.sort())sources.push({path,sha256:hash(await readFile(path))})
const sourceDigest=hash(sources.map(row=>row.path+'\0'+row.sha256+'\n').join(''))
await cp('dist',frozen,{recursive:true,force:false,errorOnExist:true})
for(const resource of build.resources)if(hash(await readFile(resolve(frozen,resource.path)))!==resource.sha256)throw Error('FROZEN_RESOURCE_MISMATCH')
const sourceHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
const marker={syntheticOnly:true,productionPreview:true,sourceHead,sourceDigest,sourceCheck,apkSha256:apkHash,resourceCount:build.resourceCount,archiveFileBatchRequired:true,frozenAt:new Date().toISOString()}
await writeFile(resolve(frozen,'qa-build.json'),JSON.stringify(marker,null,2)+'\n',{flag:'wx'})
await writeFile(new URL('frozen-source-'+tag+'.json',directory),JSON.stringify({root,tag,...marker,sources},null,2)+'\n',{flag:'wx'})
await writeFile(new URL('production-build-before-'+tag+'.json',directory),await readFile(new URL('production-build-verification.json',directory)),{flag:'wx'})
const annotated={...build,sourceHead,sourceDigest,archiveFileBatchRequired:true,frozenTag:tag}
await writeFile(specific,JSON.stringify(annotated,null,2)+'\n')
await writeFile(new URL('production-build-verification.json',directory),JSON.stringify(annotated,null,2)+'\n')
console.log(JSON.stringify(marker))
