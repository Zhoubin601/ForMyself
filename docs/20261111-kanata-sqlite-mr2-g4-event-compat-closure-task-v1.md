# Kanata SQLite M4-R · ER1 事件兼容边界收口任务书 v1

**制定日期：** 2026-11-11（北京时间）  
**仓库 / 分支：** Zhoubin601/ForMyself / M（仅 M）  
**任务基线：** 766e768535c02ff187d985c70351b11cb90ea980  
**当前阶段状态：** Event 普通分页读取切片已通过定向验收；事件旧兼容边界、G4、MR2、M4 仍 BLOCKED；M5 NO。  
**任务性质：** M4-R 总合同下的事件兼容收口工作包 ER1。它不替代 M4-R 总合同，不代表 G4、MR2 或 M4 已通过。

> 启动必须重新 fetch 远端 M。若远端 HEAD 已前进，先审查新增提交、工作区和所有 worktree，再从最新 HEAD 接续。不得回退到本文件记录的基线。

## 0. 本轮目标与明确结论

本轮只处理 SQLite 候选架构中的事件兼容边界，目标不是继续给旧完整对象接口做局部性能优化，而是从应用边界移除无界的完整对象契约，同时保留历史数据与领域语义。

本轮必须回答并解决：

1. 候选 SQLite Runtime 是否仍暴露没有真实生产消费者的旧事件包装接口。
2. Repository 的完整 Event、Effect、Audit、关系 ID 和撤销 ID 物化是否可以迁出生产路径。
3. 历史字符串 action 的 UTF-16 object-spread 行为能否在不构造完整 Event 的情况下等价保留。
4. 新分页撤销计划与旧领域撤销语义是否逐项一致；已知差异必须通过 Oracle 明确判定。
5. 事件页面、Runtime、Store 和 WebView 的生命周期及内存证据是否真正闭环。

### 0.1 核心设计决策

**兼容旧数据与旧业务语义，不等于必须保留旧的完整 JS 对象返回接口。**

如果一个接口的契约要求返回完整 Event[]、Effect[]、Audit[]、sourceEventIds、revokeIds 或 uncertainIds，那么调用者最终必须在 JS 中持有随数据规模增长的完整数组/对象图。无论底层 SQL 是否分页，都不能把这种返回契约称为有界。

因此本轮的默认方向是：

- 候选页面和应用 Runtime 只使用 header、分页关系、分页 Effect、Audit header、JSON chunk、acknowledgement 和 compact revocation plan。
- 旧的完整对象构造逻辑迁入 tests/helpers，作为测试 Oracle，不进入生产模块。
- 如果发现真实导出消费者，必须设计显式 chunk/stream sink；不能在 Repository 内重新 gather 成完整对象后返回。
- 不修改生产 canonical 的 legacy 存储实现，不删除旧数据，不改变 Schema 001–004。
- 任何无法确认的历史语义必须停止并报告，不得通过截断、忽略未知字段或改变错误码来取得 PASS。

### 0.2 可行性判断

| 子项 | 可行性 | 判断 |
|---|---|---|
| 迁移/移除候选 Runtime 旧包装 | 高 | 当前候选 Event Ledger 已使用 acknowledgement、managed detail 和分页撤销 API；仍须全仓确认无其他真实消费者 |
| 移除 Repository 完整对象 Facade | 高至中 | 现有分页 API 已覆盖大部分页面能力；测试中仍大量直接使用 events.legacy，需迁移到新 API 与测试专用 Oracle |
| eventFromRow / loadEvent 退出生产路径 | 中高 | 已知调用集中在旧 Repository Facade 和历史字符串 action 回退；必须完成全仓调用审计 |
| 字符串 action 字段级兼容 | 中 | 可将转换限制到 action 字段，但必须证明 UTF-16、代理对、孤立 surrogate 和 JSON 往返等价；不得假设字段已有长度上限 |
| 撤销预览语义等价 | 中 | 新旧选择、签名和批次顺序存在待核对差异，必须先建 Oracle，再决定是否调整候选 SQL |
| UI 生命周期与对象留存取证 | 中 | 已有 Runtime owner guard、组件卸载清理和 Heap/PSS 采样；还需补齐事件页面组合与 retained object 分类 |

## 1. 权威基线与必须阅读的资料

启动后按最新 HEAD 重新核对：

