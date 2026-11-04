// Only generated QA project, never production android/.
import fs from 'node:fs/promises'
const manifest='android/app/src/main/AndroidManifest.xml'
let xml=await fs.readFile(manifest,'utf8')
xml=xml.replace('android:allowBackup="true"','android:allowBackup="false" android:fullBackupContent="false" android:dataExtractionRules="@xml/m0_extraction_rules"')
await fs.writeFile(manifest,xml)
await fs.writeFile('android/app/src/main/res/xml/m0_extraction_rules.xml','<?xml version="1.0" encoding="utf-8"?><data-extraction-rules><cloud-backup><exclude domain="root"/><exclude domain="database"/><exclude domain="sharedpref"/><exclude domain="external"/></cloud-backup><device-transfer><exclude domain="root"/><exclude domain="database"/><exclude domain="sharedpref"/><exclude domain="external"/></device-transfer></data-extraction-rules>')
const gradle='android/app/build.gradle'
let text=await fs.readFile(gradle,'utf8')
if(!text.includes('// M0 isolated native encryption test'))text+='\n// M0 isolated native encryption test\ndependencies { androidTestImplementation "net.zetetic:sqlcipher-android:4.17.0@aar" }\n'
text=text.replaceAll('androidx.sqlite:sqlite:2.6.2','androidx.sqlite:sqlite:2.4.0')
if(!text.includes('androidx.sqlite:sqlite:2.4.0'))text+='\ndependencies { androidTestImplementation "androidx.sqlite:sqlite:2.4.0" }\n'
await fs.writeFile(gradle,text)
const testDir='android/app/src/androidTest/java/com/formyself/qa/m0'
await fs.mkdir(testDir,{recursive:true})
for(const file of ['SqlCipherM0Test.java','SqlCipherM0SessionTest.java','M0KeystoreTest.java'])await fs.copyFile(file,testDir+'/'+file)
