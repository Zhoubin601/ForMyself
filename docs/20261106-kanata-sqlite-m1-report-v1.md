# Kanata SQLite M1：Schema、约束与版本升级

日期：2026-11-06（北京时间）。分支M，基线bda1a58。用户要求“拉取吧，继续开发”，已在工作区干净、无分叉时快进到远端M；读取更新后的计划、规范、真实类型/校验器和M0放行记录后开始M1。

**结论：M1 BLOCKED（Android新增Schema设备运行）。** 结构、升级器、真实SQLite与主机SQLCipher测试已实现并通过，Android QA App/Test构建通过。两套隔离AVD均在启动前被磁盘空间预检拒绝，没有设备结果。M0既有PASS不变；本轮不以编译成功或旧M0设备结果放行M1，不进入M2。

## 实现与结构

- [DDL定义](../src/features/chat/storage/sqlite/kanataSchema.js)：47张表、114个触发器、36个显式索引，另有SQLite为PK/UNIQUE生成的内部索引。
- [升级器](../src/features/chat/storage/sqlite/kanataSchemaMigrator.js)：可注入独占事务，无插件、路径、凭据或业务Store依赖。
- [接口](../src/features/chat/storage/sqlite/kanataSchemaTypes.d.ts)、[strict正负样例](../tests/types/kanataSqlite.ts)、[常规行为/故障测试](../tests/kanataSqliteSchema.test.js)。
- [完整目录JSON](qa/kanata-sqlite-m1/evidence/schema-catalog.json)包含每张表的DDL、column NOT NULL/PK、全部外键和索引列；[生成SQL](qa/kanata-sqlite-m1/evidence/schema.sql)可逐行审查CHECK、状态枚举和触发器。二者由同一源定义生成，不是另一套手写Schema。

以下映射按当前`kanataTypes.d.ts`、`kanataValidation`、`experienceValidation`、`autonomyValidation`及CompletionAttempt核对。所有高频作用域、关联、状态、revision、时间和分页字段为独立列。主记录`extensions_json`留给未映射的低频/未知扩展；不在其中保存消息集合或替代关联字段。

| 当前集合/字段 | SQL表 | 映射及主要约束 |
| --- | --- | --- |
| type/version/userId、顶层扩展 | dataset_metadata | singleton=1、user_id唯一、data_version限1/2；SQL版本另计；type为固定领域常量 |
| worlds | worlds | name/rules/timeZone/revision/水位/开关/mode/archived；identity_id延迟外键确保一世界一身份；presetSourceId/version留扩展 |
| cards/cardVersions | character_cards、card_versions | 当前版本必须属于同一卡；card+revision唯一；definition/rawData/imported独立JSON，原卡未知字段原样保留；presetKey唯一 |
| identities/instances | world_identities、character_instances、participants | 身份user_id引用dataset；世界身份唯一；实例卡版本所属卡一致；overrides JSON、state独立列；participants由真实身份/实例派生且有类型外键 |
| conversations/participantIds | conversations、conversation_participants | 类型/mode/revision/readAt独立列；成员唯一、有序、世界/身份类型复合FK；replyLimits/replyTiming可选成组边界CHECK |
| messages | messages | 世界/会话/发言者成员复合FK、role与senderType匹配；ID/revision/status/turn/batch/snapshot/content/time独立列；reply同世界同会话、不能自引、revision不能来自未来 |
| lorebookEntries | lorebook_entries、lorebook_known_by | world/character/system作用域与owner约束；激活/priority/enabled/caseSensitive独立列；keys/secondaryKeys JSON；knownBy世界内成员FK |
| memories | memories、memory_known_by、memory_sources、memory_events、memory_links、memory_life_sources | owner/layer/key/status/visibility/conversation等独立列；message+原revision来源、事件、知情者、冲突/共享/替代关系均独立引用；共享父链禁环、单父节点 |
| relationships | relationships、relationship_events | 同世界有向成员边、禁止自关系、world/from/to唯一；kind、baseline、三维数值与规则版本独立；sourceEventIds复合FK |
| events | world_events、event_participants、event_sources、event_causes、event_life_sources | 状态/visibility/effective/recorded/revision及action目标/替代事件独立列；参与者/消息来源/因果关系世界内FK，因果禁环 |
| effects/effectBaselines | world_effects、effect_baselines | event和目标类型对应真实world/instance/relationship；候选事件不能产生effect；increment只接受JSON数值；baseline唯一并检查现有允许路径/数值范围 |
| tasks | background_tasks、task_sources、task_result_events、task_result_memories、task_social_participants | world+kind+idempotencyKey唯一；state/attempt/lease/时间/目标独立；源与结果复合FK；social.windowTaskId、deferredReply消息/revision/expiry、notificationId独立；其余可变元数据保存在metadata_json |
| lifeGrants及messages/memories/events.lifeSources | life_grants、message_life_sources、memory_life_sources、event_life_sources | world+instance+module唯一；read/remember/share三个必填独立布尔；历史来源精确绑定grant/instance/module/revision/fingerprint，禁止未来revision |
| presetApplications | preset_applications | initializationKey与world各自唯一；来源/版本独立列，来源与世界preset的业务一致性仍做领域校验 |
| usageEvents | usage_events | 请求attempt ID全局唯一，真实世界/会话/角色成员FK；model、transport、status/time、真实/估计Token、缓存、purpose独立；pending与finishedAt及usage空值组合CHECK；不保存请求正文/Key |
| messageAudits/eventAudits | message_audits、event_audits | 世界/实体FK、at、previous/next revision及完整JSON快照；ID/world/revision匹配、next>previous且不超当前；消息快照发言者必须为对应世界会话成员 |
| roleBindings | role_binding_state、role_bindings | revision、global与七模块选择；保留null/未配置区别；按当前契约允许失效ID留存，运行时禁止按名字重选，不伪造“必须存在”的FK |
| memoryPolicies/autonomyPolicies | memory_policies、autonomy_policies | 每世界一条；所有现有数值区间、策略/自由度与开关独立列和CHECK；socialChannel可空 |
| virtualSchedules/days | virtual_schedules、virtual_schedule_days | 实例世界FK；星期唯一且1–7、时间区间、revision、地点/活动/resting独立列 |
| messageArchives | 不复制为SQL业务表 | 这是旧存储描述，不是新业务消息；M5应逐页验证并展开为messages，旧页只读保留。本轮未实现/执行导入 |
| Schema/数据迁移进度 | schema_migrations、data_migrations | Schema日志version/name/SHA256；数据迁移预留源指纹/目标版本/collection/cursor/count/state，未创建M5导入器 |
| 全局稳定ID | entity_ids | 由实际主记录触发器维护；显式RAISE阻断跨表重复，OR IGNORE/REPLACE不能绕过；实际FK始终引用真实类型表 |

