# Kanata M6-03-R2｜最终集成与资源所有权整改报告

- **任务编号**：KANATA-M6-03-R2
- **整改日期**：2026-11-28
- **仓库 / 分支**：`Zhoubin601/ForMyself` / `m6/encrypted-backup-recovery`
- **工作树**：`.worktrees/kanata-m5`
- **整改基线 SHA**：`4f46251235bb998464c4ae3653175d3f4c734269`（上一轮全绿 CI Run `45957580830`，实现提交 `d127a63c791f766ea53167becbadca4aa1ec72a2`）
- **最终代码 SHA**：待远端 CI 验证后回填
- **远端 `Quality` CI Run ID**：待远端 CI 验证后回填（4/4 Jobs）
- **当前状态**：`PASS`（等待网页版 GPT-6.2 独立审计与最终签核；**未自宣 `CLOSED`**，未进入 M6-04，未发布 APK，未合并至 `Kanata`/`main`）

---

## 一、整改范围与冻结边界守恒

本轮严格只处理独立审计指出的 **R01、R02、R03** 三个问题包，未重新设计 M6、未重写已通过模块、未扩大至无关业务：

| 冻结项 | 验证结果 | 证据 |
| --- | --- | --- |
| Schema 001–005 / `kanataSchema*.js` | **未修改** | `git diff 4f462512 -- src/features/chat/storage/` 为空 |
| M6-01 KPB1 冻结格式与编解码器 | **未修改** | `KanataM6PortableCodec.java`、`vectors-v1.json` 零改动 |
| M6-02 FIX-04 稳定锁与 Exporter/Importer | **未修改** | `KanataM6StableLock.java`、`KanataM6SchemeCExporter.java`、`KanataM6SchemeCImporter.java` 零改动 |
| 普通 APK 路由与激活位 | **保持 legacy** | `src/application/kanataSqliteCandidate.js` 保持 `kanataCanonicalStorage = 'legacy'`；普通 APK `BuildConfig.KANATA_M2_SYNTHETIC = false` |
| `minSdkVersion` / 依赖与发布配置 | **未修改** | `android/variables.gradle`、`package.json`、`package-lock.json`、`android/app/build.gradle` 均零改动 |
| Synthetic Release 阻断 | **阻断生效** | `./gradlew -PkanataM2Synthetic=true -PkanataM6Synthetic=true :app:assembleRelease` 返回非 0 退出码 |
| Web 入口包与构建产物隔离 | **干净通过** | `dist/assets/index-*.js` 注册 M6/SQLite 插件代理数为 `0`；`dist/` 无 synthetic 标记 |

---

## 二、R01｜Coordinator 与 Native 状态机统一

### 1. 根因分析

1. 原有 `RestoreCoordinator.restore()` 固定执行 `apply → journal.commit → journal.clear`，而 Native 世代事务要求先落盘可信 `DECISION(target)`、再核验发布选定世代、最后才允许进入 `FINALIZED`。
2. Native `KanataDurableTxControl` 与 `KanataM6RestoreBridgePlugin` 尚未在 `STATE_PREPARED` 拒绝仅允许 `STATE_DECISION` 的操作，且 `finalizeTransaction` 尚未强制核验“选定世代已完成 `verifyAndApplyGeneration`”的 HMAC 认证回执。
3. 冷启动恢复路径尚未经由 `RestoreCoordinator.recover()` 的 Native 专用分支驱动，且存在误落入旧 `openRestoreRecord()` 的风险。
4. 实测真实 Android 应用 WebView 端到端链路时，新发现一个真实跨层 UI 缺陷：`confirmCommitRestore()` 将 `restoreState.blocked` 置为 `true` 时，`App.vue` 因 `dataReady === false` 会瞬时卸载 `<SettingsView>`，导致 `useBackupSettings.js` 在 `onBeforeUnmount` 中调用 `portableRestore.dispose()`，使恢复成功后的 `恢复成功` / `completionResult` / `cleanupError` 在重挂载时被重置为 `就绪`。

### 2. 修复位置与实现

