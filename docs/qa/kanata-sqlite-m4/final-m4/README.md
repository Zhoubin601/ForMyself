# Kanata SQLite M4 最终综合验收与两轮独立审查报告

**日期：** 2026-11-18（北京时间）  
**仓库 / 分支：** `Zhoubin601/ForMyself` / `M`（工作区 `.worktrees/kanata-m0`）  
**接管与集成基线：** 远端与前序检查点 `ebec33ba97b3f9eb053643beaf75d054cac83f15` → 设备基线 `a2b20e0b38df89f1b062c75df7f76108b84068ca` → 本次收敛树  
**最终结论：** **M4 PASS**（`A–G`、`MR0–MR8`、`G1–G11` 全部 **PASS**）  
**M5 放行建议：** **YES（可放行进入 M5，等待用户明确授权后方可启动；本轮未开始 M5）**

---

## 1. 生产边界与冻结声明

- **生产 canonical：** `legacy`（`kanataCanonicalStorage = 'legacy'`，`src/application/kanataSqliteCandidate.js`）。
- **普通 Android APK 激活位：** `false`（实际打包 DEX `BuildConfig.KANATA_M2_SYNTHETIC=false`，`com.yubin.formyself`，无合成页面、25 条合成测试 SQL 语句未打包、未安装、未发布）。
- **Schema 001–005：** 全部冻结且与历史校验和完全一致（`SCHEMA_CHECKSUMS_MATCH=PASS`）。
- **数据与模型隔离：** 真实用户数据与旧备份 `0` 触碰；所有主机与 Android 实测均使用合成夹具及受控 synthetic provider，真实模型 API 调用严格为 `0`；未合并回 `Kanata` 或 `main`。

---

## 2. 固定环境与核心制品指纹

| 维度 | 实测指纹 / 值 |
|---|---|
| 执行环境 | Windows 11 / PowerShell / Node `v24.14.1` / Gradle `8.14.3` |
| 设备与加密引擎 | 隔离合成 AVD `kanata_m2_api34`（`emulator-5582`）、Android API `34`、SQLCipher `4.17.0 community`（`journalMode=wal`、`synchronous=2`、`foreignKeys=1`、`cacheSize=-2048`、`busyTimeout=5000`） |
| 主机最终门禁 | `npm run check` → `EXIT=0`（ESLint `0 errors / 61 warnings`；Node `743/743`；Vitest `45` 文件 `420/420`；`vue-tsc` + `tsc -p tsconfig.contracts.json`；`vite build`）；日志 [host-check.log](host-check.log) / [host-check-exit.txt](host-check-exit.txt) |
| 候选合成 APK (`-PkanataM2Synthetic=true`) | `com.yubin.formyself.m2qa` SHA-256 `927f448730cb8664c68c98f582d7673ac0d9cd4159768f9c8e381acd80d89d4a`（[candidate-hashes.json](candidate-hashes.json)） |
| 测试 APK (`androidTest`) | `com.yubin.formyself.m2qa.test` SHA-256 `d77d0207c0c778c42e93779bd16ceeabfaade152d01b6d500ac91e6e92e9923a`（[candidate-hashes.json](candidate-hashes.json)） |
| 候选 SQLite Catalog | `fa2c517cf190fa3815ff1b0391943fb7b077ac2a15c760fabac0ce386de1b87d`（`823` 条语句） |
| 普通 APK (`-PkanataM2Synthetic=false`) | `com.yubin.formyself` SHA-256 `fe915a0019dace92904d62d75e35968fea8ffd7d064b7628b33ef512c94d9a0b`（[default-gate.json](default-gate.json)） |
| 普通 SQLite Catalog | `1886d13e6baff8a2431637ee76fcf44b7d846fcf3a3ec1f3d10bdd19ea870714`（`723` 条语句，[default-catalog.txt](default-catalog.txt)） |
| 夹具与脚本 SHA-256 | `kanataSqliteM2Fixture.js`: `e4173826...ff25`；`m4/fixture.mjs`: `f19a820c...e9d9`；`completion/fixture.mjs`: `30945945...db91`；`m4-closeout-device.mjs`: `a057f54b...065e`（bundle `e71047ac...`）；`candidate-smoke.mjs`: `21e319b4...0607`（bundle `0d69a195...`） |
| Schema 001–005 SHA-256 | v1 `76a3464b...ab0a2`；v2 `545360d8...ddab2`；v3 `1a48f88a...dd8e1`；v4 `e1546c34...19d68`；v5 `10db9e45...840be`（[schema-checksums.json](schema-checksums.json)） |

