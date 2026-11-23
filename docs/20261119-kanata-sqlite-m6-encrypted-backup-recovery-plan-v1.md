# Kanata SQLite M6 加密备份、恢复与改密计划 v1

- 当前状态（2026-11-23）：**M5 Overall CLOSED / PASS，M6-QA-01 PASS，M6-00 CLOSED / PASS，M6-01 CLOSED / PASS，M6-02 已获授权并进入实施准备**。M6-01 以提交 43b26d6ec41929a59844bb62a882bdf578391192 完成最终独立复核。
- 当前入口：[M6-00 最终设计收口](qa/kanata-sqlite-m6/m6-00-final-closeout-v1.md) · [M6-01 实施任务书](20261120-kanata-sqlite-m6-01-portable-backup-format-task-v1.md) · [M6-01 交付报告](qa/kanata-sqlite-m6/m6-01-portable-codec-report-v1.md) · [M6-02 实施任务书](20261123-kanata-sqlite-m6-02-consistent-export-task-v1.md)。
- M6-01 已由 GPT-6 在提交 43b26d6ec41929a59844bb62a882bdf578391192 完成最终独立复审并签核 PASS。用户于 2026-11-23 明确授权启动 M6-02；当前执行范围以 M6-02 独立任务书为准。下方历史规划和 CI 记录保留当时口径。
- 日期：2026-11-19
- 仓库：`Zhoubin601/ForMyself`
- 规划所在分支：`m5/json-archive-migration`
- 规划基线：`2b6e8e3591385024576c6606cce2acc31dbaad2b`
- 前置阶段：M0–M5 各阶段已有阶段记录；M5-06 已于该基线正式关账 PASS
- 权威路线来源：[SQLite 迁移与性能重构计划 M v1](20261103-kanata-sqlite-migration-plan-v1.md) 第 6 节 M6、第 7 节性能规范、第 8 节分支规则
- 本计划不授权真实用户数据操作、生产存储切换、APK 发布或合并。

## 1. 阶段目标

M6 的唯一阶段目标是：让 Kanata SQLite/SQLCipher 候选具备与应用既有安全架构兼容的加密备份、恢复、主密码变更和故障恢复能力。

M6 必须沿用应用现有的备份参与者、版本兼容、受保护模块、主密码事务和恢复协调器语义。不得另建一套绕过全局恢复门禁的平行机制。

M6 必须解决以下核心问题：

1. **便携备份**：为 Kanata SQLite 数据定义可跨设备恢复的版本化、分块、加密、可验证备份格式。格式内部建议命名为 Kanata SQLite Backup V3；必须先核对现有格式命名，避免与应用完整备份 v12、Kanata 产品组合 v13 混淆。
2. **一致性导出**：从 SQLite/SQLCipher 候选数据库导出事务一致的快照，不复制 WAL 活跃状态下的裸数据库文件，不把十万条消息重新拼成单一巨大 JSON。
3. **受控恢复**：恢复到隔离临时数据库，分批校验与导入；全部校验通过后，才通过既有 `restoreCoordinator` 统一切换。
4. **主密码变更**：通过现有 `protectedModules` / `changeMasterPasswordTransaction` 协调 Kanata 与其他受保护模块；失败时反向补偿，回滚失败必须保持 blocked。
5. **故障恢复**：覆盖强停、空间不足、错密、损坏分块、日志损坏、连接中断、恢复中断、改密部分失败与回滚失败。
6. **向后兼容**：保留完整备份 v1–v12 和 Kanata 产品备份既有版本的读取语义；新增格式必须明确旧版缺字段、未知字段和不支持版本的行为。

## 2. 已知架构约束（规划依据）

以下是当前分支源码/说明书已确认的既有边界，M6-00 必须再按实际 HEAD 复核：