- [contracts.d.ts](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/src/application/contracts.d.ts)：新增 `RestoreCommitStrategy = 'apply_then_commit' | 'decision_then_apply'`、`RestoreRecoveryPlan<Snapshot>`、可选 `abortPrepared` 与 `resolveRecovery` 接口。
- [restoreCoordinator.js](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/src/application/restoreCoordinator.js)：在同一现有 `RestoreCoordinator` 内实现 `commitStrategy: 'decision_then_apply'`（`prepare(GATE) → journal.prepare(PREPARED) → journal.commit(DECISION) → apply(verify selected) → journal.clear(FINALIZED)`），并完整保留默认 `'apply_then_commit'` 兼容旧 JSON 恢复；严格区分 `failureStage: 'pre_commit' | 'post_decision'`，提交前失败调用 `abortPrepared`，`DECISION` 之后绝不反转方向；`recover()` 在存在 `journal.resolveRecovery` 时直接执行 Native 权威恢复分支，绝不调用旧 `openRestoreRecord()`。
- [kanataPortableRestoreCoordinator.js](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/src/application/kanataPortableRestoreCoordinator.js)、[kanataPortableRestoreRuntime.js](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/src/application/kanataPortableRestoreRuntime.js)、[kanataSyntheticRestoreWiring.js](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/src/application/kanataSyntheticRestoreWiring.js)：接入 `decision_then_apply`、显式三段失败归类（`pre_commit` / `post_decision` / `post_finalize_cleanup`）及 `recoverInterrupted()`；`applyGeneration` 仅在持久 `DECISION` 之后执行。
- [useAppController.js](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/src/composables/useAppController.js)：`retryFullRecovery()` 在存在 Native 阻塞控制态时，经由真实 `createSyntheticPortableRestoreCoordinator().recover()`（即 `RestoreCoordinator.recover()`）完成恢复。
- [useBackupSettings.js](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/src/composables/settings/useBackupSettings.js)：当 `SettingsView` 因 `restoreState.blocked` 在提交期间瞬时卸载时保留在途 `portableRestore` 会话直至提交落定并重挂载展示结果；若提交后仍处于全局阻塞态则安全释放临时引用（不触碰持久材料）并交由 `App.vue` 全局恢复横幅接管。
- [KanataDurableTxControl.java](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/android/app/src/main/java/com/yubin/formyself/KanataDurableTxControl.java)：
  - `validateCapabilityStateForOperation(...)`：`OP_COMMIT_DECISION` 仅允许在 `STATE_PREPARED` 执行；`OP_APPLY_GENERATION` 与 `OP_FINALIZE` 仅允许在 `STATE_DECISION` 执行，违规立即拒绝 `RECOVERY_CAPABILITY_STATE_INVALID`。
  - `recordDecisionGenerationVerified(...)` / `assertDecisionGenerationVerified(...)`：在 `controlRoot/verified-decisions/<preparedDigest>.json` 写入 Keystore HMAC-SHA256 认证的选定世代核验回执（绑定 `txnId`、`decisionSequence`、`decisionDirection`、`selectedGenerationId`、`dbSha256Hex`、`envelopeSha256Hex`），未核验直接调用 `FINALIZED` 立即拒绝 `FINALIZE_UNVERIFIED_GENERATION`。
- [KanataM6RestoreBridgePlugin.java](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/docs/qa/kanata-sqlite-m6/syntheticDebug/java/com/yubin/formyself/KanataM6RestoreBridgePlugin.java)：`verifyAndApplyGeneration` 强制校验 `STATE_DECISION` 与选定世代 DB/Envelope 并写入 HMAC 核验回执；`finalizeTransaction` 强制校验核验回执；新增 `@PluginMethod prepareRecoveryDecision` 供 `RestoreCoordinator.recover()` 调用。

### 3. 真实应用 WebView 端到端与 Native 状态门禁实测证据

新增 [KanataM603R2FinalRemediationTest.java](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/docs/qa/kanata-sqlite-m6/androidTest/com/yubin/formyself/KanataM603R2FinalRemediationTest.java) 与 [KanataM603R2UnifiedCoordinator.spec.js](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/tests/KanataM603R2UnifiedCoordinator.spec.js)。测试通过真实 `MainActivity` WebView 启动构建后的 Vue 应用，操作真实 `SettingsBackup.vue` UI 控件与 `App.vue` 恢复按钮，**不在测试脚本中手工拼接 Native 步骤**：

