import assert from 'node:assert/strict'
import test from 'node:test'
import CryptoJS from 'crypto-js'
import {encryptPassphraseAes,decryptPassphraseAes} from '../src/shared/crypto/passphraseAes.js'
import {sha256Text} from '../src/shared/crypto/sha256Text.js'
import { cloneKanataJson, validateKanataData, assertKanataData } from '../src/features/chat/domain/kanataValidation.js'
import { assertKanataJson } from '../src/features/chat/domain/kanataJson.js'
import { planMessageArchive, archiveMayMatch, createArchiveIndex, validateMessageArchives } from '../src/features/chat/storage/messageArchiveCore.js'
import { createMessageArchiveRepository, KANATA_ARCHIVE_DIRECTORY } from '../src/features/chat/storage/messageArchiveRepository.js'
import { buildKanataChatBackupSnapshot, captureKanataRestoreSnapshot } from '../src/features/chat/backup/kanataBackup.js'
import { encryptKanataData, KANATA_DATA_PATH, KANATA_BACKUP_PATH } from '../src/features/chat/storage/kanataRepository.js'
import { archiveData, archiveFilesystem, ARCHIVE_PASSWORD as password } from './helpers/kanataArchiveFixture.js'
const code = value => error => error.code === value || error.message === value
const scope = data => ({worldId:data.worlds[0].id,conversationId:data.conversations.find(c=>c.type==='private').id})
const path = page => KANATA_ARCHIVE_DIRECTORY+'/'+page.key+'.enc'

test('P7 page rekey preserves exact verified JSON bytes and unknown fields with three I/O calls and no mkdir',async()=>{
  const h=archiveFilesystem(),repo=createMessageArchiveRepository({filesystem:h.filesystem}),data=archiveData(50),target=scope(data)
  const initial=await repo.write(data.messages,password,target)
  const body=JSON.parse(decryptPassphraseAes(h.files.get(path(initial)),password));body.messages[0].unknown={kept:['合成扩展',null]}
  const plaintext=JSON.stringify(body,null,2)+'\n',ciphertext=encryptPassphraseAes(plaintext,password)
  const page={...initial,key:sha256Text(ciphertext),bytes:ciphertext.length};h.files.set(path(page),ciphertext)
  const before=JSON.stringify(page),offset=h.calls.length,next=await repo.reencrypt(page,password,'synthetic-next-password',target)
  assert.deepEqual(h.calls.slice(offset).map(call=>call.operation),['read','write','read'])
  assert.equal(JSON.stringify(page),before);assert.notEqual(next.key,page.key);assert.equal(next.index,page.index)
  assert.notEqual(next.messages,page.messages);assert.notEqual(next.messages[0],page.messages[0])
  assert.equal(decryptPassphraseAes(h.files.get(path(next)),'synthetic-next-password'),plaintext)
  assert.equal(h.files.get(path(page)),ciphertext)
  await assert.rejects(repo.read(next,password,target),code('KANATA_ARCHIVE_DECRYPT_FAILED'))
  assert.deepEqual(await repo.read(next,'synthetic-next-password',target),body.messages)
})

test('P7 page rekey validates old scope, password, hash and index before any new write',async()=>{
  const h=archiveFilesystem(),repo=createMessageArchiveRepository({filesystem:h.filesystem}),data=archiveData(50),target=scope(data)
  const page=await repo.write(data.messages,password,target),offset=h.calls.length,old=h.files.get(path(page))
  for(const [descriptor,oldPassword,requested,error] of [
    [page,password,{...target,worldId:'other'},'KANATA_ARCHIVE_SCOPE_DENIED'],
    [page,'wrong-synthetic-password',target,'KANATA_ARCHIVE_DECRYPT_FAILED'],
    [{...page,index:'0'.repeat(1024)},password,target,'KANATA_ARCHIVE_INDEX_MISMATCH'],
    [{...page,key:'../outside'},password,target,'KANATA_ARCHIVE_PATH_INVALID'],
    [{...page,bytes:page.bytes+4},password,target,'KANATA_ARCHIVE_VERIFY_FAILED']
  ])await assert.rejects(repo.reencrypt(descriptor,oldPassword,'synthetic-next-password',requested),code(error))
  assert(!h.calls.slice(offset).some(call=>call.operation==='write'));assert.equal(h.files.get(path(page)),old)
})