> 注：`candidate-hashes.json` 记录由合成构建产生的 `app-debug.apk`（`927f4487...`）与 `823` 条目录；随后执行普通 APK 门禁构建覆盖了同一 Gradle 默认输出路径用于只读校验并记录于 [default-gate.json](default-gate.json)（`fe915a00...` / `723` 条）。所有 Android 合成场景均在普通构建覆盖前于候选合成 APK（`927f4487...`）上完成，且 `array-order-result.txt` 同时直接记录升级后的 `upgradeApkSha256 = "927f448730cb8664c68c98f582d7673ac0d9cd4159768f9c8e381acd80d89d4a"`。

---

## 3. MR0–MR8 状态总表

| 工作包 | 状态 | 实测命令 / 依据 / 原始日志 |
|---|---|---|
| **MR0** 接管与基线 | **PASS** | `git status --short --branch` / `git rev-parse HEAD` / `adb -s emulator-5582 emu avd name`；验证工作区、`kanata_m2_api34` 隔离包白名单与既有证据 |
| **MR1** 10k 宽事件确认 | **PASS** | 候选重跑 `full`（`EXIT=0`，`10k` 确认 `10,001` 条、批次 `<=128`、强停回滚、`realModelCalls=0`）：[full-result.txt](full-result.txt) / [full-exit.txt](full-exit.txt) |
| **MR2** G4 provenance | **PASS** | 串行通过 `mr2-grants`、`mr2-chat-provenance`、`mr2-event-provenance`、`mr2-event-read`、`message-bounded`、`message-text`、`task-read`（全部 `EXIT=0`，`fullDtos=0`、`bodyReads=0` 撤权后）：[mr2-grants-result.txt](mr2-grants-result.txt)、[mr2-chat-provenance-result.txt](mr2-chat-provenance-result.txt)、[mr2-event-provenance-result.txt](mr2-event-provenance-result.txt)、[mr2-event-read-result.txt](mr2-event-read-result.txt)、[message-bounded-result.txt](message-bounded-result.txt)、[message-text-result.txt](message-text-result.txt)、[task-read-result.txt](task-read-result.txt) |
| **MR3** A/B/C 管理闭环 | **PASS** | 主机 `npm run check`（743 Node / 420 Vitest）+ 设备 `m4-closeout` & `full -M4Growth -M4Completion`：世界静态复制/归档/`GROUP-01..05`、大尺寸（275k/290k 字符）角色卡导入与多世界同步、世界书全字段/65 知情角色分页/`1017` 条规模扫描：[m4-closeout-result.txt](m4-closeout-result.txt)、[full-result.txt](full-result.txt) |
| **MR4** D/E/G 管理闭环 | **PASS** | 记忆策略/冲突合并/后代分享撤回（`dRevokedBodyReads=0`）、6 类事件、Schema 005 原序（`array-order`、`immutableMutations=9`）、纯领域撤销顺序、长 Effect Audit 分块与 4 路径历史 `action`（`event-semantics`）、历史归档与未知扩展引用保护（`m4HistoryArchive.archivedCount=49`）：[event-semantics-result.txt](event-semantics-result.txt)、[array-order-result.txt](array-order-result.txt) |
| **MR5** F 真实消费者与后台任务 | **PASS** | `ActivityPanel` 真实 UI 表单与游标分页、有限补算/角色交流/主动联系（含静默/通知失败记录/中止清理）、`LifeCompanion`（`home` 聚合读取与子模块 `remember=false` 隔离、不回退同名、私聊历史接入）及任务有界读写（`1k 5306ms / 10k 51697ms`）：[m4-closeout-result.txt](m4-closeout-result.txt)、[task-read-result.txt](task-read-result.txt) |
| **MR6** 生命周期、权限与故障 | **PASS** | 跨页面取消/关闭/卸载/后台/锁屏/租约失效/迟到结果拦截、损坏游标拒绝、`COMMIT` 失败回滚与 `domNodesAfterUnmount=0` / `retainedWindow=0` 观测，20 项组件生命周期测试（`KanataCandidateManagementLifecycle.spec.js`）+ `m4-closeout` + `full` 全通过 |
| **MR7** 最终全量回归与门禁 | **PASS** | 主机 `npm run check`（`EXIT=0`）+ Android API 34 串行 11 项场景全部 `EXIT=0` + 5 类 Native Instrumentation `OK (13 tests)`（[project-instrumentation.log](project-instrumentation.log)）+ 普通 APK 门禁（[default-gate.json](default-gate.json)、[default-catalog.txt](default-catalog.txt)）+ Schema 001–005 校验和 |
| **MR8** 两轮独立全范围审查 | **PASS** | Round 1（`b1df8d7b`，发现 5 P0 + 2 P1，全部修复并实测）+ Round 2（`b31d7f2c`，0 P0 / 0 P1，4 项 P2 观察记录） |

