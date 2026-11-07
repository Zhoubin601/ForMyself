import fs from 'node:fs/promises'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {KANATA_SCHEMA_MIGRATIONS} from '../../../src/features/chat/storage/sqlite/kanataSchema.js'
import {kanataSqliteFixture} from '../../../tests/helpers/kanataSqliteFixture.js'
const work=await fs.realpath('work/m0'),root=await fs.realpath(process.argv[2]??'')
if(!root.startsWith(work+path.sep)||!path.basename(root).startsWith('android-8.4.1-'))throw Error('QA_BUILD_DIR_DENIED')
const m=JSON.parse(await fs.readFile(process.argv[3]??'','utf8')),pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')),config=JSON.parse(await fs.readFile(path.join(root,'capacitor.config.json'),'utf8'))
if(m.syntheticOnly!==true||m.serial!=='emulator-5580'||m.avdName!=='kanata_m1_schema_api34'||pkg.name!=='kanata-sqlite-m0-isolated-qa'||pkg.dependencies?.['@capacitor/core']!=='8.4.1'||config.appId!=='com.formyself.qa.m0')throw Error('QA_IDENTITY_DENIED')
const sdk=path.resolve(process.env.ANDROID_HOME??process.env.ANDROID_SDK_ROOT??'work/m0/android-sdk'),adb=path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb')
const commands=[],call=args=>{commands.push(args);return execFileSync(adb,['-s',m.serial,...args],{encoding:'utf8',timeout:180000,stdio:['ignore','pipe','pipe']})}
if(call(['emu','avd','name']).trim().split(/\r?\n/)[0]!==m.avdName||call(['shell','getprop','sys.boot_completed']).trim()!=='1'||call(['shell','getprop','ro.build.version.sdk']).trim()!=='34')throw Error('QA_BOOT_OR_AVD_DENIED')
const dir=await fs.mkdtemp(path.join(work,'m1-r-native-')),hashes=[]
for(const file of ['debug/app-debug.apk','androidTest/debug/app-debug-androidTest.apk']){
 const apk=path.join(root,'android/app/build/outputs/apk',file);hashes.push(createHash('sha256').update(await fs.readFile(apk)).digest('hex'));call(['install','-r','-t',apk])
}
const output=call(['shell','am','instrument','-w','-r','-e','class','com.formyself.qa.m0.SqlCipherM1RTest','com.formyself.qa.m0.test/androidx.test.runner.AndroidJUnitRunner'])
await fs.writeFile(path.join(dir,'instrumentation.txt'),output)
const schemaSha256=createHash('sha256').update(JSON.stringify(KANATA_SCHEMA_MIGRATIONS)).digest('hex'),fixtureSha256=createHash('sha256').update(JSON.stringify(kanataSqliteFixture())).digest('hex')
const pass=output.includes('OK (1 test)')&&!output.includes('FAILURES')&&output.includes('M1R_SCHEMA_SHA256='+schemaSha256)&&output.includes('M1R_FIXTURE_SHA256='+fixtureSha256)&&output.includes('M1R_CIPHER_VERSION=4.17.')
const result={status:pass?'PASS_NATIVE_DDL_M1_R':'FAIL',schemaSha256,fixtureSha256,apkSha256:hashes[0],testApkSha256:hashes[1],avd:m.avdName,api:34,
 scope:'native DDL/constraints/v2->v3 rollback/reopen only; no JS migration, clock execution or production Driver',dir,commands}
await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(!pass)process.exitCode=1
