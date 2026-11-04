// Optional restricted-cloud installation workaround. Exact root lock versions and
// integrities are retained. Only mirror tarball origin changes in a TEMP copy.
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
const root=process.cwd(),work=path.resolve('work/m0/deps')
try{await fs.lstat('node_modules');throw Error('QA_NODE_MODULES_EXISTS_USE_EXISTING_OR_FRESH_CHECKOUT')}catch(e){if(e.code!=='ENOENT')throw e}
await fs.mkdir(work,{recursive:true})
await fs.copyFile('package.json',path.join(work,'package.json'))
await fs.cp('scripts',path.join(work,'scripts'),{recursive:true})
const lock=JSON.parse(await fs.readFile('package-lock.json','utf8'))
for(const p of Object.values(lock.packages)){if(p.resolved?.startsWith('https://registry.npmmirror.com/'))p.resolved=p.resolved.replace('https://registry.npmmirror.com/','https://registry.npmjs.org/')}
await fs.writeFile(path.join(work,'package-lock.json'),JSON.stringify(lock,null,2)+'\n')
const result=spawnSync('npm',['ci','--registry=https://registry.npmjs.org'],{cwd:work,stdio:'inherit'})
if(result.status!==0)process.exit(result.status??1)
await fs.symlink(path.relative(root,path.join(work,'node_modules')),'node_modules','dir')
