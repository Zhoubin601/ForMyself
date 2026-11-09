# Kanata SQLite M2 技术设计 v1

日期：2026-11-09（Asia/Shanghai）。基线：`de3164b8de569f57a250d0592eae5a21345e5264`，分支 M。[任务书](20261107-kanata-sqlite-m2-task-v1.md)、[Preflight](20261107-kanata-sqlite-m2-preflight-v1.md)。本页冻结拟实施接口与边界，不表示代码或测试已通过。真实实现/类型/测试须共同更新。

## 1. 组合根与激活边界

生产 `useKanataStore` 继续使用 JSON/AES+归档仓库。M2 不默认创建/打开 SQLite，不因数据库为空认定新用户，不双写，不自动回退。新增候选由应用组合根显式注入，只在 syntheticOnly QA 入口创建。生产激活状态固定 `legacy / KANATA_SQLITE_NOT_ACTIVATED`，不是默认打开的 flag。M3/M4/M5/M6 与备份/改密/恢复闭环未验收之前不允许切换；后续跨阶段切换单独由用户决策。

平台依赖只在 `src/platform/` 与 Android 插件中；SQL 与 DTO 映射在 `src/features/chat/storage/sqlite/`。页面/业务 Runtime 只消费领域 Repository 接口。ChatTimeline 是旧小家组件，不接入本候选，不导入旧小家数据。

## 2. Driver API 与类型

拟新增独立 M2 类型入口并从 application/contracts.d.ts 导出，strict 样例实际 import 工厂，覆盖错误参数、返回 affectedRows、错误 scope、错误 cursor/version、禁止嵌套事务和旧 M1 adapter 兼容。

```ts
type SqlValue = string | number | null
interface WriteResult { affectedRows: number; lastInsertRowId?: number }
interface Transaction {
  query(sql: string, parameters?: readonly SqlValue[]): Promise<readonly Record<string, SqlValue>[]>
  execute(sql: string, parameters?: readonly SqlValue[]): Promise<WriteResult>
}
interface Driver {
  open(context: ProtectedOperationContext, options: { create: boolean }): Promise<void>
  transaction<T>(action: (tx: Transaction) => Promise<T>): Promise<T>
  health(): Promise<HealthResult>
  close(): Promise<void>
  release(): Promise<void>
}
```

ProtectedOperationContext 只在真实 `access.runOperation(['chat'], (password, sessionRevision) => ...)` 内构造，含 ownerGeneration、assertCurrent/恢复门禁及临时派生能力，不导出密码 getter/数据库 handle。查询也经租约，不能让只读旁路泄露明文。M1 adapter 包装 execute 仅丢弃 WriteResult，保持既有 migrateKanataSchema 签名与执行顺序。

JS 端与 native 各有串行队列，队尾只保留 settlement，不能保留 DTO/密码。事务 BEGIN IMMEDIATE → 回调 → COMMIT；回调/COMMIT 任一失败尝试 ROLLBACK；rollback/close 失败进入 poisoned 状态并拒绝后续 open/create。嵌套或事务外写穿插明确拒绝，不隐式合并。

原生桥接不接受任意路径、数据库句柄、secret API 或不受限 SQL。候选采用构建期固定 SQL catalog（迁移语句及 Repository 固定查询）和 statement ID，参数独立传递，触发器完整语句视为一条。动态 IN 列表改关系/递归 CTE，避免将用户内容拼接成 SQL。catalog 在构建/QA 比对 SHA。执行 DML 通过 SQLiteStatement.executeUpdateDelete 获取真实 affectedRows，插入按真实结果返回，CAS 恰好1才成功。

## 3. lease 与生命周期状态机

状态：CLOSED → CHALLENGE → OPEN → TRANSACTION → OPEN → REVOKING → CLOSED；任意不可证明关闭/回滚进入 POISONED。

- prepare 需要前台，绑定 sessionRevision/ownerGeneration；随机 token，30秒，单次消费，重复 prepare 撤销旧挑战。
- unlock 消费挑战后才处理临时 KEK。错误/过期/重放/错误 session 均拒绝；原生随机 lease 与 revision/generation 绑定。
- 每次操作同时核对前台、lease、revision/generation 和事务 token。不能把旧 lease 重新绑定到新 session。
- 显式 lock、auth.sessionRevision 改变、Store.release、pause/background、destroy 先同步停止新请求和 challenge，再在同一 native executor 上回滚未提交事务/关闭连接。不能 close 与 transaction 并行。
- 进入 COMMIT 前再次检查撤销：已 committed 结果不抹掉，但 UI/AI/分页迟到结果由 owner generation 检查后丢弃；尚未 committed 的事务回滚。
- 页面卸载撤销页面 generation/请求；会话换页清窗口、quote缓存和预览；Store.release 清明文、订阅、请求及连接。close 不依赖可重放的旧 lease 才能执行，且不返回明文。
- 不嵌套 protectedAccess 全局 operation queue。原生 bridge 不是独立认证体系；认证仍由现有 auth/protectedAccess 提供。