- 完整备份基础类型为 `formyself-full-backup`、版本 12，兼容 v1–v12；Kanata P2 产品组合采用 v13 组合适配，不能把 Kanata 数据库文件格式版本与应用备份版本混为一谈。
- 备份参与者契约位于 `src/application/backupRegistry.js`、`src/application/backupParticipants.js` 与 `src/application/contracts.d.ts`；产品组合根位于 `src/application/fullBackupRuntime.js`。
- 完整恢复通过 `src/application/restoreCoordinator.js`、`src/platform/storage/restoreJournal.js`、`src/platform/storage/restoreState.js`；日志为独立 AES-GCM 封装。不得绕过协调器或直接清除恢复日志。
- 敏感模块注册位于 `src/application/protectedModules.js`，受保护会话位于 `src/stores/protectedAccess.js`；主密码改密事务位于 `src/services/masterPasswordChange.js`。
- Kanata Store 当前实现仍包含 legacy Repository 路径；M5 迁移器仍为 synthetic-only，未接入生产 Store、生命周期或 ordinary APK SQLite activation。M6 不得默认认为 SQLCipher 已成为生产 canonical。
- M5-06 已 PASS，但只证明合成迁移器与 Android SQLCipher 合成验收；不代表生产数据已经迁移，也不代表生产数据库已激活。
- Web 在 M 阶段继续使用现有加密文件存储适配器；不得因 Android SQLCipher 引入而强制把 Web 改为 SQLite WASM/OPFS。
- 主密码、生物凭据和 SQLCipher 原始密钥不得进入备份明文、普通 Preferences、日志或机器证据。备份必须可在另一台兼容设备通过用户凭据恢复，不能仅依赖单设备 Keystore。
- 任何真实用户数据、真实备份、真实设备数据库操作均不在本规划授权范围。

## 3. M6 子阶段路线

| 子阶段 | 目标 | 交付与退出条件 |
|---|---|---|
| **M6-00** | 现有备份/恢复/改密架构审计与格式设计输入冻结 | 只读审计报告、风险清单、数据流图、格式决策记录、后续实现任务拆分；不得修改业务代码 |
| **M6-01** | Kanata SQLite 便携备份格式与合成 Codec | 格式规范、manifest、分块边界、KDF/密钥封装决策、哈希/认证、确定性合成 round-trip 测试 |
| **M6-02** | SQLCipher 一致性导出与分块备份生成 | 采用经证实的只读事务逻辑导出，另与物理一致性原语做独立 A/C 合成实验；有界内存；合成 1k/10k/100k 导出 |
| **M6-03** | 隔离临时库恢复与 RestoreCoordinator 接入 | 临时库分批恢复、完整性/Schema/指纹验证、统一协调器切换、失败回滚及重启恢复 |
| **M6-04** | 主密码变更与密钥封装轮换 | 通过 protectedModules 与 changeMasterPasswordTransaction；各参与者部分失败、补偿、回滚失败均有证据 |
| **M6-05** | 故障注入、兼容矩阵与阶段验收 | 强停、磁盘不足、错密、损坏分块、日志损坏、连接中断；v1–v12 兼容回归；独立复核及关账 |
 
M6-00 完成前不得开始 M6-01 的实现。每个子阶段单独任务书、实现 SHA、测试证据和关账记录；前一阶段 PASS 后才进入下一阶段。

## 4. 全阶段验收门禁

### 4.1 格式与加密
- 格式版本、KDF 算法/参数、salt、nonce、密钥封装版本、分块索引、明文长度、密文长度、分块 SHA-256 和认证标签均有明确规范。
- 每个分块具备防重排、防截断、防替换的认证绑定；manifest 与全部分块之间有认证关联。
- 错误密码、错误密钥、未知版本、篡改 manifest、缺块、重复块、乱序块、截断块均在目标数据写入前拒绝。
- 密钥派生、封装和 SQLCipher 数据库密钥语义必须由 M6-00 比较现有实现后决定；不得臆造或直接复用未经证明的旧派生方案。
- 密钥、密码、明文正文不进入日志、文件名、普通设置或证据 JSON。

### 4.2 有界导出
- 禁止构造全量 KanataData 或十万条消息的单一大 JSON。
- 导出必须有界分块，记录最大驻留内存、批次上限、取消行为和临时文件清理语义。
- 活跃 WAL 场景下不得直接复制主数据库文件；必须证明使用 SQLite backup API 或一致快照流程。
- 导出过程失败时不覆盖既有备份、不删除源数据库、不留下可被误认为完成的半成品。

### 4.3 恢复与切换
- 恢复始终写入隔离临时数据库；源库在验证完成前只读且不变。
- 验证 Schema/application_id、表计数/摘要、外键、integrity_check、数据集指纹和分块认证。
- 只有完整验证通过后才进入 restoreCoordinator 的受控 apply 阶段。
- 在 commit 标记前强停必须恢复 previous；commit 标记后重启必须恢复 target。
- 回滚失败、journal 损坏或状态不确定时保留材料并保持 blocked，禁止普通写入。
- 派生通知/索引同步失败与业务数据恢复失败区分处理；同步重试不得再次导入业务数据。