可选布尔/secondaryKeys用NULL表示旧字段不存在，区别于显式false/空数组。角色卡rawData可以是任意合法JSON，未知对象不执行脚本。M5还须明确顶层可选集合的出现信息、扩展投影与逐字段回读；本阶段的测试夹具投影器只服务合成测试，不是生产迁移器。

数据库不是全部领域规则的替代品：完整群成员人数、有效IANA时区、知情权限、生活三权限的当前有效性、event action参与关系、effects闭集路径、日程互斥/总量、自治元数据组合等仍由现有领域校验器在命令事务前/内验证。旧revision允许存在但不能自动充当当前有效知识。消息修订的CAS、审计与派生stale/needsReview原子提交属于M2/M3；本轮不虚报这些业务命令已实现。

## 版本与失败语义

首个SQL版本链：001 `kanata-core`（表和全部安全防护），002 `kanata-access-indexes`。不等同于KanataData 1/2或全量备份v13。尚未接入生产，未来演进只能追加版本，不修改已实际发布使用的migration。

进入升级器前，Driver必须已有有效受保护租约、解密连接且foreign_keys=ON；`transaction`独占BEGIN IMMEDIATE，结算所有回调及COMMIT异常后回滚。升级器不保留连接、密钥、用户记录或业务快照。M2业务驱动需另提供CAS/affectedRows，不能把这个DDL接口当完整Repository。

在事务内先读user_version；未来版本固定返回`KANATA_SCHEMA_FUTURE_VERSION`，零DDL/记录写入。已有库同时核对application_id、完整sqlite_schema与每版日志SHA256；陌生库、不完整表、被改日志、丢索引均拒绝，不用IF NOT EXISTS掩盖错误，不自动删除/降级/覆盖。新建必须是确实空库。待升级的全部版本与日志、user_version、application_id一起提交；失败重启后从原版本重试。升级后执行原生外键检查，只返回至多一条错误，不将整表结果带入JS。

驱动异常统一映射`KANATA_SCHEMA_MIGRATION_FAILED`，不暴露原生SQL或参数正文；结构/日志/外键错误有独立稳定错误码。恢复策略是保留原库、使用正确支持版本或重试故障，不是初始化空世界。此处SHA256用于结构/版本一致性，不替代SQLCipher和密钥信封的认证保护。

## 本轮验证

执行环境Linux x86_64、Node24.19.0，内建SQLite3.53.3；额外host SQLCipher4.12.0/SQLite3.51.1。Android编译为Capacitor8.4.1与SQLCipher4.17.0；两个主机版本均不冒充Android运行结果。没有新增/升级生产package或lock。

