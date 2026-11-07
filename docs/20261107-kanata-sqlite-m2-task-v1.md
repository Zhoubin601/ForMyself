# Kanata SQLite M2｜消息与会话 Repository 工程任务书 v1

日期：2026-11-07（Asia/Shanghai）  
目标分支：M  
任务状态：**READY / NOT STARTED**  
任务类型：生产级 Driver 与 Repository 实现、受保护会话接入、消息路径垂直切片与隔离验收  
基线：任务书建立时 M 分支 HEAD = 85b6587449d98365b315832309cbc44262defda5。Agent 开始时必须重新 fetch 并确认最新 HEAD，不得假设基线仍未变化。

> 本文件是 M2 的完整执行任务书。M2 总体验收条件仍以 [SQLite 迁移总计划](20261103-kanata-sqlite-migration-plan-v1.md) 的 M2 小节为准；本文件把该门禁细化为可执行工作、边界和证据要求。它不代表 M2 已开始或已通过。

---

## 0. 开始前必须读取的依据

按以下优先级阅读，不能只读本任务书就直接写代码：

1. **AGENTS.md**：工作区保护、目录、测试、提交和交付规则。
2. **架构接口与 Agent 开发说明书.md**：尤其第 2、5、6、8、9、11、12、13 节；实际接口以源码为准。
3. **docs/20261103-kanata-sqlite-migration-plan-v1.md**：M0–M7 总体顺序、M2 验收、分支规则和性能测试规范。
4. **docs/20261104-kanata-sqlite-m0-direct-gate-v1.md**：已冻结的直接 SQLCipher 字节密钥、信封、受保护会话与性能参数。
5. **docs/20261106-kanata-sqlite-m1-report-v2.md**：M1 Schema/升级器和 Android SQLCipher 结构验证边界。
6. **docs/20261107-kanata-sqlite-m1-r-audit-v1.md**：M1-R 六项核查、347 字段、108 组外键、审计脱敏、后续 M2 责任。
7. **docs/qa/kanata-sqlite-m1-r/README.md** 及其 evidence：复现命令、环境差异和真实测试证据。
8. 以下当前源码与实际调用链（名称可能随实际结构调整，但必须逐一找到并核对）：
   - src/features/chat/storage/sqlite/kanataSchema.js
   - src/features/chat/storage/sqlite/kanataSchemaMigrator.js
   - src/features/chat/storage/sqlite/kanataSchemaHardening.js
   - src/features/chat/storage/sqlite/kanataSchemaTypes.d.ts
   - src/features/chat/storage/kanataRepository.js
   - src/features/chat/storage/messageArchiveRepository.js
   - src/features/chat/kanataStore.js
   - src/features/chat/experience/kanataEvents.js
   - src/features/chat/KanataConversationView.vue
   - src/features/chat/ChatTimeline.vue
   - src/application/kanataChatRuntime.js
   - src/application/protectedModules.js
   - src/stores/protectedAccess.js
   - src/application/restoreCoordinator.js
   - src/application/ordinaryModules.js
   - Android 原生入口、Capacitor 注册、Gradle 依赖、package.json 与 lockfile。

源码、类型、测试共同描述当前真实实现。历史报告不能覆盖当前代码；如果发现文档与实现不一致，先记录差异并以真实源码为准，不得默默沿用过时描述。

## 1. M2 目标

在不破坏既有 Kanata 数据和全局安全架构的前提下，完成消息与会话访问的 SQLite 垂直切片：

1. 建立可用于生产集成的 Android SQLCipher Driver，使用 M0 已验证的直接字节密钥方案，不使用会持久化明文/插件 secret 的旧式接口。
2. 建立可注入、可测试的消息 Repository 与会话 Repository；业务层不依赖 Capacitor 插件，也不直接拼接或执行 SQL。
3. 把查询、写入、分页、编辑、删除、重试、状态更新和群聊成员读取封装为明确领域接口。
4. 所有业务写入使用受保护会话和有效 operation lease；锁定、后台、会话变化和销毁时撤销连接能力。
5. 以稳定 keyset cursor 实现最近消息、向前分页、按 ID 跳转和引用回复查询。
6. 消息 UI 与 AI 上下文使用有界消息窗口，不再依赖全量历史数组完成当前会话操作。
7. 保留现有群聊 speaker、消息气泡、引用、重试、编辑、删除、事件/记忆来源与审计语义。
8. 使用真实 Android SQLCipher 原生桥接执行 JS Schema 升级器和 Repository 集成测试；不能只编译 APK 或只跑原生 JUnit 就声称通过。
9. 完成定向、负向、故障、生命周期、UI/运行时和完整项目回归，进行两轮有实质内容的自检并留证据。

**M2 的核心交付是 Driver + Repository + 可验证的消息访问切片，不是整库迁移完成。**

