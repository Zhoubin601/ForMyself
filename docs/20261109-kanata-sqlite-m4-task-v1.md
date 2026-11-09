# Kanata SQLite M4｜Pinia 与业务访问模型重构 — 完整工程任务书 v1

**制定日期：** 2026-11-09（北京时间）  
**执行分支：** `M`（仅 M）  
**开始基线：** `751da40149404deb8bc1562851a91e699c60c1e5`（M3 合成候选 PASS）。Agent 接手时必须重新 fetch 校验远端最新 HEAD。  
**状态：** READY / NOT STARTED。此文件仅是计划，不意味着 M4 代码和测试已经通过。  
**执行环境：** 优先 Windows 本地 Codex + 已核对身份的 WHPX / Android API 34 合成 AVD；Node / Vitest / strict 也可在隔离主机执行。

> **阶段定位：** M2 已构建 Android SQLCipher Driver、消息/会话 Repository 与有界消息候选窗口；M3 已建立世界、角色、世界书、记忆、事件、自治/统计 Repository 和 Schema 004。M4 需要消除 SQLite 候选的全量 `KanataData` 依赖、全量复制和整体序列化式读写，改为有界 UI 状态 + 显式领域命令 + 按需 Repository 查询。**本阶段的 PASS 指隔离合成 SQLite 候选；生产 canonical 仍为 legacy，不提前切流。**

## 0. 项目依据与不可误解的现状

**强制先读（顺序不可省略关键项）：**

1. `AGENTS.md`、根目录 `架构接口与Agent开发说明书.md`、`memory-bank/development-context.md`。
2. [M0–M7 总迁移计划](20261103-kanata-sqlite-migration-plan-v1.md)，尤其 M4 必需验收、M5/M6/M7 边界、P7 原始门槛。
3. [M2 任务书](20261107-kanata-sqlite-m2-task-v1.md)、[M2 Windows PASS](20261109-kanata-sqlite-m2-acceptance-v2.md)、[M2 QA](qa/kanata-sqlite-m2/README.md)。
4. [M3 任务书](20261109-kanata-sqlite-m3-task-v1.md)、[M3 技术设计](20261109-kanata-sqlite-m3-design-v1.md)、[M3 PASS](20261109-kanata-sqlite-m3-acceptance-v1.md)、[M3 QA](qa/kanata-sqlite-m3/README.md)。
5. [M1-R 字段映射](20261107-kanata-sqlite-m1-r-field-mapping-v1.md)与 Schema/迁移器实代码。001/002/003/004 的已应用版本、checksum、约束和安全拒绝不能静默改变。
6. 当前源码、类型、UI/Runtime、实际测试：`src/features/chat/kanataStore.js`、`src/features/chat/KanataConversationView.vue`、`src/features/chat/useKanataMessageWindow.js`、`src/application/kanataSqliteCandidate.js`、`src/application/kanataSqliteChatRuntime.js`、`src/application/kanataSqliteWorldRuntime.js`、`src/features/chat/storage/sqlite/`、`src/features/chat/storage/kanataRepository.js`、`src/features/chat/storage/messageArchiveRepository.js`、`src/stores/protectedAccess.js`、`src/application/protectedModules.js`、恢复协调器、备份/改密、群聊/记忆/事件/自治消费者以及 `tests/`。

**已知、需先复核的源码事实：**
- legacy `kanataStore.js` 的 `snapshot` / `update(change)` / `archiveHistory` / `prepareBackup` / `backupSnapshot` 等仍围绕完整 KanataData 图；这是当前生产 legacy 路径，不代表 M2/M3 候选已经全局无全量引用。
- M2 `useKanataMessageWindow.js` 与 `KanataConversationView.vue` 已有候选分页和有界消息；候选分支不能把 `store.snapshot.messages` 作为隐藏回读兜底。
- `kanataSqliteCandidate.js` 对 `syntheticOnly !== true` 拒绝激活；M2/M3 候选通过 `withRepositories`、`withDomains` 和受保护操作访问 SQLCipher。
- M3 归档采用世界可逆归档；撤销事件遵循用户预览确认的批量语义，每个事件只停用自身 Effects；来源 `message_id + revision` 和 read/remember/share 权限检查已是合同。
- 2026-11-09 M3 QA 记载 648 Node、392 组件、Android SQLCipher 4.17.0 合成 AVD 通过。**以上是历史基线，不是 M4 实测结果**。Windows 真正运行后的数据和当前 HEAD 才是本轮证据。

## 1. M4 明确目标与绝对边界