test('P7 page rekey read-back corruption fails without deleting the old file or exposing plaintext',async()=>{
  const h=archiveFilesystem(),data=archiveData(50),target=scope(data),repo=createMessageArchiveRepository({filesystem:h.filesystem})
  const page=await repo.write(data.messages,password,target),old=h.files.get(path(page)),normalRead=h.filesystem.readFile
  h.filesystem.readFile=async options=>{const result=await normalRead(options);return options.path===path(page)?result:{data:result.data.slice(0,-1)+'!'}}
  await assert.rejects(repo.reencrypt(page,password,'synthetic-next-password',target),code('KANATA_ARCHIVE_VERIFY_FAILED'))
  assert.equal(h.files.get(path(page)),old);assert.equal(h.calls.filter(call=>call.operation==='delete').length,0)
  h.filesystem.readFile=normalRead
  assert.deepEqual(await repo.read(page,password,target),data.messages)
})

test('P7 page rekey cancellation after source read and failed new writes never retire the old copy',async()=>{
  const h=archiveFilesystem(),repo=createMessageArchiveRepository({filesystem:h.filesystem}),data=archiveData(50),target=scope(data)
  const page=await repo.write(data.messages,password,target),old=h.files.get(path(page));let checks=0
  await assert.rejects(repo.reencrypt(page,password,'synthetic-next-password',target,()=>{if(++checks===2)throw Error('SYNTHETIC_EXPIRED')}),/SYNTHETIC_EXPIRED/)
  h.control.failure={operation:'write',contains:'kanata-pages-v1'}
  await assert.rejects(repo.reencrypt(page,password,'synthetic-next-password',target),code('KANATA_ARCHIVE_WRITE_FAILED'))
  assert.equal(h.files.get(path(page)),old);assert(!h.calls.some(call=>call.operation==='delete'))
})

test('P7 concurrent page creation shares only directory readiness and still verifies every encrypted body',async()=>{
  const h=archiveFilesystem(),repo=createMessageArchiveRepository({filesystem:h.filesystem}),data=archiveData(200),target=scope(data)
  const pages=await Promise.all([0,50,100,150].map(start=>repo.write(data.messages.slice(start,start+50),password,target)))
  assert.equal(h.calls.filter(c=>c.operation==='mkdir').length,1)
  assert.equal(h.calls.filter(c=>c.operation==='write').length,4);assert.equal(h.calls.filter(c=>c.operation==='read').length,4)
  for(const [index,page] of pages.entries())assert.deepEqual(await repo.read(page,password,target),data.messages.slice(index*50,index*50+50))
})

test('P7 failed directory creation or writes never poison later retry readiness',async()=>{
  const h=archiveFilesystem(),repo=createMessageArchiveRepository({filesystem:h.filesystem}),data=archiveData(100),target=scope(data)
  h.control.failure={operation:'mkdir',contains:'kanata-pages-v1'}
  await assert.rejects(repo.write(data.messages.slice(0,50),password,target),code('KANATA_ARCHIVE_WRITE_FAILED'));assert.equal(h.files.size,0)
  h.control.failure=null;await repo.write(data.messages.slice(0,50),password,target)
  assert.equal(h.calls.filter(c=>c.operation==='mkdir').length,2)
  h.control.failure={operation:'write',contains:'kanata-pages-v1'}
  await assert.rejects(repo.write(data.messages.slice(50),password,target),code('KANATA_ARCHIVE_WRITE_FAILED'))
  h.control.failure=null;await repo.write(data.messages.slice(50),password,target)
  assert.equal(h.calls.filter(c=>c.operation==='mkdir').length,3)
})

