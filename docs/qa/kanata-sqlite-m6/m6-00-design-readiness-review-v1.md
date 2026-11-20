# Kanata SQLite M6-00 设计冻结前独立审查

审查日期 2026-11-20（北京时间）。结论为**有条件推荐方案 C，暂缓 M6-00 关账**。优先补齐三处跨阶段契约：可信的持久化决定和跨存储写门禁、无需普通模块加载的冷启动恢复、能保全 Schema v5 自引用数据和数组顺序的导入合同。M6-QA-01 的通过证据覆盖测试基线整改。

## A. 审计基线

| 用途 | 实际核实结果 |
| --- | --- |
| 远端 | `git ls-remote --exit-code origin refs/heads/m6/encrypted-backup-recovery` 返回 `a301436259663999bd1cd6424e6e04ecb4662dc7`，与预期一致。源仓库 `Zhoubin601/ForMyself`。 |
| M6 源码及本文行号 | 独立 detached worktree，HEAD 为 `a301436259663999bd1cd6424e6e04ecb4662dc7`。本地同名分支停在 `af31867bf2f20fc79adad8385dc43637122b7fa8`，落后远端跟踪分支 5 个提交，原样保留。 |
| 规划基线 | `b695226a8495d9129e9e95cf127bfbc4a61c92c4`，可解析，位于 M6 HEAD 的祖先链。 |
| M5 关账基线 | 任务书 `2b6e8e3591385024577c6606cce2acc31dbaad2b` 本地不可解析。`git rev-parse 2b6e8e3` 得到 `2b6e8e3591385024576c6606cce2acc31dbaad2b`，提交主题和关账文件相符。已报告差异，以后一 SHA 做源码交叉核对，待人工确认编号。 |
| 代码变化 | `git diff --exit-code 2b6e8e3 b695226 -- src android/app/src/main` 与 `git diff --exit-code b695226 HEAD -- src android/app/src/main` 均无差异。规划到 HEAD 的变化来自文档、Android 测试和 QA 驱动等。 |

资料来源和引用日期均为 2026-11-20，限此仓库的任务、实现与历史记录。主要文档为 [M6 计划](../../20261119-kanata-sqlite-m6-encrypted-backup-recovery-plan-v1.md)、[原架构审计](m6-00-architecture-audit-v1.md)、[独立复核](m6-00-independent-review-v1.md)、[M6-QA-01](m6-qa-01-report-v1.md)、[M5-06 关账](../../20261119-kanata-sqlite-m5-06-closeout-v1.md)，以及 [M5-06 规模证据](../kanata-sqlite-m5/m5-06-remediation-v1.md)、[最终复核](../kanata-sqlite-m5/m5-06-final-independent-review-v1.md)。项目约束依据 [AGENTS.md](../../../AGENTS.md) 和 [开发说明书](../../../架构接口与Agent开发说明书.md)。`raw/` 只核对 Git 文件清单。没有读取私人资料、数据库、凭据或未入库的设备证据。

下表给出复核索引。后续表格中的简名均指这里的 M6 HEAD 文件，冒号后的数字为该 SHA 的实际行号。

