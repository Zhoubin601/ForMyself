import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {KANATA_SCHEMA_MIGRATIONS as migrations,KANATA_SCHEMA_APPLICATION_ID as applicationId,KANATA_REGISTRY_VALIDATION_QUERIES} from '../../../src/features/chat/storage/sqlite/kanataSchema.js'
import {KANATA_AUDIT_VALIDATION_QUERIES as auditValidationQueries} from '../../../src/features/chat/storage/sqlite/kanataSchemaHardening.js'
import {kanataFixtureCommands,kanataSqliteFixture,insertSql} from '../../../tests/helpers/kanataSqliteFixture.js'
const legacyValidationQueries=[...auditValidationQueries,...KANATA_REGISTRY_VALIDATION_QUERIES]
const work=await fs.realpath('work/m0'),root=await fs.realpath(process.argv[2]??'')
if(!root.startsWith(work+path.sep)||!path.basename(root).startsWith('android-8.4.1-'))throw Error('QA_BUILD_DIR_DENIED')
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')),config=JSON.parse(await fs.readFile(path.join(root,'capacitor.config.json'),'utf8'))
if(pkg.name!=='kanata-sqlite-m0-isolated-qa'||pkg.dependencies?.['@capacitor/core']!=='8.4.1'||config.appId!=='com.formyself.qa.m0')throw Error('QA_BUILD_IDENTITY_DENIED')
const data=kanataSqliteFixture(),commands=kanataFixtureCommands(data),a=commands.find(c=>c.sql.startsWith('INSERT INTO message_audits('))
const columns=a.sql.split('(')[1].split(')')[0].split(','),row=Object.fromEntries(columns.map((key,i)=>[key,a.parameters[i]]))
const other=data.conversations.find(c=>c.worldId===data.worlds[0].id&&c.id!==data.conversations[0].id&&c.participantIds.includes(data.identities[0].id)).id
const rejected=[
 insertSql('message_audits',{...row,id:'bad-conversation',previous_json:JSON.stringify({...JSON.parse(row.previous_json),conversationId:other})}),
 insertSql('message_audits',{...row,id:'duplicate-audit'}),
 ...["DELETE FROM entity_ids WHERE id='message-audit-one'","UPDATE entity_ids SET table_name='memories' WHERE id='message-audit-one'","INSERT OR REPLACE INTO entity_ids VALUES('message-audit-one','memories')","INSERT INTO entity_ids VALUES('orphan','memories')",'UPDATE message_audits SET at=at+1','DELETE FROM message_audits','DELETE FROM event_audits','UPDATE event_audits SET at=at+1',
  'UPDATE memory_sources SET message_revision=99',"UPDATE messages SET revision=1 WHERE id='message-one'"].map(sql=>({sql,parameters:[]}))
]
const nextAudit=insertSql('message_audits',{...row,id:'rollback-audit',previous_revision:2,next_revision:3,previous_json:row.next_json,next_json:JSON.stringify({...JSON.parse(row.next_json),revision:3,content:'rollback'})})
const bundle={applicationId,migrations:migrations.map(m=>({...m,checksum:createHash('sha256').update(JSON.stringify([m.version,m.name,m.statements])).digest('hex')})),legacyValidationQueries,commands,rejected,nextAudit,
 redact:"UPDATE message_audits SET previous_json=json_set(previous_json,'$.content','（已删除的原始记录）','$.deleted',json('true')),next_json=json_set(next_json,'$.content','（已删除的原始记录）','$.deleted',json('true'))",
 schemaSha256:createHash('sha256').update(JSON.stringify(migrations)).digest('hex'),fixtureSha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')}
const tests=path.join(root,'android/app/src/androidTest');await fs.mkdir(path.join(tests,'assets'),{recursive:true})
await fs.writeFile(path.join(tests,'assets/kanata-m1-r.json'),JSON.stringify(bundle))
await fs.copyFile(new URL('./SqlCipherM1RTest.java',import.meta.url),path.join(tests,'java/com/formyself/qa/m0/SqlCipherM1RTest.java'))
console.log(JSON.stringify({root,schemaSha256:bundle.schemaSha256,fixtureSha256:bundle.fixtureSha256,nativeRun:'NOT_RUN_BY_PREPARATION'}))
