import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'

const root=await fs.realpath(path.resolve('work/m0'))
const project=await fs.realpath(path.resolve(process.argv[2]))
if(!project.startsWith(root+path.sep)||!path.basename(project).startsWith('android-8.4.1-'))throw Error('QA_BUILD_DIR_DENIED')
const config=JSON.parse(await fs.readFile(path.join(project,'capacitor.config.json'),'utf8'))
if(config.appId!=='com.formyself.qa.m0')throw Error('QA_BUILD_IDENTITY_DENIED')
const productionArchive='android/app/src/main/java/com/yubin/formyself'
const nativeArchive=path.join(project,productionArchive)
await fs.mkdir(nativeArchive,{recursive:true})
for(const name of ['ArchiveFileBatchStore.java','ArchiveFileBatchPlugin.java']){
  await fs.copyFile(path.join(productionArchive,name),path.join(nativeArchive,name))
}
const qaJava=path.join(project,'android/app/src/main/java/com/formyself/qa/m0')
await fs.copyFile(new URL('./prototype/M0DirectPlugin.java',import.meta.url),path.join(qaJava,'M0DirectPlugin.java'))
const gradleFile=path.join(project,'android/app/build.gradle')
const gradle=await fs.readFile(gradleFile,'utf8')
const sqlcipherDependency='dependencies { implementation "net.zetetic:sqlcipher-android:4.17.0@aar"; implementation "androidx.sqlite:sqlite:2.4.0" }'
if(!gradle.includes(sqlcipherDependency))await fs.appendFile(gradleFile,'\n'+sqlcipherDependency+'\n')
await fs.writeFile(path.join(project,'android/app/src/main/java/com/formyself/qa/m0/MainActivity.java'),`package com.formyself.qa.m0;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.yubin.formyself.ArchiveFileBatchPlugin;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(ArchiveFileBatchPlugin.class);
        registerPlugin(M0DirectPlugin.class);
        super.onCreate(state);
    }
}
`)
await fs.mkdir(path.join(project,'scripts'),{recursive:true})
await fs.copyFile('scripts/patch-capacitor-preferences.mjs',path.join(project,'scripts/patch-capacitor-preferences.mjs'))
const htmlFile=path.join(project,'www/index.html')
const html=await fs.readFile(htmlFile,'utf8')
await build({
  entryPoints:[fileURLToPath(new URL('./target-benchmark.mjs',import.meta.url))],
  outfile:path.join(project,'www/target-benchmark.js'),
  nodePaths:[path.join(project,'node_modules')],
  bundle:true,format:'esm',target:'chrome113',
  plugins:[{
    name:'exclude-host-fixture-hash',
    setup(builder){
      builder.onResolve({filter:/^node:crypto$/},args=>{
        if(path.basename(args.importer)==='dataset.mjs')return {path:args.path,namespace:'host-fixture-only'}
      })
      builder.onLoad({filter:/.*/,namespace:'host-fixture-only'},()=>({
        contents:'export function createHash() { throw Error("QA_HOST_ONLY"); }'
      }))
    }
  }]
})
const tag='<script type="module" src="target-benchmark.js"></script>'
if(!html.includes(tag))await fs.writeFile(htmlFile,html.replace('</body>',tag+'</body>'))
