import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {patchFilesystemWebSource} from '../scripts/patch-capacitor-filesystem.mjs'

async function patchedWeb(){
  const source=await readFile(new URL('../node_modules/@capacitor/filesystem/dist/esm/web.js',import.meta.url),'utf8')
  const patched=patchFilesystemWebSource(source)
    .replace("import { WebPlugin, buildRequestInit } from '@capacitor/core';",'const WebPlugin=class {},buildRequestInit=()=>({});')
    .replace("import { Encoding } from './definitions';",'const Encoding={UTF8:"utf8",ASCII:"ascii",UTF16:"utf16"};')
    .replaceAll('IDBKeyRange.only(path)','path')
  const {FilesystemWeb}=await import('data:text/javascript;base64,'+Buffer.from(patched).toString('base64'))
  return new FilesystemWeb()
}

test('P7 Web filesystem listing reads at most four stored bodies concurrently while preserving every metadata field and order',async()=>{
  const fs=await patchedWeb(),entries=Array.from({length:13},(_,n)=>'/DATA/synthetic/file-'+n)
  let active=0,peak=0
  fs.dbIndexRequest=async(index,cmd,args)=>{assert.equal(index,'by_folder');assert.equal(cmd,'getAllKeys');assert.deepEqual(args,['/DATA/synthetic']);return entries}
  fs.dbRequest=async(cmd,[path])=>{
    assert.equal(cmd,'get')
    if(path==='/DATA/synthetic')return{type:'directory'}
    ++active;peak=Math.max(peak,active)
    await new Promise(resolve=>setTimeout(resolve,entries.indexOf(path)%3))
    --active
    const n=entries.indexOf(path)
    return{path,type:'file',size:100+n,ctime:1+n,mtime:2+n,content:'synthetic encrypted body excluded from metadata'}
  }
  const result=await fs.readdir({directory:'DATA',path:'synthetic'})
  assert.equal(peak,4);assert.equal(active,0)
  assert.deepEqual(result.files,entries.map((path,n)=>({name:'file-'+n,type:'file',size:100+n,ctime:1+n,mtime:2+n,uri:path})))
})

test('P7 failed Web listing settles its bounded batch, starts no later batch and never substitutes an empty list',async()=>{
  const fs=await patchedWeb(),reads=[]
  let active=0
  fs.dbIndexRequest=async()=>Array.from({length:12},(_,n)=>'/DATA/synthetic/'+n)
  fs.dbRequest=async(_cmd,[path])=>{
    if(path==='/DATA/synthetic')return{type:'directory'}
    reads.push(path);++active
    await new Promise(resolve=>setTimeout(resolve,path.endsWith('/0')?1:10))
    --active
    if(path.endsWith('/0'))throw Error('SYNTHETIC_IDB_READ_FAILED')
    return{type:'file',path,size:1}
  }
  await assert.rejects(fs.readdir({directory:'DATA',path:'synthetic'}),/SYNTHETIC_IDB_READ_FAILED/)
  assert.equal(reads.length,4);assert.equal(active,0)
})

test('P7 empty/missing folders and legacy slash-directory lookup keep the existing Web filesystem behavior',async()=>{
  const fs=await patchedWeb()
  fs.dbIndexRequest=async()=>[];fs.dbRequest=async()=>({type:'directory'})
  assert.deepEqual(await fs.readdir({directory:'DATA',path:'synthetic'}),{files:[]})
  fs.dbRequest=async()=>undefined
  await assert.rejects(fs.readdir({directory:'DATA',path:'synthetic'}),/Folder does not exist/)
  fs.dbIndexRequest=async()=>['/DATA/synthetic/sub']
  fs.dbRequest=async(_cmd,[path])=>path==='/DATA/synthetic'?{type:'directory'}:path.endsWith('/')?{type:'directory',size:0,path,ctime:1,mtime:2}:undefined
  assert.deepEqual((await fs.readdir({directory:'DATA',path:'synthetic'})).files,[{name:'sub',type:'directory',size:0,ctime:1,mtime:2,uri:'/DATA/synthetic/sub/'}])
})

test('P7 filesystem patch is idempotent for installed ESM/CJS/browser bundles and refuses incompatible or partial sources',async()=>{
  for(const file of ['dist/esm/web.js','dist/plugin.cjs.js','dist/plugin.js']){
    const source=(await readFile(new URL('../node_modules/@capacitor/filesystem/'+file,import.meta.url),'utf8')).replace(/\r\n/g,'\n')
    const patched=patchFilesystemWebSource(source)
    assert.equal(patchFilesystemWebSource(patched),patched)
  }
  assert.throws(()=>patchFilesystemWebSource('unsupported'),/Unsupported/)
  assert.throws(()=>patchFilesystemWebSource('// ForMyself: bound Web directory entry reads, including stored file contents.'),/Incomplete/)
})

test('P7 malformed directory keys reject instead of being treated as an empty directory',async()=>{
  const fs=await patchedWeb()
  fs.dbRequest=async()=>({type:'directory'})
  for(const invalid of [null,{},'synthetic-invalid-index',42]){
    fs.dbIndexRequest=async()=>invalid
    await assert.rejects(fs.readdir({directory:'DATA',path:'synthetic'}))
  }
})