1. AGENTS.md
2. 架构接口与Agent开发说明书.md
3. memory-bank/development-context.md
4. raw/完整需求清单.txt
5. raw/彼方 · Kanata 技术设计.txt
6. docs/20261110-kanata-sqlite-m4-r-closeout-task-v1.md
7. docs/20261110-kanata-sqlite-mr2-g4-event-read-compat-task-v1.md
8. docs/20261111-kanata-sqlite-mr2-g4-acceptance-v3.md
9. docs/qa/kanata-sqlite-m4/m4-r/README.md
10. docs/qa/kanata-sqlite-m4/m4-r/g4-call-map.md
11. docs/qa/kanata-sqlite-m4/m4-r/event-provenance-audit.md
12. docs/qa/kanata-sqlite-m4/m4-r/matrix.md
13. docs/qa/kanata-sqlite-m4/m4-r/reviews.md

原始资料 raw/ 只读，不得修改、重命名、移动或覆盖。实际源码、当前类型和可复现测试优先于过期文档数字；历史验收只能作为历史证据，不能冒充当前代码树的复测。

## 2. 最新基线已确认的源码事实

以下来自任务基线 766e768535c02ff187d985c70351b11cb90ea980。执行时必须重新核对，不得直接假设 HEAD 未变化。

### 2.1 已有的有界候选 API

src/features/chat/storage/sqlite/kanataEventRead.js 已提供：

- list：最多 50 条事件摘要。
- readFor：授权后读取单条 header，不返回完整关系数组。
- relations：参与者、前因、消息来源、生活来源分别分页。
- effects：Effect 分页。
- audits：Audit header 分页。
- jsonChunk：扩展、摘要、关系成员、Effect 字段及 Audit snapshot 分块。
- 游标绑定 world、event、revision、scope、kind 等身份。

src/application/kanataSqliteWorldRuntime.js 已将分页 cursor 绑定 Runtime owner，并提供 eventReadFor、eventRelations、eventEffects、eventAudits、eventJsonChunk 等有界包装。

src/features/chat/KanataCandidateEventLedger.vue 已使用：

- eventDetail / managedEvent
- proposeEventAcknowledged
- commitEventAcknowledged
- openRevocation
- confirmRevocation
- correctConfirmedEvent
- revocationAudits
- revocationEffectAudit

候选页面不应重新接入旧完整 Event API。

### 2.2 仍然暴露的旧完整对象接口

src/features/chat/storage/sqlite/kanataEventRepository.js 中的 events.legacy 当前包含：

- list：返回完整 Event[]。
- readFor：返回完整 Event 和完整 lifeSources。
- effects：循环分页后 gather 成完整 Effect[]。
- audits：将 previous_json / next_json 解析成完整 Event snapshot。
- propose / commit / correct：返回完整 Event。
- preview：构造完整 revokeIds 和 uncertainIds。
- revoke：消费完整 ID 数组。
- relationship：构造完整 sourceEventIds。

src/application/kanataSqliteWorldRuntime.js 另暴露 legacyEvents 包装，包含旧 propose、commit、previewRevoke、revokeEvent、correctEvent。

这些接口是否存在真实产品消费者尚须全仓确认。候选页面已使用新接口这一事实，不足以证明其他模块、备份、恢复或外部适配器无人调用。

### 2.3 完整物化的关键位置

- src/features/chat/storage/sqlite/kanataMessageDependents.js：eventFromRow 会读取完整 extensions JSON，gather 参与者、causes、sources、lifeSources，并构造完整 Event。
- src/features/chat/storage/sqlite/kanataEventRepository.js：loadEvent、eventProvenance、authorizeEvent、旧 preview/revoke/correct 和旧 read/list/effects/audits。
- src/features/chat/storage/sqlite/kanataEventRead.js：materializeAuditSnapshot 会逐块读取后拼接完整 JSON，再 JSON.parse 为 Event。
- src/features/chat/storage/sqlite/kanataEventSnapshot.js：eventAuditSupport 对 text action 返回 supported=0。
- src/features/chat/storage/sqlite/kanataMessageDependents.js：消息修订遇到 unsupported action 时调用 eventFromRow，并 JSON.stringify 完整 previous/next Event。
- src/features/chat/storage/sqlite/kanataEventRepository.js：commitLegacyStringAction、prepareCorrection、legacyStatus 在历史字符串 action 路径调用 loadEvent。

