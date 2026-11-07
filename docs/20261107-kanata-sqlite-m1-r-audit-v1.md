# Kanata SQLite M1-R 审计、修复与交接 v1

日期：2026-11-07（Asia/Shanghai）。任务依据：[M1-R任务书](20261106-kanata-sqlite-m1-r-remediation-task-v1.md)、根AGENTS/开发说明书、总迁移计划及实际类型/源码。首次检查在M、工作区干净，`a753ad3`；fetch后仅落后远端一个任务书提交，ff-only到`a33eda7c608c425f144cfb861f60dba2e3e85422`。之后HEAD未变，本次修复均为本地未提交文件，没有推送。原M1 v2 PASS、v1 BLOCKED及原始证据保留。

正式交付：[本地验收报告](../output/20261107-kanata-sqlite-m1-r-acceptance-v1.md)（output按规则忽略）。[QA命令/边界](qa/kanata-sqlite-m1-r/README.md)、[机器验收及指纹](qa/kanata-sqlite-m1-r/evidence/verification-summary.json)。不接通生产Driver/Repository/Store，不进入M2。

## 六项核查

| 项 | 真实现状/复现 | 根因与本轮最小处理 | 结果与证据 | 风险/后续责任 |
| --- | --- | --- | --- | --- |
| R1 应用时间 | 原日志仅version/name/checksum，不能追溯执行时间 | 追加003应用时间表；JS每版本DDL完成采样，整链提交才持久；已存在001/002明确NULL/legacy-unrecorded；日志与时间防改删/替换 | PASS；R1-01～04、24点旧v2故障、SIGKILL；001/002 checksum与旧目录逐一相同 | UTC Unix毫秒、毫秒表示精度；不是物理COMMIT时刻，系统时钟可回拨/不准，不据此判revision顺序 |
| R2 location空值 | 原实例TEXT NOT NULL已接受空串/空白；NULL/缺失拒绝；日程空串拒绝；可选事件位置空串/缺省可表达 | NOT-A-DEFECT；不改location DDL，不造默认地点；补域校验、SQL、边界、重复迁移测试 | R2、原生Android；修复前后探针一致 | SQL NULL是事件字段缺省，不能放宽JS显式null；move命令的非空要求归M3 |
| R3 revision历史 | 原触发器校验世界/ID/revision/成员，但同世界另一合法会话快照可写；全局ID登记可被直接移除，随后不同实体可复用审计ID | 003把快照会话/发言者/role/createdAt绑定实际消息身份，校验正文/删除标记类型；registry双向预检及触发器维护所有权 | PASS；原快照ALLOW→现REJECT，保留连续/缺口/乱序真实记录；global registry复现原结果两个实体同ID，已补负例 | SQL不恢复丢失历史；新内容与旧快照不同是合法状态；CAS/派生失效仍M2/M3 |
| R4 不可变/顺序/事务 | 原同revision可重复，普通UPDATE/DELETE可篡改审计 | 003拒绝重叠区间/重复、普通改删；事件审计只追加；消息仅允许实际P5所需的不可逆正文脱敏；版本日志也不可篡改 | PASS；OR REPLACE/IGNORE、错误世界、rollback、两类真实SIGKILL/重开；主机SQLCipher9组、Android实跑 | 有缺口不补造，先后以revision区间为准，不引入虚假hash链；生产原子命令仍未实现 |
| R5 字段映射 | 原报告是领域集合映射，不足以逐字段检查NULL/扩展/归档和默认初始化 | 新增实际类型AST＋人工审阅映射规格；347字段行，包含内联嵌套字段；所有目标列真实存在 | PASS；字段文档/机器JSON/映射测试，重要集合和继承类型来源单列 | 是结构表达能力和映射设计，无M5导入/回读；全局集合次序/可选出现信息须M3/M5冻结与验证 |
| R6 外键删除 | 实测108组FK全部NO ACTION；引用父项拒删，未引用消息可删，显式先删自有明细可解除父项 | NOT-A-DEFECT；保留外键，不CASCADE擦除历史；逐条父子/复合键/理由与用例输出 | 完整PRAGMA比对、跨世界/孤儿/延迟FK/回滚、Android FK检查 | 元数据全覆盖≠每个可空分支产品命令均已执行；软删/归档/撤销/解绑分别由M2/M3实现 |