| 简名 | 文件和检查范围 |
| --- | --- |
| RC / RJ / RS / Boot | [恢复协调器](../../../src/application/restoreCoordinator.js#L6-L96)、[日志](../../../src/platform/storage/restoreJournal.js#L5-L82)、[门禁](../../../src/platform/storage/restoreState.js#L3-L6)、[启动探测](../../../src/main.js#L16-L24)。 |
| App / PA / FB / KB / BR / UI | [恢复入口](../../../src/composables/useAppController.js#L536-L544)、[受保护会话](../../../src/stores/protectedAccess.js#L67-L170)、[全备组合](../../../src/application/fullBackupRuntime.js#L27-L78)、[Kanata 编排](../../../src/application/kanataBackupRuntime.js#L55-L96)、[备份注册器](../../../src/application/backupRegistry.js#L13-L56)、[设置备份](../../../src/composables/settings/useBackupSettings.js#L63-L280)。 |
| SC / Native / Driver / Env / KEK | [SQLite 候选](../../../src/application/kanataSqliteCandidate.js#L20-L158)、[原生插件](../../../android/app/src/main/java/com/yubin/formyself/KanataSqlitePlugin.java#L79-L644)、[Android Driver](../../../src/platform/storage/androidKanataSqliteDriver.js#L151-L185)、[封套](../../../android/app/src/main/java/com/yubin/formyself/KanataKeyEnvelope.java#L49-L142)、[本机 KEK](../../../src/platform/security/kanataSqliteKek.js#L4-L25)。 |
| PW / Auth / Store / Vault / Settings / Cred | [改密服务](../../../src/services/masterPasswordChange.js#L1-L24)、[认证](../../../src/stores/auth.js#L38-L66)、[Kanata Store](../../../src/features/chat/kanataStore.js#L223-L339)、[密码库](../../../src/features/vault/vaultStore.js#L198-L217)、[设置](../../../src/stores/settings.js#L390-L480)、[凭据适配](../../../src/platform/security/secureCredentials.js#L30-L75)。任务书中的 `src/stores/kanataStore.js` 在该 SHA 不存在。 |
| Todo / TodoBridge / TodoJS | [原生仓库](../../../android/app/src/main/java/com/yubin/formyself/TodoRepository.java#L31-L130)、[原生桥](../../../android/app/src/main/java/com/yubin/formyself/TodoPlugin.java#L44-L60)、[JS 仓库](../../../src/features/todo/todoRepository.js#L7-L35)。 |
| S / SH / SO / SM / MR / MM | [Schema 001/002/004](../../../src/features/chat/storage/sqlite/kanataSchema.js#L36-L300)、[003](../../../src/features/chat/storage/sqlite/kanataSchemaHardening.js#L39-L83)、[005](../../../src/features/chat/storage/sqlite/kanataSchemaArrayOrder.js#L2-L58)、[Schema 迁移器](../../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js#L19-L125)、[M5 行映射](../../../src/features/chat/storage/sqlite/kanataDataMigrationRows.js)、[M5 迁移器](../../../src/features/chat/storage/sqlite/kanataDataMigrator.js)。 |
| DR / CR / AR / HArchive / Backup / Payload | [命令收据](../../../src/features/chat/storage/sqlite/kanataDomainRows.js#L81-L108)、[角色卡仓库](../../../src/features/chat/storage/sqlite/kanataCharacterRepository.js#L44-L110)、[任务仓库](../../../src/features/chat/storage/sqlite/kanataAutonomyRepository.js)、[归档标记](../../../src/features/chat/storage/sqlite/kanataHistoryArchive.js#L78-L98)、[兼容格式与任务策略](../../../src/features/chat/backup/kanataBackup.js#L13-L202)、[日志压缩编解码](../../../src/platform/storage/restorePayloadCodec.js)。 |

本轮实际跑了 Git 基线/差异、文档链接/行号/表宽/清单检查，以及将 Node 导出的仓库 DDL 送入 Python 3.13.5、SQLite 3.49.1 内存库的两项探针。第一项枚举 `sqlite_schema`、`table_info`、`foreign_key_list`，五版 DDL 分别为 161、36、19、7、21 条，得到 53 表、149 触发器、42 显式索引（排除 `sqlite_*`），零声明 BLOB 列。第二项只用合成行，验证两个两节点自引用环和 004→005 空顺序映射，详见 E。均成功退出。未运行 `npm run check`、Android 编译、instrumentation、WebView/实机测试、真实数据库或真实恢复操作。M6-QA-01 第 76–111 行引用其本地测试及 API 34 CI，CI 被测 SHA 是 `522d26455f72e62b19d9fe7a5624e99837424893`，与本轮文档 HEAD 区分。

## B. 原审计与独立复核交叉检查

编号取自独立复核第 4 节，原审计相应章节与现有源码交叉对照。状态表示原陈述在此 SHA 的证据强度。M6-QA-01 里的同名编号属于测试基线整改。

| ID | 判定 | 交叉核对 |
| --- | --- | --- |
| B-01 | 已确认 | 原审计第 8、9 节已指出恢复所需内部能力待证；Native:167–175,241–268 确认候选 prepare/unlock 对主日志拒绝，SC:55–64,151–157 另有普通会话拒绝。App:536–542、PA:110–113,161–168、FB:54–57、KB:65–69 形成三层加载/就绪依赖。原生拒绝适用于合成候选。实际产品重试仍使用旧 Kanata 仓库，半坏受保护存储的冷启动问题独立存在。 |
| B-02 | 部分确认 | Native:103–118 无条件撤销 epoch，关闭排到 worker；SC:58–63 会忽略受 guard 保护的 inactive。UI:130–157 用 guard 打开 Share/选文件，Cred:30–50 有生物凭据路径。不同 picker、Share provider、Biometric 实际产生 pause/resume 的顺序与取消行为须实机验证。 |
| B-03 | 存在事实错误 | Native:498–509 是 Kanata 插件单个 Java String 的 262144 UTF-16 单元校验。原复核推导为所有超长字段必然无法经桥导入，CR:54–103 已有固定参数拼接的单次 INSERT，未触碰不可变 UPDATE。`messages` 内容修改需提高 revision（S:232–234），并非整行绝对不可更新。通用完整备份仍须解决桥总量和游标边界。 |
| B-04 | 已确认 | PW:7–22 是进程内补偿，Auth:38–66,232–242 的 verifier/生物凭据与参与者分开写。PA:121–125,161–167 既无持久化全局门禁，也会在恢复准备时先清内存标记。Store:318–327 提早退休旧页。 |
| H-01 | 已确认 | 53 表与分类实查相符；收据、旁表重建、外键和任务契约尚需冻结。自引用环和未回填 005 状态超出原复核所给的排序建议。 |
| H-02 | 部分确认 | UI:68,160–171,280 证明全文件文本读入，解包与日志使用同一个已认证本机密码来源。当前是 HTML 文件输入，源码未提供 M6 Native SAF 持久化 URI 实现；URI 在重启/provider 变更后的行为为设计风险。 |
| H-03 | 部分确认 | `android/variables.gradle:2` 为 API 24；KEK:15–24 现走 WebCrypto，Env:94–107 只用 Java GCM，`PBKDF2-SHA256` 为封套标签。仓库未证明 API 24/25 所有 provider 的 `SecretKeyFactory` 支持/字节语义，按低版本验证门禁处理。 |
| H-04 | 已确认 | RJ:50–77 的摘要比较确认主日志与标记内容匹配；prepare 已返回摘要，RC:58–64 用于同次 apply/补偿，但 RC:71 不传预期摘要，RJ:74–77 重读现有日志并写无密钥摘要。 |
| H-05 | 已确认 | RJ:5–7 是 `restore-v1.{enc,commit,tmp}`，Native:171–174 搜索 `restore-v1.enc{,.commit,.tmp}`，Todo:95–96 只看主日志。需统一含异常路径的盘点。 |
| H-06 | 部分确认 | Env:49–52,106–120 只有读、解封、创建随机 DEK 的入口。Native:176–185 确实拒绝当前 `envelope.json.bak/.new`；未来采用独立新槽的改密材料如何识别要另定，源码未实现该暂存态。 |
| M-01 | 已确认 | RS:3–5、RC:37,55–60、RJ:64–69 与 Todo:95–130 证实窗口，并存在检查后才提交的在途写。桥 CAS 在整个日志存在期间也没有原生区分普通与恢复写，见 B-07。RJ 写后读回代码未给出文件/目录持久化证明。 |
| M-02 | 已确认 | Settings:390–405,424–430 调用原生凭据写；Cred:53–75 写后读回并区分读取失败。恢复、补偿及重启均需验证 API Key 与配置配对。 |
| M-03 | 已确认 | UI:211–222→BR:51–55→FB:44–50→Store:223–254，目前是旧 Store 单项导入；不会走 RC 或生成恢复决定。UI:107–120 的空数据判断基于旧 DTO。 |
| M-04 | 已确认 | Native:258–291 与 Env:94–142 是本机 DEK 封套；RJ:19–37 是内部日志，两者与拟议 BEK/子密钥包协议相互独立。独立复核第 5.3 节的随机 BEK「严格唯一」与「数学上杜绝」表述超出了随机抽样可证明范围。 |
| L-01 | 已确认 | 内存 DDL 查到零 BLOB 声明，Native:527–532 默认拒绝含 BLOB 在内的其他类型。实际长字段以 TEXT/JSON、内嵌 Base64 为主，仍须处理字节长度。 |
| L-02 | 部分确认 | `tests/fullBackup.test.js:238,284` 的历史标题与旧输入应分读，`src/services/fullBackup.js:24,140` 当前通用版本为 12；Backup:13–17,157–169 的产品 Kanata full 为 13。Settings:424–480 是更完整的引用。Env:132–142 可确认 raw key 构形，SQLCipher AAR 的 key 路径按 C 的验证项复核。 |
| B-05（原独立复核额外项） | 证据不足 | 源码未接入原生导出快照。Native:305–332,407–412,596–610 给出读写连接、只读 preflight、写者事务及健康检查；三者无法证明 Java 层可调用 online backup、实际只读长事务行为或副本耐久性。 |


## C. 风险追踪矩阵

严重程度适用于拟议 M6 集成。合成候选缺口和当前产品旧路径问题均给出各自证据。B-06～B-09 为本轮新增的独立阻断条件。F 节给出阶段退出条件。

| ID | 风险 | 源码证据 | 严重程度 | 影响阶段 | 必要设计决策 | 验收测试 |
| --- | --- | --- | --- | --- | --- | --- |
| B-01 | 冷启动先加载半更新数据。候选还因日志或普通会话限制拒开，形成恢复死锁 | App:536–542；PA:110–113,161–168；FB:54–57；KB:65–69；Native:167–175,241–268；SC:55–64,151–157 | Blocker | M6-03/05 | 独立恢复认证，只验证本机身份和事务材料。Native 能力绑定事务 ID、局部世代、操作和 epoch，由 Native 验证后向协调器签发；只开放核验、重放或切换已登记世代。 | F03-02/06/07，分别破坏 Vault、旧 Kanata、Settings readiness，真实产品入口进入恢复，普通插件调用仍拒绝。 |
| B-02 | JS 保持会话时原生撤销，迟到回调或提交应答丢失可使前端误判 | UI:130–157；SC:55–63；Native:103–145,430–455 | Blocker | M6-02/03/05 | 选择/认证先结束，恢复展示只允许新 epoch。导出关句柄后 Share。长操作可协作取消，提交应答不明时查询持久化决定。 | F02-02/F03-09，覆盖前后台、取消、锁屏、旋转、快速 resume、commit 后回调前 pause。 |
| B-03 | 固定 SQL 桥的单参、结果和内存限制无法当通用备份传输能力 | Native:498–537,574–577；CR:44–110 | Blocker | M6-01/02/03 | Native 数据面独立于普通固定 SQL API，桥只传命令、受限元数据和句柄。所有大字段限定整行峰值。 | F02-01/03，UTF-16 262144/262145、整行 2 MiB 边界、实际已支持的大卡、含 NUL 的长审计文本。 |
| B-04 | 改密中断会形成新旧密码分裂态，失去数据可用性 | PW:7–22；PA:121–125,161–167；Auth:38–66,232–242；Store:313–327 | Blocker | M6-04/05 | 跨冷启动事务、双槽封套和凭据、明确决定与退休顺序，与数据恢复互斥。 | F04-01～04，按每个参与者每一步强停，独立用新旧认证重开。 |
| B-05 | 快照可能混读不同时间点，误复制遗漏 WAL 内容 | Native:305–332,407–412,596–610 | Blocker | M6-02 | 同连接固定只读视图、写冻结与有界 WAL 预算，物理原语仅作经实测备选。 | F02-01/04，在并发写和 reader 持有 WAL 时用事务共同不变量验证。 |
| B-06 | 决定、清理和启动探测不闭合。主日志缺失即删旁文件，可能把仍在切换的状态当空，或把已提交状态回拨 | RJ:46–60,74–81；RC:31–33,71–92；Boot:16–21 | Blocker | M6-03/04/05 | 版本化、认证的事务控制记录和持久化门禁同时描述准备、决定和完成。文件和目录持久化、原子发布和缺失语义是同一协议。 | F03-03/04/05/07/08，注入孤立 commit、损坏 slot、只缺主记录、写成但返回失败、目录同步失败、清理逆序。 |
| B-07 | 普通 Todo CAS 可在主日志存在期间继续写。已确认的写可能被 target 或补偿覆盖 | TodoBridge:48–58→Todo:41–48；TodoJS:15–29；Todo:95–127 | Blocker | M6-03/05 | 同一 Native 排它门禁覆盖 CAS、widget、旧请求和恢复能力，排空后才采 previous。恢复 CAS 用受限凭据，保持 revision 单调。 | F03-01/03，排队旧 CAS、日志建立后普通 CAS、widget 通过检查后延迟提交，验证无漏写和反向覆盖。 |
| B-08 | 仅拓扑排序会拒绝 DDL 允许的两节点环。005 未回填仍可通过通用完整性检查，可能悄悄丢原序 | S:83–92,121–129,222–234；SO:12–23,29–55；E 的内存探针 | Blocker | M6-01/02/03 | 可空自引用分两遍，或明示经批准的领域拒绝策略和保留路径。缺失顺序映射先安全拒绝导出，另定补齐决策。 | F02-03/F03-02，环、前向引用、未来 revision、005 空/空洞/乱序。 |
| B-09 | 简单开启候选开关后，保留旧资料与候选盘点硬拒绝互斥。可能恢复死锁或读回错误 canonical | SC:20–31；Native:79–87,147–218；FB:27–51；`src/application/protectedModules.js:21–22` | Blocker | M6-03/05 | staging/代际协议与旧库入口分离。以经确认的产品决定控制 canonical；旧文件保留，禁止隐式激活；旧版降级检测未知决定。 | F03-02/10，双代同时存在、旧凭据和残留页、空目的库与当前安装分别测，掉电后无隐式切回。 |
| H-01 | 固定表遗漏、业务收据丢失或伪造、触发器派生不一致 | S:193–206,272–295；SH:39–83；DR:96–107；MR:427–437 | High | M6-01/03 | 冻结 E 的表、列、类型、依赖和摘要，保留收据并按命令语义校验。 | F03-02，53 表覆盖、异常收据、幂等重放与 FK/触发器。 |
| H-02 | 二进制误读、全文件内存、SAF provider 更换内容或撤回授权 | UI:68,160–171,280 | High | M6-01/02/03 | 二进制 Native 文件流、加密私有 spool、严格 EOF，脱离 URI 后才 prepare。 | F02-02/F03-02，短读、零读、撤权、二遍输入被替换。 |
| H-03 | 低 API 派生能力或编码不同导致合法包不能导入 | `android/variables.gradle:2`；KEK:15–24；Env:94–107 | High | M6-01/02/05 | 固定字节协议；冻结参数前做 API 24、25、≥26 已知答案测试。 | F05-01，分解字符、中文、辅助平面和非法代理项跨端对照。 |
| H-04 | 决定可替换或伪造，损坏记录可能与真正未提交混淆 | RJ:50–77；RC:58–72 | High | M6-03/04 | 同锁验证 expected digest 和 txn，决定需 MAC 和持久化 CAS。 | F03-04/07，替换、伪造、删除决定与上一交易重放。 |
| H-05 | JS、原生候选、组件分别观察到不同挂起状态 | RJ:5–7；Native:171–174；Todo:95–96 | High | M6-03/05 | 统一盘点及旧日志适配，区分缺失、权限错误、损坏和未知版本。 | F03-07/F05-02，逐一制造旧/新旁文件组合。 |
| H-06 | 暂存封套被误判创建失败，或覆盖唯一旧封套使两种密码都失效 | Env:49–78,106–120；Native:176–185 | High | M6-04 | 版本独立的槽、登记双封套、复读解封验证同 DEK，未知谱系保持锁定。 | F04-02/03，双槽、替换旁文件、损坏、错 DEK、错 generation。 |
| M-01 | JS 逻辑阻断先于日志持久化，原生晚提交越过快照边界 | RC:37,55–60；RJ:64–69；Todo:95–127 | Medium | M6-03 | 门禁与在途写提交在线性化点互斥，证实未写才开放无日志的退出。 | F03-01，确认成功的旧写均进入 previous。 |
| M-02 | 安全凭据与普通设置可能只成功一边 | Settings:424–430,453–480；Cred:53–75 | High | M6-03/05 | 捕获并认证旧配置及凭据存在状态，串行写后读回，使用恢复能力修复损坏配置。 | F03-06，凭据已写、读取或删除失败与 Preferences 失败。 |
| M-03 | 单项绕过事务、误接受合并、空 DTO 被误认作空库 | UI:107–120,211–222；BR:51–55；FB:44–50 | High | M6-03/05 | 共用协调器，单项 scope 仅含 Kanata；以授权 Native 计数确认覆盖。 | F03-10，预置其他参与者与坏档，单项只切 Kanata，取消零 active 写。 |
| M-04 | 包密钥复用、旧封套泄漏、当前目录与旧密码材料混用 | Env:94–142；KEK:11–24；RJ:19–37 | High | M6-01/04/05 | 包、库、日志密钥域隔离；新导出独立随机材料；常规改密轮换 KEK，失陷处置另评 DEK 轮换。 | F05-01/F04-04，重复和独立备份、跨设备目标新 DEK、旧材料。 |
| L-01 | 把 BLOB 当现有列会误配类型；把字符数当字节数会截断 TEXT | S:7–20,39；Native:527–533；CR:44–61 | Low | M6-01/02 | v5 使用声明类型白名单，UTF-8 字节计长；内部可用字节投影。 | F02-03，补充平面、NUL 尾和复合长行。 |
| L-02 | 旧版本测试名称和 raw key 拼装被错当运行结果 | Backup:13–17,157–169；Env:132–142；`tests/fullBackup.test.js:238,284` | Low | M6-05 | 分派按明确 type/version；独立验证 AAR/ABI 的 raw-key 语义。 | F05-02，v1–v12、现存 Kanata full v13/单项 v1、未来版、错身份。 |
| N-01 | 现有日志将两份快照编码并整段加解密，仍可击穿有界内存 | RC:10–15；RJ:14–37,41–48；Payload:3,81–129 | High | M6-02/03 | SQLite 日志仅持认证后的代际引用、摘要、决定；其他参与者材料单列受限流/文件，保留旧日志读法。 | F02-03/F03-08/F05-03，包可流完但日志 RAM/磁盘超限。 |
| N-02 | 旧 lease 和 OS 提醒仍可能触发副作用；清日志、同步前强停会丢失重试线索 | Backup:46–63,125–149；RC:27–34,71–92；FB:59–64；AR:398–420,544–582 | High | M6-03/05 | 停调度，按代隔离旧回调，持久化可幂等派生同步账，回滚保留业务任务原值并重新核对运行租约。 | F03-09/F05-02，发送任务、旧 notification ID、延迟回调和同步中断。 |
| N-03 | OS 备份/迁移或过宽分享路径可能复制 staging、决定或部分相关材料 | `AndroidManifest.xml:3–9,74–80`；`res/xml/file_paths.xml:2–4`；Native:147–150；RJ:39–42 | High | M6-02/03/05 | 私有 no-backup 放事务和 staging；仅授予密文完成包的 FileProvider URI，核对合并 Manifest 与 D2D 规则。 | F02-02/F05-03，OS 迁移、旧 URI、URI 越界和卸载残留。 |
| N-04 | Auth verifier 回退无读回，改密与恢复可清掉对方仍需的材料 | Auth:38–66,232–242；PA:132–136；RC:35–41 | High | M6-03/04/05 | 两类事务共享排它所有权；出现未知结果时读决定；验证 verifier/biometric/participant 配对。 | F04-03，双事务、verifier 已写但回读错误、取消/锁屏和重启。 |
| N-05 | 持包密码者仍可制作语义恶意包，也可回放较旧的真实包 | S:7–27,209–249；DR:96–107；Backup:157–189 | High | M6-01/03/05 | 认证后仍固定 DDL、字段/图/预算验证。覆盖确认提示来源与时间。密码认证无来源签名或全包防重放保证。 | F03-02/F05-01，合法认证恶意语义、旧包、未知字段和复合键重复。 |

### C.1 Native 能力与实机门槛

| 层次 | 核实结果与要求 |
| --- | --- |
| 源码可确认 | AAR 固定 4.17.0（`android/app/build.gradle:102`），当前 Native 单 worker（Native:45–50）。`OPEN_READONLY` 用于 preflight 并关闭（Native:316–338）。普通路径设置 WAL、synchronous FULL、FK、缓存及 busy timeout，普通事务 `beginTransactionNonExclusive` 占 writer。桥 262144 是单个绑定字符串的 UTF-16 单元数，查询用 `JSArray` 累积结果，ready 最多 256 行（Native:498–537）。 |
| 历史测量 | M5-06 整改表给出 100k 合成迁移 912.31 秒、最大 RSS 561.5 MiB、2001 批、目标库 109.91 MiB。M5 关账第 45 行限定为隔离 API 34，100k 独立核对覆盖 47 固定表及计数等。512 MiB 是 M6 规划第 127 行保留的 Android 红线。此结果评估旧迁移路径。M4 有约 2 MiB CursorWindow 和大角色卡历史探针，实际边界受整行、provider、ABI、系统影响。[M4 关账](../kanata-sqlite-m4/final-m4/README.md#L60) |
| 需编译/链接 | 核对实际 AAR 的只读快照、游标/statement、JNI/ABI、目录同步、SAF URI 及 FileProvider。`sqlite3_backup_*`、`VACUUM INTO`、`sqlcipher_export` 是待验证的物理备选。 |
| 必须实机 | 在 API 24/25、项目近期支持 API 和低内存实体或等约束环境测。记录 App 与 WebView 同时峰值 RSS、native/Java heap、CursorWindow、文件与 WAL 峰值，覆盖合成 1k/10k/100k、长值、取消、低盘、系统终止和慢 provider。分别测导出、恢复、全量改密，后者另受规划 120 秒门槛。 |

推荐导出在受保护会话内生成私有密文文件。排空写入和发送，持同一只读事务/连接与同一视图，以固定键分页读取表、派生摘要。优先冻结 Kanata 写至 snapshot 释放，按预算监控 WAL、空闲空间、时长和取消信号，超阈值关闭连接并拒绝发布。实测只读连接打开/关闭与 `-wal/-shm` 行为，确认源业务行不变且无显式 checkpoint 或维护性 DDL。全包验证完成并关句柄才打开 Share。SAF 写失败可能留下不完整文档，目标成功关闭后才报告完成，条件允许时移除本次半件，旧成功包保留。

按 PK keyset 分页元数据，避免整行 `SELECT *` 或多个大字段占同一 CursorWindow。试用小块读取 TEXT 字节流，测试 `substr(TEXT)` 的码点/NUL、`substr(CAST(... AS BLOB))` 的字节语义、SQLite 内部整值物化成本及严格增量 UTF-8 解码。JSON CHECK 和 JNI 绑定可能复制整字段，小帧不能给这部分内存定界。分别冻结单字段、单行、包总量和 SQLite/JNI 预算，至少覆盖 CR:54–103 能产生的合法卡片。空间估算包含 spool、目标 DB、两代活跃文件、WAL/索引、控制记录与保留量，并捕获实际 ENOSPC。只清理证明属于本次且无事务引用的文件。


## D. 密码学设计建议

| 选项 | 独立评估 |
| --- | --- |
| A：版本化逻辑记录 | 可移植、可用固定 DDL 重建，也能明确投影任务状态。原审计未要求必须经现有 SQL 桥。若把现有桥作为完整数据面，长值、往返和 WebView 聚合开销均需重做预算。 |
| B：SQLCipher 物理镜像 | 可保留物理布局，受 AAR、ABI、页/加密参数、快照和 WAL 语义制约。把源库文件原样携出意味着目标需要源库相关解密能力。仅保留为使用独立目标密钥的实验对照，收益及一致性待证。 |
| C：容器与逻辑载荷分离 | 推荐。外层仅处理帧和密码学，内层 `kanata-logical-v1` 使用固定目录与版本化记录。Android 数据面 Native，JS/Node 作为同字节协议的流式参考和合成 oracle。需要两套实现互验，对实际 Java/JNI 单行内存和跨端值编码仍设退出门槛。 |

### D.1 密钥层级、帧结构和认证

以下是建议的 v1 工作规格。算法、参数、限值、正式枚举号与测试向量待批准和验证，当前 HEAD 尚无此格式。

1. **头与封装。** 固定长度、大端、保留位为 0 的公开头 `P`。建议字段为 8 字节魔数、u16 版本、u16 套件、u16 KDF profile、u16 flags、u32 迭代次数、16 字节随机 salt、16 字节随机 backupId、u8 scope、u8 payloadKind、u32 frameLimit、u16 reserved。随后 48 字节封套，含 32 字节 BEK 密文和 16 字节标签。对长度/枚举/限值/重复字段先做一次固定成本解析。包密码严格编码为 UTF-8，无 trim、大小写转换、Unicode 正规化或 BOM 注入，拒绝未配对代理项与空密码；冻结前设字节上限（候选 1024）。`PBKDF2-HMAC-SHA256` 输出 32 字节，盐输入为新域标签 `ForMyself/Backup/KEK/v1\0`、独立 salt 和 backupId 的定长拼接。建议 v1 只接收经实测批准的一组 profile 及其精确迭代数，600000 为对照基准（本机 KEK 为该值），不因兼容需求接收任意输入迭代数。一次运行只做一次 KDF，限并发、取消与进程内节流。成本由 API 24/25 低端设备校准。离线猜密仍取决于密码强度与每次猜测成本。
2. **域隔离。** 每次新导出用 CSPRNG 生成新的 BEK、salt、backupId。建议再用 HKDF-SHA256 从口令派生结果按 `P` 派生包专用 `K_wrap`，AES-256-GCM 以 `P` 作 AAD、单次封装用固定零 96-bit nonce，前提是同一 `K_wrap` 只加密一次。BEK 经 HKDF-SHA256，以 backupId 为 salt，版本化固定二进制 info 含用途/streamId/frameType，分别派生 manifest、data、footer 子密钥。固定测试随机源只进合成测试。生成器报错/异常即停止，重导出新材料，仅允许已完成密文的字节级重传。包密码、包 KEK/BEK、本机 DEK/KEK、日志密钥和事务 MAC 密钥各在自己的用途域。
3. **Nonce 与 AAD。** 推荐 `u16 streamId ∥ u8 frameType ∥ 0x00 ∥ u64 index`。控制帧保留流 0，MANIFEST/FOOTER 各一次、各自 index=0，数据流采用白名单非零 ID，逐流 index 从 0 连续增加。单次导出严禁重置 writer、重新加密既有 index 或计数回绕。96-bit 元组编码对合法元组单射；跨导出 key/随机量重复仍有小概率并依赖 CSPRNG，不能宣称数学上无碰撞。帧头 `F = streamId:u16 ∥ type:u8 ∥ flags:u8 ∥ index:u64 ∥ plaintextLen:u32 ∥ ciphertextLen:u32`。每帧 AAD 为 `SHA256(P ∥ wrappedBEK) ∥ F`，绑定实际序列化字节。v1 建议禁用压缩、冗余编码和未知位，要求 ciphertextLen = plaintextLen + 16 且含固定长度标签。DATA 帧初始候选 64 KiB 上限、总 data frame 数 ≤ 2^16，进一步按全包/逻辑字段/流总量限额校验；控制帧另有小上限。禁止先按未经校验的长度分配，u64 用 BigInt 或精确字节/检查过的整数转换。
4. **相位和 Footer。** MANIFEST 第一帧，声明已知 payload、逻辑 Schema、策略、固定 stream 列表及顺序。v1 按 manifest 流顺序写完一流再下一流，每流非空时唯一末块置 FINAL，零数据流由 manifest/footer 明确表示。FOOTER 必须是最后一帧且正好 EOF。Footer 认证逐流块数、明文字节、密文字节、开始/结束状态，及按实际顺序对 `F ∥ ciphertext-with-tag` 做的 SHA-256 transcript（精确定义初始域、覆盖 MANIFEST/所有 DATA，排除 Footer 自身）。另认证 E 节表行数与规范化摘要。读端逐一比较、严格判尾随任意字节，空库仍要 MANIFEST/FOOTER 和零计数表。错误密码、篡改标签统一对 UI 显示无法认证，内部只保留固定分类。未知版本、预算、I/O、取消、记录语义错误可区分，任何不完整结果不得对外发布或写 active 库。
5. **阶段分离。** 本机会话只授权导出和目标切换，外部包密码仅解封/生成该包。目标先完成本机凭据建立/认证，即使密码恰与包密码相同也独立处理。导出不携带源封套、源 DEK、源 Keystore 材料、验证器或生物凭据。每个目标 staging 世代在 Native 独立生成新随机 DEK，并以目标机本机 KEK 封装，实际切换只使用本机生成的世代引用。内部恢复日志与外部包寿命分离，冷启动只依赖本机认证及已登记材料。建议首次外部流读取只写加密私有 spool，并逐帧验证至 Footer 和 EOF；通过后对同一个受控私有文件再解包、重验每帧和文件摘要，放入隔离 SQLCipher。SAF URI 只在首次读取有效窗口内使用。磁盘代价纳入 F。即使持密码成功解包，所有字段/FK/策略仍要重新验证。
6. **逻辑值编码。** 按固定列 ID 与顺序编码、显式 NULL、INTEGER 精确有符号编码、REAL 固定 IEEE 754 并定义负零及拒绝非有限值，TEXT 为长度前缀的原始严格 UTF-8，JSON TEXT 保留合法字节（包括扩展与表达差异）。SQLCipher 值跨语言转换须逐字节比较，禁止隐式浮点化大整数。确定性顺序按列的 SQL 二进制排序契约并用跨端字节 oracle，主键及 PK tie-breaker 固定，实时行 ID 与源 SQL 页/rowid 解耦。跨帧逻辑记录支持增量收取，严格边界，禁止未知表、重复行、DDL、SQL、路径、URI 或整对象反序列化进入导入解释器。

### D.2 对抗场景与已知答案/互操作任务

拟议防线需要 M6-01 合成验证，其 Native 版本需在 M6-02/03/05 复测。当前已有防御只标注源码可以确认的功能。

| 核查 | 场景及影响 | 当前防御与拟议防线 | 剩余风险 / 建议向量 |
| --- | --- | --- | --- |
| 1. Nonce | 中断续跑或索引重置，GCM 同 key/nonce 复用会损害机密性和完整性 | Env:49–52 为本机随机封套。拟按域派生，导出状态机保证唯一元组与单次封装。 | 同 ID/BEK 模拟生成失败、并发重试、index=0/最大/溢出、同 index 不同 stream/type。随机碰撞与 RNG 回滚仍须评估。 |
| 2. AAD | 改 scope、套件、序号或长度触发降级、帧串包或解析偏差 | Env:94–103 对本机封套有 AAD。新包绑定公开头和精确帧头。 | 对头每个字段单字节变异、相等长度交叉流/包替换、密文长度与标签边界，含未知保留位。 |
| 3. Footer | 删除、换序、重复、追加整包或空字节，造成静默数据缺失 | 新包要求连续索引、单一相位、认证计数/摘要和 EOF。 | 空包结构、缺首/中/末帧、边界截断、提前 FINAL、重复 Footer、尾随 0 或另一个有效包、总长度不一致。 |
| 4. KDF/错密 | 恶意迭代/长度及并发请求耗尽 CPU/RAM，反复试错或离线字典 | 本机 KEK:18–20 使用固定迭代。新包先校验 profile 后派生，限并发/取消。 | 0、最大 u32、超允许迭代 1、超长口令、重复取消、错密并发，确认 KDF hook 调用次数与时间。同合法包可离线猜密。 |
| 5. Unicode | JS/Java 替换非法代理项、归一化或字符密码 provider 实现不同，导致解封失败 | KEK:10–24 用 TextEncoder，本机封套 Native 接收已派生 KEK。新包统一严格标量到 UTF-8。 | 合成字符串含中文、补充平面、空格、U+0000、预组/分解字符，分别核对 UTF-8、派生 key、帧字节。孤立高/低代理项拒绝；双方都不输出向量之外的真实输入。 |
| 6. API 24/25 | 某 JCA 工厂缺失或 PBEKeySpec 转码不同，旧机无法导入 | 当前本机 WebCrypto 路径避开 Java KDF。建议审核过且接受 byte[] 的 PBKDF2 provider 或经标准向量验证的兼容实现，经版本检测选定。 | 在实际 API 24/25/≥26 列出 provider 与结果，跨 Node/WebCrypto/Android 独立 oracle；能力失败给稳定代码。不可仅凭算法名或 API 34 通过认定。 |
| 7. 两种密码 | 外部包密码被当本机密码，或用户认证失败后仍允许切换 | 旧 UI 共用会话密码（UI:68,164–171）。新包要求双角色输入、包验证及本地授权分步。 | 外包正确/本机错及相反、取消任一步、切换前本机锁定、同一字符串分别处理。 |
| 8. 源 DEK | 将现有 envelope 或 raw key 放进包/桥，泄露后可解源库 | Native:258–291 仅在 Native 解 DEK 并清理可变缓冲，Driver:163–175 的桥发送本机 KEK。C 的数据面不序列化源 DEK。 | 注入可识别的合成 DEK，检查包字段、桥、日志、临时文件、错误和 release 轨迹。不可承诺托管堆或设备被控时零驻留。 |
| 9. 目的 DEK | 跨设备复制封套或复用源 DEK，以同一密钥污染两台设备 | Env:110–119 新建库取随机 32 字节，现无便携恢复路径。M6 staging 复用本机新建原则。 | 同一个包恢复至两个隔离目标、同机重复发布，测试钩子在 Native 验证不同 DEK 与正确封套绑定，旧目标密钥不能开新代。 |
| 10. 秘密落盘/日志 | 崩溃、provider 垃圾、普通 Preferences、错误 stack 或调试桥保存密码/明文 | Native:74–97,137–139,269–291,423–426 做固定错误、清缓冲、清 bridge 参数，Cred:30–75 管理原生安全凭据。现有 JS 字符串无法保证擦除。 | logcat/JS console、桥、普通 Preferences、缓存、OS 备份清单、错误和强停残件的合成哨兵扫描。检查旧明文口令迁移残留及清理失败，密文文件也按敏感材料管理。 |

生成测试向量时固定合成随机量、合法头和两个流，独立给出预期 UTF-8 字节、PBKDF2、HKDF、AAD、nonce、wrap ciphertext、帧标签和 Footer transcript。独立 Node/Android 逐层比对，以标准 primitive 已知答案和固定 wire 字节共同验收，避免两端同错。包可证明持密码方的完整性，不能证明作者身份、新鲜度或阻止整包回放。主动控制本机进程、读取运行时明文或同时回滚全体可信存储属于另外的威胁边界。


## E. 53 表备份矩阵

分类为 3 张运行/迁移、5 张触发器派生、45 张业务表。导出/恢复栏是拟议逻辑合同。业务表逐行编码；旁表仅提交计数/摘要，目标依现有触发器重建。表名、PK 和 FK 来自 A 的 DDL 探针。顺序同时考虑触发器的非 FK 依赖。PK 指对应表的固定主键排序。先以可信 001–005 建库，保持 FK 和触发器开启。源包不提供 DDL、索引、迁移进度或本机凭据。每表核对固定列、类型、NULL、行数及摘要，最终核对 Schema catalog、`integrity_check` 和 `foreign_key_check`。

| 表名 | 分类 | 导出 | 恢复 | 触发器重建 | 外键依赖（实际表） | 顺序要求 | 补充校验 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `data_migrations` | 运行/迁移 | 否 | 空表 | 否 | 无 | 源检查状态，目标空表（PK `id`） | 拒绝未完成或不明来源迁移 |
| `schema_migration_applications` | 运行/迁移 | 否 | 本机迁移登记 | 否 | `schema_migrations` | 本机迁移器按 version（PK `version`） | 本机时间来源和版本覆盖 |
| `schema_migrations` | 运行/迁移 | 否 | 本机迁移登记 | 否 | 无 | 目标按 001–005 迁移顺序（PK `version`） | 版本/名称/校验和、应用 ID |
| `baseline_array_order` | 派生 | 只导校验摘要 | 重建并核验 | 是 | `effect_baselines` | effect_baselines BEFORE INSERT，world/ordinal（PK `world_id,entity_id`） | 逐行核对 entity/ordinal 及覆盖数 |
| `effect_array_order` | 派生 | 只导校验摘要 | 重建并核验 | 是 | `world_effects` | world_effects BEFORE INSERT，world/ordinal（PK `world_id,entity_id`） | 逐行核对 entity/ordinal 及覆盖数 |
| `entity_ids` | 派生 | 只导校验摘要 | 重建并核验 | 是 | 无 | 实体 AFTER INSERT，id（PK `id`） | 实体与登记的双向集合、全局 ID |
| `event_array_order` | 派生 | 只导校验摘要 | 重建并核验 | 是 | `world_events` | world_events BEFORE INSERT，world/ordinal（PK `world_id,entity_id`） | 逐行核对 entity/ordinal 及覆盖数 |
| `participants` | 派生 | 只导校验摘要 | 重建并核验 | 是 | `character_instances`、`world_identities`、`worlds` | 身份/实例 AFTER INSERT，PK（PK `world_id,id`） | kind、identity/instance/world 双向核对 |
| `archived_message_marks` | 业务 | 是 | 是 | 否 | `messages` | 消息完成后，PK（PK `world_id,conversation_id,message_id`） | 归档标记 scope 与实际消息 |
| `autonomy_policies` | 业务 | 是 | 是 | 否 | `worlds` | worlds 后，PK（PK `world_id`） | 版本、自由等级、静默时段 |
| `background_tasks` | 业务 | 是 | 是 | 否 | `background_tasks`、`character_instances`、`conversations`、`messages`、`worlds` | 参与者、会话、消息后，PK 两遍（PK `id`） | 延迟来源、幂等键、lease、通知 ID；见 E.2 |
| `card_versions` | 业务 | 是 | 是 | 否 | `character_cards` | 与 character_cards 同事务，PK（PK `id`） | card/revision 唯一和文本字节 |
| `character_cards` | 业务 | 是 | 是 | 否 | `card_versions` | 与 card_versions 同事务，PK（PK `id`） | 当前版属本卡、preset_key 唯一 |
| `character_instances` | 业务 | 是 | 是 | 否 | `card_versions`、`worlds` | worlds 与 card_versions 后，PK（PK `id`） | 卡版复合键、能量与扩展类型 |
| `conversation_participants` | 业务 | 是 | 是 | 否 | `conversations`、`participants`、`worlds` | 会话与 participants 后，world/conversation/ordinal（PK `world_id,conversation_id,participant_id`） | 成员类型、数值 ordinal、复合 scope |
| `conversations` | 业务 | 是 | 是 | 否 | `worlds` | worlds 后，PK（PK `id`） | 会话类型与参数约束 |
| `dataset_metadata` | 业务 | 是 | 是 | 否 | 无 | 首批，singleton（PK `singleton`） | user_id、data_version 与业务身份 |
| `domain_command_receipts` | 业务 | 是 | 是 | 否 | 无 | 关联业务行后，command_key（PK `command_key`） | 保留 key/fingerprint/result，见 E.2 |
| `effect_baselines` | 业务 | 是 | 是 | 否 | `character_instances`、`relationships`、`worlds` | 世界、实例及关系后，world/ordinal（PK `id`） | 路径、范围和唯一基线 |
| `event_audits` | 业务 | 是 | 是 | 否 | `world_events`、`worlds` | world_events 到最终 revision 后，PK（PK `id`） | 快照 owner/scope、修订区间、不可变 |
| `event_causes` | 业务 | 是 | 是 | 否 | `world_events`、`worlds` | 事件后，PK（PK `world_id,event_id,cause_event_id`） | 环拒绝、同世界、无自边 |
| `event_life_sources` | 业务 | 是 | 是 | 否 | `life_grants`、`world_events`、`worlds` | 事件与授权后，PK（PK `world_id,event_id,grant_id,grant_revision,fingerprint`） | grant scope、revision、指纹 |
| `event_participants` | 业务 | 是 | 是 | 否 | `participants`、`world_events`、`worlds` | 事件与 participants 后，PK（PK `world_id,event_id,participant_id`） | 同世界 membership |
| `event_sources` | 业务 | 是 | 是 | 否 | `messages`、`world_events`、`worlds` | 事件与消息最终 revision 后，PK（PK `world_id,event_id,message_id`） | 来源版本不可在未来 |
| `life_grants` | 业务 | 是 | 是 | 否 | `character_instances`、`worlds` | 实例后，PK（PK `id`） | 模块、三种授权、revision 与权限 |
| `lorebook_entries` | 业务 | 是 | 是 | 否 | `character_instances`、`worlds` | 世界与实例后，PK（PK `id`） | owner scope、keys JSON、可见性 |
| `lorebook_known_by` | 业务 | 是 | 是 | 否 | `lorebook_entries`、`participants`、`worlds` | 条目与参与者后，PK（PK `world_id,entry_id,participant_id`） | 已知人同世界 |
| `memories` | 业务 | 是 | 是 | 否 | `character_instances`、`conversations`、`worlds` | 世界、实例及会话后，PK（PK `id`） | owner scope、状态与 generation_key |
| `memory_events` | 业务 | 是 | 是 | 否 | `memories`、`world_events`、`worlds` | 记忆与事件后，PK（PK `world_id,memory_id,event_id`） | 同世界关系与复合键 |
| `memory_known_by` | 业务 | 是 | 是 | 否 | `character_instances`、`memories`、`worlds` | 记忆与实例后，PK（PK `world_id,memory_id,instance_id`） | 同世界实例关系 |
| `memory_life_sources` | 业务 | 是 | 是 | 否 | `life_grants`、`memories`、`worlds` | 记忆与授权后，PK（PK `world_id,memory_id,grant_id,grant_revision,fingerprint`） | grant revision 和复合 scope |
| `memory_links` | 业务 | 是 | 是 | 否 | `memories`、`worlds` | 两端的记忆后，PK（PK `world_id,memory_id,kind,target_memory_id`） | shared 环及 shared/superseded 单父索引 |
| `memory_policies` | 业务 | 是 | 是 | 否 | `worlds` | worlds 后，PK（PK `world_id`） | 阈值、预算、revision |
| `memory_sources` | 业务 | 是 | 是 | 否 | `memories`、`messages`、`worlds` | 记忆和最终消息后，PK（PK `world_id,memory_id,message_id`） | 来源 revision 和 scope |
| `message_audits` | 业务 | 是 | 是 | 否 | `messages`、`worlds` | 消息、成员与最终 revision 后，PK（PK `id`） | sender/scope、审计区间、原始内容字节 |
| `message_life_sources` | 业务 | 是 | 是 | 否 | `life_grants`、`messages`、`worlds` | 最终消息与授权后，PK（PK `world_id,message_id,grant_id,grant_revision,fingerprint`） | grant scope、revision、指纹 |
| `messages` | 业务 | 是 | 是 | 否 | `conversation_participants`、`conversations`、`messages`、`worlds` | 会话成员后，PK 两遍（PK `id`） | 回复与 reply revision、文本字节、角色及删除标志 |
| `preset_applications` | 业务 | 是 | 是 | 否 | `worlds` | worlds 后，PK（PK `id`） | world 与 initialization_key 唯一 |
| `relationship_events` | 业务 | 是 | 是 | 否 | `relationships`、`world_events`、`worlds` | 关系与事件后，PK（PK `world_id,relationship_id,event_id`） | 同世界边及反向索引 |
| `relationships` | 业务 | 是 | 是 | 否 | `participants`、`worlds` | participants 后，PK（PK `id`） | 双向端点、非自环、范围及唯一性 |
| `role_binding_state` | 业务 | 是 | 是 | 否 | 无 | role_bindings 前，singleton（PK `singleton`） | 版本与唯一单例 |
| `role_bindings` | 业务 | 是 | 是 | 否 | `role_binding_state` | role_binding_state 后，scope（PK `scope`） | 允许成对 stale ID，禁止按名称改绑 |
| `task_result_events` | 业务 | 是 | 是 | 否 | `background_tasks`、`world_events`、`worlds` | 任务与事件后，PK（PK `world_id,task_id,event_id`） | 结果事件 scope 与复合键 |
| `task_result_memories` | 业务 | 是 | 是 | 否 | `background_tasks`、`memories`、`worlds` | 任务与记忆后，PK（PK `world_id,task_id,memory_id`） | 结果记忆 scope 与复合键 |
| `task_social_participants` | 业务 | 是 | 是 | 否 | `background_tasks`、`conversation_participants`、`worlds` | 任务与会话成员后，PK（PK `world_id,task_id,instance_id`） | 会话一致及角色成员类型 |
| `task_sources` | 业务 | 是 | 是 | 否 | `background_tasks`、`messages`、`worlds` | 任务与最终消息后，PK（PK `world_id,task_id,message_id`） | 来源 revision 和 scope |
| `usage_events` | 业务 | 是 | 是 | 否 | `character_instances`、`conversation_participants`、`worlds` | 实例和会话成员后，PK（PK `id`） | 状态/完成时间/令牌计量，不发请求 |
| `virtual_schedule_days` | 业务 | 是 | 是 | 否 | `virtual_schedules`、`worlds` | 计划后，PK（PK `world_id,schedule_id,day`） | 星期范围和去重 |
| `virtual_schedules` | 业务 | 是 | 是 | 否 | `character_instances`、`worlds` | 实例后，PK（PK `id`） | 起止时间范围 |
| `world_effects` | 业务 | 是 | 是 | 否 | `character_instances`、`relationships`、`world_events`、`worlds` | 事件、实例/关系后，world/ordinal（PK `id`） | 禁止 candidate 效果，校验目标与值类型 |
| `world_events` | 业务 | 是 | 是 | 否 | `character_instances`、`relationships`、`world_events`、`worlds` | 实例/关系后，world/ordinal（PK `id`） | 替换边延迟或后补、状态/动作/时间戳 |
| `world_identities` | 业务 | 是 | 是 | 否 | `dataset_metadata`、`worlds` | metadata、worlds 后，与 worlds 同事务（PK `id`） | 本世界唯一身份及数据集用户 |
| `worlds` | 业务 | 是 | 是 | 否 | `world_identities` | metadata 后，与 world_identities 同事务（PK `id`） | 身份、时区/时间戳及启用标志 |

### E.1 依赖、触发器与原序

- `worlds.identity_id` 指向 `world_identities` 的复合延迟 FK，反向的 `world_identities.world_id→worlds` 立即，另依赖 `dataset_metadata`（S:56–66）。先 metadata，再 world 后 identity，同事务提交。`character_cards.current_version_id` 与 `card_versions.card_id` 两侧延迟，需把同卡跨向引用置于同事务。`world_events.replaces_event_id` 本身延迟，MR:355–367 的后续 UPDATE 是 M5 策略。M6 可在一个合法 staging 事务保全值，或在 staging 后补，均须验证替换边的领域规则。
- `messages.reply_to_message_id` 与 `background_tasks.window_task_id` 都是立即自 FK，CHECK 排除单节点自指（S:83–92,121–129,222–234）。A 的两节点样例先插双 NULL，再原位补引用，COMMIT 后 m-a↔m-b、t-a↔t-b，FK 空、完整性 ok。父先子后的拓扑法只能处理 DAG。建议在隔离 staging 先落骨架（消息的 reply ID 和 revision 一并 NULL），再补引用并验证 scope、版本、触发器和最终摘要。若领域最终拒绝环，须明确错误与数据保全策略。探针证明 DDL 可表达性，普通 UI 可达性未专项测试。
- S:193–206 的实体注册与 participants 由触发器产生，SH:72–83 约束登记，Native:375–376 还查 003 兼容条件。按同一快照生成 `id,table_name` 和 participant 完整元组计数/摘要，在目标做双向反连接和定长投影摘要。SM:19–125 验证 catalog 和日志；本机重建 S:249–265,289–293、SH:47 的部分唯一/访问索引。外部 DDL 或索引不进入执行。
- SO:29–51 的旁表用每世界 `MAX(ordinal)+1`，order FK 延迟，旁表禁止 UPDATE/DELETE，已有实体也不能靠直接 INSERT 补。`world_events/world_effects/effect_baselines` 按 `(world_id,ordinal)` 重放生成三表，验原 ordinal 和关联，不能只比行数。SO:15–23 明示 005 不回填。A 的第四版有一行事件的内存库加 005 后得到 `(1,0)`，FK 空、完整性 ok。建议源端要求完整、一一对应且 ordinal 可按固定 DDL 重建；有洞、漏或来源顺序无法证明即拒绝导出并保留源库。MM:97–116 证明 M5 的派生方法。`kanataEventWorldSignature.js:11–20,56–87` 使用并摘要 ordinal，错序会改变业务签名。
- `conversation_participants.ordinal` 是业务列，MR:217 映射成员索引，保全实际值和 scope。MM:213–253,366–407 的 manifest 与集合进度用于判断来源迁移完成。排除运行表时仍须验证来源，避免备份可读但未完成的迁移。目标空 `data_migrations` 不代表可自动开启旧数据迁移，目标来源及校验结果归入恢复控制记录。

### E.2 收据、任务与归档

- **收据。** S:277–281 只定义 key、fingerprint 长度和 result_id 字符串，DR:96–107 命中收据直接返回原结果，同 key 异指纹报冲突。排除该表可能重复创建角色卡、事件或副作用，或使合法重试变冲突。推荐保留所有合法收据。校验已知命令的数组形状/作用域、规范 key、lower-hex 64、result 型别语义，明确历史删除的结果策略。`kanataMemoryRepository.js:422–430` 的 policy 返回世界 ID，HArchive:88–94 返回会话 ID。不能将结果一概套同一 FK，也无法从已编辑的当前行重算原请求 fingerprint。验合法重试零副作用、同 key 不同输入、畸形 scope、未知命令、陈旧结果及已暂停任务的重试。MR:427–437 盘点该表，本身未定义备份策略。
- **任务。** Backup:46–63,67–77,120–130,157–189 的 `pause-sending-v1` 清零全部 `leaseUntil`，令 reply/proactive/followup 的 pending、running、failed → cancelled，其余 running → pending，其他状态保持。外部 export 对 `background_tasks` 只读投影，import 同规则复核并保持幂等。验 `lease_until`/`state` 行摘要；保全父任务、延迟消息、结果边、幂等键、时间及通知/联系人历史。AR:544–582 记录通知编号与状态。需确认 `notification_id` 的历史语义与目标机现有 OS 通知隔离，重新核对权限、租约、来源版本，撤销旧代派生通知且零重发。内部 previous/target 日志精确重放已登记的本地状态（外部 target 已投影），previous 不套用发送投影，运行时旧租约仍因世代失效。
- **归档。** `archived_message_marks` 为业务关系，HArchive:88–94 写标记，S:282–287 需要原消息。Store:235–249 的旧文件页与 SQLite 标记是不同表示，旧格式适配须验证完整历史与原消息身份。


## F. 故障注入矩阵

### F.1 恢复协议及判定

`previous` 指门禁建立且在途写入结算后捕获的完整旧业务世代，`target` 指已认证并完成 staging 验证的目标世代。恢复入口识别事务种类、应用版本、认证记录与活动指针。任何一方不一致、材料缺失、密码不对、读盘出错或决定未知时 fail closed，保留现有世代和证据。下表是 M6 建议验收语义。当前 RC 在 `record.committed` 为真时选择 target，否则 previous，再普通准备和 apply（RC:82–92）。RJ:50–81 的单纯有无标记不具备表中证明力。

建议用持久化的本机事务控制记录统一管理 **门禁已建立 → PREPARED → 决定为 previous 或 target → FINALIZED**。记录版本、txn ID、scope、已批准参与者清单、previous/target 的不可变世代引用、所有者、阶段、摘要及单调转换序号。活动 pointer 与元数据由同一 native 协议线性化，未完成决定时屏蔽所有普通打开。记录及决定需经独立 MAC/AEAD 验证。提交在同一锁/CAS 中校验 expected prepared digest 与引用，审计文件需先同步自身再原子安装、同步父目录和冷读回。读回只验证可读性，持久化及 rename/dir sync 保证待实机与掉电模型验证。仅签 MAC 无法防止对全部可信状态的回滚，协议还应拒绝孤立旧事务、跨世代拼接与缺失/未知状态。

- **prepare 前**：外部 staging 可在独立目录无业务变更地完成。短事务式获得全局 Native/JS 门禁并等所有普通写与调度结算，再采 previous 及其凭据、文件、CAS 版本。Widget 冷启动也要先看持久化门禁。建立门禁的代码必须与写提交共享所有权，不能只靠某刻读到文件存在。校验两个代际引用、文件所属和可解封。
- **prepare 后**：业务切换、参与者 apply/flush/readback 均由 txn 能力执行。Native 验证已经登记的事务和认证证明后签发不可由调用方自行构造的短时句柄，约束阶段、参与者、世代和 epoch。普通桥参数或 JS 的 recovering 标志不构成授权。DB/WAL/SHM/封套同属目录，旧与新世代分开，不能逐个跨代挪侧文件。commit 可成功但应答丢失，读取持久化决定再重试/补偿；不能仅因 JS throw 执行反向补偿。
- **完成后**：参与者业务语义、加密材料、指针与决定都已验证，持久化 FINALIZED 与派生同步任务，然后允许普通写。删除旧文件只删除可证明无引用的材料。收尾失败若无法证明最终状态则 blocked；若 FINALIZED 完整可验证且失败只涉及无引用垃圾，正常返回选定世代并保留独立 cleanup 队列。同步通知/组件失败单独重试，禁止再次 apply 陈旧快照。

| M6-03/05 用例 | 强停、故障点与证据 | 冷启动选择 | 门禁和退出条件 |
| --- | --- | --- | --- |
| F03-01 prepare 前 | 验包/staging 时；Native 门禁取得前后、旧 CAS 在途与 widget 完成按钮 | previous（此时的 active） | 仅能在可信记录证明业务 apply 未发生、在途 writer 已结算后解锁；保留已确认的旧写。若留陌生 gate 或异常文件，先 blocked。 |
| F03-02 prepare 后、apply 前 | 合成 v5 全表、完整性、两个可开世代、事务控制记录耐久；重新启动 | previous | 按已认证 PREPARED/未决定状态确认 previous，废止未发布 target；能重读 previous、凭据一致并持久化完成才解锁。 |
| F03-03 apply 中途 | 位于 SQLite pointer 后、Todo CAS/Settings/其他参与者任一点；在途旧任务 | previous | 回滚按参与者逆序或等价的幂等写入约定；持久化进度与逐项回读，半成功/缺证据继续 blocked。 |
| F03-04 apply 完成、commit 尚未持久化 | target 都已读回，注入写 commit 前停止、短写、rename 或同步失败 | 可证明未提交时 previous；决定持久化且认证时 target；未知不选 | 不能以“看上去 target 已完整”提交，也不能以 commit 返回异常回滚；重读真实控制记录，确认完整后解锁。 |
| F03-05 commit 已持久化、清理失败 | 各清理点强停，含上一代材料、commit、staging、最终标记、同步任务 | target | 无可信 FINALIZED 时 blocked 并幂等完成；已完成可核验则允许 target 继续写，垃圾清理重试不再导入。 |
| F03-06 回滚失败 | previous 的 Vault、Settings/API Key、Kanata 封套、Todo 或参与者复读失败 | previous（预期决定），失败期间不发布 | 冷启动保持 blocked，保存 last error 和已验证材料，不加载损坏业务才能认证。故障解除后重放同 txn，确认全部 previous 再完成。 |
| F03-07 日志损坏 | 主记录标签损坏、仅残留 commit/tmp、新日志但旧版本、决定 MAC 或世代不一致、访问错误 | 保持未决；经独立认证的完备副本证明后才按其决定选择 | 默认 blocked，禁止静默清理、猜测方向或创建空库。错本机密码不得改记录。旧日志按批准的兼容策略处理。 |
| F03-08 磁盘不足 | 分别在 spool、staging DB/WAL、prepare、apply、commit 与清理写点注入 ENOSPC | prepare 前证实无业务写选 previous；持久 PREPARED 无决定选 previous；有效 commit 选 target；未知待核验 | 空间预检和实际错误均测试。若补偿、记录同步或复读无空间保持 blocked；释放安全空间后重试同 txn。 |
| F03-09 系统直接终止或后台撤销 | 系统 kill、进程死亡无回调、强停、提交返回前 pause，重启不使用 JS 内存 | 同对应持久化状态；PREPARED→previous，已提交→target，可证实未写→previous | 验没有依赖 finally/onDestroy，也没有迟到写、重复调度、通知/API 调用。同步账可在冷启动被发现。 |
| F03-10 连续冷启动和重复恢复 | 在两种决定的每个进度点多次终止，双会话竞争，单项与全量/旧版重复导入 | 同一 txn 每次选同代；完成后的新事务重新捕获新 previous | 重放幂等，旧已完成记录不能回拨新用户写。单项只写 Kanata，v1–v12 preserve Kanata，旧版不识别新挂起状态时禁止降级接管。 |

F03-02 同时包含语义验证回归：对 53 表按 E 比较，覆盖缺表/未知列、前向 FK、两节点环、revision、005 空映射/断洞、错误 case、合法 AEAD 但不合法领域图。目标完整且通过空间预算后才请求切换。F03-06 单独测 NativeBiometric 写成但读回错误、一次缺失凭据和普通 Preferences 半成功。

### F.2 主密码事务

当前 PW:7–22 串行重加密并在异常时反序调用，尚无持久事务。Auth:38–66 在 verifier 写后复读失败时尝试恢复旧值，补偿未再次复读。Auth:232–242 在 verifier 后清理旧口令并尝试更新生物凭据；其旧材料清理有吞错分支。Store:313–327 在 Auth 全局提交前已退休旧归档页。Vault:198–217 和 PA:121–125 保存失败状态或暂停持久化依赖进程。当前产品改密操作涉及旧 Kanata、Vault 等，Native SQLite 候选和 Env 没有已接入的 SQLite 改密能力。

建议采用持久化多阶段 `prepare / commit / retire`：

1. 与恢复共用排它 owner 和全局启动门禁。认证旧口令，阻止运行中业务继续写，冻结参与者和旧世代。认证本机事务记录，保留旧 verifier/安全凭据/归档、封套和可冷开的配对世代。新 verifier 和各模块新材料入独立 slot，逐个写后读回。槽和清单含 txn 与材料角色。记录无明文主密码、包密码、DEK。
2. SQLite `rewrap()` 用旧 KEK 解旧 DEK，校验数据库关联，以新独立 salt/nonce 和由新密码派生的 KEK 封装**原 DEK**，分别读回两个封套并常数时间核对同一 DEK，关闭句柄后再继续。封套认证绑定 purpose、版本、数据库世代、slot 与事务；保持 Env v1 已有读法。非 SQLite 参与者用独立 staging 实现复制写入及检查，禁止在 prepare 中覆盖唯一可读记录或删老页。
3. 全部参与者可冷开后，写认证的 durable commit，再发布/重放 verifier 和参与者选择。重启在决定前只能以旧凭据恢复 previous，已提交只接受新凭据恢复 target。恢复认证依赖已登记可信槽，跳过普通模块预加载。必要时让用户重新输入已选定方向的本机口令，不在日志或普通 Preferences 保存它。设计必须证明切换过程中两方向材料可用，即使生物凭据失效、主 verifier 指针未写或已部分写；生物凭据只在选定 verifier 后刷新，刷新失败保留主密码入口。
4. 失败时依据持久决定选择反向逐项补偿或继续完成目标。每项写、读回和失败都能重启重试。关键材料未知或补偿失败保持全局 blocked。清理退休在 durable FINALIZED、选定方向全参与者复读通过后执行，具体何时允许保留旧槽和删除见 G；退役失败不得让旧凭据继续独立解锁产品。清理流程应记录未退休副本，闪存磨损均衡与外部备份使常规文件删除无法提供物理擦除保证。

**常规改密建议轮换 KEK，不执行 `PRAGMA rekey`。** 本机 SQLCipher 使用 Native 构形的 raw key（Env:132–142、Native:279–305），保留 DEK 可避免数据库整库重写及其 WAL/空间/耗时风险。若攻击者只有旧密码且旧封套已不可取得，新的随机 salt/新密码封套提升对当前库的隔离。若攻击者曾获得旧密码与旧封套、明文 DEK，或可能接触恢复槽，旧 DEK 仍可解该 DEK 保护的当前库。失陷处置需要另行设计并验证新 DEK 世代及原子切换，`PRAGMA rekey` 仅是待比较的机制，不能撤销已离线获取的历史副本。跨设备备份恢复依 D 使用新目标 DEK，与本机常规改密是不同操作。

### F.3 各阶段退出门槛

| 阶段/用例 | 必须覆盖的故障与输入 | 可核验退出条件 |
| --- | --- | --- |
| M6-02 / F02-01 | 并发写、读事务 pin 住旧页、WAL 变长、只读打开/关闭、源 writer 忙；1k/10k/100k | 所有表来自同一读视图，源业务指纹不变，无源显式 checkpoint，资源达线有界退出；有设备/ABI/AAR/指标采样证据。 |
| M6-02 / F02-02 | Share/SAF/认证取消、provider 部分写和权限撤回、晚回调、锁屏、导出期间强停 | 无发布半成品、无遗留未授权句柄，私有材料仅按所有权清理或保留重试，正常 Share 前关源句柄。 |
| M6-02 / F02-03 | UTF-8 跨块、NUL、极长 TEXT/复合行、真实大卡上界、无顺序映射、磁盘低水位 | 无截断，导出的验证摘要与源语义/投影一致。整链 RSS 低于 512 MiB 规划红线，超预算前拒绝并保全源。 |
| M6-02 / F02-04 | AAR API 能力与备选；linked 调用失败、WAL 高水位、超时取消 | 只读逻辑路径证明可行。若采用任何物理原语，单独证明页快照、加密目的、副本侧文件、失败原库零业务改写。 |
| M6-03 / F03-01～10 | 完整上表及所有参与者，包括单项和全量，强停与连续冷启动 | 产品实际协调器和 Native/组件启动门禁通过；每点唯一方向或 blocked，验证完整性、指纹、代与凭据；对旧日志路径有兼容证据。 |
| M6-04 / F04-01 | 每参与者 prepare 前后强停，归档页新建失败、旧 Vault/SQLite 解封失败、临时槽错代 | 决定前 previous 可冷开；旧资料完整。失败保留可恢复材料及全局 gate。 |
| M6-04 / F04-02 | 双封套读回、任一标签坏、磁盘不足、commit marker 前后、进程中断与重复重放 | target 可冷开且保留同 DEK、使用新 KEK，previous/target 与 verifier 组合一致，无半提交暴露。 |
| M6-04 / F04-03 | 逆序补偿失败、verifier 写后未知、biometric 更新/删除失败、并发恢复/改密 | 冷启仍仅允许选定认证方向或 blocked，无跨事务清理和旧世代迟到写。 |
| M6-04 / F04-04 | 旧材料保留/退休、退出中断、旧密码试开、100k 场景与外部残留 | 完整改密规划阈值 120 秒可测，旧凭据不能进入产品。证明本地可观测退休边界并记录未能除去的外部副本。 |
| M6-05 / F05-01 | D.2 向量、API 24/25 与近期版本、篡改/错密/恶意 KDF、跨设备包与新目标 DEK | JS/Node/Native 固定字节与错误分类一致，所有拒绝路径 active 零写入，无合成密钥或密码暴露。 |
| M6-05 / F05-02 | v1–v12 兼容、已有 Kanata full v13/单项 v1、旧日志、未知新格式、调度同步、禁隐式降级 | 老包仍走批准的 legacy nonchat/preserve Kanata、明确旧聊天处理；当前 Kanata 产品入口覆盖。重复冷启方向稳定、派生同步重试零二次导入。 |
| M6-05 / F05-03 | 系统终止及掉电模型、I/O/空间预算、备份/迁移规则、provider 加密材料检查、独立复核 | 同一实现 SHA 的跨版本/设备证据，报告区分模拟故障、系统 kill、强停和掉电；记录未覆盖情形和材料库存。 |

后续验证必须明确隔离合成环境。每个阶段提供实现 SHA、命令、实际样本和测量口径，报告通过、预期故障复现、跳过和未运行，硬门槛不能用源码正则或历史 QA 数字代替。


## G. 待用户或主审确认的决策

| 决策 | 推荐 | 需要确认或证明 |
| --- | --- | --- |
| G-01 线格式和范围 | C，`kanata-logical-v1` 首先定义完整 Kanata 逻辑备份；多模块以独立流参与同一协调器。 | 首发是 Kanata 单项还是全量同步交付；新 full 类型/版本及参与者映射；旧 v1–v12 和已存 v13/单项 v1 的保留入口。 |
| G-02 文件密码/KDF/加密帧 | 单一经实测 profile、严格 UTF-8、随机 BEK、无压缩 v1、定长 AAD 与 Footer，双角色认证。 | 选定参数、帧/全包和逻辑字段的上限、API 24/25 provider、Node/Native 向量和出口限额。 |
| G-03 快照及 staging | 优先固定 Native 只读事务、短期禁止 Kanata 写、私有加密 spool 与隔离目标库。 | 批准锁持有与 WAL/存储预算，证明 AAR 支持。若拟承诺导出期间可写，需另做并发 WAL 压力与事务证明。 |
| G-04 持久化控制与旧日志 | 统一恢复/改密排它 owner，使用经认证的决定和代际指针；旧日志保存并走版本化恢复；未知失败保持 blocked。 | 本机认证密钥、可恢复材料、双槽/单一状态文件、原子 rename/目录同步、旧 commit 未认证时的人工处置与降级限制。 |
| G-05 数据语义 | 保留 45 业务表和收据，5 派生重建校验，3 运行表本机处置。自引用两遍，005 缺序拒绝保留，任务投影与内部日志分别对待。 | 是否接收 DDL 合法的双环、收据的历史 result 语义、005 缺序后续政策、通知 ID/权限的跨机语义。 |
| G-06 改密与退休 | 常规 KEK rewrap 保留 DEK，跨重启只接受决定方向凭据。全局复读和完成后退休，失陷用独立 DEK 轮换方案。 | 恢复认证与生物凭据刷新、旧槽保留界限、退休失败的门禁/审计；兼容升级和降级时旧材料如何被拒绝。 |
| G-07 升级和激活 | 维护旧数据，批准后才允许 canonical 激活；M6 设计和实施验收先用合成包与显式候选。 | 状态登记、旧后端并存及部署批次、合并 Manifest/no-backup、来源和目标防错配；人工确认 M5 SHA 差异。 |

## H. M6-00 关账建议

- **成熟度**：总体结构与验收语义可以写入阶段任务条件。线格式的最终字节规格、产品持久化决定和 Native 可行性证据仍欠完整。原 M6-QA-01 的测试整改为独立成果。
- **尚未闭环的 Blocker**：B-01 冷启动恢复认证与 apply 前置依赖、B-02 生命周期及提交结果、B-03/B-05 真正有界的数据面和一致性快照、B-04 跨重启改密，以及本轮 B-06 决定/清理、B-07 Todo 原生 CAS、B-08 自引用与原序、B-09 代际/canonical 并存。每一项均需有批准的合同与明确退出证据。
- **可冻结输入**：优先 C 的外层/内层分离；包密码与本机主密码独立、源 DEK 不导出且目的新 DEK；现有 Schema 保持固定，使用 E 的分类和拒绝规则；单项/全量共用恢复决定，原生 CAS 与旧任务受门禁；常规 SQLite 改密优先 rewrap；保留老格式和老日志的兼容入口。
- **先完成的验证**：在设计冻结前确认 G 中会影响 wire、密钥生命周期与跨阶段能力的选项，给出持久状态转换与降级表。先以合成环境获证低 API KDF 字节一致、AAR 只读快照和超长 TEXT 能力、Native 写门禁及文件/目录持久化可行性。各阶段完整端到端实验及容量阈值按 F 关账，相关实验需单独授权后执行。
- **阶段建议**：本轮建议维持 M6-00 待关账，待人工核对 M5 提交编号、审核 G 及确认阻断设计和验证责任后再决定 M6-01。未进行阶段实现、提交、推送或合并。

本轮唯一交付文件为 `docs/qa/kanata-sqlite-m6/m6-00-design-readiness-review-v1.md`，位于独立 detached worktree `formyself-m6-design-readiness`。原工作区 `main`、既有变更与其他 worktree 保留。静态证据和内存 DDL 探针的执行范围见 A。