effectFromRow 仍被普通 Effect 分页和 Effect 重放使用，不得因 eventFromRow 的移除而误删。

## 3. ER1-0：接管、工作区保护与完整调用审计

本阶段先只读，不得一开始就改源码。

### 3.1 Git 和工作区

在本地 Codex 仓库中执行并记录：

- git status --short --branch
- git rev-parse HEAD
- git diff --stat
- git diff --name-status
- git worktree list
- git fetch origin
- git rev-parse origin/M

检查 main、M、Kanata 和所有相关 worktree。保护所有既有修改、删除项、未跟踪文件和其他 worktree。

禁止：

- git reset --hard
- git clean
- 强制 checkout 覆盖
- 擅自 stash
- 删除失败证据
- 覆盖用户文件
- force push
- 合并到 main 或 Kanata

### 3.2 全仓调用面审计

使用 ripgrep、TypeScript 类型引用、AST 或等价方法，覆盖 src、tests、scripts、docs 中的真实调用者。

至少搜索：

- legacyEvents
- events.legacy
- legacy.propose / commit / preview / revoke / correct
- legacy.list / readFor / effects / audits / relationship
- eventFromRow
- loadEvent
- materializeAuditSnapshot
- eventProvenance
- authorizeEvent
- commitLegacyStringAction
- eventAuditSupport
- sourceEventIds
- revokeIds / uncertainIds
- JSON.stringify、JSON.parse、gather、readAll、map/filter/reduce、Map/Set 累积和分页后重新聚合。

输出调用矩阵：

| API / 函数 | 真实调用者 | 层级 | 当前返回/暂存对象 | 完整物化位置 | 目标接口 | 是否真实产品依赖 |
|---|---|---|---|---|---|---|

特别区分：

1. 生产 canonical 的 legacy 数据实现。
2. 候选 SQLite Repository 内部的 legacy Facade。
3. 候选 SQLite Runtime 暴露的 legacyEvents。
4. 测试为了生成 fixture 或旧行为 Oracle 而使用的 legacy 方法。
5. 备份、恢复、导出、QA 或脚本的实际消费者。

**不得仅因为某接口名称含 legacy 就删除。也不得仅因为测试在使用就认定它是生产消费者。**

ER1-0 交付：

- 完整调用矩阵。
- 所有 eventFromRow / loadEvent / materializeAuditSnapshot 的调用点。
- 所有旧 Facade 的生产与测试消费者。
- 旧 API 字段、顺序、错误码、权限和幂等语义清单。
- 可迁移项、待确认项及不可安全移除项。

如果发现无法确认的真实消费者，停止该 API 的删除，先报告其依赖契约。

## 4. ER1-1：移除候选 SQLite 的无界完整对象边界

### 4.1 Runtime 边界

优先迁移所有真实消费者到现有有界 API：

| 旧能力 | 目标 |
|---|---|
| 完整 propose / commit 返回值 | proposeAcknowledged / commitAcknowledged + managedEvent |
| 完整事件详情 | readFor header + relations 分页 + jsonChunk |
| 完整 Effect[] | effects 分页 |
| 完整 Audit[] | audits header + jsonChunk |
| 完整关系 sourceEventIds | relationship header + relationshipEvents |
| 完整撤销预览 ID 数组 | openRevocation compact plan + 分页 entries |
| 旧 revoke / correct | confirmRevocation / correctConfirmed |

如果全仓审计证明 legacyEvents 没有真实生产消费者，则从候选 Runtime 删除该包装，并补充类型负例和 Runtime API surface 测试。

如果发现真实消费者，必须先迁移并验证，不允许先删后修。

### 4.2 Repository 边界

在所有真实消费者迁移后，评估从 createKanataEventRepository 的生产返回对象中移除完整对象 legacy Facade。

不得保留以下生产行为：

- 分页后重新 gather 为完整 Event[] / Effect[] / Audit[]。
- 将全部撤销 ID 拼成数组再跨桥传递。
- 将完整 Audit snapshot JSON.parse 成 Event。
- 将关系页全部拼成 sourceEventIds。
- 将分页结果存进全局 Store 后形成完整图。

如果确实存在完整旧格式导出需求：