## 2. 严格范围边界

### 2.1 本轮允许

- Android 生产候选 SQLCipher Driver 和最小原生桥接。
- JS/TS Driver contract、事务 contract、Repository contract 与 strict 类型负向样例。
- M1 Schema 的实际连接适配和版本升级调用。
- 消息、会话、参与者及消息审计所需的 SQL Repository。
- 为保留现有消息删除契约而必须在同一事务内执行的最小派生失效 SQL。
- 受保护会话、operation lease、迟到结果丢弃、连接关闭和敏感缓冲区生命周期。
- 消息列表、历史分页、原消息定位、引用预览、群聊 speaker 和 AI 上下文的必要接线与回归。
- 独立合成 QA App / 隔离测试环境、Android instrumentation、JS-to-native 实际集成驱动。
- 为 M2 必需且有证据支持的 Schema 变更。若确实需要，必须追加新 migration（从 004 开始），绝不修改 001/002/003 的 DDL 或 checksum。

### 2.2 本轮禁止

- 不实现 M3 的世界、角色卡、角色实例、世界书、记忆、事件、effects、关系、自治任务、授权和统计的通用 Repository。
- 不实现 M4 的全应用 Pinia/Store 全量重构；M2 只把消息访问改为有界 Repository 窗口，不宣称整个 KanataData 已脱离内存。
- 不实现 M5 的旧 JSON 主数据、messageArchives 加密归档的完整导入器、数据迁移 journal 或旧数据清理。
- 不实现 M6 的便携备份 V3、完整恢复切换、全局改密/DEK 重包装故障恢复协议。
- 不执行 M7 的 1k/10k/100k 整应用容量放行，不修改 P7 门槛。
- 不迁移 ForMyself 的心情、体重、日程、储蓄、密码库等其他业务。
- 不把旧「温馨小家」聊天数据导入 Kanata；不更改既有产品决定。
- 不改 Kanata/main 分支，不合并 main，不创建发布版 APK，不发布应用。
- 不读取、导入、删除或覆盖真实用户聊天数据，不使用真实主密码、API Key 或真实备份作为测试夹具。

### 2.3 最重要的数据切换保护

M1 只建立 Schema，不代表已有 JSON/归档数据已进入 SQLite。M5 才负责旧数据导入。M6 才负责完整备份/恢复和全局改密安全闭环。

因此：

- **禁止**因为 SQLite 数据库不存在或为空，就把已有用户识别为新用户。
- **禁止**在旧 JSON、旧备份副本、旧归档页或恢复记录存在时自动创建空 SQLite 并将其作为 canonical 数据源。
- **禁止**同时向旧 JSON 和 SQLite 双写，禁止“先写一边、失败后悄悄切另一边”的双主策略。
- **禁止**SQLite 读取/解密/Schema 错误时静默回退到旧 JSON，再把旧 JSON 写回 SQLite 或覆盖任一副本。
- **禁止**在 M2 删除、改名、清理旧文件、归档页或恢复材料。

M2 开始前必须先完成一张真实数据状态矩阵，至少覆盖：
1. 无 SQLite DB、无 envelope、无任何旧 Kanata 数据；
2. 无 SQLite DB/envelope，但旧主文件、备份副本、临时文件、归档页或恢复记录存在；
3. DB 与 envelope 同时存在且可打开；
4. DB/envelope 只有一方存在；
5. DB 存在但 envelope 错误、损坏、错密或缺失；
6. Schema 未知未来版本、结构不完整、迁移日志损坏；
7. 数据库可打开但外键、完整性或密文校验失败。

对每种状态定义唯一结果、错误码、是否允许写入和是否保留原材料。

**默认安全策略：** 如果 M3/M4/M5/M6 尚未完成，且当前真实生产 Store 无法在不丢失世界/角色/备份/改密语义的情况下安全切换，则保留现有生产 canonical 路径；将新 Driver/Repository 作为可注入的生产实现，通过真实 SQLCipher 合成数据和 UI/runtime 注入测试验收。增加明确的未启用状态/组合根门禁，不能用一个默认打开的 feature flag 暗中切流。M2 可以交付完整可用的 Repository，但不得冒称已有用户数据已切换。

只有在证明完整依赖、备份、改密、恢复和旧数据状态均安全后，才允许提出更大范围切换；这类跨阶段切换不得自行扩展，必须停下说明并等待用户确认。

## 3. Android SQLCipher Driver 与原生桥接

### 3.1 选型和依赖

M0 的直接桥接候选在 docs/qa/kanata-sqlite-m0/，重点核对：

