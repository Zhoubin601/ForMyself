// Only constructed with a fresh mkdtemp root owned by this harness.
import fs from 'node:fs/promises'
import path from 'node:path'
export function fileDriver(root) {
  const p=value=>{const result=path.resolve(root,value);if(!result.startsWith(root+path.sep))throw Error('QA_PATH_DENIED');return result}
  const counters={reads:0,bytes:0,writes:0}
  const stat=async({path:q})=>{const s=await fs.stat(p(q));return{type:s.isDirectory()?'directory':'file',size:s.size}}
  const filesystem={stat,
    async readFile({path:q}){const data=await fs.readFile(p(q),'utf8');counters.reads++;counters.bytes+=Buffer.byteLength(data);return{data}},
    async writeFile({path:q,data}){const h=await fs.open(p(q),'w');try{await h.writeFile(data,'utf8');await h.sync();counters.writes++}finally{await h.close()}},
    async mkdir({path:q}){await fs.mkdir(p(q),{recursive:true})},
    async rename({from,to}){await fs.rename(p(from),p(to))},
    async deleteFile({path:q}){await fs.unlink(p(q))},
    async readdir({path:q}){const entries=await fs.readdir(p(q));return{files:await Promise.all(entries.map(async name=>({name,...await stat({path:q+'/'+name})})))}}
  }
  const journal={
    async get(){try{return{value:await fs.readFile(p('recovery.enc'),'utf8')}}catch(e){if(e.code==='ENOENT')return{value:null};throw e}},
    async set({value}){const h=await fs.open(p('recovery.enc'),'w');try{await h.writeFile(value,'utf8');await h.sync()}finally{await h.close()}},
    async remove(){try{await fs.unlink(p('recovery.enc'))}catch(e){if(e.code!=='ENOENT')throw e}}
  }
  return {filesystem,journal,counters}
}