- 必须显式命名为 export/stream。
- 按 chunk 或逐条 visitor 输出。
- 消费端直接写入目标 sink，不得先收集为完整字符串、数组或对象图。
- 游标绑定 world、event、audit、revision、side 和 owner。
- 取消、权限变化和失败必须终止后续读取。
- 如果现有平台没有安全的流式 sink，不得假装已实现；先报告接口设计。

### 4.3 测试 Oracle 迁移

tests/kanataSqliteDomains.test.js 当前直接调用 events.legacy 的位置较多，包括：

- 事件创建与提交 fixture。
- 旧事件列表和完整 Event 对照。
- Effect/Audit 对照。
- 旧撤销 preview ID 集合。
- relationship.sourceEventIds 对照。
- historical action UTF-16 对照。

将这些旧行为对照迁入 tests/helpers/ 中的独立 test-only Oracle。

要求：

- Oracle 只在测试环境运行。
- 不得从 src 导入完整对象 materializer 作为测试捷径。
- 可以在测试进程内读取合成 SQLite 数据并构造完整对象，因为这是明确的旧行为对照，不是生产调用路径。
- Oracle 的实现应可追溯到旧纯领域逻辑或冻结的历史契约。
- 不得因为删除生产 Facade 而删除旧语义测试。
- 测试创建事件优先使用 acknowledgement API；读取 revision 使用 managedEvent 或已知初始 revision。
- 测试修正、撤销优先使用 compact plan 和确认 API。

### 4.4 删除条件

只有在以下条件全部满足后，才删除：

- legacy Runtime 包装无真实消费者。
- Repository legacy Facade 无真实生产消费者。
- 完整 materializer 的所有生产调用点已迁移。
- 测试 Oracle 已独立。
- TypeScript strict 正负样例通过。
- npm run check 通过。

届时再评估删除：

- loadEvent
- eventFromRow
- materializeAuditSnapshot
- 仅服务于旧 Facade 的 gather / originalOrder / extensionObject
- legacySelection / legacyPlan / legacySignature / legacyStatus
- legacyEventDdl 及仅供旧路径使用的查询和写入
- 仅供旧 Facade 使用的完整 provenance collector

不得误删普通分页读取、Effect 重放、事件审计 SQL 或其他仍有消费者的 visitor。

## 5. ER1-2：历史字符串 action 的字段级兼容

### 5.1 当前问题

eventAuditSupport 对 text action 返回 0，现有代码通过 eventFromRow 完整构造 Event，以保留：

- 空字符串。
- ASCII 字符串。
- BMP 非 ASCII 字符。
- 代理对。
- 孤立 high surrogate / low surrogate。
- 混合字符串。
- action 缺失、null、数组、对象等其他 JSON 类型。

旧 materializer 使用 JavaScript object spread。字符串按 UTF-16 code unit 展开，不是按 Unicode code point 展开。

不得使用 [...text]、Array.from(text) 或 code point 遍历替代 object-spread 语义。

### 5.2 字段级目标

建立仅处理 action 字段的兼容函数或 SQL 路径：

1. 读取事件必要的标量字段和 action 原始值。
2. 只对历史 text action 做 UTF-16 object-spread 等价转换。
3. 保留 action 字段是否存在、空字符串行为、numeric key、属性顺序和 scalar action columns 的覆盖/删除规则。
4. 不读取完整 extensions 对象到 JS。
5. 不读取 participants、causes、sources、lifeSources 来构造 Event。
6. 将转换结果写入事件扩展或审计快照时必须位于同一事务，并受 revision/CAS 保护。
7. 未知扩展字段保持原样，不得因 action 转换而丢失。
8. 事务失败必须完整回滚。

### 5.3 必须覆盖的真实调用路径

逐一检查并处理：

- commitEvent / commitLegacyStringAction。
- prepareCorrection。
- 消息修订 reviseMessageDependents。
- 事件撤销/状态变更和 Audit snapshot。
- 任何其他调用 eventAuditSupport 后因 supported=0 而回退的路径。

不得只修 commit，然后让 correction 或 message invalidation 继续调用 eventFromRow。

### 5.4 转换策略与停止条件

先建立小型可行性 Spike，再选择实现：