- M0 QA 实际候选：Capacitor 8.4.1、SQLCipher Community 4.17.0。
- 直接 SQLCipher 字节密钥 API，而不是 Capacitor 社区插件的持久化 secret API。
- 原型代码包括 M0DirectPlugin.java、SqlCipherM0SessionTest.java、app.mjs、key-envelope.mjs、build-android.mjs。
- 主机 SQLCipher 4.12.0 与 Android SQLCipher 4.17.0 是不同验证环境，报告必须分开标注。

先检查当前生产根 package/lock、Android Gradle 与插件注册。不得因为 QA 项目版本不同而静默升级根 Capacitor、Gradle、JDK 或 SQLCipher。若生产依赖与 M0 QA 版本不同，先做兼容性差异表和真实构建验证；任何升级必须说明必要性、影响和回滚方式。

M0 原型是 QA 证据，不是可直接复制的生产实现。不得把固定 QA 数据库名、任意 SQL、测试 SharedPreferences、测试日志、测试按钮或 prototype 路径带入生产。

### 3.2 密钥和信封协议

以 M0 direct gate 的冻结协议为依据，不另创第二套密码体系：

- 主密码仍由现有认证系统管理；不得新建一套主密码、认证 UI 或密码持久化。
- WebCrypto 派生 KEK：PBKDF2-HMAC-SHA256，600,000 次，256-bit KEK，16-byte 随机 salt，并保留 M0 的 domain separation。
- DEK 为 256-bit 随机密钥，由原生侧生成。
- 使用 AES-256-GCM 包装 DEK，12-byte 随机 nonce、128-bit authentication tag。
- envelope version/purpose/KDF/cipher/salt/nonce/ciphertext/AAD 的编码和字段顺序必须与 M0 兼容；若需改变必须新版本化，不能悄悄更改 AAD。
- envelope 使用 Android App 私有目录和 AtomicFile 语义，写入后读回验证；不能写入普通 Preferences、日志、命令行、环境变量或普通文件明文。
- 原始 DEK 只在受控原生内存中用于打开 SQLCipher；尽最大可能清零本代码持有的 byte[]、KEK、DEK 和临时密钥文本。必须说明 Java/JS/运行时复制无法被保证物理清零的边界，不能夸大。
- 错误密钥、损坏 envelope、未知版本和认证标签失败统一返回固定安全错误，不泄露原生异常、SQL、绑定参数或密钥材料。

首次创建必须定义 DB/envelope 的可恢复顺序和中断状态；DB 与 envelope 不能只有一方却继续初始化。首次创建、迁移失败和进程强停必须可检测、可恢复或明确拒绝，不允许静默重建。

### 3.3 受保护会话和 operation lease

必须接入现有架构，不得另建旁路认证：

- 复用 src/stores/protectedAccess.js 的 authenticate / ensureModule / runOperation 语义。
- 受保护操作通过现有 chat 模块租约执行；不直接读取或缓存主密码，不绕过 auth.sessionRevision。
- 按 M0 设计采用一次性 challenge：有随机 token、短时有效（原型为 30 秒）、单次消费；拒绝过期、重放、错误会话和后台调用。
- 原生端同时检查 App 前台状态和当前 lease；不能只依赖 JS 页面按钮是否禁用。
- 每个数据库操作都必须带有效 lease 或由受控连接上下文证明 lease 有效；不能暴露可被 UI/普通模块直接调用的原生数据库句柄。
- App pause/background、显式锁定、会话 revision 改变、受保护 Store release、插件 destroy 时撤销 challenge/lease、停止新请求、关闭数据库连接并清理缓冲区。
- 已开始的写事务必须按定义完成或回滚；锁定后不允许新操作进入。迟到的查询/AI/分页结果必须检查 owner generation 与 sessionRevision，失效后丢弃，不能写回新会话或新世界。
- 并发操作、连接关闭与释放之间必须有明确串行化规则；不得出现 close 与 transaction 交错。

### 3.4 Driver 契约

建立平台无关的 Driver contract，Android 原生桥接只是一个实现。接口至少明确：

- open/create、unlock/lease、close/release、health/schema probe；
- 参数化 query、execute、批量写入；
- 独占事务、回调失败回滚、COMMIT 失败回滚；
- execute 必须可靠返回 affectedRows（及需要时 lastInsertRowId），供 CAS 判定；不能用“没有抛异常”冒充写入成功；
- 统一固定错误码，不向 UI 泄露 SQL 或原生错误正文；
- 连接状态、前台状态、sessionRevision/generation、取消和迟到结果处理；
- migration adapter 能满足现有 KanataSchemaConnection.transaction 的要求。

M1 的 KanataSchemaConnection 是 Schema migration 专用接口，不足以直接表达 M2 的 affectedRows/CAS。可增加业务事务 contract 或安全扩展，但不能偷偷改变旧接口语义。同步更新 contracts.d.ts、实际类型入口、strict 正负向样例和行为测试。

### 3.5 SQLite 连接参数

