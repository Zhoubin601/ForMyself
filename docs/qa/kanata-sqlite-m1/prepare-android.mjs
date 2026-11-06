// Add the exact M1 DDL and synthetic commands to an existing isolated M0 QA project.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {KANATA_SCHEMA_MIGRATIONS as migrations,KANATA_SCHEMA_APPLICATION_ID as applicationId} from '../../../src/features/chat/storage/sqlite/kanataSchema.js'
import {kanataSqliteFixture,kanataFixtureCommands,insertSql} from '../../../tests/helpers/kanataSqliteFixture.js'
const base=await fs.realpath('work/m0'),root=await fs.realpath(process.argv[2]??'')
if(!root.startsWith(base+path.sep)||!path.basename(root).startsWith('android-8.4.1-'))throw Error('QA_BUILD_DIR_DENIED')
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'))
if(pkg.name!=='kanata-sqlite-m0-isolated-qa'||pkg.dependencies['@capacitor/core']!=='8.4.1')throw Error('QA_BUILD_IDENTITY_DENIED')
const config=JSON.parse(await fs.readFile(path.join(root,'capacitor.config.json'),'utf8'))
if(config.appId!=='com.formyself.qa.m0')throw Error('QA_PACKAGE_DENIED')
const data=kanataSqliteFixture(),w=data.worlds[0].id,w2=data.worlds[1].id
const rejected=[
  insertSql('conversation_participants',{world_id:w,conversation_id:data.conversations[0].id,participant_id:data.instances.find(i=>i.worldId===w2).id,kind:'character',ordinal:10}),
  insertSql('memory_sources',{world_id:w2,memory_id:'memory-one',message_id:'message-one',message_revision:1}),
  insertSql('event_sources',{world_id:w2,event_id:'event-one',message_id:'message-one',message_revision:1}),
  ...['UPDATE memory_sources SET message_revision=3','UPDATE event_sources SET message_revision=3',"UPDATE messages SET revision=1 WHERE id='message-one'",'UPDATE life_grants SET can_share=2',"UPDATE messages SET content='unversioned' WHERE id='message-one'"].map(sql=>({sql,parameters:[]}))
]
const bundle={applicationId,migrations:migrations.map(m=>({...m,checksum:createHash('sha256').update(JSON.stringify([m.version,m.name,m.statements])).digest('hex')})),
  schemaSha256:createHash('sha256').update(JSON.stringify(migrations)).digest('hex'),fixtureSha256:createHash('sha256').update(JSON.stringify(data)).digest('hex'),
  commands:kanataFixtureCommands(data),rejected,worldId:w,conversationId:data.conversations[0].id}
const testRoot=path.join(root,'android/app/src/androidTest')
await fs.mkdir(path.join(testRoot,'assets'),{recursive:true})
await fs.writeFile(path.join(testRoot,'assets/kanata-m1-schema.json'),JSON.stringify(bundle))
const java=path.join(testRoot,'java/com/formyself/qa/m0')
await fs.mkdir(java,{recursive:true})
await fs.copyFile(new URL('./SqlCipherM1SchemaTest.java',import.meta.url),path.join(java,'SqlCipherM1SchemaTest.java'))
console.log(JSON.stringify({root,schemaSha256:bundle.schemaSha256,fixtureSha256:bundle.fixtureSha256,deviceRun:'NOT_RUN_BY_PREPARATION'}))