- 可以研究 SQLite JSON1 / recursive CTE 生成 UTF-16 code unit 对象。
- 也可以研究只读取 action 字段的 JS 转换，但必须证明字段大小有现成、可信的上限。
- 不得为了方便擅自新增 4096 字符限制。
- 不得修改 Schema 001–004。
- 不得把字符串 action 静默转换成普通空对象。
- 不得丢失 action 原始存在性或未知扩展。
- 不得用完整 Event materializer 作为回退。

如果 SQLCipher 4.17.0 无法无损保留孤立 surrogate，或必须改变历史语义才能避免完整 Event，则保留失败证据，标记 ER1-2 BLOCKED，并提交可选方案等待用户决策。不得强行宣布 PASS。

### 5.5 Action Oracle

至少覆盖：

| 输入 | 必须验证 |
|---|---|
| 空字符串 | action 仍存在，展开对象为空 |
| ASCII | 每个 UTF-16 code unit 的 numeric key/value |
| BMP 非 ASCII | 字符和值精确一致 |
| 代理对 | 两个 UTF-16 code unit，不得变成一个 code point |
| 孤立 high surrogate | 原值与 JSON 往返精确 |
| 孤立 low surrogate | 原值与 JSON 往返精确 |
| 混合字符串 | 索引、顺序、JSON 序列化一致 |
| null | 保留旧行为 |
| array | 保留旧展开和类型行为 |
| object | 保留旧字段、顺序和 scalar columns 覆盖规则 |
| 缺失 | 不得凭空创建 action 字段 |

主机 SQLite 和 Android API 34 / SQLCipher 4.17.0 均须实测。

对比：

- 旧 materializer 的 action 结果。
- 新字段级转换结果。
- previous_json / next_json。
- commit、correction、message revision、revoke 后的持久化结果。
- JSON.stringify 输出及字段顺序（适用时）。

同时核对纯领域 legacy 实现 src/features/chat/experience/kanataEvents.js。若它与旧 SQLite materializer 在异常历史数据上的行为不同，必须在报告中分别说明；不得将两者混成一个 Oracle，也不得擅自改变已有 v1 任务书明确保护的 UTF-16 语义。

## 6. ER1-3：撤销预览与执行语义等价

新候选路径已经有 compact revocation plan、分页 entries、冻结签名、CAS、批次和回执。本轮不重新实现一套撤销系统，而是验证它与旧语义的精确关系。

### 6.1 已知需要专门核对的差异

当前源码存在以下待验证差异：

1. 旧 legacySelection 的 descendants 选择没有排除已 revoked 事件；新 selection 在投影时排除了 status='revoked'。旧 preview 可能包含已撤销的后续事件，而新 revokeCount 可能只统计仍需改变状态的事件。
2. 旧 legacySignature 遍历整个 world 的事件；新 snapshot signature 主要绑定 root revision、选中集合、Effects 和 Baselines。无关事件变化是否应使预览 stale，需要按旧契约和用户确认语义判定。
3. 旧领域 revokeKanataEvent 分开处理 confirmed revokeIds 和 uncertainIds；新 SQLite 执行使用冻结选择集和批次。必须比较审计顺序、Effect 重放顺序、状态和回执。
4. correction 必须保持原事件 tombstone、replacement candidate、sourceRefs、causes、lifeSources、未知扩展和撤销影响的原子性。

这些是代码层发现的风险点，不预设哪一方必然正确。先跑 Oracle，再决定最小修复。

### 6.2 Oracle 和场景

至少同时保留：

- 纯领域旧 Oracle：previewKanataEventRevoke / revokeKanataEvent / correctKanataEvent。
- 历史 SQLite adapter Oracle：仅在测试中冻结旧 SQL/DTO 行为，不能作为生产实现。

覆盖：

- 已撤销的因果后续。
- 多层深链。
- 宽扇出。
- 混合图。
- 明确后续与 uncertain 后续交错。
- 同一 Effect target/path 的多个事件。
- 不同 owner/revision。
- 预览后新增无关事件。
- 预览后修改选中事件、关系边、Effect、Baseline。
- COMMIT 失败、批次中断、强停重开、幂等重放。
- correction 与 revoke 组合。
- 旧命令重复提交及损坏回执。

逐项比较：

- 完整 revoke/uncertain ID 顺序。
- 每个事件的 revision/status/disposition。
- 每条 Effect 的归属、before/after、审计和幂等键。
- Memory stale 结果。
- Instance/Relationship revision。
- Effect replay 最终状态。
- Audit previous/next。
- Preview stale 判定。
- 取消、失败、恢复和重复回执。