test('P7 JSON clone preserves inert JSON without serialized copies, aliasing or prototype setters', () => {
  const shared={text:'合成正文'}, input=JSON.parse('{"__proto__":{"polluted":"synthetic"},"constructor":"ordinary","minus":0}')
  input.a=shared;input.b=shared;input.list=[null,true,-0,1.5,'🚀'];input.nullPrototype=Object.assign(Object.create(null),{value:'null-proto'})
  const actual=cloneKanataJson(input)
  assert.deepEqual(actual,JSON.parse(JSON.stringify(input)))
  assert.notEqual(actual.a,input.a);assert.notEqual(actual.a,actual.b);assert.equal(Object.getPrototypeOf(actual),Object.prototype)
  assert.equal(Object.prototype.polluted,undefined);actual.a.text='changed';assert.equal(input.a.text,'合成正文')
})
test('P7 JSON clone still rejects hidden/accessor/runtime/sparse/cyclic/deep/non-finite inputs without invoking getters', () => {
  let calls=0;const getter={get secret(){++calls;return'synthetic'}}
  const cyclic={};cyclic.self=cyclic
  const hidden=Object.defineProperty({},'secret',{value:'synthetic',enumerable:false})
  const symbol={[Symbol('synthetic')]:1}, sparse=Array(2), withExtra=[1];withExtra.extra=1
  let deep={};for(let i=0;i<66;i++)deep={next:deep}
  for(const input of [getter,cyclic,hidden,symbol,sparse,withExtra,deep,NaN,Infinity,undefined,()=>1,1n,new Date(),new Map()]) {assert.throws(()=>cloneKanataJson(input));assert.throws(()=>assertKanataJson(input))}
  assert.equal(calls,0)
})
test('P7 privately owned graph assertion keeps all graph/security checks without claiming detached ownership',()=>{
  const data=archiveData(50);assert.equal(assertKanataData(data),data)
  const bad=cloneKanataJson(data);bad.messages[1].replyToRevision=999
  assert.throws(()=>assertKanataData(bad),code('INVALID_REPLY_SOURCE_REVISION'))
  assert.throws(()=>validateKanataData(bad),code('INVALID_REPLY_SOURCE_REVISION'))
  const detached=validateKanataData(data);detached.messages[0].content='changed';assert.notEqual(data.messages[0].content,'changed')
})
test('P7 archive planner retains source proofs, audits and complete reply components; no fake history or source changes', () => {
  const data=archiveData(),target=scope(data),source=data.messages[0],before=JSON.stringify(data)
  data.tasks.push({id:'task-proof',worldId:source.worldId,kind:'summary',state:'pending',idempotencyKey:'proof',sourceRefs:[{messageId:source.id,revision:1}],sourceRevision:1,attempt:0,notBefore:0,leaseUntil:0,resultEventIds:[]})
  const original=validateKanataData(data),plan=planMessageArchive(original,{...target,keepRecent:50})
  assert.equal(plan.archivedCount,348);assert.equal(plan.remaining.length,52)
  assert(plan.remaining.some(m=>m.id==='synthetic-message-1'))
  const archived=new Set(plan.pages.flat().map(m=>m.id))
  for(const rows of plan.pages){assert(rows.length<=50);for(const message of rows)if(message.replyToMessageId)assert(rows.some(m=>m.id===message.replyToMessageId))}
  assert.equal(new Set([...plan.remaining.map(m=>m.id),...archived]).size,400)
  assert.equal(JSON.stringify(data.messages),JSON.stringify(JSON.parse(before).messages))
  assert.throws(()=>planMessageArchive(data,{worldId:'wrong',conversationId:target.conversationId}),code('KANATA_ARCHIVE_SCOPE_DENIED'))
  assert.throws(()=>planMessageArchive(data,{...target,keepRecent:0}),code('KANATA_ARCHIVE_KEEP_INVALID'))
})
test('P7 Bloom index never skips an exact normalized match, including Unicode and repeated/single characters', () => {
  assert.equal(CryptoJS.SHA256(createArchiveIndex([{content:'星河🚀 Café ＡＢＣ 测测测'},{content:'合成容量正文777，不含真实资料。'}])).toString(),'862c5c1a4e227900874566b8aa97dc00356fa4bcdf7f39d830df3ebb4dc95c48')
  const texts=['星河🚀 Cafe\u0301','ＡＢＣ xyz','aaaa','中文分词','\n', '𠮷野家']
  for(const content of texts){const index=createArchiveIndex([{content}]);const chars=Array.from(content.normalize('NFKC').toLowerCase());for(let i=0;i<chars.length;i++)for(let j=i+1;j<=chars.length;j++)assert(archiveMayMatch(index,chars.slice(i,j).join('')))}
})
test('P7 encrypted immutable page verifies bytes/hash/scope/index, has no plaintext/password cache and refuses traversal', async () => {
  const h=archiveFilesystem(),repo=createMessageArchiveRepository({filesystem:h.filesystem,directory:'DATA'}),data=archiveData(50),target=scope(data)
  const page=await repo.write(data.messages,password,target)
  assert.equal(h.files.size,1);assert.equal(h.files.get(path(page)).includes('合成历史'),false)
  assert.deepEqual(await repo.read(page,password,target),data.messages)
  await assert.rejects(repo.read(page,'wrong-synthetic-password',target),code('KANATA_ARCHIVE_DECRYPT_FAILED'))
  const n=h.calls.length;await assert.rejects(repo.read(page,password,{...target,worldId:'other'}),code('KANATA_ARCHIVE_SCOPE_DENIED'));assert.equal(h.calls.length,n)
  await assert.rejects(repo.read({...page,key:'../../outside'},password,target),code('KANATA_ARCHIVE_PATH_INVALID'))
  await assert.rejects(repo.read({...page,index:'0'.repeat(1024)},password,target),code('KANATA_ARCHIVE_INDEX_MISMATCH'))
  h.files.set(path(page),h.files.get(path(page)).slice(0,-1)+'!')
  await assert.rejects(repo.read(page,password,target),code('KANATA_ARCHIVE_VERIFY_FAILED'))
})
test('P7 version2 graph validates unique archive IDs and scope while portable export rejects unhydrated references', async () => {
  const h=archiveFilesystem(),repo=createMessageArchiveRepository({filesystem:h.filesystem}),data=archiveData(100),target=scope(data)
  const page=await repo.write(data.messages.slice(0,50),password,target),header={...data,version:2,messages:data.messages.slice(50),messageArchives:[page]}
  assert.equal(validateKanataData(header).messageArchives.length,1)
  for(const bad of [{...header,version:1},{...header,messageArchives:[page,page]},{...header,messageArchives:[{...page,worldId:'other'}]},{...header,messages:data.messages}])assert.throws(()=>validateKanataData(bad))
  assert.throws(()=>buildKanataChatBackupSnapshot(header),/KANATA_ARCHIVE_BACKUP_NOT_HYDRATED/)
  assert.throws(()=>captureKanataRestoreSnapshot({chat:{data:header}}))
  assert.throws(()=>validateMessageArchives({...header,messageArchives:[{...page,version:999}]}),code('UNSUPPORTED_KANATA_ARCHIVE_VERSION'))
})
test('P7 disk pagination returns only requested rows and indexed rare search reads one page; canceled reads return no late bodies', async () => {
  const h=archiveFilesystem(),repo=createMessageArchiveRepository({filesystem:h.filesystem}),data=archiveData(),target=scope(data),pages=[]
  for(let start=0;start<350;start+=50)pages.push(await repo.write(data.messages.slice(start,start+50),password,target))
  h.calls.length=0
  const first=await repo.query(pages,data.messages.slice(350),password,{...target,limit:50})
  assert.equal(first.messages.length,50);assert.equal(first.messages[0].id,'synthetic-message-399');assert(first.hasMore);assert.equal(first.pagesRead,1)
  const second=await repo.query(pages,data.messages.slice(350),password,{...target,limit:50,before:first.messages.at(-1)})
  assert.equal(second.messages[0].id,'synthetic-message-349');assert.equal(second.messages.at(-1).id,'synthetic-message-300');assert.equal(second.pagesRead,2)
  h.calls.length=0
  const found=await repo.query(pages,[],password,{...target,text:'星河🚀 café'})
  assert.equal(found.messages[0].id,'synthetic-message-26');assert.equal(found.pagesRead,1);assert.equal(h.calls.filter(c=>c.operation==='read').length,1)
  let current=true,resume;h.control.pause={operation:'read',contains:pages[0].key,onEnter:()=>{current=false;resume()},wait:new Promise(resolve=>{resume=resolve})}
  await assert.rejects(repo.read(pages[0],password,target,()=>{if(!current)throw Object.assign(Error('expired'),{code:'EXPIRED'})}),code('EXPIRED'))
})
test('P7 query budget exhaustion cannot return a partial page/cursor that skips unchecked history',async()=>{
  const h=archiveFilesystem(),repo=createMessageArchiveRepository({filesystem:h.filesystem}),data=archiveData(100),target=scope(data)
  const pages=[await repo.write(data.messages.slice(0,50),password,target),await repo.write(data.messages.slice(50),password,target)]
  await assert.rejects(repo.query(pages,[],password,{...target,limit:50,maxPages:1}),code('KANATA_ARCHIVE_QUERY_BUDGET_EXCEEDED'))
})
test('P7 archive missing/corrupt/readback/cancel failures never alter the canonical file; retire is nonrecursive and confined',async()=>{
  const h=archiveFilesystem(),repo=createMessageArchiveRepository({filesystem:h.filesystem}),data=archiveData(50),target=scope(data)
  h.files.set('formyself/kanata-v1.enc','synthetic canonical');h.files.set('outside','synthetic keep')
  h.control.failure={operation:'read',contains:'kanata-pages-v1'}
  await assert.rejects(repo.write(data.messages,password,target),code('KANATA_ARCHIVE_READ_FAILED'))
  assert.equal(h.files.get('formyself/kanata-v1.enc'),'synthetic canonical')
  h.control.failure=null;h.files.set(KANATA_ARCHIVE_DIRECTORY+'/unknown.keep','synthetic unknown')
  await assert.rejects(repo.retireAll(),code('KANATA_ARCHIVE_RETIRE_FAILED'))
  assert.equal(h.files.get('outside'),'synthetic keep');assert(h.files.has(KANATA_ARCHIVE_DIRECTORY+'/unknown.keep'))
  const unknownPath=KANATA_ARCHIVE_DIRECTORY+'/unknown.keep';h.files.delete(unknownPath) // fixture Map only
  await repo.retireAll();assert.equal(h.files.size,2)
})
test('P7 raw page payload must match authenticated descriptor metadata, not just valid JSON',async()=>{
  const h=archiveFilesystem(),repo=createMessageArchiveRepository({filesystem:h.filesystem}),data=archiveData(50),target=scope(data)
  const page=await repo.write(data.messages,password,target)
  const bad=CryptoJS.AES.encrypt(JSON.stringify({type:'kanata-message-page',version:99,...target,messages:data.messages}),password).toString()
  const badDescriptor={...page,key:CryptoJS.SHA256(bad).toString(),bytes:bad.length};h.files.set(path(badDescriptor),bad)
  await assert.rejects(repo.read(badDescriptor,password,target),code('UNSUPPORTED_KANATA_ARCHIVE_VERSION'))
})
test('P7 future archive header version cannot silently fall back to and overwrite an older full graph',async()=>{
  const h=archiveFilesystem(),repository=h.repository(),data=archiveData(100),target=scope(data)
  const page=await repository.archives.write(data.messages.slice(0,50),password,target)
  const head={...data,version:2,messages:data.messages.slice(50),messageArchives:[{...page,version:999}]}
  const future=CryptoJS.AES.encrypt(JSON.stringify(head),password).toString()
  h.files.set(KANATA_DATA_PATH,future);h.files.set(KANATA_BACKUP_PATH,encryptKanataData(data,password));h.calls.length=0
  await assert.rejects(repository.read(password),code('UNSUPPORTED_KANATA_ARCHIVE_VERSION'))
  assert.equal(repository.getState().loaded,false);assert.equal(h.files.get(KANATA_DATA_PATH),future)
  assert.equal(h.calls.filter(c=>['write','rename','delete'].includes(c.operation)).length,0)
})
test('P7 cold archive inspection uses one metadata listing, no bodies or per-page native calls, and rejects missing/changed files',async()=>{
  const h=archiveFilesystem(),repo=createMessageArchiveRepository({filesystem:h.filesystem}),data=archiveData(100),target=scope(data)
  const pages=[await repo.write(data.messages.slice(0,50),password,target),await repo.write(data.messages.slice(50),password,target)]
  h.calls.length=0
  await repo.inspectAll(pages)
  assert.equal(h.calls.filter(c=>c.operation==='list').length,1)
  assert.equal(h.calls.filter(c=>['read','stat','write'].includes(c.operation)).length,0)
  h.files.set(path(pages[0]),'changed-size')
  await assert.rejects(repo.inspectAll(pages),code('KANATA_ARCHIVE_VERIFY_FAILED'))
  h.files.delete(path(pages[0]))
  await assert.rejects(repo.inspectAll(pages),code('KANATA_ARCHIVE_MISSING'))
})
test('P7 a driver without listing sizes still requires exact per-file stat; forged or ambiguous metadata is rejected',async()=>{
  const h=archiveFilesystem(),data=archiveData(50),target=scope(data)
  const repo=createMessageArchiveRepository({filesystem:h.filesystem}),page=await repo.write(data.messages,password,target)
  const list=h.filesystem.readdir
  h.filesystem.readdir=async options=>({files:(await list(options)).files.map(({name,type})=>({name,type}))})
  h.calls.length=0;await repo.inspectAll([page]);assert.equal(h.calls.filter(c=>c.operation==='stat').length,1)
  h.filesystem.readdir=async()=>({files:[{name:page.key+'.enc',type:'directory',size:page.bytes}]})
  await assert.rejects(repo.inspectAll([page]),code('KANATA_ARCHIVE_VERIFY_FAILED'))
  h.filesystem.readdir=async()=>({files:Array(2).fill({name:page.key+'.enc',type:'file',size:page.bytes})})
  await assert.rejects(repo.inspectAll([page]),code('KANATA_ARCHIVE_VERIFY_FAILED'))
  h.filesystem.readdir=async()=>{throw Error('synthetic denied')}
  await assert.rejects(repo.inspectAll([page]),code('KANATA_ARCHIVE_MISSING'))
})