---

## 4. A–G 产品范围逐项状态

| 范围 | 状态 | 核心实现与最终实测证据 |
|---|---|---|
| **A. 世界与群聊** | **PASS** | `kanataWorldRepository.copy` 隔离复制静态成员/世界书/非角色聊天/无事件队友关系；`GROUP-01..05`、可逆归档关闭自主开关、设置/身份/建世界实测通过（[m4-closeout-result.txt](m4-closeout-result.txt)、[full-result.txt](full-result.txt)） |
| **B. 角色卡与世界实例** | **PASS** | `kanataCharacterRepository` 修复 >262,144 字符入参写失败与 >2 MiB CursorWindow 限制（`275k` 设备、`290k` 主机）、保留 `card_versions_immutable`、PNG/JSON 导入、版本发布、本地覆盖与多世界同步校验（[m4-closeout-result.txt](m4-closeout-result.txt)、[full-result.txt](full-result.txt)） |
| **C. 世界书** | **PASS** | 全字段保留、65 个知情角色分页（`maxRows=51`）、按角色激活预览、`1017` 条规模 keyset 分页与详情关闭释放（[m4-closeout-result.txt](m4-closeout-result.txt)、[full-result.txt](full-result.txt)） |
| **D. 记忆、冲突、合并与分享** | **PASS** | 整理策略、`previewConflicts`/`confirmConflicts` 自定义正文合并来源保留冲突记录、后代分享链撤回后正文读取 `dRevokedBodyReads=0`（[m4-closeout-result.txt](m4-closeout-result.txt)、[full-result.txt](full-result.txt)） |
| **E. 世界事件与 Effects** | **PASS** | 6 类事件、Schema 005 原序与不可改删（`immutableMutations=9`）、纯领域 `Set`/遍历顺序撤销与完整签名、revoked no-op、长 Audit 分块（`<=4096`）、4 路径历史 `action`、1k/10k 深/宽/混合图及强杀恢复（[event-semantics-result.txt](event-semantics-result.txt)、[array-order-result.txt](array-order-result.txt)、[mr2-event-provenance-result.txt](mr2-event-provenance-result.txt)） |
| **F. 自治、contact/social 与生活消费者** | **PASS** | `KanataCandidateActivityPanel`（>50 角色/日程分页、`removedScheduleIds`、`[1..7]` 周按钮）、`kanataSqliteAutonomyRuntime`（顺序事务、`relations` 分页、`resolveLineageSources`、`STALE_CONTEXT`、通知失败记录、中止清理）、`kanataSqliteLifeCompanion`（`'home'`/`'reports'` 聚合与子 `remember` 隔离、私聊历史 12 条、`INVALID_LIFE_TASK`、不回退同名）（[m4-closeout-result.txt](m4-closeout-result.txt)、[task-read-result.txt](task-read-result.txt)） |
| **G. 历史整理与引用保护** | **PASS** | `kanataHistoryArchive` 全表与未知 `extensions_json` 递归引用保护、归档预览签名 CAS、不可损坏游标拒绝、`COMMIT` 失败回滚（`MR6_COMMIT_FAULT_ROLLBACK`）（[m4-closeout-result.txt](m4-closeout-result.txt)、[full-result.txt](full-result.txt)） |