### 6.3 不允许的做法

- 不得将 revokeIds/uncertainIds 截断为前 50 条。
- 不得静默忽略已 revoked 后续或 uncertain 事件。
- 不得缩小用户确认集合。
- 不得自动把 uncertain 集合并入 revoke 集合。
- 不得因新旧算法差异而直接删除 Oracle 断言。
- 不得通过减少样本或跳过 Effect 来取得 PASS。

如果新候选算法的语义确实优于旧算法但不等价，先写差异、影响和产品决策请求；没有依据不得擅自改变产品行为。

## 7. ER1-4：事件页面生命周期、Heap 与 Store 证据

### 7.1 真实页面范围

先根据调用审计确认实际页面和消费者。至少检查：

- KanataCandidateEventLedger.vue。
- KanataCandidateWorkspace.vue 的事件账本与因果详情入口。
- kanataSqliteWorldRuntime.js 的 owner、cursor 和 protected operation。
- 当前实际使用的 eventDetail、openRevocation、revocationAudits、revocationEffectAudit。
- 若 eventRelations / eventEffects / eventAudits / eventJsonChunk 有真实 UI 消费者，也纳入对应页面矩阵；若没有，不得虚构页面，改做 Runtime/Repository 专用测试。

### 7.2 生命周期矩阵

真实 Android 候选包覆盖：

- 打开详情后正常关闭。
- 请求进行中关闭页面。
- 撤销预览翻页时关闭。
- Audit 页面和 Effect Audit 子页请求进行中关闭。
- 切换世界、切换角色和 owner 失效。
- 锁屏、解锁和 protected session revision 变化。
- grant 撤权、角色解绑和世界归档。
- 旧 cursor、旧 revision 和跨 owner cursor。
- SQL 查询失败、取消、COMMIT 失败和恢复门禁。
- 页面卸载后 provider/异步结果迟到（如果该路径存在 provider；没有则标为 N/A，不得编造 provider 场景）。

要求：

- 页面关闭或 owner 变化后不得发布旧结果。
- 关闭、取消、撤权后新增查询为 0。
- 撤权后正文读取为 0。
- 关闭后 Event、关系、Effect、Audit 和预览对象不再被页面或 Store 强引用。
- 错误状态可见，不能将 DENIED、STALE、NOT FOUND 混成空数组。

### 7.3 内存取证口径

沿用当前预算，不得放宽：

| 项目 | 上限或要求 |
|---|---|
| SQL 业务数据页 | 最多 50；含一个 sentinel 最多 51 |
| Event 列表/关系页 | 最多 50 DTO |
| Effect / Audit 页 | 最多 50 DTO |
| JSON chunk | 最多 4096 code points |
| 撤销/修正事务批次 | 最多 128 行 |
| 完整 Event DTO 跨桥 | 0 |
| 完整 Effect[] / Audit[] 跨桥 | 0 |
| 完整 revokeIds / uncertainIds 跨桥 | 0 |
| 关闭/撤权后新增查询 | 0 |
| 撤权后正文读取 | 0 |

每档 1k/10k 分别记录：

- SQL rows、query count、bridge calls、分页数。
- JS 当前页 DTO 数和最大同时驻留对象数。
- 完整 Event / Effect / Audit 对象计数。
- WebView Heap 阶段峰值。
- Android App PSS/RSS 阶段峰值。
- Pinia 中事件相关对象的真实数量。
- 组件局部 shallowRef/状态中的对象数量。
- 页面关闭、切世界、撤权、强制 GC 后的 retained object 证据。

采样必须区分 Seed 与 Read 阶段，不能将 Seed 峰值误报为纯读取峰值。

不得为了统计而把原本不进入 Pinia 的数据塞入 Pinia。若 Store 中没有事件对象，应通过真实 Store 检查和 instrumentation 证明为 0。

Heap snapshot 应在测试环境采集；结合对象创建/释放 instrumentation 和 GC 后快照判断 retained object。单次 performance.memory、heapUsed 或 RSS 采样不能单独证明无界问题已解决。

### 7.4 设备身份

必须重新核验隔离设备：