保留 M0/M1 已验证约定，任何变更必须有真实证据：

- WAL；
- synchronous=FULL；
- cache_size=-2048（约 2 MiB）；
- checkpoint 阈值按 M0 冻结值 1000 pages；
- 单批写入最多 256 条；
- 单次 Repository 分页最多 50 条；
- Android 显式 NO_LOCALIZED_COLLATORS，保证二进制排序；
- 对整个连接池执行 setForeignKeyConstraintsEnabled(true)，不能只对某条连接执行一次 PRAGMA；
- 使用 M1 已验证的外键、Schema 结构与未知结构拒绝策略；
- 事务使用独占 BEGIN IMMEDIATE 语义；不能嵌套事务或让普通写入穿插到事务中；
- 具体 busy timeout、checkpoint 执行时机和连接池数量以真实源码/实测决定并记录，不得凭空给出性能结论。

不能删除陌生表、忽略未知 Android 表或放宽严格结构目录来让数据库“看起来能打开”。

## 4. 消息与会话 Repository

### 4.1 领域接口

在现有 feature/storage 分层内设计最小、清晰、可注入的接口。建议职责分离为：

**KanataMessageRepository**
- 单条消息插入；
- 有界批量插入；
- 按 worldId + conversationId 查询最近消息；
- 使用 cursor 查询更早消息；
- 按消息 ID 在正确世界/会话范围内定位原消息；
- 获取引用回复所需的目标消息摘要；
- 更新消息状态、流式完成状态和重试状态；
- 基于 expectedRevision 编辑消息；
- 基于 expectedRevision 删除消息并执行审计/派生失效；
- 提供 count/hasMore 等有界查询结果。

**KanataConversationRepository**
- 按 worldId 列出会话；
- 读取会话详情和参与者；
- 创建或更新 M2 当前调用链确实需要的会话字段；
- 对会话 revision 做乐观并发检查；
- 保留 private/group/character 类型和参与者 kind/speaker 顺序语义；
- 不提供 M3 的世界、角色卡、记忆、事件等通用 CRUD。

接口名称可以按实际代码调整，但职责、作用域、错误语义和验收行为不能遗漏。先审计所有真实调用点，再冻结接口，不能为了少改代码而保留一个暗中全量读写 KanataData 的大接口。

### 4.2 消息写入与幂等

- 单条消息新增只能插入/更新目标消息行，不得序列化、克隆或重写全部历史消息。
- 批量插入上限 256，单批事务原子提交；超过上限拆批必须由调用者显式迭代并有中断语义，不能偷偷吞掉后续批次。
- 以稳定 message ID 作为幂等边界。重复相同 ID、相同作用域、相同内容的请求可以按明确契约返回已存在结果；同 ID 不同世界/会话/内容必须拒绝，不能覆盖。
- 禁止使用 INSERT OR REPLACE、INSERT OR IGNORE 或 UPSERT 绕过 M1-R 全局 entity_ids / 审计触发器保护。
- 失败、重复请求、断线、重试和进程强停后不能产生半条消息、重复消息或虚假成功状态。
- 流式回复每次持久化只触及当前消息，不得每个 token/气泡都写整段历史；应按现有 UI/AI 流式语义确定安全写入粒度，并确保取消后已提交内容和状态一致。

### 4.3 CAS、revision 和审计原子性

- 对消息编辑/删除/状态变化，必须检查 expectedRevision。
- SQL 更新必须以 message ID + world ID + conversation ID + expectedRevision 为条件；affectedRows 必须恰好为 1。
- revision 按现有领域契约单调递增；不能以 wall-clock 时间代替 revision 顺序。
- message_audits 的 previous_json/next_json 必须对应真实旧/新快照，绑定真实消息不可变身份、世界、会话、发言者和 revision。
- 业务记录更新、revision 更新、审计插入、必要的派生失效必须在同一事务内。
- 并发两个编辑只允许一个基于同一 expectedRevision 成功；另一个返回固定冲突错误，不得覆盖先提交版本。
- 审计表继续遵守 M1-R 的不可变约束。普通 UPDATE/DELETE、OR REPLACE/IGNORE、重复或重叠 revision 区间都必须被拒绝。

### 4.4 删除隐私语义与派生失效（M2 强制项）

这是 M1-R 明确交给 M2 的责任，不得推迟成“后续再做”：

必须对照 src/features/chat/experience/kanataEvents.js 的 reviseKanataMessage，保留当前实际行为。删除命令至少包括：