### 4.4 主密码变更
- 全局改密仍由现有 changeMasterPasswordTransaction 统一编排。
- Kanata 密钥封装更新、数据库 rekey（若确有必要）和其他受保护模块参与者必须定义顺序及补偿语义。
- 任一参与者失败后，已完成参与者按逆序恢复旧密码/旧封装；回滚失败显式报告并保持保护状态。
- 验证新密码成功、旧密码拒绝、强停恢复、旧封装退休和跨设备恢复。
- 不得只更新 Kanata 就报告全局主密码变更成功。

### 4.5 兼容性
- 完整备份 v1–v12 保持现有兼容要求。
- Kanata 产品备份现有 v13 语义需通过实际代码与 fixture 冻结。
- 新增格式明确支持/拒绝矩阵，不静默丢弃未知字段或必需参与者。
- 旧备份缺少 Todo 等字段的既有语义保持不变。
- 单项备份与完整备份的权限、格式、合并/覆盖语义分别验收。

## 5. 安全与范围边界

M6 初始实施仍只使用合成数据和隔离候选库。除非用户另行授权，整个 M6 不允许：

- 读取、复制、扫描、导入或迁移真实用户数据、真实设备数据库、真实备份或真实归档。
- 将 M5 synthetic-only migrator 接入生产 Store、lifecycle 或 canonical。
- 修改普通 APK SQLite 激活位或将生产存储切换到 SQLCipher。
- 删除、覆盖、重命名、压缩或清理任何旧 JSON、backup、archive 或 recovery journal。
- 修改 Schema 001–005 历史 checksum、application_id 或生产数据格式。
- 发布/分发 APK、创建 Release、合并 M 到 Kanata/main。
- 绕过 restoreCoordinator、protectedModules、恢复日志或既有 v1–v12 兼容层。
- 升级无关依赖或扩大为 ForMyself 其他业务模块迁移。

M6 可以在独立隔离分支上开发新的备份格式和候选实现，但生产激活与真实数据操作必须作为后续单独审批事项。

## 6. Git 与 Agent 协作

- M5-06 关账基线：`2b6e8e3591385024576c6606cce2acc31dbaad2b`。
- M6 实现必须使用独立功能分支，建议 `m6/encrypted-backup-recovery`；不得直接在已关账的 M5 分支继续提交实现。
- M6-00 仅新增审计/设计文档，可在当前分支保留规划记录；M6-01 开始前必须创建并核对独立 M6 分支。
- 默认授权 Agent 在指定 M6 功能分支完成本任务后正常 commit + push，并等待 GitHub CI；只允许普通 fast-forward push，禁止 force-push。
- CI 通过不等于阶段 PASS；必须按任务书验证 Android 原生、加密、恢复和故障场景。
- 每个阶段交付实现 SHA、证据 SHA、CI run、工作区状态、实际测试结果和未覆盖项。
- 发现测试失败、远端分支意外前进、工作区包含未归属修改、分支冲突或需要超范围操作时停止并报告。
- 不自动合并 M6 分支，不自动合并 M 到 Kanata/main。

## 7. 本轮启动点

当前只启动 **M6-00 架构审计与设计输入冻结**。它是只读审计任务，不实现备份 Codec、不写入数据库、不改密码、不执行恢复、不创建 APK。

M6-00 的报告通过人工复核后，才制定 M6-01 的实现任务书。M6-00 不得提前替用户决定加密格式、KDF 参数、密钥封装或数据库 rekey 策略。

## 8. 最终路线

M0–M5（候选 Schema、Repository、业务访问模型、迁移器）→ M6（便携加密备份、恢复、改密与故障恢复）→ M7（性能验收、文档收口与合并准备）→ 用户明确授权后合并回 Kanata → 以合并后新基线重新执行 P7 原始门禁。

SQLite 迁移通过不等于 P7 自动通过。Android 512 MiB、完整改密 120 秒、Web 768 MiB 及原 P7 完整需求验收门槛保持有效。


## 9. 2026-11-20 CI 基线修复与独立复核补充

### 9.1 当前状态与治理边界