## 4. 信封与首次创建

保持 M0 v1：purpose=`kanata-sqlcipher-dek-wrap`；PBKDF2-HMAC-SHA256 600000、256bit KEK、16byte随机盐；KDF salt 为 UTF8 `ForMyself/Kanata/KEK/v1\0` + salt。DEK 原生256bit随机；AES-256-GCM，12byte nonce，128bit tag。

AAD 字段与顺序固定 version,purpose,kdf(name,iterations,length),cipher,salt,nonce，与 M0 独立实现交叉解包。base64 必须规范编码且长度准确。固定错误码隐藏原生异常/SQL/参数。KEK 只临时桥接，关闭 bridge 日志；原生 byte[] finally 清零，PluginCall 移除临时密钥字段；JS TextEncoder 缓冲用后 fill(0)。Java String、CryptoKey、WebView/SQLCipher 内部副本无法保证物理清零，报告明确此边界。

App 私有固定目录，AtomicFile 写入并读回字节与认证验证。首次创建先持久化“创建未完成”标记（不含密钥）再写信封，再创建 DB，再执行 JS 升级器和 health，最后移除标记。任一步中断都保留文件且拒绝自动重建；M2 允许明确拒绝并请求受控恢复，不提前写 M5 journal。未完成创建只可由明确的合成 QA 清理命令处理，不向产品 UI 暴露删除入口。生产未激活时连空状态也不执行此序列。

## 5. 真实数据状态矩阵

native 固定路径的存在性检查与只读 legacy inventory（主/备份/临时、归档目录/文件、Kanata恢复键、全局恢复材料），任何读取异常均 fail closed。M2 生产组合根总门禁先返回 NOT_ACTIVATED，矩阵定义将来显式候选调用的唯一底层结果，不代表本轮扫描过用户文件。

| 实际状态 | 候选结果/固定错误码 | 允许写入 | 原材料 |
|---|---|---|---|
| 无DB/envelope/legacy，inventory全部成功 | EMPTY_ELIGIBLE；仅显式synthetic create | 仅授权创建后 | 保留 |
| 无DB/envelope，任一旧主/副本/临时/归档/恢复存在 | KANATA_SQLITE_LEGACY_PRESENT | 否 | 全保留，不导入 |
| DB/envelope同时存在且正确 | 租约+Schema+health通过才READY | 候选合成环境允许 | 保留 |
| DB/envelope只有一方；或创建标记残留 | KANATA_SQLITE_INCOMPLETE_CREATION | 否 | 全保留，不补造另一方 |
| 信封错密/损坏/未知版本/标签失败 | KANATA_SQLITE_UNLOCK_FAILED | 否 | 全保留，统一正文 |
| Schema未来版本/结构缺失/日志损坏/application_id错误 | M1固定KANATA_SCHEMA_* | 否 | 全保留，事务零写入 |
| FK/integrity/cipher检查失败 | KANATA_SQLITE_INTEGRITY_FAILED | 否 | 全保留 |
| inventory权限/IO错误、无法确定恢复状态 | KANATA_SQLITE_STATE_UNKNOWN | 否 | 全保留 |
| 生产组合根任何状态 | KANATA_SQLITE_NOT_ACTIVATED / legacy | 禁止SQLite写 | legacy不变 |

## 6. SQLite 配置与迁移

SQLCipher4.17.0 Community，NO_LOCALIZED_COLLATORS；setForeignKeyConstraintsEnabled(true)覆盖池。WAL、synchronous=FULL、cache_size=-2048、wal_autocheckpoint=1000。busy_timeout 先采用5000ms作为候选，须实测锁竞争、撤销延迟；不把该候选值当性能通过。连接由单 executor 管理；SQLCipher 实际池由 WAL API 管理，测试并记录实际行为，不虚构单物理连接结论。release 不用裸文件拷贝备份。

复用 JS migrateKanataSchema，严格 sqlite_schema/application_id/checksum/日志/FK 检查。001/002/003 SHA 保持不变；必要新增 migration 从004开始且单独证据。health 包含 cipher_version、cipher_integrity_check、integrity_check、foreign_key_check 及配置读回。Schema失败不得在未知库上先建业务表。

## 7. Repository API 与事务

MessageRepository：insert(message)、insertBatch(messages≤256)、recent(scope,limit≤50)、older(scope,cursor,limit)、get(scope,id)、quote(scope,id)、count(scope)、replies(scope,messageId,limit/cursor)、setStatus(scope,id,expectedRevision,status)、revise(scope,id,expectedRevision,{content,deleted})。ConversationRepository：list(worldId,cursor,limit)、get(scope)、participants(scope，按ordinal)、create/conversation字段CAS；不提供M3世界等通用CRUD。所有领域调用都核对 world+conversation，不把全局唯一ID代替scope。