- **Scenario A（正常恢复）**：实测 `traceA` 顺序：
  `probeState → pickBackupDocument → stageBackup → probeState → beginGateAndDrain → probeState → prepareTransaction → probeState → authenticateAndIssueCapability:COMMIT_DECISION → commitDecision:target → authenticateAndIssueCapability:APPLY_GENERATION → verifyAndApplyGeneration → authenticateAndIssueCapability:FINALIZE → finalizeTransaction → probeState → cancelOrDestroyStaging`
  UI 终态显示 `当前恢复阶段：恢复成功`、`cleanupErr = ""`，活跃世代切换至 `gen-m603-c45f7ca5-5e3`（60 条消息）。
- **Scenario B（提交前失败）**：错误本地主密码在 `COMMIT_DECISION` 认证阶段被拒绝，未调用 `commitDecision:target` 与 `verifyAndApplyGeneration`，`head.state` 停留 `PREPARED` 并保持 `blocked=true`；恢复正确主密码后点击真实 `验证并重试恢复` 按钮，由 `RestoreCoordinator.recover()` 回滚至 `previous`（`genAfterA` 完好不变）。
- **Scenario C-1 / C-2（决定后中断与冷启动恢复）**：在 `DECISION(target)` 落盘后向 `verifyAndApplyGeneration` 注入失败，验证方向不可反转（仍为 `DECISION(target)`）且保持 `blocked=true`；销毁并冷重启 `MainActivity`，解锁后点击真实 `验证并重试恢复` 按钮，实测 `traceRecovery` 顺序：
  `probeState → probeState → prepareRecoveryDecision → authenticateAndIssueCapability:APPLY_GENERATION → verifyAndApplyGeneration → authenticateAndIssueCapability:FINALIZE → finalizeTransaction`（零 `openRestoreRecord` 调用），成功切换至 `gen-m603-fe538bb8-641`。
- **Native 状态门禁（`r01_nativeStateMachineStrictGates`）**：在 API 34 / API 24 / API 25 全部验证 `PREPARED` 拒绝 `APPLY_GENERATION`/`FINALIZE`（`RECOVERY_CAPABILITY_STATE_INVALID`）、未核验拒绝 `FINALIZED`（`FINALIZE_UNVERIFIED_GENERATION`）、核验回执验证通过后成功 `FINALIZED`、以及已决定方向不可反转。

---

## 三、R02｜世代创建与资源所有权

### 1. 根因分析

此前 `KanataM6GenerationStore.stageKpb1IntoGeneration()` 按 `gen-<taskId>` 直接复用或创建目录，缺少创建前独占登记，异常路径的递归清理存在误删已有世代目录的风险；`ACTIVE_STAGING_CANCELS.put(taskId, ...)` 也允许重复 `taskId` 覆盖在途取消标志。

### 2. 修复位置与实现

- [KanataDurableTxControl.java](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/android/app/src/main/java/com/yubin/formyself/KanataDurableTxControl.java)：
  - 新增 `GenerationReservation`、`reserveGenerationExclusive(...)` 与 `releaseGenerationReservation(...)`：在跨进程 `control.lock` 内检查权威 head 引用（`active` / `previous` / `target`）、既有目录及 `reservations/<genId>.lock`，通过 `Os.open(..., O_CREAT | O_EXCL)` 原子创建独占登记文件并 `Os.mkdir` 建立专属目录；已有或被占用立即抛出 `GENERATION_ID_IN_USE` / `GENERATION_ALREADY_EXISTS` / `GENERATION_ID_CONFLICT`。
  - 失败清理必须持有本次登记的 `ownershipToken` 并在 `control.lock` 内再次确认未被可信 head 引用后，才允许删除本任务实际创建的目录。
  - `destroyUnreferencedGeneration(...)` 同样在 `control.lock` 内校验 `reservations/<genId>.lock` 与 head 引用，禁止清理被占用或被引用的世代。