### 1.1 必须交付的能力

1. 当前世界、会话、角色及必要轻量摘要以**有界、不可越权、可撤销**的 Store/ViewModel 持有；不在候选 Pinia / Vue reactive 图常驻全体消息、归档页、记忆正文、历史事件图或完整 KanataData。
2. 消息查询继续沿用 M2 keyset（固定 `created_at DESC,id DESC`）、单页最多 50、当前显示窗口最多约 100；定位原消息、quote、旧页读取都走按需 Repository。
3. 世界、角色、世界书、记忆、事件、关系、权限、自治、统计的候选 UI 和 Runtime 消费者使用**明确的作用域、有界列表、单 ID 查询、聚合、命令/事务**，不重新将多表结果汇总成 KanataData。
4. 对候选普通聊天的新增、更新、重试、AI 流式提交、编辑/删除、会话更改、授权和事件处理，仅触达所需表和关联事务；**不能再依赖完整 JSON.stringify(KanataData) 或完整数组 clone 来完成普通聊天操作**。
5. 所有实际写路径遵守既有 Protected Session / operation lease、restore gate、owner generation、CAS、审计、失败状态及重试。
6. 页面卸载、会话/世界快速切换、锁屏、后台、会话 revision 变化、恢复门禁和候选 dispose/release 后，停止新的数据库操作、丢弃迟到结果并释放可控明文缓存/订阅/连接。
7. 保留 M2/M3 的群聊 speaker 与气泡、引用跳转、character 拒绝人工发送、记忆来源、事件 Effects、世界可逆归档、自主水位和撤权前置查询语义。
8. 通过代码层**和运行时可观测证据**证明以上约束，包括真实 Android JS→Native→SQLCipher 的候选路径。

### 1.2 阶段不得越界

- **不实施 M5**：旧 `kanata-v1.enc`、`.bak`、`.tmp`、`kanata-pages-v1`、恢复材料及旧 JSON/加密归档的生产导入、迁移 journal、数据清理等。
- **不实施 M6**：便携备份 V3、完整恢复切换、全局主密码改密及 DEK 重包装。M4 不能以“新 Store 不再持有全量”就删掉原有 backup/restore/reencrypt 入口；候选无法安全实现时必须明确维持未激活或返回固定不支持错误。
- **不实施 M7**：完整 1k/10k/100k 整应用容量、P50/P95/RSS/P7 最终验收与性能门槛修改。M4 只证明访问复杂度和缓存有界性，并对合理合成数据做针对性增长测试。
- 不迁移 ForMyself 其他业务，不迁旧“温馨小家”聊天，不修改 Kanata/main，不自动合并/发布 APK。
- 不在普通 Android 构建将 SQLite 激活位从 false 改为 true，不开启静默切换、双主、双写、失败后 legacy fallback，不把空 SQLite 当作已完成迁移的真实用户数据库。
- 不修改已应用 001–004 迁移历史 DDL/checksum；若 M4 有真实结构缺口，先给证据与向前兼容方案，再决定是否追加 005。优先在访问层修复，不能无依据改 Schema。
- 不删除或覆盖用户本地已有改动、未跟踪文件、旧加密文件、归档页和真实设备资料。

**对外可宣称：** “M4 隔离候选访问模型 PASS”。**不可宣称：** “生产已切换 SQLCipher”“全量 KanataData 在所有平台彻底消失”“M5/M6/M7/P7 已通过”。

## 2. M4 的访问与状态合同

### 2.1 分层和依赖方向

```text
View / 组件
  ↓ 轻量 selector + ViewModel（仅当前世界/会话与有界 DTO）
Application Runtime / Domain Command
  ↓ 明确 worldId/conversationId / 权限 / owner / expectedRevision
Repository（单项、scope list、count、keyset、迭代批次、事务命令）
  ↓ 参数化查询 / affectedRows / FK / CAS
M2/M3 SQLCipher Driver + Protected Session + restore gate
```

- 平台注入放在组合根，View 和普通 Store **不能直接 import SQLite/Capacitor Driver 或拼接 SQL**。
- Store 状态为小而稳定的 DTO：`currentWorldId`、`currentConversationId`、`currentInstanceId`、分页窗口、所需可见元信息、`loading/error/hasMore`、owner generation 等。字段名只作设计建议，必须与当前应用实际类型匹配。
- 需要读取角色状态、事件、记忆或权限时，优先 M3 Repository 的有界查询/聚合；在权限判定前禁止先取正文或全域列表。世界/会话切换时不保留前世界明文。
- 读写两个边界：**canonical = SQLCipher 目标表**、**UI cache = 可淘汰 DTO**。不得把缓存再当第二个可写 canonical。
- 不为兼容旧 `update(data => ...)` 而从 SQLite 反向装配完整 KanataData；必须按调用点迁移为明确命令，保留 legacy 模块原来的完整图语义直到后续 M5/M6 正式切换。