DTO roundtrip 保留可选 false/缺失、lifeSources 与扩展；已知字段优先从真实列读取，未知扩展不能覆盖ID/作用域/revision。输入校验使用当前领域限制，不依赖SQL CHECK覆盖所有产品规则。

同ID初次插入后，相同scope及规范内容幂等返回 existing；不同内容或scope固定 KANATA_MESSAGE_ID_CONFLICT；不得使用REPLACE/IGNORE/UPSERT。批次1/50/256均一个事务，257零写入拒绝；调用者显式拆批，失败不吞后续。

所有状态/编辑/删除 UPDATE 条件必须 id+world+conversation+expectedRevision，revision+1且affectedRows恰为1，否则 KANATA_MESSAGE_REVISION_CONFLICT。前后快照来自该事务实际记录，审计ID由注入idFactory生成，at由clock；业务/审计同事务。单 speaker 多气泡一个批次提交，流式delta仅预览，完成持久化当前气泡批次，取消不将残片误标complete。

## 8. 编辑/删除的内聚派生失效事务

不能简化为软删一行。edit 与 delete 都复现 reviseKanataMessage：

1. 在事务读取目标与world非archived状态，校验revision/输入；递归CTE确定reply后代（UNION防环）。
2. 由受影响message的event_sources找未revoked根，再沿event_causes找因果后代；不以source revision等于当前revision过滤而漏掉历史依赖。
3. 查询同world不在closure、committed、causality非explicit且effectiveAt≥受影响最早事件者；存在则 EVENT_DEPENDENCY_UNCERTAIN，零写入，不自行替用户确认。
4. 对closure每个非revoked event needsReview/revision+1，真实previous/next追加event_audit；源event相关非deleted memory先stale/revision+1。
5. 对closure相关effects校验ruleVersion/path/value和baseline；从durable baseline fold所有仍committed的同路径effects（原顺序、clamp、set语义），更新受影响instance/relationship及revision。effects本身不删；不能盲目加减反转。
6. 目标消息CAS正文/删除标记/revision。删除固定正文“（已删除的原始记录）”；目标旧审计用原存SQL json_set只改content/deleted，然后追加已脱敏previous/new next审计。edit不清历史。
7. 每个reply后代status=stopped、revision+1并追加审计，即使之前stopped也按原函数规则递增。
8. 源message相关非deleted memory再stale/revision+1（两条命中路径允许共增2）；源message相关pending/running task取消、leaseUntil=0、errorCode=SOURCE_REVISED。
9. 任一步含COMMIT失败整笔回滚；rollback失败毒化连接，保持保护。

使用定向closure及SQL端集合更新，不将全部消息载入JS。需要event快照的关系字段只按目标event读取，关系顺序/扩展按M1-R映射保留。与原纯函数在同一合成输入逐字段对照（含未知扩展、双路径记忆、revoked节点、独立effects、任务）。发现无法表达的语义即BLOCKED，不篡改纯函数或删验收。

## 9. 分页、消息窗口与AI

cursor v1绑定worldId、conversationId、createdAt、id；所有字段严格验证，错scope/version/非法值固定 KANATA_MESSAGE_CURSOR_INVALID，不能回第一页。排序 created_at DESC,id DESC；limit+1最多51行判断hasMore，给UI至多50。只用keyset，get/quote按ID+scope查询。count单独COUNT(*)，不读取正文。

页面窗口≤100：首次50；更早页插到前方、裁掉远端；保存scrollHeight差/首条锚点，禁止分页触发自动到底。翻到旧页期间新消息显示“回到最近”而非无界追加。ownerGeneration+sessionRevision+scope三者检查每个异步结果；load/save/error/retry明确。按ID跳转只重载目标附近有界页；quote预览缓存随窗口/会话释放。

AI只读目标会话需要的recentMessages（现策略2–40），角色/群聊speaker/预算与权限沿原规则。reply、memory/event provenance由目标ID检查存在/状态/revision及life grant，不把“没在窗口”当作可用；不为验证来源加载全部历史。异步completion提交前重验session/scope/generation、源message revision、conversation/instance revision、knowledge/life signature。controlled provider，0真实API请求。

非消息领域暂保留已注入metadata表示；不能向SQLite候选回读全messages填充KanataData。M3依赖（自动记忆/自治任务/统计通用存储）明确隔离在未激活的生产legacy路径，QA候选只验证本轮消息切片及必要事务，不宣称M3完整可用。

## 10. 错误与验证矩阵

