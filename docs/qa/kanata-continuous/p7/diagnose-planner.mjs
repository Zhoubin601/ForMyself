// Independent-process allocation diagnostic only. Does not count as a product capacity gate.
import {execFileSync} from 'node:child_process'
import {readFile, writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {archiveData} from '../../../../tests/helpers/kanataArchiveFixture.js'
const mode=process.argv[2],baseline='ddd3f10e2daf1c3675dbd05bac3425157d1a2ef4'
if(!['baseline','current'].includes(mode))throw Error('PLANNER_DIAGNOSTIC_MODE_REQUIRED')
const path='src/features/chat/storage/messageArchiveCore.js',sourceUrl=new URL('../../../../'+path,import.meta.url)
const source=mode==='baseline'?execFileSync('git',['show',baseline+':'+path],{encoding:'utf8'}):await readFile(sourceUrl,'utf8')
const rewritten=source.replace("'../domain/kanataJson.js'",JSON.stringify(new URL('../domain/kanataJson.js',sourceUrl).href))
const {planMessageArchive}=await import('data:text/javascript;base64,'+Buffer.from(rewritten).toString('base64'))
const data=archiveData(100000),scope={worldId:data.worlds[0].id,conversationId:data.conversations[0].id,keepRecent:200}
data.memories=Array.from({length:20},(_,n)=>({sourceRefs:[{messageId:data.messages[n].id,revision:1}]}))
const before=process.memoryUsage(),start=performance.now(),plan=planMessageArchive(data,scope)
const result={status:'DIAGNOSTIC_ONLY',syntheticOnly:true,mode,baseline,sourceSha256:createHash('sha256').update(source).digest('hex'),count:data.messages.length,ms:performance.now()-start,before,after:process.memoryUsage(),peakRssKiB:process.resourceUsage().maxRSS,pages:plan.pages.length,archived:plan.archivedCount,retained:plan.remaining.length,forcedGC:false}
await writeFile(new URL('planner-diagnostic-'+mode+'-20261102.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result))