---

## 5. G1–G11 横向门禁状态

| 门禁 | 状态 | 实际验证摘要与证据文件 |
|---|---|---|
| **G1 调用覆盖** | **PASS** | A–G 全操作均走真实 `UI → Runtime → Repository → SQLite`；`m4-closeout-device.mjs` 内遗留 3 处未注册裸 SQL 测试辅助已全部替换为正式领域 API；无空按钮或假成功 |
| **G2 状态有界** | **PASS** | 所有业务分页 `<=51`（含 sentinel）、长 JSON/Audit/正文块 `<=4096/4097`、提示词来源编码 `=1`、`domNodesAfterUnmount=0`、`retainedWindow=0`、WebView JS Heap & Android PSS/RSS 连续采样稳定（[full-result.txt](full-result.txt)、[m4-closeout-result.txt](m4-closeout-result.txt)、[mr2-event-read-result.txt](mr2-event-read-result.txt)） |
| **G3 Repository** | **PASS** | `823` 条合成目录 / `723` 条生产目录覆盖全量 SQL；CAS、scope、owner、keyset、continuation、幂等回执与大字段分块均获主机 `743` 测试与真机验证 |
| **G4 普通聊天无全图** | **PASS** | 普通聊天、提示词、`task-read`、`event-read`、`message-text` 与 `message-bounded` 均 `fullDtos=0`、`bodyReads=0`（撤权）且保留原语义 |
| **G5 领域正确** | **PASS** | 纯领域事件撤销、世界静态复制、生活模块精确绑定与子模块独立权限、历史扩展引用保护在主机与 Android 对照一致 |
| **G6 权限与租约** | **PASS** | `grantVersion` 与 `generation` 分离使权限变更不丢失工作区状态同时使 AI/生活消费者失效；`read`/`remember`/`share` 独立校验、撤权/解锁失败/切世界/卸载后迟到结果 `0` 越权写入 |
| **G7 错误与故障** | **PASS** | 错密重开、未知未来 Schema、损坏游标、`COMMIT` 失败回滚（`MR6_COMMIT_FAULT_ROLLBACK`）、`SIGKILL` 冷启恢复与幂等重放全部 `fail closed` |
| **G8 UI/AI** | **PASS** | 全部新增工作区、卡片、世界书、记忆、事件、自治面板与 `KanataLifeCompanion` 在 API 34 真机挂载操作；仅用 synthetic provider，`realModelCalls=0` |
| **G9 全项目** | **PASS** | `npm run check` `EXIT=0` + 11 项串行 Android E2E 全部 `EXIT=0` + 5 类原生 Instrumentation `OK (13 tests)`（`EXIT=0`） |
| **G10 兼容边界** | **PASS** | 普通 APK (`com.yubin.formyself`) `canonical=legacy`、`BuildConfig.KANATA_M2_SYNTHETIC=false`、无合成页面与 25 条合成 SQL、Schema 001–005 冻结校验和全匹配、[default-gate.json](default-gate.json) / [default-catalog.txt](default-catalog.txt) |
| **G11 证据审计** | **PASS** | 全部失败记录（`attempt1..10` 等）完整保留未删；两轮独立审查与所有测试命令、退出码、APK/Catalog/源码/夹具指纹闭环 |