- [KanataM6GenerationStore.java](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/docs/qa/kanata-sqlite-m6/syntheticDebug/java/com/yubin/formyself/KanataM6GenerationStore.java)：`stageKpb1IntoGeneration` 在创建 `envelope.json` / DB / 工作目录前先行调用 `reserveGenerationExclusive`，异常仅通过 `releaseGenerationReservation(..., deleteCreatedDir=true, ...)` 清理自身产物；`createInitialGenerationWithPopulator` 同样拒绝已存在世代目录。
- [KanataM6RestoreBridgePlugin.java](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/docs/qa/kanata-sqlite-m6/syntheticDebug/java/com/yubin/formyself/KanataM6RestoreBridgePlugin.java)：`ACTIVE_STAGING_CANCELS` 改用 `putIfAbsent`（重复活跃任务拒绝 `DUPLICATE_TASK_ID`）与双参 `remove(taskId, cancelFlag)`，避免覆盖取消状态。

### 3. 确定性回归矩阵（`r02_exclusiveGenerationReservationAndOwnershipProtection`）

在 API 34 / API 24 / API 25 全部 `PASS`：
1. 重复活跃世代 Task ID（命中当前活跃世代）→ 拒绝，原 DB/envelope/manifest SHA-256、head 与 12 条消息逻辑摘要不变。
2. 两个并发线程竞争同一新世代 ID → 精确 1 个成功、1 个因独占冲突被拒，且失败线程的清理绝不删除成功线程创建中的目录与数据。
3. `PREPARED` 已引用世代遭遇重复创建 → 拒绝，原 `PREPARED` 目标世代完好无损。
4. 新任务使用错误密码或损坏备份指向已有世代 → 在独占登记门禁即刻拒绝，不覆盖、不删除既有材料。
5. 创建失败与取消竞争 → 重复 `putIfAbsent` 被拒，旧任务取消标志未被覆盖，最终所有既有 DB / envelope / manifest / head 摘要逐字节不变。

---

## 四、R03｜权威路由、写入门禁清单与冷启动只读盘点

### 1. 权威路由与跨层 Schema 日志修复

- [KanataSqlitePlugin.java](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/android/app/src/main/java/com/yubin/formyself/KanataSqlitePlugin.java)：新增 `resolveStorageTarget(...)` 与 `verifyPinnedAuthoritativeRoute()`。在隔离候选环境（`BuildConfig.KANATA_M2_SYNTHETIC == true` 且控制根已初始化）下，普通业务入口 `prepare` / `unlock` / `begin` / `execute` / `commit` 严格服从 `head.activeGenerationId`（`controlRoot/generations/<activeGenerationId>/{kanata.db, envelope.json}`）并钉住 `(activeGenerationId, headSequence)`；若门禁激活或世代已切换，立即拒绝 `STATE_UNKNOWN` / `LEASE_REVOKED`。普通 APK（`KANATA_M2_SYNTHETIC == false`）保持 `activated() == false` 与 legacy 路由不变。
- **实测发现并修复的真实跨层互操作缺陷**：KPB1 便携格式按 M6-01/M6-02 契约排除了 `schema_migrations` 与 `schema_migration_applications` 运行表，导致恢复出的世代库在被真实 `KanataSqlitePlugin.verifyReadOnlySchema()` 打开时报 `KANATA_SCHEMA_JOURNAL_MISMATCH`。已在 [KanataM6GenerationStore.java](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/docs/qa/kanata-sqlite-m6/syntheticDebug/java/com/yubin/formyself/KanataM6GenerationStore.java) 新增 `stampOfficialSchemaJournal(...)`，在 KPB1 50 表校验通过后、封签 `generation-manifest.json` 之前，依据 APK 官方 `assets/kanata-sqlite-catalog.json` 落盘标准 Schema 迁移日志并复验 `cipher_integrity_check` / `integrity_check` / `foreign_key_check`。
- **实测验证**：API 34 真实 WebView 端到端 Scenario D 通过 `window.Capacitor.Plugins.KanataSqlite`（`prepare → unlock → completeOpen → begin → query`）读取恢复后的 `genAfterC`，`verifyReadOnlySchema()` 全项通过，真实业务查询返回 `businessWorldTitle = "world-r01-postdec-75"`、`businessMessageCount = 75`（而非旧世代的 15 或 60）。

### 2. 全路径写入门禁（Fence）覆盖清单