- M6 总状态仍为 **PLANNED — M6-00 架构审计待执行**。
- 本轮 Android CI 基线修复已完成；它属于 M6 开发环境与验收脚本基线修复，**不构成 M6-00 架构审计 PASS，也不授权 M6-01**。
- M5-06 在规划基线中的阶段记录保持原结论；**M5 Overall 总体关账仍是独立治理事项**，不得从 M6 CI 变绿推导为 M5 Overall 已关账。
- 规划原始基线仍为 `2b6e8e3591385024576c6606cce2acc31dbaad2b`；规划原始版本所在分支为 `m5/json-archive-migration`。本规划当前维护副本位于 `m6/encrypted-backup-recovery`。
- 当前维护分支在本次更新前已包含独立复核报告提交 `57dba0170bde64952e85d0a83d026e355f7ac622`。该提交触发的 Quality #44678066753 在本次记录时 Web Job 已 PASS、Android Job 仍在运行；不得提前宣称该次运行全绿。

### 9.2 CI 基线修复已验证事项

功能修复提交：`dbd35ab8f7435736237dd6778d146c9be8ceacf7`。

文档同步提交：`af31867bf2f20fc79adad8385dc43637122b7fa8`。

- Quality #44542364600：Web + Android 双 Job PASS。
- Quality #44677069315：最终文档同步 SHA `af31867...` 的 Web + Android 双 Job PASS。
- #44677069315 的 Android Job 包含标准 Debug APK 构建、Instrumentation 与 WebView Playwright；Playwright 退出码 0、`pageErrors=[]`、三张不同的原生界面截图。
- Web Job 日志：Node 测试 791/791 通过，Vitest 420/420 通过，类型检查及 Vite 构建通过。
- 两个 Instrumentation 测试现同时接受标准包名 `com.yubin.formyself` 与合成 QA 包名 `com.yubin.formyself.m2qa`，并断言包名与 `BuildConfig.KANATA_M2_SYNTHETIC` 一致；`kanataM2Synthetic` 默认仍为 false。
- Playwright 已适配 KanataView / 旧 ChatView 选择器分支、`restoreState-*.js` 独立 chunk 和单对象 `page.evaluate` 参数。

修复记录：[m6-ci-baseline-fix-v1.md](qa/kanata-sqlite-m6/m6-ci-baseline-fix-v1.md)。

独立复核：[m6-ci-baseline-independent-review-v1.md](qa/kanata-sqlite-m6/m6-ci-baseline-independent-review-v1.md)。

### 9.3 独立复核发现与风险登记

**M-01 — Medium：KanataView 分支将未执行的聊天收发测试标记为通过。**

当前 `docs/qa/architecture-20261026/native/verify.mjs` 在旧 ChatView 分支会输入合成消息、点击发送并等待 assistant 回复；在 KanataView 分支仅等待 `.kanata-setup / .kanata-manager / .kanata-frame` 可见，随后仍统一设置 `results.chatSendReply = true`。

因此现有 CI 证明新版 KanataView 容器可见，不能证明新版 Kanata 聊天消息已实际发送并收到回复。后续必须修正验收语义：
- 若 KanataView 有真实、受支持的消息发送入口，则通过实际 UI/业务路径发送合成消息，并断言对应用户消息与 assistant 完成回复。
- 若当前 KanataView 不提供聊天发送能力，则将“视图可见/模块已加载”与“消息发送/回复”拆成不同结果字段；未执行的收发场景必须标记为未覆盖或不适用，严禁设置 `chatSendReply=true`。
- 对主密码变更后的 Kanata 数据保留验收，若能够建立合成数据，应核对稳定记录 ID 和内容；仅检查 `isDataLoaded` 不能证明原数据保留。

**L-01 — Low：`loadRuntime` 仍有任意导出函数盲目调用风险。**

当前修复优先寻找 `createFullBackupRuntime`，但仍可能遍历 `Object.values(mod)` / `Object.values(mod.n || {})` 并无参调用其他函数。后续应改为显式、确定的工厂入口或稳定 QA adapter，不得为了探测返回值而调用不相关导出函数。

### 9.4 后续独立 QA 工作项：M6-QA-01

该编号是 CI / 测试基线维护工作项，**不属于 M6-01 备份 Codec 实现子阶段**，不改变 M6-00 → M6-01 的阶段门禁。