### 2.2 访问审计/替换矩阵（必须先形成）

Preflight 用搜索 + 手工追调用链查清所有候选/legacy 调用点，输出表：

| 调用点 | 当前读取/写入方式 | 数据量与作用域 | 目标 Repository / 命令 | Owner 与权限 | 失败语义 | 测试 |
|---|---|---|---|---|---|---|

重点搜：`store.snapshot`、`snapshot.messages`、`snapshot.worlds`、`snapshot.instances`、`store.update`、`data=>`、`validateKanataData`、`assertKanataData`、`kanataRestoreDraft`、`JSON.stringify`、`structuredClone`、`messageArchives`、`archiveHistory`、`prepareBackup`、`backupSnapshot`、`readHistory`、`activateHistoryMessage`、`withDomains`、`withRepositories`、`kanataCanonicalStorage`，以及实际 import 链与动态调用、测试桩。

每个点必须标：**已接线 / 本轮迁移 / legacy 继续保留 / M5/M6 后续 / 非 M4**。不能简单删除搜索命中，或只改注释让 grep 不再出现。

### 2.3 Repository 合同

按现有 M2/M3 接口增量补齐：
- 单 ID / 有限 scope / count / 有序 cursor 分页；不得全表 materialize 后 JS 过滤/排序。
- 确需跨实体遍历或备份前置统计时使用**有界异步批次迭代**，含固定上限、确定排序、取消检查、owner 和 session lease；不缓存全部结果。批次规模须有真实资源/语义依据，不能擅自将 50/256 现有上限放大。
- 写入用明确领域命令与 expectedRevision；affectedRows 不符返回固定 conflict，审计/Effects/记忆来源/自治水位在同一事务。
- 读写错误分成解密失败、版本错误、权限拒绝、owner 过期、事务/保存失败和未激活，不能转成空数组、空世界或成功结果。
- 保留 M2/M3 固定 SQL catalog、事务和回滚毒化；不得引入 UI 自由 SQL 接口。
- 接口变化同步 `src/application/contracts.d.ts`、功能类型声明、strict 正负测试和运行时行为测试；保持旧兼容合同可识别且显式隔离。

### 2.4 状态一致性与缓存预算

- 消息默认依照 M2 页 50、窗口不超过 100；世界/会话/角色 UI 摘要的缓存预算由真实使用场景决定，在技术设计中明确每类 maxEntries/maxBytes/ttl 或生命周期，不得用无上限 `Map` / `Set` / 订阅者数组。
- 缓存键至少绑定身份/世界/会话/授权世代/owner；异步返回再检查当前世代，失效不得写 Store、引用、AI 上下文、最近提示、用量或任务。
- 分页插入更早消息保留滚动锚点，同时间戳稳定，重复翻页/瞬时更新不重复、不越界、不丢 quote。只在当前会话生成未读/新回复指标，不靠扫描全局消息数组。
- 若缓存被淘汰而仍在后台执行任务，任务必须重新按 ID 查询所需 DTO，不能依赖已释放的对象引用。
- 有限列表包含状态 loading/ready/error/stale/hasMore；错误不得以“列表空”伪装。权限撤销必须立即失效对应正文缓存并禁止随后新查询。

## 3. 按阶段执行与阶段内验收

### M4-0｜安全接管、基线与真调用链

1. 在 Windows 本地确认实际仓库和 `M` 工作树：
   ```powershell
   git status --short --branch
   git diff --stat
   git rev-parse HEAD
   git fetch origin refs/heads/M:refs/remotes/origin/M
   git ls-remote origin refs/heads/M
   git rev-parse refs/remotes/origin/M
   ```
2. 有用户未提交改动时保留；只有可快进且不覆盖修改才用 `git merge --ff-only origin/M`。不得 `reset --hard`、`clean`、force push、替用户删除文件。
3. 核对原历史回归 648 Node / 392 组件只是 M3 基线；重新运行有代表性的定向与 `npm run check` 并记录实际数字和命令。
4. 生成 `docs/20261109-kanata-sqlite-m4-preflight-v1.md` 和上节调用矩阵。比对 M3 代码、真实 Repo/UI、Android 构建、旧存储与安全门禁。
5. 先只读核对隔离 AVD 的 API、包名、syntheticOnly、磁盘和数据归属。不得在未确认设备前运行 `adb clear`、覆盖安装或清理。