1. 对目标消息进行 expectedRevision CAS。
2. 找出其回复后代，保持现有后代停用/状态与 revision 规则。
3. 查找引用这些消息 revision 的 memories、events 及因果后代。
4. 对不明确的因果依赖继续拒绝，不能自行选择“保留独立”或“标记待复核”来绕过用户原确认。
5. 对受影响 memory 标记 stale；对受影响 event 按现有语义标记 needsReview；需要更新的 effects、instance、relationship revision 必须与纯领域函数的真实行为一致。
6. 每个发生 revision 变化的消息/event 写入对应审计；event_audits 继续只追加，不开放修改。
7. 当前消息先变为 deleted=true，正文使用既有固定标记“（已删除的原始记录）”。
8. 对该消息所有已存 message_audits，必须用 M1-R 允许的 SQL json_set 方式，只修改 previous/next 中的 content 与 deleted；保留 ID、时间、revision、扩展字段及其他 JSON 字段，不得先在 JS 解析再 stringify 重排 JSON。
9. 当前消息、历史正文脱敏、新 message audit、回复后代状态、memory/event 派生失效和相关审计必须同一事务提交；任一步失败整笔回滚。
10. 任何失败不得出现“当前消息已删除但历史正文未脱敏”或“正文已清除但审计/派生状态未更新”的半状态。

M2 不要求建立 M3 通用业务 Repository，但为维持既有删除契约，可以实现一个内聚的、仅由消息删除命令调用的内部事务协调器。若当前 Schema/数据不足以完整复现纯领域函数语义，必须保留失败证据并标记 M2 BLOCKED，不能简化删除行为后宣称通过。

### 4.5 Cursor 与分页

- 默认单页不超过 50 条，沿用 M0 的有界读取参数。
- 排序固定为 created_at DESC, id DESC；同时间戳必须稳定。
- 使用 keyset/cursor，不使用大 OFFSET。
- cursor 至少绑定版本、worldId、conversationId 和完整排序锚点；不得跨世界/会话复用。
- cursor 不合法、过期版本、作用域不匹配时返回固定错误，不允许静默重置为第一页。
- 最近消息、向前翻页、按 ID 跳转、引用回复预览都必须有实际 SQL 查询和边界测试。
- hasMore 必须通过有界查询准确判断，不能先读全表计算。
- 任何分页查询不得将完整 messageArchives 或全会话消息载入 JS。

### 4.6 会话与群聊

- 私聊、character、group 的现有语义保持。
- 会话成员必须与真实 world_id、participant ID、kind 绑定；跨世界成员继续由 M1 复合外键拒绝。
- 群聊 speaker 的选择、显示名、顺序、@解析、已保存角色数、每轮回复上限和失败重试语义不得变化。
- quote/replyTo 必须仍指向同一世界和会话内真实消息；引用目标不存在或被脱敏时显示现有安全降级，不伪造原文。
- 会话配置更新使用 expectedRevision；并发更新冲突必须可观察。
- M2 不擅自改变 group 成员编辑、失效 roleBinding 或会话删除策略。

## 5. UI、Store 和 AI Runtime 接线

重点核对：
- src/features/chat/kanataStore.js
- src/features/chat/KanataConversationView.vue
- src/features/chat/ChatTimeline.vue
- src/features/chat/KanataHistoryPanel.vue
- src/application/kanataChatRuntime.js
- 所有调用 store.snapshot.messages、store.update、历史归档和引用跳转的模块。

### 5.1 有界消息窗口

当前 KanataConversationView 从 snapshot.messages 过滤会话后取最近 100 条；这是现状，不是允许继续依赖全量历史的理由。

M2 需要：
- 当前会话使用 Repository 加载最近消息；
- 单页最多 50 条；内存窗口保持有界，默认不得超过现有 UI 100 条的量级，确需调整必须说明并测试；
- 向前翻页时保持滚动锚点，避免旧消息插入后跳到底部；
- 切换世界/会话、快速连续切换、组件卸载、锁定和请求取消后，旧请求结果不能更新新页面；
- 进入历史、跳转原消息和引用回复必须按需查询，不把完整历史恢复到 Store；
- bubble reveal 只消费当前有界窗口，不触发额外持久化或历史复制；
- 现有消息加载、保存失败、重试、删除确认和归档错误状态仍可观察。

M2 不等于 M4：非消息领域数据仍可暂时保留现有 Store 表示，但消息不能再把全量数组当作 Repository 的 canonical 数据源。需要消息数据的其他业务调用点必须逐一列出，明确改为有界查询、目标消息查询或在 M3 处理的依赖，不得悄悄保留一条全量回读旁路。

### 5.2 AI 上下文

- AI 当前会话上下文只从目标世界/会话按需读取必要消息，保留现有上下文窗口、角色人格、群聊 speaker、引用和权限边界。
- 不把数据库全表、其他世界、其他会话、归档页或无权限来源传给模型。
- 用户消息、AI 回复、流式分段、取消、重试和延迟回复任务必须保持原有顺序与持久化语义。
- 每次异步模型响应在写入前重新校验 sessionRevision、world/conversation owner、消息 revision 和当前请求 generation。
- 会话切换或锁定后的迟到回复不得写入新会话。
- 不增加真实模型请求；QA 使用 controlled provider 或 mock，明确记录 0 次真实 API 请求。