领域固定错误：NOT_ACTIVATED、LEGACY_PRESENT、STATE_UNKNOWN、INCOMPLETE_CREATION、UNLOCK_FAILED、CHALLENGE_INVALID、LEASE_REVOKED、SESSION_CHANGED、TRANSACTION_BUSY、TRANSACTION_FAILED、ROLLBACK_FAILED、CLOSE_FAILED、INTEGRITY_FAILED、CURSOR_INVALID、MESSAGE_ID_CONFLICT、MESSAGE_REVISION_CONFLICT、CONVERSATION_REVISION_CONFLICT（代码均以KANATA_SQLITE_/KANATA_MESSAGE_/KANATA_CONVERSATION_前缀落实）；M1已有错误码原样白名单保留。不得回显SQL/绑定值或native错误正文。

| 阶段 | 真实验证与证据 |
|---|---|
| Preflight/设计 | Git/源SHA、依赖差异、源码清单、状态矩阵、设计自审；隔离API34基础运行探针 |
| Driver | 正错密/信封交叉兼容、挑战过期重放/后台、有效lease、FK池、WAL/FULL、事务与关闭竞态、JS迁移 |
| Repository | 1/50/256/257、ID冲突/幂等、keyset重复时间戳/边界/scope、get/quote/count、CAS竞争、commit故障 |
| 删除派生 | 与纯函数对照、扩展JSON精确保留、审计保护负例、全事务每写入点故障、独立effects、task取消 |
| Runtime/UI | private/character/group、speaker/气泡/retry/引用、历史/锚点、快切/卸载/锁定、权限/迟到AI、有界返回计数 |
| 主机SQLCipher | 实际JS Driver/Repository、错密/SQLite拒读、完整性、SIGKILL事务重开，版本分开标 |
| Android | syntheticOnly/API34/包/AVD身份核验，instrumentation、Capacitor JS→native、JS迁移/repository/删除、强停重开 |
| 自检1 | 安全/并发/存储主动反例、发现/修复/复测；不能用设计自审代替 |
| 自检2 | 产品/兼容/证据主动核对、修复/复测；分开验证，不虚称外部Agent |
| 最终回归/交付 | 完整npm run check、定向/strict、Android构建/设备E2E、DDL/代码/夹具/APK SHA、diff/link检查、正式验收、普通commit/push M |

测试seed/夹具版本/数据SHA随证据保存，不记录密码/KEK/DEK。每项PASS/FAIL/BLOCKED/NOT RUN独立记录；基础能力未运行不算产品安全反例已通过。任何安全关键失败禁止M2 PASS，M2非PASS不得进入M3。

## 11. 设计自审（编码前）

2026-11-09：逐项对照任务书§2–§11与真实调用链。

- 修正最初只列delete清单的不足：edit也失效派生；task取消、memory双路径revision与effects实体revision均进入设计/测试。
- 区分M1 execute:void与M2 affectedRows，避免CAS基于虚假成功；不改历史DDL。
- 原型允许通用SQL/测试固定表，不能复制进生产；以固定catalog和受保护操作注入界限替代。
- 明确已有生产Store的全图/备份/改密依赖，M2固定不激活，不能以空DB或缺失信封绕过旧材料。
- 确认当前Linux无KVM不等于自动BLOCKED；先建全新合成AVD，若WebView基础探针实测失败，必须保存本轮证据再决定需要何种运行环境。

设计接口与安全边界已冻结，尚未宣称实现完成。后续若变更需在本页追加理由及真实测试，不静默删验收。

补充核对：M1 的 `kanataFixtureCommands` 是结构夹具写入器，并未把所有可选字段（如 event.causality/kind/action、会话replyLimits/timing）写进对应列。M2 与纯函数的逐字段对照必须使用完整的合成投影，不能直接把该结构夹具当作M5无损导入器。缺省causality在真实领域规则中属于不明确依赖，不能为了测试通过改成explicit。

产品边界补充：character类型可按既有权限查询/显示，但手动ChatRuntime.send继续保持当前kanataConversation的拒绝语义；不能把“覆盖character测试”实现为新开人工发言入口。Kanata当前没有旧小家Timeline的quote控件，候选quote预览/按ID跳转须在Kanata窗口独立接线并实测，不改旧小家业务来替代。

只读inventory明确清单：`formyself/kanata-v1.enc`、`.bak`、`.tmp`，`formyself/kanata-pages-v1`，Preferences键`my_kanata_recovery_encrypted_v1`，以及`formyself/restore-v1.enc`、`.commit`、`.tmp`。只执行严格stat/readdir/get；不能调用restoreJournal.inspect作为探针，因为当前inspect在主日志不存在时会清理commit/temp，这违反M2对旧材料零清理的要求。文件读取错误不得当不存在，空归档目录也保守拒绝自动创建。这是编码前源码自审补充，尚不是行为测试通过证据。