**M4-0 PASS：** 基线、依赖图、全量读取/复制热点、后续依赖与设备身份均有证据；无本地用户资料受损。

### M4-1｜冻结技术设计与验收探针

创建 `docs/20261109-kanata-sqlite-m4-design-v1.md`，必须包含：状态 DTO、候选组合根、Store/Repository 接口、owner generation、错误/保存状态、权限前置、分页/迭代预算、资源释放、业务等价矩阵、M5/M6 暂留接口，以及可观测 instrumentation 方案。

**重点：先写会失败的证据测试。** 建立真实 Node / SQLCipher 或可追踪 Repo instrumentation，捕获“普通聊天写入是否触发全图序列化/复制/全量 SELECT”“页面加载是否查询历史全部消息”“取消/跨世界是否泄漏旧明文”；不能仅靠代码正则计数或 fake driver 的绿色 Promise。

设计自审两次：一次安全/并发/内存访问，一次业务行为/平台兼容。**设计自审不替代实现后的两轮自检。**

**M4-1 PASS：** 每条原有调用点有归属、每条目标接口有可运行测试，未偷渡 M5/M6。

### M4-2｜领域命令替换、Repository 迭代能力

按访问矩阵从候选消费路径逐项实施，优先顺序：
1. 消息/会话只查询最近页、按 ID、counts、分页/quote、streaming 和 retry；直接复用 M2。
2. 世界、角色、卡版本、世界书、关系、记忆来源、事件及 Effects、权限与自治指标依 M3 Repository 按需访问；不把查询拼成大世界图。
3. 将仍依赖 `store.update(data => ...)` 的候选业务操作替换为明确的 `command + expectedRevision + transaction`；legacy 保持原行为与原存储。
4. 对确需全范围处理的候选命令，提供有界 iterator，确保每批范围、取消点及事务语义明确；禁止将所有批次聚合到数组再在末尾 `JSON.stringify`。

**M4-2 PASS：** 单条/多条写入不会重写或复制未相关历史；参数化 SQL、CAS、审计和事务故障均有复现测试。

### M4-3｜Pinia/ViewModel 有界化与 UI 接线

- 由组合根注入候选 Store/ViewModel，页面只订阅当前 scope 的状态；不要在 UI 内添加 SQLite 特判和 SQL。
- 逐个核对 `KanataConversationView`、历史页、角色/世界管理、世界书、记忆、事件、自治/用量、设置和聊天 AI Runtime 的真实调用链。若部分 UI 仅有 legacy 入口，建立功能等价的隔离候选接线；不能声称候选全局接管了生产页面。
- 每个组件可读取轻量世界/会话/角色 DTO 与有限集合，不持有全数据图；UI 计算属性不能从全表结果 `filter/sort/slice` 模拟分页。
- 复用 M2 `useKanataMessageWindow`；严格验证 50 页、100 窗口、翻页锚点、quote、历史查找、群聊 speaker、气泡 reveal、取消和延迟回复。
- 世界/会话/角色切换与组件卸载、恢复阻断、密码锁定的过期请求不得污染新 Store，AI 和通知/任务不得引用失效明文；character 仍拒绝人工发送。

**M4-3 PASS：** 路由/UI/Runtime 行为等价，实际 Vue reactive 对象和 payload 有界，且无全量旁路。

### M4-4｜生命周期、安全和兼容边界

- 当前 protectedAccess、operation lease、原生 driver release/close、restoreCoordinator 等合同不变。读取完全成功才能发布 ready；读取/解密/版本/权限失败不允许初始化空白或放行写入。
- 锁屏/后台/release/destroy/会话变化：停止新请求，允许原事务在规定范围提交或回滚，然后关闭连接、清理缓存和订阅；并发 close/commit、两次 release、晚到查询必须测试。
- 编辑/删除后记忆/事件来源、Effects 重放、审计、归档定位依 M2/M3 既有事务语义；read/remember/share 授权在敏感正文查询前执行，并对撤权和再授权进行实测。
- 离线/无 Key 不凭空给 AI 回复；0 真实 API；合成 provider 故意忽视 abort 仍不得越界写。
- 旧 legacy Store、Web 辅助路径及 v1–v12 / v13 历史备份读取等遗留协议不得被 M4 错删。禁止用新候选做未经 M5/M6 完整验收的生产改密/恢复/迁移。