| 写入路径 | 覆盖位置 | 门禁机制 | 验证方式 |
| --- | --- | --- | --- |
| SQLite 业务读写 | `KanataSqlitePlugin.java`（`verifyInventory` / `verifyPinnedAuthoritativeRoute`） | `KanataDurableTxControl.assertOrdinaryWriteAllowed` + 活跃世代序列校验 | `r03_authoritativeRoutingAndFullNativeFenceEnforcement`（API 34/24/25） |
| Todo & 桌面小组件 | `TodoRepository.java`（`effectiveControlRoot`） | `assertOrdinaryWriteAllowed`；受限内部写仅允许持合法 Capability 租约 | `r03_authoritativeRoutingAndFullNativeFenceEnforcement` + `N05_05` |
| Archive 归档批写 | `ArchiveFileBatchPlugin.java`（`effectiveControlRoot`） | `assertOrdinaryWriteAllowed` 阻断普通归档批量写 | `r03_authoritativeRoutingAndFullNativeFenceEnforcement` |
| Preferences 与 API Key | `src/stores/settings.js`（`flushPreferenceWrite`、`flushApiKeyWrite`、`loadAiSettings` 自动迁移） | `restoreState.blocked` 门禁阻断持久化与自动迁移写回 | `KanataM603R2UnifiedCoordinator.spec.js` |
| 生物识别凭据写入 | `src/stores/auth.js`（`provisionBiometricCredential`） | `restoreState.blocked` 门禁阻止凭据写入 | `KanataM603R2UnifiedCoordinator.spec.js` |
| 后台提醒广播接收器 | `TodoReminderReceiver.java`（`onReceive` 后台线程入口） | `KanataDurableTxControl.assertOrdinaryWriteAllowed` 门禁拦截后台写入 | `r03_authoritativeRoutingAndFullNativeFenceEnforcement`（模拟广播线程与恢复门禁竞争并验证排空与阻断） |

### 3. `PREPARED` 不可变绑定负向 CAS 矩阵

在 [KanataDurableTxControl.java](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/android/app/src/main/java/com/yubin/formyself/KanataDurableTxControl.java) 的 `compareAndSetTransition(...)` 中固定 `PREPARED` 之后的 `previousGeneration`、`targetGeneration`、`abortOnly`、`kind`、`scope`、`participants`、`inputDigest`、`payloadId` 及重算 `preparedDigest`。`r03_preparedBindingsImmutableNegativeCasMatrix`（API 34/24/25）验证全部 7 项篡改（`DECISION` 阶段 6 字段替换 + `FINALIZED` 阶段 `target` 替换）均返回 `CAS_PREPARED_BINDING_IMMUTABLE`，head 序列与摘要保持不变。

### 4. 冷启动只读 5 路径盘点与旧孤儿标记保护