### 5.3 UI 不直接碰 Driver

View、Pinia 组件和普通业务模块不得直接导入 Capacitor 原生插件或 SQL。调用链必须为 UI/Runtime → Repository/Domain command → Driver → Native SQLCipher。平台选择在组合根注入，不散落 platform if/else。

## 6. 受保护会话、生命周期与失败语义

必须满足架构说明书第 8、9 节和 M0 direct gate：

- 普通聊天操作先通过现有恢复写门禁；不能从 UI 直接调用底层 Driver 绕过 restoreCoordinator。
- Driver 打开、查询、写入、flush、close 均受 session/lease 约束。
- 加载失败、解密失败、Schema 错误、未知版本、恢复阻断、保存失败不得当作空世界/空会话。
- 读取与校验全部成功后才能向 Store 提交数据；失败保留旧值和原始文件。
- 写失败保留可重试状态；不能吞掉异常后返回成功。
- release 必须取消订阅/请求、等待允许完成的事务、拒绝新请求、关闭连接、清理明文和 lease。
- 连接关闭失败或恢复状态不明时，保持保护，不允许自动创建新数据库。
- 对 lock/background/destroy/会话 revision 变化/页面卸载/数据库错误逐一做真实测试。
- 不修改全局主密码体系；M6 负责完整 DEK 重包装、备份/恢复与改密崩溃协调。M2 不得宣称这些能力已通过，也不得在未实现安全回滚的情况下把 SQLite 作为真实用户 canonical 数据源。

## 7. 测试与证据矩阵

所有测试仅使用可复现合成数据。记录随机种子、夹具版本、数据指纹、Schema SHA、代码 SHA、设备/API、SQLCipher 版本和真实命令退出码。

### 7.1 Node / Driver / Repository

至少覆盖：

- 空库创建与逐版升级；旧 v1/v2/v3 Schema 打开和幂等；未知未来版本、未知结构、错误 application_id、损坏迁移日志零写入拒绝。
- 单条/批量写入；批次边界 1/50/256/257；失败原子回滚。
- 同 ID 同内容幂等；同 ID 不同内容拒绝；跨世界/会话重复 ID 拒绝。
- 最近页、向前分页、同时间戳、重复时间戳、最早/最新边界、空结果、hasMore、cursor 跨会话/跨世界复用拒绝。
- 按 ID 定位和 replyTo 预览；目标不存在、目标被删除/脱敏和跨会话引用。
- CAS 两写者竞争；过期 revision、重复请求、提交失败和重启重试。
- message_audits 完整 previous/next；普通改删/替换/重复/重叠区间拒绝。
- 删除的历史 JSON 精确脱敏；扩展字段保留；回复后代、memory/event/effects 派生语义与原纯函数逐项一致；任意事务点失败整笔回滚。
- SQL 注入字符串只作为参数值处理；SQL 不拼接用户内容；Driver 错误不泄露 SQL/参数。
- release 后旧 lease 拒绝；迟到查询丢弃；close/transaction 竞争不产生悬挂连接。
- 全量历史未进入 JS：通过查询条数、返回 payload、内存对象计数或可观察测试证明；不能只用源码正则。
- 事务内执行顺序和 affectedRows 真实验证；不能以 mock 的“成功 Promise”代替所有数据库测试。

优先复用 Node 24 node:sqlite 与 M1 已有 fixture/harness；若使用新测试 Driver，必须另有真实 SQLCipher/Android 实测，不得把 fake driver 结果标记为原生通过。

### 7.2 主机 SQLCipher

复用 M0/M1 QA 工具与独立合成密钥，核验：
- 实际 JS Driver/Repository 调用 SQLCipher；
- 正确密钥打开，错误密钥拒绝；
- 普通 SQLite 无法读取明文；
- PRAGMA cipher_version、cipher_integrity_check、integrity_check、foreign_key_check；
- 事务、CAS、审计、脱敏、分页、关闭重开；
- SIGKILL 发生在事务未提交时，重开无半状态；
- 密钥只通过受控 stdin/内存，不写 argv/env/日志/证据。

主机 SQLCipher 4.12.0 结果不得冒充 Android SQLCipher 4.17.0。

### 7.3 Android 真实桥接与 JS E2E

必须在任务专用隔离 API 34 合成 AVD 执行，先核对设备序列号、AVD 身份、安装包身份、syntheticOnly 标记和启动状态。不能因为设备名含 emulator 就假设没有真实资料。