**M4-4 PASS：** 生命周期故障、权限追踪、旧路径兼容均通过；生产 SQLite 仍默认关闭。

### M4-5｜实测回归与有界性证据

**Node / Vue / TypeScript：**
- 完整 `npm run check`、新增定向测试和 strict 正负例；记录真实数量及退出码。
- 消息数量和世界/会话/角色数量逐步增加的合成场景，断言单次消息读/写的返回量、SQL 访问范围、JS retain 数量不会线性增长为全表大小。可用 1k/10k 作为结构增长证据；如环境许可可增加 100k **针对性访问场景**，不能当 M7 完整容量验收。
- 注入恶意参数、重复 ID、跨世界 cursor、并发 CAS、重复调用、迟到 owner、权限撤销、缺失来源、失败回滚、COMMIT 失败、读/写错误、空库与陌生 Schema 负例。
- 观察每次普通聊天写入的 `JSON.stringify` 与深拷贝/全量对象读取行为。通过明确隔离的 instrumentation + 真实候选路径证明不存在整图副作用；允许单条消息/固定小 DTO 的局部 JSON 序列化，但不得将其误报为全图 stringify。
- 验证 UI 已卸载/锁屏后不再保留已释放的敏感对象、订阅及异步回调。

**Windows / Android SQLCipher：**
- 使用上一阶段核验过或重新核验的 Windows/WHPX API 34 合成 AVD；不得仅凭模拟器名称信任其无用户数据。
- 原生 SQLCipher 4.17.0 + 实际 JS→Native→JS 与 Repository/ViewModel，按需查询、领域命令、完整场景；验证 FK、WAL、CAS、租约、安全拒绝和强停后重开。
- 检查窗口上下界、role/permission/事件撤销与自治水位；复现 M2/M3 关键正常/负向和故障用例。
- 验证普通 Android Debug（非 synthetic）构建的激活位仍为 `false`、正式目录无 QA 语句；不在真实资料上测试。
- 若 Android 无法运行，标 BLOCKED/NOT RUN，不允许凭 Node 和 Gradle BUILD SUCCESSFUL 给 M4 PASS。

**数据/性能证据：** 保存数据集种子/版本/指纹、候选 SHA、Schema/SQL catalog SHA、APK SHA、AVD API/ABI/WHPX、SQLCipher 版本、原始日志、测试次数和失败记录。可附 RSS/heap/SQL 查询数的 M4 趋势，但不将其冒充 M7 P50/P95 或 100k 的最终容量门槛。

### M4-6｜实现后两轮独立自检

**第一轮（架构、安全、并发与内存）：** 主动构造全量绕路、过期 scope、撤权后缓存、一次失败重试导致双写、COMMIT 失败、乱序分页、锁屏/close 竞态、失效订阅泄漏和跨世界源引用反例；发现缺陷→修复→重测并保存证据。

**第二轮（产品语义、旧版兼容与证据）：** 群聊/气泡/quote/失败重试、character 角色权限、世界可逆归档、批量撤销仅各自 Effects、记忆来源、自治水位、历史跳转、延迟 AI；检查候选/legacy / Web 区分与 M5/M6 数据边界；逐项核对证据没有以 Mock 代替设备真跑。

**M4-6 PASS：** 两轮均有具体审查对象、主动反例、修复记录及最终重新执行的实测结果。不能把设计阶段自审或一次全绿测试冒充两轮。

### M4-7｜验收、文档和 Git