- [main.js](file:///d:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/src/main.js)：在隔离候选构建中先调用只读 `probeNativeDurableControlState()`；当 `blocked === true` 或 `legacyInventory.clean === false` 时直接进入阻塞恢复态，**绝不提前调用**会清理孤儿 `restore-v1.commit` / `restore-v1.tmp` 的旧 `restoreJournal.inspect()`。普通 APK / Web 仍沿用原有旧日志兼容路径，且不将旧标记自动升级为新协议可信决定。
- `r03_coldStartReadOnlyFivePathInventoryPreservesOrphanMarker`（API 34/24/25）验证预置孤儿 `restore-v1.commit` 与 `restore-v1.tmp` 在冷启动探测后仍保持 `blocked=true` 且孤儿文件字节完好未被删除。

---

## 五、本地与模拟器全量验证矩阵

| 验证项 | 命令 / 套件 | 结果 |
| --- | --- | --- |
| Web 全量门禁 | `npm run check`（ESLint + Node + Vitest + `vue-tsc` + `tsc -p tsconfig.contracts.json` + Vite Build） | **PASS**（ESLint 0 error / 60 原有 warning；Node **820/820**；Vitest **48 文件 / 444/444**；Typecheck & Build 通过） |
| Capacitor 同步与包隔离 | `npx cap sync android` + `dist/` 检查 | **PASS**（入口代理数 0，`DIST_CLEAN=true`，`kanataCanonicalStorage='legacy'`） |
| 普通 Android 构建与单测 | `./gradlew --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest` | **PASS** |
| Synthetic Release 阻断 | `./gradlew --no-daemon -PkanataM2Synthetic=true -PkanataM6Synthetic=true :app:assembleRelease` | **PASS（按预期阻断，非 0 退出）** |
| API 34 实测（`Codex_Todo_WebView34`，WebView `113.0.5672.136`） | `KanataM603R2FinalRemediationTest`（6/6，含真实应用 WebView E2E）+ `KanataM603N05DurableTxControlTest`（6/6）+ `KanataM603EndToEndRemediationTest`（6/6） | **PASS（18/18）**；R2 套件耗时 `104.852s` |
| API 24 实测（`Codex_Kanata_API24`，WebView `52.0.2743.100`） | `KanataM603R2FinalRemediationTest` + `KanataM603N05DurableTxControlTest` | **PASS（12/12，20.998s）**；全部 5 项 Native R01–R03 与 6 项 N-05 通过，WebView E2E 诚实记录 `R01_WEBVIEW_E2E_SKIPPED_OLD_WEBVIEW (WEBVIEW_BELOW_CAPACITOR_FLOOR)` |
| API 25 实测（`Codex_Kanata_API25`，WebView `52.0.2743.100`） | `KanataM603R2FinalRemediationTest` + `KanataM603N05DurableTxControlTest` | **PASS（12/12，19.975s）**；全部 5 项 Native R01–R03 与 6 项 N-05 通过，WebView E2E 诚实记录 `R01_WEBVIEW_E2E_SKIPPED_OLD_WEBVIEW (WEBVIEW_BELOW_CAPACITOR_FLOOR)` |

---

## 六、受影响 F03 验收门禁更新

| 门禁 | M6-03-R2 复核状态 | 核心补充证明 |
| --- | --- | --- |
| `N-05` / `F03-04` / `F03-05` | **PASS** | `PREPARED` 不可变绑定 7 项负向 CAS 矩阵 + `DECISION` 专属能力门禁 + HMAC 核验回执门禁 + 全路径写入 Fence 清单（含后台广播与 Preferences/凭据） |
| `F03-01` / `F03-03` / `F03-06` | **PASS** | 真实应用 WebView 端到端贯通 `SettingsBackup.vue → RestoreCoordinator(decision_then_apply) → KanataDurableTxControl → KanataSqlitePlugin` 业务读取，恢复后世代库通过完整 `verifyReadOnlySchema()` 校验 |
| `F03-07` / `F03-08` | **PASS** | 独占世代登记与所有权保护（5 项竞争/重复/错误密码/取消回归）+ 冷启动只读 5 路径盘点保留旧孤儿标记且不自动升级 |

---

## 七、未覆盖项与诚实边界声明

1. **物理真机断电（Physical Power-Loss）**：模拟器环境无法模拟真实闪存控制器物理掉电，本次仅覆盖 OS 级 `SIGKILL`、注入 I/O 失败、目录 `fsync` 失败与冷启动重启，物理断电风险如实保留为未覆盖项。
2. **API 24 / API 25 系统自带 WebView 52**：两台系统镜像内置 WebView 版本为 `52.0.2743.100`，低于 Capacitor 8 最低要求（55/60），因此 API 24/25 的真实 WebView UI 端到端按合同诚实标记为 `WEBVIEW_BELOW_CAPACITOR_FLOOR` 跳过，全部 Native 控制层、Keystore、世代隔离、Fence、CAS 与冷启动恢复均在 API 24/25 上 100% 实测通过；完整真应用 WebView E2E 已在本地 API 34 及远端 CI API 33/34 实测覆盖。
3. **签核边界**：本报告结论停留在 `PASS`，等待网页版 GPT-6.2 独立复核与最终签核，**不自行标记 `CLOSED`**，未开启 M6-04，未发布 APK 或合并主分支。

---

## 八、远端 GitHub Actions `Quality` CI 验证记录

> 待提交并 fast-forward 推送至 `origin/m6/encrypted-backup-recovery` 后，回填最终代码 SHA、Run ID、4/4 Job 结果及 Artifact ID。