- emulator-5582
- AVD kanata_m2_api34
- Android API 34
- x86_64 / WHPX
- SQLCipher 4.17.0 community

使用现有 QA manifest 和白名单。不得因模拟器名称相似而跳过身份核验，不得安装到用户真实设备或真实数据目录。

## 8. ER1-5：完整回归、两轮审查与证据交付

### 8.1 主机验证

- npm run check。
- 事件 Repository、EventRead、EventRevocation、MessageDependents 定向测试。
- strict 类型正向与负向检查。
- test-only Oracle 与候选 SQLite 的字段/顺序/状态对照。
- 所有新增测试必须进入常规测试命令实际覆盖范围。

测试数量按最终命令实际输出报告，不得沿用历史 688 Node / 397 Vue 数字冒充本轮结果。

### 8.2 Android 验证

在最终候选源码、最终 APK、最终 catalog 和最终 fixture 指纹一致的前提下执行：

- action 1k/10k 与所有 JSON 类型矩阵。
- 事件 header、关系、Effect、Audit、JSON chunk 的 1k/10k 分页。
- 深链、宽扇出、混合图。
- 旧撤销 Oracle 对照。
- 事件 UI 生命周期矩阵。
- COMMIT 失败、CAS、取消、锁屏、撤权、强停重开和幂等重放。
- 最终完整候选回归。

具体 PowerShell、Gradle、instrumentation 命令从当前 QA README 和现有 runner 中复核，不得凭历史命令猜测参数。

Android 未实际运行的场景必须写 NOT RUN / BLOCKED。Gradle 构建成功不等于设备验收。

### 8.3 普通 APK 与生产门禁

最终复核：

- production canonical 仍为 legacy。
- 普通 Android APK 的 SQLite 激活位为 false。
- 普通 APK 不含 synthetic 页面、fixture 和 QA seed。
- Schema 001–004 checksum 与冻结值一致。
- 不新增 migration 005。
- 不触碰真实 legacy JSON、kanata-v1.enc、bak/tmp、真实用户数据或真实备份。
- 不调用真实模型 API。

### 8.4 两轮独立审查

第一轮：安全、权限、数据边界和事务反例。

重点：

- 是否仍有 eventFromRow / loadEvent / JSON.parse 完整快照。
- 是否存在分页后 gather。
- 是否有全量 Set/Map/数组。
- action 字符串是否准确保留 UTF-16。
- scope、owner、revision、grant、CAS 和撤权前置。
- COMMIT 失败、强停、恢复、幂等和 Effect replay。
- 是否存在新旧撤销集合不一致。

第二轮：产品语义、UI、平台、兼容与证据。

重点：

- 对照 raw、legacy 纯领域逻辑和冻结 Oracle。
- 检查旧字段、顺序、未知扩展、缺失/null、action JSON 和审计快照。
- 检查事件页面卸载、切世界、锁屏、撤权和迟到结果。
- 检查 Heap、PSS/RSS、Store 和 DTO 分类。
- 检查 APK、catalog、Schema checksum 和源码指纹。

每轮记录反例、失败、修复、复测命令和实际结果。只检查本轮 diff 不能称为全范围审查。

## 9. ER1 最终验收标准

只有以下项目全部满足，才能将 **ER1 事件兼容收口切片** 标记为 PASS：

1. 全仓调用矩阵完整，所有旧接口的真实消费者已分类。
2. 候选应用 Runtime 不再暴露无界完整 Event/Effect/Audit/关系/撤销数组接口。
3. Repository 不再默认物化完整 Event/Effect/Audit 对象图。
4. eventFromRow、loadEvent、materializeAuditSnapshot 等完整 materializer 已无生产调用者；若仍有调用者，必须有明确且经审查的例外，不能宣称全面有界。
5. 历史字符串 action 在 commit、correction、message invalidation 和相关状态变更中不再依赖完整 Event 回退。
6. UTF-16、代理对、孤立 surrogate、JSON 类型、属性顺序和未知扩展 Oracle 全部通过。
7. 旧领域撤销集合、uncertain 决策、Audit、Effect replay、CAS、回执和恢复语义与冻结 Oracle 一致，或已取得明确产品决策。
8. 主机与 Android API 34 / SQLCipher 4.17.0 的 1k/10k 证据齐全。
9. 事件 UI 生命周期、Heap、PSS/RSS、Store 和 DTO 分类证据齐全。
10. 最终源码、APK、catalog、fixture、日志和提交 SHA 一致。
11. npm run check、strict 正负类型、构建和 Android 最终回归通过。
12. 两轮独立审查完成，失败证据保留，复测可复现。