---

## 6. Android 实测明细（11 项隔离场景 + 原生 Instrumentation）

全部运行于 `emulator-5582`（`kanata_m2_api34` / API 34 / SQLCipher `4.17.0 community`），由 `docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1` 严格串行安装验证 APK（`927f4487...`）并收集：

| 场景模式 | 退出码 | 关键观测指标 | 证据文件夹 / 归档日志 |
|---|---|---|---|
| `m4-closeout` | `0` | `status=PASS`, `loreScaleCount=1017`, `loreMaxSqlRows=51`, `dRevokedBodyReads=0`, `syntheticModelCalls=8`, `realModelCalls=0`, `domNodesAfterUnmount=0` | `final-v5-20261117-m4-closeout` / [m4-closeout-result.txt](m4-closeout-result.txt) |
| `full -M4Growth -M4Completion` | `0` | 1k/10k `maxRows=51`、`m4HistoryArchive.archivedCount=49`、`m4Workspace` `GROUP-01..05` / `memoryManagement` / `shareWithdrawal` / `roleLorePreview` / `createWorld` / `worldSettings` 全 `PASS`、10k 事件 `10001` 确认、`realModelCalls=0` | `final-v7-20261118-full` / [full-result.txt](full-result.txt) |
| `message-text` | `0` | `status=PASS`, `maxRows=3`, `maxText=4097`, NUL/UTF-8 分块与强杀恢复通过, `realModelCalls=0` | `final-v7-20261118-message-text` / [message-text-result.txt](message-text-result.txt) |
| `message-bounded` | `0` | `status=PASS`, `maxRows=51`, `maxText=64`, 阶段/真实 COMMIT 回滚与 SIGKILL 恢复通过, `realModelCalls=0` | `final-v7-20261118-message-bounded` / [message-bounded-result.txt](message-bounded-result.txt) |
| `task-read` | `0` | `status=PASS`, `1k 5306ms / 10k 51697ms`, `maxRows=51`, `maxText=4097`, `fullDtos=0`, 11 权限矩阵与冷启幂等通过 | `final-v7-20261118-task-read` / [task-read-result.txt](task-read-result.txt) |
| `event-semantics` | `0` | `status=PASS`, `maxRows=51`, 长 Audit 55 条/23 块及 4 路径历史 `action` 15 类通过 | `final-v7-20261118-event-semantics` / [event-semantics-result.txt](event-semantics-result.txt) |
| `array-order` | `0` | v4→v5 原地升级 (`upgradeApkSha256=927f4487...`), `immutableMutations=9`, DDL/COMMIT/SIGKILL 回滚与缺序号拒绝通过 | `final-v7-20261118-array-order` / [array-order-result.txt](array-order-result.txt) |
| `mr2-grants` | `0` | `bodyReads=0` 撤权阻断（正反各 `maxRows=1`） | `final-v7-20261118-mr2-grants` / [mr2-grants-result.txt](mr2-grants-result.txt) |
| `mr2-chat-provenance` | `0` | `maxRows=50`, 取消后 `0` 查询, `syntheticModelCalls=7`, `realModelCalls=0` | `final-v7-20261118-mr2-chat-provenance` / [mr2-chat-provenance-result.txt](mr2-chat-provenance-result.txt) |
| `mr2-event-provenance` | `0` | `maxRows=50`, `fullDtos=0`, `realModelCalls=0` | `final-v7-20261118-mr2-event-provenance` / [mr2-event-provenance-result.txt](mr2-event-provenance-result.txt) |
| `mr2-event-read` | `0` | `maxRows=51`, `fullDtos=0`, 强杀恢复 `audits=1 / effects=1 / revision=2` | `final-v7-20261118-mr2-event-read` / [mr2-event-read-result.txt](mr2-event-read-result.txt) |
| 原生 Instrumentation（5 类） | `0` | `OK (13 tests)`（`KanataSqliteTransactionTest`, `ArchiveFileBatchTest`, `KanataEventActionCompatibilityTest`, `ArchitectureContractTest`, `TodoNativeTest`） | [project-instrumentation.log](project-instrumentation.log) |

