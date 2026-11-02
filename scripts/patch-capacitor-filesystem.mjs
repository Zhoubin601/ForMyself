import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const marker='// ForMyself: bound Web directory entry reads, including stored file contents.'
const loop=`if (!Array.isArray(entries)) throw Error('Invalid directory entry keys');
        const files = [];
        for (let start = 0; start < entries.length; start += 4) {
            const batch = await Promise.allSettled(entries.slice(start, start + 4).map(readEntry));
            const failure = batch.find(result => result.status === 'rejected');
            if (failure) throw failure.reason;
            for (const result of batch) files.push(result.value);
        }
        return { files: files };`

export function patchFilesystemWebSource(source){
  if(source.includes(marker)){
    if(!source.includes('entries.slice(start, start + 4).map(readEntry)')||!source.includes('if (failure) throw failure.reason;')||!source.includes("Array.isArray(entries)"))throw Error('Incomplete Filesystem Web bounded listing patch')
    return source
  }
  const expression=/^([ \t]*)const files = await Promise\.all\(entries\.map\(async \(e\) => \{([\s\S]*?)^\1\}\)\);\n\1return \{ files: files \};/gm
  const matches=[...source.matchAll(expression)]
  if(matches.length!==1||!matches[0][2].includes('size: subEntry.size')||!matches[0][2].includes("e + '/'"))throw Error('Unsupported Filesystem Web source; bounded listing patch not applied')
  return source.replace(expression,(_whole,indent,body)=>`${indent}${marker}\n${indent}const readEntry = async (e) => {${body}${indent}};\n${indent}${loop.replaceAll('\n        ','\n'+indent)}`)
    .replace(/^\/\/# sourceMappingURL=.*$/gm,'') // The package's original source map does not describe the patched method.
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const root=new URL('../node_modules/@capacitor/filesystem/',import.meta.url)
  const manifest=JSON.parse(await readFile(new URL('package.json',root),'utf8'))
  if(manifest.version!=='8.1.2')throw Error('Unsupported Filesystem version; review bounded listing patch before upgrading')
  // Prepare all three formats before changing any of them. npm ci/postinstall is reproducible;
  // no application database, native implementation or encrypted file layout changes.
  const changes=[]
  for(const file of ['dist/esm/web.js','dist/plugin.cjs.js','dist/plugin.js']){
    const path=new URL(file,root),original=(await readFile(path,'utf8')).replace(/\r\n/g,'\n')
    changes.push({path,original,updated:patchFilesystemWebSource(original)})
  }
  for(const {path,original,updated} of changes)if(updated!==original)await writeFile(path,updated)
  console.log('Filesystem Web bounded directory listing patch verified.')
}