任一项缺失，ER1 保持 BLOCKED；出现权限绕过、数据丢失、历史字段静默丢弃、事务半提交、旧结果跨 owner 发布或生产误激活，按 FAIL 处理。

### 9.1 本任务 PASS 不等于 G4 / MR2 / M4 PASS

即使 ER1 全部通过，以下 MR2/G4 其他缺口仍需单独验收：

- 普通消息旧 get/recent/older/replies/provenance 完整 DTO 兼容入口。
- 消息兼容导出逐条等价与有界性。
- 自治 loadTask 完整任务 DTO。
- 自治来源 Android 1k/10k。
- 记忆管理分享/撤回的完整宽数据故障矩阵。
- 其他 provenance 闭包、增长和生命周期缺口。

M4 仍须完成 A–G、G1–G11 和 MR0–MR8 总合同。

因此本任务结束时：

- ER1：按证据 PASS / BLOCKED / FAIL。
- G4：除非所有其他缺口也关闭，否则继续 BLOCKED。
- MR2：除非所有 provenance 入口均通过，否则继续 BLOCKED。
- M4：继续 BLOCKED，直到总合同全部满足。
- SQLite 阶段 M5：保持 NO；不得自动启动。

## 10. Git、安全与范围限制

- 只在 M 分支普通提交和推送。
- 每次推送前 fetch；若远端前进，先检查差异。
- 禁止 force push、reset --hard、git clean、擅自 stash、覆盖用户文件和删除失败证据。
- 保留 main、Kanata 及其他 worktree 的原有修改、删除项和未跟踪文件。
- raw/ 不可修改。
- 不修改 Schema 001–004，不新增 migration。
- 不切换生产 canonical，不启用普通 APK SQLite。
- 不接触真实用户数据、真实备份、真实 legacy JSON 或加密归档。
- 不调用真实模型 API。
- 不开始 MR3、MR4、MR5、MR6、MR7、MR8 的其他工作包，不启动 SQLite 阶段 M5/M6/M7，不修改 P7。
- 不为了获得 PASS 而删测试、降样本、放宽 timeout、缩小确认集合或更改 Oracle。
- 遇到历史语义冲突、设备白名单不满足、工作区状态异常、真实数据风险或必须改变 Schema 时，停止相关改动并报告。

## 11. 交付物

在 docs/qa/kanata-sqlite-m4/m4-r/event-compat/ 建立本轮证据目录，至少包含：

- README.md：任务入口、命令、设备、结果与指纹。
- call-map.md：旧接口与新接口完整调用矩阵。
- compatibility-contract.md：旧字段、顺序、错误码、action 和撤销语义。
- oracle.md：纯领域 Oracle 与历史 SQLite adapter Oracle 的边界。
- lifecycle-matrix.md：事件 UI / Runtime 生命周期矩阵。
- memory-summary.json：Heap、PSS/RSS、DTO、Store 分类数据。
- reviews.md：两轮独立复核。
- host / Android 原始日志、失败日志、复测日志。
- APK、catalog、fixture、源码和设备指纹。

更新：

- docs/20261111-kanata-sqlite-mr2-g4-acceptance-v4.md（仅在 ER1 有完整证据时；否则使用如实 BLOCKED 的版本）。
- docs/qa/kanata-sqlite-m4/m4-r/README.md。
- docs/qa/kanata-sqlite-m4/m4-r/g4-call-map.md。
- docs/qa/kanata-sqlite-m4/m4-r/event-provenance-audit.md。
- docs/qa/kanata-sqlite-m4/m4-r/matrix.md。
- docs/qa/kanata-sqlite-m4/m4-r/reviews.md。
- docs/plan.md。
- memory-bank/development-context.md（只记录稳定、已确认的阶段事实）。

最终普通提交推送 M，并重新 fetch，核对本地和远端 HEAD 一致。最终报告必须明确 ER1、G4、MR2、M4、M5 的独立状态。

**最终原则：移除的是无界兼容接口，不是旧数据兼容性。任何历史语义都必须由 Oracle 和真实设备证据证明。**