必须实际运行：
- 生产候选 Android 插件构建与 instrumentation；
- Capacitor 注册后的 JS 调用；
- JS 端调用 migrateKanataSchema；
- JS Repository 单条/批量写入、查询、分页、CAS、审计与删除；
- close/reopen 后读回；
- 锁定、后台、session revision 变化后旧 lease 拒绝；
- 错密、challenge 重放/过期、连接池 FK、WAL 和加密检查；
- 在事务未提交时强停 App，重新启动后验证无半条业务/审计状态。

只有 Android 原生 JUnit 通过但未执行 JS-to-native 生产 Driver 的，不能算 M2 Android 集成 PASS。没有运行的项目明确标 NOT RUN / BLOCKED，不得用构建成功代替。

### 7.4 项目级回归

- 运行 npm run check；
- 运行本轮全部新增定向 Node/Vitest/strict 类型测试；
- 运行 Android Debug 与 AndroidTest 构建；
- 运行隔离模拟器 instrumentation / JS E2E；
- 运行 git diff --check、文档链接/路径检查、Schema 目录生成一致性检查；
- UI 覆盖私聊、character、group、speaker 选择、引用、重试、编辑、删除、历史翻页、会话快速切换和锁定；
- 对 M2 未覆盖的 M3/M4/M5/M6/M7 项明确列为后续，不得写成已通过。

## 8. 两轮独立自检

必须在实现完成后进行两轮不同角度的实质自检，不能只写“已检查无问题”。

**第一轮：安全、存储与并发**
- 原生密钥边界、envelope/AAD、挑战/lease、后台撤销、迟到结果、连接关闭；
- 事务隔离、CAS、affectedRows、审计不可变、删除隐私脱敏；
- WAL、FK、Schema 升级、损坏库、强停、恢复门禁；
- 至少主动构造反例，记录发现、修复和重测。

**第二轮：产品语义、兼容与证据**
- 对照现有 KanataChatRuntime、KanataConversationView、ChatTimeline、KanataHistoryPanel 和纯领域函数；
- 核对群聊 speaker、引用、AI 上下文、重试、状态、流式、删除派生语义；
- 核对 M2/M3/M4/M5/M6 边界、旧用户数据安全、备份/改密未完成时的激活门禁；
- 核对测试是真实执行、设备/APK/代码/Schema 指纹匹配、报告不夸大；
- 发现问题后修复并重新运行受影响测试与最终完整 check。

“独立”指审查角度和重新验证分离，不得声称调用了并不存在的外部 Agent 或第三方审计。

## 9. 交付文件与阶段门禁

### 9.1 必须交付

- Driver / Native bridge / Repository / Runtime 相关实现；
- contracts.d.ts、真实类型入口、strict 正负向样例；
- Node、SQLCipher、Android instrumentation 和 JS-to-native E2E 测试；
- docs/qa/kanata-sqlite-m2/：可复现脚本、合成夹具、原始日志、设备信息、指纹与机器汇总；
- docs/20261107-kanata-sqlite-m2-acceptance-v1.md：正式阶段报告；
- 如接口/生命周期/注册点发生变化，同步更新架构接口说明书；
- 更新 README.md、docs/plan.md、SQLite 总迁移计划中的 M2 当前状态与链接；
- 更新 memory-bank 中确实长期有用的稳定交接信息；不要把临时草稿或密钥写入 memory-bank；
- output/ 可放正式验收交付副本，但该目录可能被 Git 忽略；GitHub 上的正式入口必须放在 docs/，不能只交本地 output 文件。

### 9.2 M2 验收矩阵

| 门禁 | 必须证明 |
|---|---|
| Driver 与加密 | Android 真实 SQLCipher、直接 DEK 字节密钥、信封与 M0 兼容、无明文 secret |
| 受保护会话 | 真实 operation lease、锁定/后台撤销、迟到结果丢弃、连接安全关闭 |
| Schema | 复用 M1 升级器，001/002/003 checksum 不变，未知版本拒写 |
| Repository | 消息/会话接口完整，参数化 SQL，affectedRows/CAS 可靠 |
| 写入/审计 | 单条/批量增量写入，业务/审计/派生状态同事务 |
| 删除隐私 | 当前与历史正文按 M1-R 精确不可逆脱敏，其他字段不变 |
| 分页 | 稳定 keyset，cursor 绑定 world/conversation，单页≤50 |
| UI/Store | 有界窗口、快速切换无迟到污染，群聊/引用/重试/气泡语义保持 |
| AI | 上下文按需读取、权限/作用域不扩大、迟到结果拒绝 |
| 故障 | 事务失败、COMMIT 失败、SIGKILL、重开、错误密钥和 lease 失效安全 |
| 回归 | npm run check、定向测试、真实 Android JS-to-native E2E 通过 |
| 证据 | 两轮自检、机器汇总、原始日志、代码/DDL/夹具/APK 指纹可追溯 |

