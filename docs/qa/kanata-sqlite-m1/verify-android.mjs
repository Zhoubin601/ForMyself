// Run only with the operator's manifest for a disposable synthetic emulator.
import fs from 'node:fs/promises'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {KANATA_SCHEMA_MIGRATIONS} from '../../../src/features/chat/storage/sqlite/kanataSchema.js'
import {kanataSqliteFixture} from '../../../tests/helpers/kanataSqliteFixture.js'
const base=await fs.realpath('work/m0'),root=await fs.realpath(process.argv[2]??'')
if(!root.startsWith(base+path.sep)||!path.basename(root).startsWith('android-8.4.1-'))throw Error('QA_BUILD_DIR_DENIED')
const manifest=JSON.parse(await fs.readFile(process.argv[3]??'','utf8'))
if(manifest.syntheticOnly!==true||manifest.serial!=='emulator-5580'||!['kanata_m0_api34','kanata_m1_schema_api34'].includes(manifest.avdName))throw Error('QA_DEVICE_MANIFEST_DENIED')
const config=JSON.parse(await fs.readFile(path.join(root,'capacitor.config.json'),'utf8'))
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'))
if(config.appId!=='com.formyself.qa.m0'||pkg.name!=='kanata-sqlite-m0-isolated-qa'||pkg.dependencies?.['@capacitor/core']!=='8.4.1')throw Error('QA_BUILD_IDENTITY_DENIED')
const sdk=path.resolve(process.env.ANDROID_HOME??process.env.ANDROID_SDK_ROOT??'work/m0/android-sdk')
const adb=path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb')
const call=args=>execFileSync(adb,['-s',manifest.serial,...args],{encoding:'utf8',timeout:180000,stdio:['ignore','pipe','pipe']})
if(call(['emu','avd','name']).trim().split(/\r?\n/)[0]!==manifest.avdName)throw Error('QA_AVD_MISMATCH')
if(call(['shell','getprop','sys.boot_completed']).trim()!=='1'||call(['shell','getprop','ro.build.version.sdk']).trim()!=='34')throw Error('QA_BOOT_REQUIRED')
const dir=await fs.mkdtemp(path.join(base,'m1-android-'))
const apks=[path.join(root,'android/app/build/outputs/apk/debug/app-debug.apk'),path.join(root,'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk')]
const hashes=[]
for(const apk of apks){hashes.push(createHash('sha256').update(await fs.readFile(apk)).digest('hex'));call(['install','-r','-t',apk])}
const output=call(['shell','am','instrument','-w','-r','-e','class','com.formyself.qa.m0.SqlCipherM1SchemaTest','com.formyself.qa.m0.test/androidx.test.runner.AndroidJUnitRunner'])
await fs.writeFile(path.join(dir,'instrumentation.txt'),output)
const passed=/OK \(1 test\)/.test(output)&&!output.includes('FAILURES')&&!output.includes('INSTRUMENTATION_FAILED')
const bundle=JSON.parse(await fs.readFile(path.join(root,'android/app/src/androidTest/assets/kanata-m1-schema.json'),'utf8'))
const schemaSha256=createHash('sha256').update(JSON.stringify(KANATA_SCHEMA_MIGRATIONS)).digest('hex')
const fixtureSha256=createHash('sha256').update(JSON.stringify(kanataSqliteFixture())).digest('hex')
const identity=output.includes('M1_SCHEMA_SHA256='+schemaSha256)&&output.includes('M1_FIXTURE_SHA256='+fixtureSha256)&&bundle.schemaSha256===schemaSha256&&bundle.fixtureSha256===fixtureSha256
const result={status:passed&&identity?'PASS_NATIVE_DDL':'FAIL',avd:manifest.avdName,api:34,apkSha256:hashes[0],testApkSha256:hashes[1],schemaSha256:bundle.schemaSha256,
  fixtureSha256:bundle.fixtureSha256,jsMigrator:'NOT_TESTED_BY_NATIVE_JUNIT',productionIntegration:'NOT_CONNECTED',dir}
await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2));if(!passed||!identity)process.exitCode=1