修复前后直接探针：[before](qa/kanata-sqlite-m1-r/evidence/reproduction-before.json)、[after](qa/kanata-sqlite-m1-r/evidence/reproduction-after.json)。原M1基线实际15/15通过；初版新增R测试在原快照10项中7失败/3通过，保留[原始失败](qa/kanata-sqlite-m1-r/evidence/remediation-before.txt)，不把不存在的问题编成六项全失败。后续新增的registry、长历史和故障点测试没有冒称在初版10项中。

## 兼容性与安全设计

原001核心161条、002索引36条完全不变，新增003共19条：一表、两显式唯一索引、16触发器。当前精确目录48表/130触发器/38显式索引。严格sqlite_schema逐项比对、application_id、版本日志checksum和future-version零写入拒绝仍保留；没有忽略未知Android表、DROP保护或修改历史checksum。

已有v1/v2升级前，SQL端检查消息快照真实归属、两类审计区间和实体登记双向一致。发现错误返回固定错误码，事务零修改拒绝；不自动删除冲突审计、不填缺号、不伪造来源。不将全部快照加载到JS；返回至多一个标记。审计重叠预检使用窗口running MAX，v1没有访问索引时避免二次相关扫描；1001条合成审计测试证明验证及保留行为，不是100k性能成绩。实体登记防护允许实体本身的正常AFTER INSERT/DELETE维护，不是一律禁止物删。

时间由`options.now`（默认Date.now）在各版本DDL结束后生成，所有版本与时间行同事务。成功提交才可见；失败/崩溃不留成功记录；重开幂等不刷新。旧日志无法证明执行时间，旧版本明确unknown，未来恢复不能当0或本次时间使用。测试通过数值UTC在不同时区一致，也接受系统回拨，绝不修饰成单调时间。Schema日志不是M5数据迁移journal，DDL SHA不是密文认证或审计hash链。

当前`src/features/chat/experience/kanataEvents.js`删除消息会清除当前及所有历史正文。 全面禁止所有消息审计UPDATE会破坏该实际契约，本轮采用狭窄隐私例外：当前记录先deleted且正文已是固定清除标记，再基于原已存JSON用SQL json_set，仅改content/deleted，其他字段及扩展保持。历史正文不能恢复、不能改时间/revision/ID。SQL比较保留结构表示，不能由未来Repository重排/重新转义JSON绕过；M2应直接对已存快照执行明确SQL，并在同一CAS事务增加删除审计、失效派生记录。本轮只验证结构能力，没有实现生产删除命令。

数据库所有权/结构触发器防普通DML误写，不是抵御已能执行任意DDL/替换整个文件的攻击者；M2必须限制SQL入口、租约、FK连接池及密钥生命周期。测试随机DEK仅在进程内存/stdin，本轮未改全局主密码/备份/恢复，也未安装SQLite插件到生产依赖。

## 字段与外键证据

[347字段映射](20261107-kanata-sqlite-m1-r-field-mapping-v1.md)逐项保留类型/可选性、真实列或JSON/关系、空值、转换校验、限制和源行号。嵌套CharacterDefinition、ImportedCardAsset、CompletionAttempt等独立展开；不把继承字段说成没有处理。领域仍KanataData1/2、完整备份v13，SQL Schema003与它们无版本等价关系。

可选布尔NULL区别false，JSON文本null区别SQLNULL，extensions_json保留未知键。低频无ordinal数组可在owner原字段同名JSON保留顺序/空数组提示，必须与关系行一致，不能绕过权限/FK。顶层集合自然次序不是SQL承诺，M3/M5需冻结顺序及可选出现信息并做完整投影往返；本轮不声称原JSON字节已无损还原。默认世界选择来自实际UI选中非archived世界的行为，Schema不造默认世界/身份。messageArchives只为M5逐页hash/解密/展开输入；旧小家virtualEvents不迁入，不生成虚假原消息。