实际命令、设备尝试和原始记录见[commands](qa/kanata-sqlite-m1/commands.md)、[QA入口](qa/kanata-sqlite-m1/README.md)。
可机读的阶段结论、测试数、202个故障点和源码SHA256见[verification-summary.json](qa/kanata-sqlite-m1/evidence/verification-summary.json)。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| M0历史证据离线校验 | PASS，不是重跑设备 | validate-results.mjs与validate-direct-gate.mjs本轮实际执行 |
| M1真实SQLite结构/负向/故障 | 15项PASS | [Node输出](qa/kanata-sqlite-m1/evidence/schema-tests.txt)；含所有升级写入点故障、v1原字节回滚、实际SIGKILL |
| 主机SQLCipher同一JS升级器/DDL | 10组检查PASS | [结果/指纹](qa/kanata-sqlite-m1/evidence/sqlcipher-host.json) |
| npm run check | PASS：605 Node、392组件/42文件、两类类型检查、生产构建；lint 0错误/42既有警告 | [完整输出](qa/kanata-sqlite-m1/evidence/check.txt) |
| Android App/Test构建 | PASS | [Gradle输出](qa/kanata-sqlite-m1/evidence/android-build.txt)、[APK摘要](qa/kanata-sqlite-m1/evidence/android-artifacts.json) |
| Android新Schema运行 | BLOCKED / NOT RUN | [M0 AVD尝试](qa/kanata-sqlite-m1/evidence/emulator-m0-blocked.txt)、[新M1 AVD尝试](qa/kanata-sqlite-m1/evidence/emulator-m1-blocked.txt) |

Node升级故障在空库对每一个DDL、日志和版本写入点逐次注入；新连接全部可重试。另对已持久化v1的索引/日志/版本/COMMIT故障检查原DB逐字节不变。真实子进程在DDL事务中被SIGKILL，重新打开观察版本0/无半套表并成功升级。两连接写锁不能交错。来源旧revision保留，未来/回退/错发言/错role/重复/孤儿/跨世界/环均拒绝；同时间戳keyset分页命中`messages_scope_time`，没有OFFSET。

本轮不重新执行M0三档性能基准，也不声明完整Schema达到M0裸原型的性能数字。新增约束/触发器的成本需在后续Repository与M7同机复测，原Android512MiB、完整改密120秒、Web768MiB门槛不变。

## 两轮自查与修正

第一轮聚焦技术、结构与失败：首次空库冒烟发现生成DDL将列放到表约束之后，修正顺序后重跑真实SQLite；strict类型接入暴露辅助函数隐式any，补齐JSDoc参数而未关闭检查，保留[首次严格类型失败](qa/kanata-sqlite-m1/evidence/strict-types-first-failure.txt)。同时把全部安全触发器放入v1，避免v1写入缺少revision防护；新增延迟任务/social父任务显式FK和审计发言者检查。正常/非法/事务/重启测试复测通过。

第二轮聚焦需求、绕过与证据：发现仅靠registry UNIQUE可能受外层OR IGNORE/REPLACE策略影响，改为BEFORE INSERT显式RAISE并加入真实负向回归；把跨世界来源用例拆成合法拥有者/非法目标及相反方向；升级失败从抽样扩展到所有写入点，再补已有v1逐字节回滚。发现可选布尔默认值会丢失字段缺省信息，改为NULL并修复相应CHECK的NULL逻辑，增加未带revision的编辑/删除拒绝。Android驱动要求实际JUnit输出Schema/夹具指纹并与当前源码匹配，避免陈旧APK冒充新测试。最后重跑定向、SQLCipher、构建和全量check。

## 阻塞与接续

云环境根盘约7.9GiB，初始空闲约1.7GiB。已只清理本会话下载的Gradle发行包docs/src（可再生工具内容），空闲约2.0GiB；原M0 AVD仍被模拟器37.2.13磁盘预检拒绝。另建1GiB数据分区的全新`kanata_m1_schema_api34`尝试也在相同预检阶段拒绝。没有绕过资源检查、安全配置或使用真实设备测试。M0配置临时核对后已恢复原字节，旧合成数据未删除；新AVD未启动成功、无挂起instrumentation，ADB设备列表为空。

补齐条件：在有足够磁盘的云环境或已确认本地合成AVD，按QA说明运行新增`SqlCipherM1SchemaTest`并保留匹配Schema/夹具/APK摘要的原始结果。若发现Android差异，修复源定义并重跑同一主机与设备检查；通过后再放行M1。不要修改已有M0 PASS来掩盖本轮缺项。

生产Store/旧JSON/归档/全局密码/备份恢复/Android生产项目未变；无真实用户资料读取或删除、无正式APK发布、未合并其他分支、未推送本轮改动。后续从本报告和未提交M1代码接续，先完成设备门禁，再实施M2。