每项必须标 PASS / FAIL / BLOCKED / NOT RUN，并附真实证据。不能以总体通过率抵消一个安全关键项失败。

### 9.3 阶段结论

- **PASS**：全部强制门禁通过，生产候选实现范围和未覆盖边界明确，正式报告与证据齐全。
- **BLOCKED**：实现基本完成，但设备、密钥、数据切换、依赖或环境关键证据未运行；不得进入 M3。
- **FAIL**：出现数据丢失、审计不一致、跨世界访问、错误密钥可打开、锁定后仍可写、半事务或无法回滚等关键问题。
- **NOT RUN**：明确没有执行，不得用构建/静态检查替代。

M2 未 PASS 前不开始 M3。M2 PASS 也不代表 M3/M4/M5/M6/M7 或 P7 已通过。

## 10. Git 与工作区规则

1. 只在 M 分支工作。开始时先 fetch、核对最新 HEAD、git status、未跟踪文件和现有 diff。
2. 不 reset、clean、强制 checkout、覆盖用户改动或删除未知文件；不为了干净工作区清除用户数据。
3. 只提交本轮必要代码、测试、文档和 QA 证据；不把 work、APK、真实资料、密钥或临时文件提交。
4. 允许 M2 普通阶段 checkpoint commit；用户已要求开始 M2 并将任务书保存到 GitHub，允许本阶段必要的普通提交并推送 M 分支。
5. 禁止 force push、修改 Kanata/main、合并 main、创建发布、上传正式 APK、清理真实旧数据。
6. 每次提交前检查 git diff、git status、git diff --check、测试证据和文件范围；报告提交 SHA 与远端 HEAD。
7. 如果工作区已有非本任务修改，先隔离并保留，不得覆盖；必要时停下说明。

## 11. Agent 执行顺序

按以下顺序连续执行，不要跳过预检直接大规模改代码：

1. **Preflight**：读取全部依据；fetch M；核对工作区；列出实际代码调用链、依赖版本、生产/QA差异、消息全量引用点和安全边界。
2. **设计冻结**：写 docs/20261107-kanata-sqlite-m2-design-v1.md，包含 Driver API、lease 状态机、envelope 生命周期、事务/CAS、Repository API、消息窗口、数据切换矩阵、失败码和测试矩阵。先自审一次。
3. **最小原生 Driver**：先完成打开/关闭/错误密钥/lease/FK/WAL/事务/Schema migration，不接 UI。
4. **消息与会话 Repository**：先完成单条/批量、分页、CAS、审计和故障测试，再做删除派生事务。
5. **Runtime/UI 注入**：按实际调用链逐步替换消息读取/写入；保留旧归档兼容和明确的生产启用门禁。
6. **真实 Android 集成**：执行 JS-to-native migration/repository/强停测试，不以单独 JUnit 代替。
7. **第一轮自检**：修复安全/并发/事务问题并重测。
8. **第二轮自检**：修复产品语义/兼容/证据问题并重测。
9. **Final regression**：重新执行完整 npm run check、定向测试、Android 构建和设备集成；记录真实命令、退出码和指纹。
10. **Acceptance**：写正式报告，更新 README / docs/plan / 总计划 / 架构说明，核对链接与 Git 差异。
11. **Commit/push**：普通提交并推送 M，报告 SHA 和链接。只有所有门禁 PASS 才建议进入 M3；否则准确标记 BLOCKED/FAIL 并列明唯一阻塞条件。

## 12. Agent 最终回复格式

最终回复必须简明但信息完整：

- M2：PASS / FAIL / BLOCKED / NOT RUN；
- 基线 HEAD、结束 HEAD、提交 SHA、远端 M HEAD；
- 实际新增/修改文件；
- Driver、Repository、lease、CAS、删除脱敏和 UI 窗口实现情况；
- 定向测试、npm run check、主机 SQLCipher、Android SQLCipher 与 JS-to-native E2E 的实际结果；
- 两轮自检发现的问题、修复与复测；
- 真实旧数据是否仍保持 legacy、生产 SQLite 是否启用、启用条件；
- 未覆盖项、风险和是否建议进入 M3；
- 正式报告、QA 入口和 GitHub 链接。

**不允许**只回复“完成”“测试通过”或只给 commit SHA。没有实际执行的内容必须写 NOT RUN。

---

## M2 放行原则

M2 不是把 SQLCipher 插件接进来就结束。必须同时证明：密钥安全、租约有效、消息 Repository 增量写入、审计/删除事务一致、分页稳定、UI 有界、群聊与 AI 行为不变、真实 Android JS-to-native 路径可复现。

宁可保留明确的 legacy 路径并报告 BLOCKED，也不能用双写、空库初始化、静默回退或提前清理旧文件换取表面上的 PASS。