范围：
1. 修正 M-01：KanataView 的视图可见、模块加载、真实消息发送和回复必须分别表达；任何字段只能在对应行为真实执行且断言通过后置为 true。
2. 修正密码变更冷启动测试的语义：有合成数据时核对数据身份与内容；无法执行时明确标记覆盖缺口，不用模块加载状态冒充数据保留。
3. 处理 L-01：消除 `loadRuntime` 对不相关导出函数的无参盲调，使用显式工厂或 QA adapter。
4. 保留旧 ChatView 兼容分支（如仍有使用场景），但不得为了兼容旧结构而降低当前 KanataView 的验收强度。
5. 补充针对结果字段的回归测试，确保“只挂载页面”不会让“消息收发 PASS”成立。
6. 使用隔离合成数据与测试模拟器；不得接触真实用户数据或生产数据库。

退出条件：
- 新版 KanataView 的测试结果字段准确，未执行行为不会被标记 PASS。
- 有真实消息发送入口时，完整发送/回复链路得到断言；没有该入口时，测试报告清楚区分“不支持/未覆盖”，不伪造通过。
- 密码变更后的数据保留断言具备数据身份依据，或明确记录尚未覆盖。
- `loadRuntime` 不再调用不相关导出函数。
- Web 与 Android CI 对同一最终 SHA 全绿；保留可追溯的 Playwright 结果和测试日志。
- 独立复核确认没有通过删除断言、跳过测试、放宽安全门禁来获得绿灯。

### 9.5 M6-QA-01 执行约束与后续路线

- 执行前先同步远端 `m6/encrypted-backup-recovery`，确认当前 HEAD、工作区状态及最新 CI；本规划更新提交触发的 CI 必须先完成并核对。
- 在独立 worktree 中实施；只修改完成 M6-QA-01 必需的 QA 脚本、测试和对应 QA 记录。若发现需要修改产品业务代码、数据格式、Schema、密钥管理或生产存储路径，立即停止并报告，等待用户另行授权。
- 正常 commit + push，禁止 force-push、reset 覆盖远端、自动合并或触碰 `main` / `Kanata` / `M` 历史分支。
- M6-QA-01 完成只表示测试基线语义修正，不代表 M6-00 完成。
- 后续仍须按既定顺序：**M6-00 只读架构审计与设计输入冻结 → 用户/独立审查批准 → M6-01 备份格式与合成 Codec**。不得因本轮 CI 全绿或 M6-QA-01 通过自动跳过 M6-00、自动启动 M6-01。
- M6-00 需结合原始双基线、原审计材料与 Neon 独立复核综合关账；M5 Overall 仍按其自身证据单独处理。

### 9.6 M6-QA-01 执行结果

