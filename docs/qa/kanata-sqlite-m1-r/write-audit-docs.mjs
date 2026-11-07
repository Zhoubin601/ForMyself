import fs from 'node:fs/promises'
import {buildFieldMapping} from './field-mapping.mjs'
import {schemaHarness} from '../../../tests/helpers/kanataSqliteHarness.js'
import {migrateKanataSchema} from '../../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
const h=schemaHarness(),root='docs/qa/kanata-sqlite-m1-r/generated'
try{
 await migrateKanataSchema(h.connection);await fs.mkdir(root,{recursive:true})
 const tables=new Map(h.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'").all().map(r=>[r.name,new Set(h.db.prepare(`PRAGMA table_info(${r.name})`).all().map(c=>c.name))]))
 const rows=buildFieldMapping()
 for(const row of rows)for(const target of row.targets){const [table,column]=target.split('.');if(!tables.get(table)?.has(column))throw Error('UNMAPPED_FIELD '+row.field+' -> '+target)}
 const escape=s=>String(s).replaceAll('|','&#124;').replaceAll('\n',' ')
 const header=`# M1-R 逐字段映射（2026-11-07）

由真实TypeScript属性声明及人工审阅的映射规格生成；类型/可选性/来源行号均来自当前源码。**不是生产DTO转换器或M5导入实现**。SQL Schema目前为003，KanataData仍1/2，全备仍v13；没有“v4→v5已迁移”。旧小家v4不导入Kanata。

规则：必需值缺失/null按实际领域校验拒绝；可选列SQL NULL表示字段缺失，若旧类型不允许显式null则不能默默接受。JSON字段可把合法JSON null保留为文本null。归档只能由M5逐页验证后展开，不能用索引头伪造原文。

保真准备约定：extensions_json保留原字段名下的未知扩展；无ordinal的低频关系数组可在该owner的同名原字段保留顺序/空数组提示，读取必须与关系行交叉校验，**不能用JSON当权限或FK来源**。known字段同名提示不会与未知扩展键相撞。顶层可选集合可在dataset_metadata.extensions_json同名已知键保留出现标记；全局集合次序尚须M3/M5冻结，不宣称原JSON逐字节往返。M5仍需实现并验证投影/回读/批次内存与冲突检查，本轮只证明结构能保存相关值。

SQL长度以码点、领域JS长度以UTF16计，边界以现有领域校验为准；不借SQL单项CHECK放宽原限制。权限、CAS、审计与业务值原子命令归M2/M3，旧数据导入M5，备份改密M6。

| 旧实体/字段 | 旧类型及可选性 | SQL目标表/列 | 表达方式 | NULL/缺失/默认 | 校验与转换 | 保真限制 | 测试或源码证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
`
 const body=rows.map(r=>[r.field,r.type+(r.optional?'；可选':'；必需'),r.targets.length?r.targets.join(' / '):'不直接落列：请求或旧页验证输入',r.kind,r.nulls,r.validation,r.limits,r.evidence+'；tests/kanataSqliteMapping.test.js'].map(escape).join(' | ')).map(r=>'| '+r+' |').join('\n')
 const suffix=`

## 初始化与旧内容边界

- 默认世界：KanataData没有defaultWorldId字段，当前KanataWorldManager本地selectedWorldId优先非archived世界；Schema不自动造默认世界。M3/M5必须保留/冻结世界列表顺序与选择语义，不得仅按ID重排改变默认选择。
- 默认身份/实例/私聊：由presetCore或kanataManagementCore显式初始化，worlds.identity_id只是完整性约束，不代表数据已建立；卡版本锁定、实例覆盖及已有经历不能由迁移初始化覆盖。
- 旧virtualEvents来自chatRecords的旧摘要，按当前不迁旧小家决定**不导入**；即使未来另获保留摘要授权，也须明确legacy-summary，不能生成虚假message_id/sourceRefs或真实世界事实。
- 未知扩展只接受clone/assertKanataJson允许的普通JSON，无getter/prototype污染/循环/NaN/Infinity；角色卡原始payload、导入字节与头像按现有验证保留，不执行脚本。
- task.idempotency_key原字符串保留，不能因关系表无自然顺序重新拼接而改变幂等键。M3/M5须验证sourceRefs顺序提示与关系行一致。
`
 await fs.writeFile('docs/20261107-kanata-sqlite-m1-r-field-mapping-v1.md',header+body+suffix)
 await fs.writeFile(root+'/field-mapping.json',JSON.stringify(rows,null,2)+'\n')
 const fks=[]
 for(const [child] of tables){
  const groups=new Map()
  for(const f of h.db.prepare(`PRAGMA foreign_key_list(${child})`).all()){
   if(!groups.has(f.id))groups.set(f.id,[]);groups.get(f.id).push(f)
  }
  for(const [id,group] of groups){
   group.sort((a,b)=>a.seq-b.seq);const parent=group[0].table
   const reason=parent==='messages'?'保留原消息稳定ID、reply与旧revision来源；软删除清正文，不能级联审计/记忆/事件。':parent==='world_events'?'事件撤销/重建不是物删；保留effects、审计和因果引用。':parent==='worlds'?'世界归档/隐藏不擦除实例、会话及历史；物删需显式处理引用。':parent==='life_grants'?'撤权用flags/revision使来源失效，保留历史grant身份，不隐式擦除历史。':parent==='schema_migrations'?'升级日志与应用时间一一对应；普通改删被显式保护，不是M5 journal。':child==='role_bindings'?'绑定state与选择同时管理；world/instance允许失效选择，此处没有伪造额外FK。':parent==='card_versions'||parent==='character_cards'?'原卡版本与实例锁定版本分离；不能因更新当前版本删掉既有来源。':'关系存在时拒绝悬挂；可在领域允许时先显式解绑/删除自有明细，再删除无引用父项。'
   fks.push({caseId:'R6-PRAGMA-'+String(fks.length+1).padStart(3,'0'),parent,child,id,columns:group.map(f=>f.from),targetColumns:group.map(f=>f.to),onDelete:group[0].on_delete,onUpdate:group[0].on_update,recommendation:'保留NO ACTION；按引用/逻辑解绑语义显式处理，不自动CASCADE',reason,evidence:'PRAGMA foreign_key_list('+child+')；R6元数据全量断言；关键父项/叶子/延迟提交见M1-06、R6运行测试'})
  }
 }
 await fs.writeFile(root+'/foreign-keys.json',JSON.stringify(fks,null,2)+'\n')
 const fkHeader='# M1-R 外键删除语义（2026-11-07）\n\n逐条来自当前真实PRAGMA，默认NO ACTION不是CASCADE。下表验证全部定义；运行测试另覆盖关键父项拒删、合法叶子物删、显式解绑与延迟提交/回滚，不冒称每个nullable分支都独立执行了产品删除命令。软删除/归档/撤销与物理删除不同，生产命令仍在M2/M3/M6验收。\n\n| 用例 | 父表 | 子表 | 子列→父列 | 当前ON DELETE | 建议语义 | 领域理由 | 验证证据 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n'
 await fs.writeFile('docs/20261107-kanata-sqlite-m1-r-foreign-keys-v1.md',fkHeader+fks.map(f=>'| '+[f.caseId,f.parent,f.child,f.columns.join(',')+' → '+f.targetColumns.join(','),f.onDelete,f.recommendation,f.reason,f.evidence].map(escape).join(' | ')+' |').join('\n')+'\n')
 console.log(JSON.stringify({fieldRows:rows.length,foreignKeyRelations:fks.length,root}))
}finally{h.close()}