---

## 7. MR8 两轮独立全范围审查：发现、反例、修复与复测

### 第一轮独立全范围审查（Round 1：`b1df8d7b-5287-4116-9be4-5a1d8fd90e2b`）

- **初审结论：** **BLOCKED**（5 项 P0、2 项 P1，`vue-tsc` 与 `tsc -p tsconfig.contracts.json` 退出码 `2`）。
- **发现、反例与修复：**
  1. **[P0-1 / F / G1,G5,G6,G8]** `kanataSqliteLifeCompanion.js` 对 `'home'` / `'reports'` 仅传 `[pre.grant]` 而非角色全量授权，导致子模块全部读空且未用 `canUseKanataLifeSources(..., { remember: true })` 校验。**修复：** 接入 `grantsForActor`、聚合子模块读取、按源权限校验跳过持久化并补全私聊 `historyForSpeaker(..., 12)`。
  2. **[P0-2 / F / G1,G5,G8,G9]** `kanataSqliteAutonomyRuntime.js` `runSocial` 调用不存在的 `domains.events.eventRelations`（遇非空公共事件必崩 `TypeError`），且存在 strict TS 错误。**修复：** 改为分页 `domains.events.relations(..., 'lifeSources')` + `jsonChunk` 并清零所有 TS 错误。
  3. **[P0-3 / F,D / G3,G5,G6]** `kanataSqliteAutonomyRuntime.js` `runSocial` 丢失记忆/历史 `lifeSources`、`.catch(() => [])` 吞错、且与 `runContact`/`LifeCompanion` 缺少完成后 `STALE_CONTEXT` 重核。**修复：** 在 `kanataAutonomyRepository.js` 事务内实现 `resolveLineageSources` 跨记忆/消息/事件重建完整来源链，三处均接入 `STALE_CONTEXT` 重校验并移除吞错回调。
  4. **[P0-4 / B / G1,G2,G3,G5]** `kanataCharacterRepository.js` 对大角色卡/扩展直接传超 262,144 字符 SQL 参数触发 Native 拒绝。**修复：** 在不改 Schema 004 `card_versions_immutable` 的前提下新增 250k 字符分段写入拼串（`insertLargeVersion`）、196,608 字符分块读取（防 Android CursorWindow 2 MiB 溢出）与分块去重（实测 275k 设备 / 290k 主机通过）。
  5. **[P0-5 / F,A / G1,G5,G6,G8]** `KanataCandidateWorkspace.vue` 中 `saveGrant` 未传 `guard` 且不刷新 `grants`，同时 `onGrantChanged` 复用 `generation` 导致保存授权与撤回分享将用户同步踢回世界目录。**修复：** 在 `kanataSqliteCandidate.js` / `WorldRuntime` / `ChatRuntime` 分离 `grantVersion` 与 `generation`，并在 `saveGrant` 后刷新局部 `grants`。
  6. **[P1-1 / F / G5,G6,G8]** `kanataSqliteLifeCompanion.js` 补齐 `INVALID_LIFE_TASK`（`trim` & `<=2000`）、单飞互斥拒绝 `LIFE_REQUEST_UNAVAILABLE` 及 `knowledgeSignature` 完成后重核。
  7. **[P1-2 / A–G,MR6,MR7 / G2,G9,G11]** `KanataCandidateActivityPanel.vue` 补齐 `>50` 游标聚合保存、`removedScheduleIds` 与 `[1..7]` 周按钮；`m4-closeout-device.mjs` 扩充至 `1017` 条世界书规模及 `10k` / Heap / DOM / Pinia 观测。