- 状态：**PASS（测试基线整改完成）**
- 整改报告：[m6-qa-01-report-v1.md](qa/kanata-sqlite-m6/m6-qa-01-report-v1.md)
- 代码验证基线提交：`522d26455f72e62b19d9fe7a5624e99837424893`（GitHub Actions [Quality #44684735609](https://github.com/Zhoubin601/ForMyself/actions/runs/44684735609) Web 与 Android 双 Job 均 `success`）
- 整改落地点：
  - 新增专用 QA adapter `docs/qa/architecture-20261026/native/runtimeAdapter.mjs`，通过纯属性查找解析唯一的 `createFullBackupRuntime` 工厂函数及 `restoreState`/`restoreJournal`，消除 `loadRuntime` 对无关导出函数的无参盲调（L-01）。
  - 修正 `docs/qa/architecture-20261026/native/verify.mjs`：拆分 `chatModuleLoaded` / `chatViewReady` / `kanataWorldInitialized` / `chatUserMessageSent` / `chatAssistantReplied` / `chatSendReply` 语义，并在 KanataView 实机执行阿拜多斯世界初始化、进入私聊会话、发送合成消息、验证用户消息与 assistant 回复及持久化后截取 `native-chat.png`（M-01）。
  - 改密冷启动后使用 `verifyKanataPreservedData` 与 `[data-message-id]` DOM 校验核对世界、会话及消息稳定 ID 与内容一致性（M-02）。
  - 修复冷启动 `attach()` 中 `playwright-core` `device.webView({ pkg })` 因 `ps -A | grep` 造成的进程名误判竞态，改为释放旧连接并通过 `pidof` + `/proc/net/unix` 确定性附着。
  - 新增回归测试 `tests/nativeQaAdapter.test.js`（5 条用例纳入 `npm test` / `npm run check`，Node 测试 796/796、Vitest 420/420 通过）。
- 阶段门禁声明：M6-QA-01 完成仅代表测试基线语义整改关账，**不代表 M6-00 通过，不自动启动 M6-01**；M6 仍严格按 `M6-00 → 独立复核 → 用户批准 → M6-01` 顺序推进。

## 2026-11-20 M6-01 实际启动检查点

- 签核通过后，在基线 `a301436259663999bd1cd6424e6e04ecb4662dc7` 的独立 M6 worktree 启动。首批交付为 [Node 合成封套](qa/kanata-sqlite-m6/portable/envelope.mjs) 和 [固定向量/负向测试](../tests/kanataPortableBackupEnvelope.test.js)。公开头、合成 profile、PBKDF2/HKDF 和随机 BEK 的 AES-GCM 封套已实现。
- `node --test tests/kanataPortableBackupEnvelope.test.js` 通过 5 项。固定字节由 Python 3.13.5 的 hashlib/hmac/struct 与 cryptography 50.0.1 的 AESGCM 独立生成，Node WebCrypto 再核对 UTF-8、PBKDF2、HKDF 和封套。错误密码、头/封套篡改、超限 KDF、Unicode、并发限额、取消和随机新包均有定向证据。
- Node v24.14.1、npm 11.11.0 下 `npm run check` 退出 0。Node 801 项、Vitest 45 文件 420 项通过，类型检查和 Web 构建成功。lint 0 错误、61 项既有告警。构建产物中未检出测试 KDF 域常量，生产源码、原生、Schema 和 canonical 入口无差异。
- 当前检查点未完成完整 C01。Manifest、分块 AEAD/顺序、Footer/transcript、`kanata-logical-v1` 记录、50 表摘要及全流拒绝矩阵属于 M6-01 后续实施。发行参数仍待 N-01/N-03，Native N-01～06 和完整 A/C 未运行。
- 本地检查点文件 SHA-256：`envelope.mjs` 为 `aa50f986432a4da97eff5fbaa72e44744eba1c73ad6e42261a44608bffb8b1cd`，`kanataPortableBackupEnvelope.test.js` 为 `5bf0e0611cd6ef3707b076ebfad2a2738a393ad7045d4dfb2d24ed6a41958f2a`。本轮交付为 worktree 改动，无新提交、推送或远端 CI。基线 [Quality 44687910607](https://github.com/Zhoubin601/ForMyself/actions/runs/44687910607) 的 Web 和 Android 均成功。


## 10. 2026-11-23 M6-01 最终关账与 M6-02 启动授权

- M6-01 最终独立复审：**PASS**。复核对象为提交 43b26d6ec41929a59844bb62a882bdf578391192，分支 m6/encrypted-backup-recovery。
- M6-01 最终交付报告：[m6-01-portable-codec-report-v1.md](qa/kanata-sqlite-m6/m6-01-portable-codec-report-v1.md)。
- 远端 Quality #45109150171 的 Web 与 Android Job 均成功。该 Android CI 证明现有 Android 构建和既有冒烟无回归，不替代 M6-02 的 N-01～N-04 Native 探针。
- M6-01 的 F01～F05 整改已完成；M6-01 未接入生产 Store、Native SQLCipher 导出、Settings UI、RestoreCoordinator 或普通 APK SQLite 激活位。
- 用户于 2026-11-23 明确授权启动 M6-02。正式任务书：[20261123-kanata-sqlite-m6-02-consistent-export-task-v1.md](20261123-kanata-sqlite-m6-02-consistent-export-task-v1.md)。
- M6-02 采用 A/C 独立合成实验：A 为 SQLCipher 物理一致性快照可行性；C 为 Native 只读逻辑快照与 M6-01 KPB1 分块导出。Scheme C 为 M6-00 建议路线，但不预设性能胜者。
- M6-02 代码基线为 43b26d6ec41929a59844bb62a882bdf578391192。实现仍限定在 m6/encrypted-backup-recovery 独立分支和隔离 worktree；禁止真实数据、生产 canonical 切换、APK 发布、合并和自动启动 M6-03。
- 本节更新只记录阶段状态和用户授权，不代表 M6-02 实现、A/C 实验、Native 低 API 能力或性能门禁已通过。