[108外键明细](20261107-kanata-sqlite-m1-r-foreign-keys-v1.md)逐条从真实PRAGMA提取，并在测试与机器JSON比对。保留NO ACTION是引用完整性要求，不等于所有实体永久不能删除；叶子与显式自有明细删除已实测。失效roleBinding选择按现契约保留，不能为了多加FK把它重绑到其他实例。

## 两轮独立自检

这里“独立”指分开的审阅角度与重新验证，并非声称启用了其他Agent或外部审计。

| 轮次 | 检查与真实发现 | 修改及重测 |
| --- | --- | --- |
| 第一轮：技术/安全 | 对照P5发现全面禁止审计更新会阻止删除隐私语义；仅deleted标记又不足以证明当前正文已清除。检查升级查询发现旧v1没有索引时相关重叠预检会退化。另实际复现移除entity_ids后memory/audit同ID的绕过 | 改为当前正文+deleted前置的不可逆精确脱敏，增加未清正文/恢复/重时间反例；改窗口预检并测1001审计；增加3条registry所有权触发器与旧库双向预检、正常注销和坏旧库零写入测试。对最终DDL重跑真实SQLite、原/新主机SQLCipher、Android构建及instrumentation |
| 第二轮：需求/证据/边界 | 核对五个M1门禁、类型契约与347字段/108FK实际目标；补已存在v2追加003全部写入故障/提交失败，避免只凭空库回滚。检查发现中间两个check误共享日志，混合输出不能作为完整证据；临时旧快照目录也曾缺失 | 增加24点+COMMIT逐字节回滚/新连接重试；补FK机器清单与当前PRAGMA全量比对；修正临时路径后复现；新增独立目录回归runner，最终重新实际执行，receipt及完整日志单独保存。核对README/根说明书/总计划入口；不改原M1报告、raw、生产Store/UI/Android/依赖或其他分支 |

复核后的代码再执行最终定向及完整check，不用第一次中间通过代替。最终代码/DDL/夹具与设备APK指纹见机器验收；原生Android与主机DDL指纹相同。仅文档整理在最终代码测试之后完成，链接与Git差异另查。

## M1正式五门禁与阶段交接

| 总计划M1门禁 | 本轮证据 |
| --- | --- |
| 表/PK/唯一/FK/索引/状态与领域映射明确 | 新schema-catalog、347字段映射、108FK逐项核对 |
| 复合约束阻止跨世界引用 | 原M1-07/08/09/13及R3/R4负例、主机SQLCipher/Android FK |
| 空库逐版、回滚及重启重试 | 空库226写入点，旧v2追加24点+COMMIT，已有v1故障；真实SIGKILL、密文重开 |
| 未知未来版本拒绝 | 原M1-03及主机SQLCipher future-version-zero-write |
| 非法记录/重复ID/孤儿/revision冲突 | 正负例、registry维护所有权、审计区间/不可变、FK/integrity/cipher检查 |

后续：M2生产Driver/受保护租约及连接池、消息/会话Repository、CAS与业务+审计原子命令、设备JS迁移E2E；M3结构化业务及数组次序语义；M4有界Store；M5旧JSON/归档与未知扩展完整往返/有序保真、数据迁移journal；M6便携备份、恢复协调、DEK重包装与改密崩溃恢复；M7整应用容量/目标手机性能，再继续P7。未实现这些不等于本轮结构测试失败，也不能在后续免验收。

Android本轮仅API34 x86_64隔离合成AVD原生DDL/约束/回滚/重开；无真机结果，未执行设备JS升级器/生产Driver。1k/10k/100k性能未重跑，Android512MiB/完整改密120秒/Web768MiB和P7完整需求不改，原P7仍No-Go。最终M1-R结论及进入M2建议以正式验收和实际回归receipt为准，本轮没有开始M2。