- **Android 实机复测追加发现与修复：**
  - 首轮实跑暴露 `kanataSqliteAutonomyRuntime.js` 内 3 处 `Promise.all` 在真机触发 `KANATA_SQLITE_TRANSACTION_BUSY`（主机 `node:sqlite` 曾静默排队），已全部改为严格串行 `await`。
  - 修复 `m4-closeout-device.mjs` 遗留 3 处未注册裸 SQL 与归档复测前主/被动开关复位，及 `candidate-smoke.mjs` 中两处旧断言（P0-5 修复前假设 `setGrant` / `withdrawMemoryShare` 踢回目录），随后全套 11 项场景全部一次退出 `0`。

### 第二轮独立全范围审查（Round 2：`b31d7f2c-8885-4111-38b8cd1e1f91`）

- **复审范围：** Round 1 修复落地后的最终集成候选全源码树 + `final-m4/` 全部实机、主机、Instrumentation、Schema 与普通 APK 门禁证据。
- **复审结论：** **0 项 P0 / 0 项 P1**，全部 `A–G` 与 `G1–G11` 复核 **PASS**；记录 **4 项 P2 观察/透明度说明**：
  1. **[P2 / F,G6]** `kanataSqliteLifeCompanion.js:90-103` 在 `allowPrompt: true` 等待 `ensureAccess()` 异步期间未先置占锁标记；当前唯一 UI 入口 `useKanataLifeCompanion.js:10-12` 已同步 `busy.value=true` 拦截并发，无 UI 复现路径，列 P2。
  2. **[P2 / F,G3]** `KanataCandidateActivityPanel.vue:54-58,147-151` 的 `load()` 与 `saveConfig()` 刷新仍使用 `Promise.all` 并发调用 3 个独立 `withDomains`；真实 `protectedAccess.js` `operationQueue` 会安全串行化，真机实测零报错，列 P2。
  3. **[P2 / G9,G11]** `m4-closeout` 与其余 10 项的 `qaBundleSha256` 差异源自之后仅调整 `candidate-smoke.mjs` 内因 P0-5 变更的两处目录跳转断言；为确保最终一致性，所有文档定稿前再重跑最终 `npm run check`。
  4. **[P2 / G10,G11]** 普通 APK 门禁构建按约定最后执行并覆盖默认 `app-debug.apk` 输出位置；所有合成验收先于普通门禁完成，`array-order-result.txt` 已双重记录升级包 SHA `927f4487...`。

---

## 8. 保留的失败与复测记录索引

按纪律全部保留未删除：
- `m4-closeout-attempt1-result.txt` ～ `m4-closeout-attempt10-result.txt`（涵盖 `KANATA_SQLITE_TRANSACTION_BUSY`、`C_COPY_ISOLATION` 前缀匹配、Vue 状态 `nextTick` 竞态、未注册测试 SQL `KANATA_SQLITE_STATEMENT_DENIED` 与世界归档后复测开闭等真实定位过程）
- `full-attempt1-result.txt`、`full-attempt2-result.txt`（P0-5 修复前旧工作区跳转断言失败记录）
- `array-order-attempt1-result.txt`、`array-order-attempt1-exit.txt`
- `message-bounded-attempt1-result.txt`、`message-bounded-attempt1-exit.txt`
- `all-instrumentation.log`（保留说明脚手架 `ExampleInstrumentedTest` 与测试包权限失败明细；对应项目专项 5 类测试在 `project-instrumentation.log` 通过 `OK (13 tests)`）