交付：
- `docs/20261109-kanata-sqlite-m4-preflight-v1.md`：真实调用矩阵、范围、风险、资源上界。
- `docs/20261109-kanata-sqlite-m4-design-v1.md`：状态与领域命令契约、缓存预算、生命期、查询/迭代策略。
- `docs/qa/kanata-sqlite-m4/README.md` 及 evidence：可复现命令、原始失败/重测、机器汇总、设备和数据指纹。
- `docs/20261109-kanata-sqlite-m4-acceptance-v1.md`：正式 PASS/BLOCKED/FAIL，未跑项单列，不覆盖 M3 历史。
- 如有代码变更：实际 Store/Runtime/Repository/类型/负向测试、必要架构说明；同步更新 `README.md`、`docs/plan.md`、总迁移计划和稳定 `memory-bank` 交接。
- `output/` 可保留本地正式交付副本但可能被 Git 忽略；**GitHub 可读的验收主入口必须在 docs/**。

本轮仅在 `M` 分支普通提交/推送，核对远端 HEAD 与本地一致，禁止强推、合并 Kanata/main、正式发布、删除真实资料。

## 4. 不可降低的正式验收矩阵

| ID | 门禁 | 如何判断 PASS |
| --- | --- | --- |
| G1 | 调用覆盖 | 全量快照/读写热点审计完整，候选调用点均迁移或明确隔离；无隐藏按需全库物化 |
| G2 | 状态有界 | Store/ViewModel 仅当前活动范围及有限 DTO；窗口、集合、订阅和缓存预算实测受控 |
| G3 | Repository | 页/计数/ID/作用域/事务/迭代 API 均可工作，参数化 SQL 和真实 affectedRows/CAS |
| G4 | 普通聊天无全图 | Android 候选消息新增、流式、编辑/删除、重试无完整 KanataData clone/serialize/readAll |
| G5 | 领域正确 | 世界/角色/世界书/记忆/事件/自治和 M2 消息语义不回退、不越权、不丢审计 |
| G6 | 权限与租约 | read/remember/share 前置；撤权即失效；锁定/后台/会话切换关闭或撤销并丢弃迟到结果 |
| G7 | 错误与故障 | 加密/版本/权限/读写/COMMIT/强停错误 fail closed，恢复后无丢失/重复/越界写入 |
| G8 | UI/AI | 私聊/group/character/引用/锚点/气泡/延迟与取消场景实跑；0 真实模型 API |
| G9 | 全项目 | 本轮定向、strict 正负例、完整 `npm run check`、真实 Android SQLCipher JS E2E 通过 |
| G10 | 兼容与边界 | 旧 legacy/ Web 保留；生产 canonical = legacy、默认 SQL 激活 false；M5/M6 未被冒称实现 |
| G11 | 证据与审计 | 两轮自检、实际测试、失败及复测、SHA/设备/来源匹配，QA 链接能打开 |

**判定：**
- **PASS**：G1–G11 全部有实测及可复现证据通过；仅表明隔离候选 M4 可进入 M5 工程开发。
- **BLOCKED**：实现或关键 Android 实测缺失，不能宣称 PASS，也不能进入 M5。
- **FAIL**：数据丢失、权限绕过、全量回读残留、锁定后明文泄漏、半事务、双写/生产误激活等安全关键失败。
- 逐项允许 `NOT RUN`，但关键 G 项 NOT RUN 时整体不能 PASS。

## 5. Agent 工作与提交协议

1. **连续执行** M4-0 → M4-1 → … → M4-7；先核实当前 HEAD/已有变更，之后才动代码。项目已有技术基础，不要重新发明独立的 Driver、Schema、加密密钥或全局密码机制。
2. 每完成一阶段先运行其定向验收，失败立即修复；不要堆到最后才统一检查。
3. 不要为“优化内存”而放松审计、权限、同步、加密、可靠保存和恢复门禁。
4. 遇到真实产品决策冲突，先依据现有 raw、任务书与既有用户确认；只有无法确定且会改变语义时才提出最少的必要问题。其他工作继续。
5. 自检必须产生复现和失败证据，且复测当前最终提交，不得把历史 M3 的 648/392 当成 M4 结果。
6. 如果复杂任务一轮执行无法全量完成，先交可验证的阶段 checkpoint，准确标记 `BLOCKED`，绝不输出虚构 PASS。
7. 用户已要求生成任务书并准备本地 Codex 执行；**本次 GitHub 提交只保存任务文档**。M4 实际源码开发、设备测试和必要普通推送由随后获得该任务的本地 Codex 按用户当次授权与仓库规则执行。

**最终回复格式：**

```text
M4：PASS / BLOCKED / FAIL
仓库/分支/起始HEAD/最终HEAD/远端HEAD：
M4-0…M4-7 各自完成状态：
G1…G11 验收证据：
替换的全量访问调用点与剩余 legacy/后续项：
Store 的窗口/缓存上界与真实观察：
普通聊天是否有整图 stringify/clone/readAll：
Node/组件/strict/Android SQLCipher 实测命令和退出码：
第一次与第二次独立自检的反例、修复、重测：
真实用户数据/生产 canonical 与默认激活位：
新建/修改文件、提交SHA和GitHub QA/报告链接：
能否进入 M5：YES / NO（含理由）
```

**最终提醒：** M4 要解决的是“业务访问模型”，不是把全量 `KanataData` 换一个新的容器藏起来。没有真实候选调用链和有界性证据，就不能放行 M5。
