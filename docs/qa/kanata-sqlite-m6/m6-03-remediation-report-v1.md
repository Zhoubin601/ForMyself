# Kanata SQLite M6-03-R｜Native 持久事务控制层与真实恢复链路整改交付报告 v1

- **任务编号**：`KANATA-M6-03-R-REMEDIATION-2026-11-27`
- **最终状态**：**`PASS`**（待 GPT-6.2 独立终审签核；未自行标记 `CLOSED`，未进入 M6-04，未发布 APK，未合并至 `Kanata` / `main`）
- **仓库 / 分支 / 工作树**：`Zhoubin601/ForMyself` / `m6/encrypted-backup-recovery` / `.worktrees/kanata-m5`
- **整改基线 SHA**：`c8c3d6ee1987ba963d4b49473d7062f310d81e80`（原实施 `6f97b4820fb953212d93ee8106fb307a46dbda3a`，原 CI `45793217397`）
- **整改任务书与门禁账本**：[docs/20261127-kanata-sqlite-m6-03-remediation-task-v1.md](../../20261127-kanata-sqlite-m6-03-remediation-task-v1.md)
- **结构化机器证据**：[docs/qa/kanata-sqlite-m6/m6-03-remediation-evidence-v1.json](m6-03-remediation-evidence-v1.json)

---

## 1. 六项审计发现（F01–F06）整改闭环总览

| 编号 | 整改核心内容 | 关键源码位置 | 实测结论 |
| --- | --- | --- | :---: |
| **F01 (N-05)** | 实现 app-private no-backup 持久控制根 `kanata-tx-control-v1`、安装身份登记、独立 AndroidKeyStore 256-bit HMAC-SHA256 与 AES-256-GCM、权威 `head.json` + 不可变内容寻址记录 `records/<sha256>.json`、锁内排他 CAS (`GATE → PREPARED → DECISION(previous|target) → FINALIZED`)、FIX-04 跨进程稳定锁 `control.lock`、统一 H-05 五路径旧日志盘点、全写路径持久 fence 与不可伪造恢复能力票据 | `android/app/src/main/java/com/yubin/formyself/KanataDurableTxControl.java`<br>`TodoRepository.java`<br>`KanataSqlitePlugin.java`<br>`ArchiveFileBatchPlugin.java` | **PASS**（API 34 6/6 + API 24 6/6 + API 25 6/6 = **18/18**） |
| **F02** | 保留原 `KanataM603RestoreEngineAndCoordinatorTest` 并显式标注为 Native 原语级验证；新增 `KanataM603EndToEndRemediationTest`（5 阶段真实 `:m6worker` 独立进程 `SIGKILL`，强杀后 100% 由产品恢复入口 `KanataM6RestoreBridgePlugin.executeAuthoritativeColdStartRecovery()` 自主读取权威 `head`、验证本机主密码、自主判向并收敛至 `FINALIZED`，无测试专用 Journal、无测试人工选向或删日志） | `docs/qa/kanata-sqlite-m6/syntheticDebug/java/com/yubin/formyself/KanataM6RestoreBridgePlugin.java`<br>`KanataM6KillableWorkerService.java`<br>`androidTest/.../KanataM603EndToEndRemediationTest.java` | **PASS**（API 34 / 24 / 25 均 5/5 阶段自主收敛 + 重复冷启动幂等） |
| **F03** | 修正 `backupCapabilityProbe.js`（Web 诚实返回 `portableRestoreAvailable=false, unavailableCode='WEB_KPB1_RESTORE_UNAVAILABLE'`，不再将旧 JSON 恢复可用性冒充 KPB1）；新增隔离合成组合根 `kanataSyntheticRestoreWiring.js` 与 `KanataM6RestoreBridgePlugin.java`（仅 `com.yubin.formyself.m2qa` 通过 `KanataM6SyntheticPluginRegistrar` 注册），实测贯通 `SettingsBackup → Runtime → PortableCoordinator → RestoreCoordinator → KanataDurableTxControl → KanataM6GenerationStore → SQLCipher`；普通 APK 零合成类且保持 `legacy` | `src/platform/runtime/backupCapabilityProbe.js`<br>`src/application/kanataSyntheticRestoreWiring.js`<br>`src/composables/settings/useBackupSettings.js`<br>`src/main.js`<br>`src/composables/useAppController.js`<br>`android/app/src/main/java/com/yubin/formyself/MainActivity.java` | **PASS**（API 34 真实 `KanataM6BridgeActivity` WebView Bridge SAF 完整恢复通过；Web / 普通 APK 零越权） |
| **F04** | 显式建立 6 态材料生命周期（`UNREGISTERED_STAGING` → `VERIFIED_AWAITING_CONFIRM` → `PREPARED_REGISTERED` → `DECIDED` → `FINALIZED` / `UNCONFIRMED`）；`PREPARED_REGISTERED` 之后 `cancelRestore`、`selectBackupFile`、`dispose` 严禁删除任何被事务引用的材料；彻底解耦 `FINALIZED` 业务提交成功（`committed: true`）与后续 `finalizeArtifacts` 清理失败（独立 `cleanupError` + `retryPostCommitCleanup`） | `src/application/kanataPortableRestoreCoordinator.js`<br>`src/application/kanataPortableRestoreRuntime.js`<br>`src/components/settings/SettingsBackup.vue`<br>`src/application/settingsModels.js` | **PASS**（Vitest 确定性竞争测试 + API 34 Bridge 实测 `cancelDuringPreparedBlocked=true`） |
| **F05** | 移除共享可变 `activeExpectedIdentity` / `lastCapturedPrevious` / `lastStagedTarget`；引入排他 `ExclusiveTxContext` 所有权锁与私有 `WeakMap` + Native HMAC `staging-reg` 登记（拒绝外部伪造 `{ verified: true }` descriptor）；强绑定 `(ownerId, sessionRevision, epoch, generation)`；恢复与已决定方向执行使用独立恢复能力边界，不因普通 UI session 失效而失去可恢复性 | `src/application/kanataPortableRestoreCoordinator.js`<br>`KanataDurableTxControl.java`<br>`tests/KanataM603RemediationF03F04F05.spec.js` | **PASS**（Vitest + API 34/24/25 `forgedRejected=true` & `forgedCapabilityRejected=true`） |
| **F06 (N-06)** | 实现 `generations/<generationId>/{kanata.db, envelope.json, generation-manifest.json}` 整代隔离目录；每次恢复生成独立 32-byte 随机 DEK 并封装 M6-00 `KanataKeyEnvelope` v1；通过权威 `head.activeGenerationId` Native CAS 原子切换整代（绝不单换 DB 漏换 envelope，绝不跨代搬运 WAL/SHM）；冷启动按权威 `head` 用本机主密码解封验活；同一 KPB1 恢复至两隔离目标实测生成不同 DEK 与封套 | `docs/qa/kanata-sqlite-m6/syntheticDebug/java/com/yubin/formyself/KanataM6GenerationStore.java`<br>`KanataDurableTxControl.java`<br>`KanataSqlitePlugin.java` | **PASS**（API 34 / 24 / 25 均通过 `distinctDeks=true`, `wrongPasswordRejected=true`, `envelopeSwapRejected=true`） |

---

## 2. 原始 M6-00 冻结门禁逐项验收映射表（N-05 / N-06 / F03-01～10）

| 合同编号 | 代码位置 | 测试名称 | 实际执行环境 | 证据文件 | 状态 |
| --- | --- | --- | --- | --- | :---: |
| **N-05** | `KanataDurableTxControl.java`, `TodoRepository.java`, `KanataSqlitePlugin.java`, `ArchiveFileBatchPlugin.java` | `KanataM603N05DurableTxControlTest` (`n05_01`～`n05_06`) | 本地 Android 模拟器 API 34 (`113.0.5672.136`), API 24 (`7.0`), API 25 (`7.1.1`) + GitHub CI API 33/34 | `m6-03-remediation-evidence-v1.json` (`n05Matrix`) | **PASS** |
| **N-06** | `KanataM6GenerationStore.java`, `KanataM6RestoreBridgePlugin.java`, `MainActivity.java` | `KanataM603EndToEndRemediationTest.e2e_03`, `e2e_04`, `KanataM603RemediationF03F04F05.spec.js` | API 34 / API 24 / API 25 + Vitest + GitHub CI | `m6-03-remediation-evidence-v1.json` (`e2eMatrix`) | **PASS** |
| **F03-01** | `KanataDurableTxControl.java`, `TodoRepository.java`, `KanataSqlitePlugin.java` | `n05_05_todoWidgetCrossProcessLockFenceAndRecoveryCapability`, `e2e_01_realBridgeFullRestoreFromSafThroughCandidateRoot` | API 34 / API 24 / API 25 + GitHub CI | `m6-03-remediation-evidence-v1.json` | **PASS** |
| **F03-02** | `KanataM6GenerationStore.java`, `KanataM6RestoreBridgePlugin.java`, `KanataM6StagingRestoreEngine.java` | `e2e_03_damagedVaultKanataSettingsRecoveryDedicatedAuth`, `e2e_05_realNativeLongFieldBindingAndBoundedStaging`, `m603_02_negativeKpb1ContainerAndLogicalRejectionMatrix` | API 34 / API 24 / API 25 + Node + GitHub CI | `m6-03-remediation-evidence-v1.json` | **PASS** |
| **F03-03** | `restoreCoordinator.js`, `kanataPortableRestoreCoordinator.js`, `secureCredentials.js` | `KanataM603RemediationF03F04F05.spec.js` (F03-03 凭据写/读回失败), `KanataM603RestoreCoordinator.spec.js` (partial apply 回滚), `KanataProductRecovery.spec.js` (28/28), `ApiKeyPersistence.spec.js` (20/20) | Vitest + API 34/24/25 + GitHub CI `web` / `android` | `m6-03-remediation-evidence-v1.json` | **PASS** |
| **F03-04** | `KanataDurableTxControl.java`, `KanataM6RestoreBridgePlugin.java` | `n05_02`, `n05_06` (4 阶段 SIGKILL), `e2e_02_realEndToEndSigkillAndColdStartAutonomousRecovery` (5 阶段 SIGKILL) | API 34 / API 24 / API 25 + GitHub CI | `m6-03-remediation-evidence-v1.json` | **PASS** |
| **F03-05** | `kanataPortableRestoreCoordinator.js`, `kanataPortableRestoreRuntime.js`, `SettingsBackup.vue` | `KanataM603RemediationF03F04F05.spec.js` (清理失败与业务提交解耦 + `retryCleanup`), `KanataM603RestoreCoordinator.spec.js` (派生同步独立重试), `e2e_02` (`FINALIZED_BEFORE_GC`) | Vitest + API 34/24/25 + GitHub CI | `m6-03-remediation-evidence-v1.json` | **PASS** |
| **F03-06** | `restoreCoordinator.js`, `kanataPortableRestoreCoordinator.js` | `KanataM603RestoreCoordinator.spec.js` (Point 10 rollbackFailed 保留 `blocked=true` 与日志), `RestoreCoordinator.spec.js` (18/18) | Vitest + GitHub CI `web` / `android` | `m6-03-remediation-evidence-v1.json` | **PASS** |
| **F03-07** | `KanataDurableTxControl.java`, `KanataM6StagingRestoreEngine.java` | `n05_03_tamperReplayOrphanVersionAndMissingHead`, `n05_04_faultInjectionWriteFsyncRenameDirSyncReadbackEnospc`, `e2e_06_legacyFivePathConflictAndNoAutoUpgrade` | API 34 / API 24 / API 25 + GitHub CI | `m6-03-remediation-evidence-v1.json` | **PASS** |
| **F03-08** | `KanataDurableTxControl.java`, `KanataM6RestoreBridgePlugin.java` | `e2e_02` (多次重复冷启动幂等), `n05_03` (未知版本 `99` 阻断、无 `head` 不扫描) | API 34 / API 24 / API 25 + GitHub CI | `m6-03-remediation-evidence-v1.json` | **PASS** |
| **F03-09** | `kanataPortableRestoreCoordinator.js`, `kanataPortableRestoreRuntime.js`, `KanataDurableTxControl.java` | `KanataM603RemediationF03F04F05.spec.js` (F04 全部 8 取消/卸载/重选竞态 + F05 防伪造/并发/会话撤销恢复), `e2e_01` (伪造 handle 拒 + `PREPARED` 取消拒), `n05_05` (跨进程 CAS 竞争 + 伪造 capability 拒) | Vitest + API 34/24/25 + GitHub CI | `m6-03-remediation-evidence-v1.json` | **PASS** |
| **F03-10** | `KanataM6GenerationStore.java`, `backupCapabilityProbe.js`, `kanataSyntheticRestoreWiring.js` | `e2e_04_sameKpb1TwoIsolatedTargetsDistinctDeksAndGenerationAtomicity`, `KanataBackupRuntime.spec.js` (7/7), `KanataProductRecovery.spec.js` (28/28), `tests/fullBackup.test.js` (v1–v12/v13), `tests/kanataPortableBackupCodec.test.js` (`C01-05`) | Node + Vitest + API 34/24/25 + GitHub CI `android` 普通 APK 回归 | `m6-03-remediation-evidence-v1.json` | **PASS** |

---

## 3. 故障证据严格分类声明（禁止混淆）

1. **真实独立进程 `SIGKILL` 证据**：
   - `n05_06`（4 阶段）与 `e2e_02`（5 阶段）均在独立操作系统进程 `:m6worker` 中运行真实 `KanataDurableTxControl` + `KanataM6GenerationStore` + SQLCipher 4.17.0，经 `Process.killProcess(workerPid)` 强杀并核验 `/proc/<pid>` 消失，随后由主进程自主冷启动收敛（API 34 / 24 / 25 全部实测通过）。
2. **真实 Android `am force-stop` 证据**：
   - 远端 CI `android` Job 运行 `docs/qa/architecture-20261026/native/verify.mjs` 对普通 APK 执行真实 `am force-stop` 强停后的未提交回滚与已提交保留验证。
3. **确定性模拟 I/O / 故障注入证据**：
   - `n05_04` 通过 `KanataDurableTxControl.FaultInjector` 确定性注入 `ENOSPC`、`beforeFileFsync`、`beforeRename`、`beforeParentDirFsync`（`DURABILITY_UNCONFIRMED`）、`afterRenameBeforeReadback`；`KanataM603RemediationF03F04F05.spec.js` 注入 `finalizeArtifacts` 清理失败与 `secureCredentials` 写/读回失败。
4. **真实硬件断电（power-loss）证据**：
   - **未在本轮模拟器环境执行真实物理拔电池/掉电实验**（标记为剩余风险；协议层面已落实同卷临时文件 → `fsync(file)` → `Os.rename` → `fsync(parentDir)` → 复读校验，并明确不以读回代替掉电耐久声明）。

---

## 4. 1k / 10k / 100k 容量复测结果（API 34 整改后实测，`batchSize=500`）

| 规模 | KPB1 大小 | 恢复总耗时 | 解码 / 分批写入 / 50 表校验 | 批次数 | 每批最大行 | 单批最大/中位 | 临时库大小 | 峰值 RSS | Java / Native Heap 峰值 | 50 表核验 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |
| **1k** | 193.0 KiB | 3,974 ms | 2,776 / 771 / 424 ms | 45 | 500 | 166 / 6 ms | 1.21 MiB | **88.4 MiB** | 6.0 / 9.2 MiB | **PASS (50/50)** |
| **10k** | 1.85 MiB | 7,737 ms | 3,160 / 2,936 / 1,637 ms | 63 | 500 | 217 / 5 ms | 4.51 MiB | **88.7 MiB** | 5.3 / 11.8 MiB | **PASS (50/50)** |
| **100k** | 18.84 MiB | 114,935 ms | 10,206 / 38,644 / 66,081 ms | 243 | 500 | 243 / 186 ms | 38.91 MiB | **92.9 MiB** | **6.3 / 11.9 MiB** | **PASS (50/50)** |

---

## 5. 两轮独立自查与发现闭环

- **Round 1 自查（实现期真实捕获并修复 4 项）**：
  1. `KanataDurableTxControl.compareAndSetTransition` 合法边检查放在 `txnId` 检查之后导致 `FINALIZED → DECISION` 先报 `CAS_TXN_MISMATCH` → 调整优先序先校验状态机合法边。
  2. `KanataM6GenerationStore` 查询 `dataset_metadata` 列名误写 `dataset_identity` → 修正为基线 Schema 001 真实列名 `SELECT user_id FROM dataset_metadata WHERE singleton = 1`。
  3. `TodoRepository.compareAndSet` 在普通未初始化控制根的 legacy APK 上需保留旧 `restore-v1.enc` P6 恢复写兼容，而在新控制根初始化后全部普通 CAS / Widget 写一律在 `control.lock` 内受持久 fence 拦截、仅允许不可伪造 `RecoveryCapability` 写入 → 通过 `executeOrdinaryWriteUnderFence(..., blockOnLegacyPending=false)` 精确解耦，兼顾 B-07 与普通 APK 零回归。
  4. `kanataSyntheticRestoreWiring.js` 避免顶层 `registerPlugin` 导出到主入口 chunk，且 `src/main.js` / `useAppController.js` 仅在检测到 `KanataM6RestoreBridge` 时动态懒加载 → 实测主入口 chunk `plugin proxy exports: []`、`DIST_CLEAN=true`。
- **Round 2 复审与远端 CI 回归闭环**：
  - 冻结基线 `git diff --exit-code`（Schema 001–005、KPB1 冻结 Codec、M6-02 Exporter/Importer、`kanataSqliteCandidate.js`、`variables.gradle`、`package.json`/`package-lock.json`）：**Exit 0**。
  - 合成 Release 构建阻断验证：**Exit 1（预期阻断）**。
  - 远端 CI 实际捕获并修复 2 项标准 APK 回归：
    1. `1fa09fed59e673f94edafe9c3e16b5dd0c5e1c06`：`KanataDurableTxControl.TxControlException.withExactCodeMessage` 保留 `RESTORE_RECOVERY_REQUIRED` 精确消息契约（满足 `ArchitectureContractTest.nativeWidgetCannotModifyDataDuringPendingRestore` 与 `TodoPlugin` 错误码契约），同时 `ArchiveFileBatchPlugin` 仅阻断未初始化旧 APK 的孤立/冲突标记而在 durable control 启用时于 `control.lock` 内全量加锁阻断。
    2. `d127a63c791f766ea53167becbadca4aa1ec72a2`：`vite.config.js` 通过 `manualChunks` 将 `@capacitor/filesystem` 拆分为独立 chunk `capacitor-filesystem`，确保主入口 `index-*.js` 导出零 Capacitor 插件代理，使 P6 原生验收 `verify.mjs` 的 `resolveRestoreJournal(entry)` 确定性命中唯一 `restoreJournal`。
  - 本地全量 `npm run check`（ESLint 0 errors、Node 820/820、Vitest 47 文件 438/438、`vue-tsc` + `tsc -p tsconfig.contracts.json`、`vite build`）、标准 Android Gradle、API 34 (17/17 + 8/8)、API 24 (13/13)、API 25 (13/13) 及远端 GitHub Actions `Quality` 4/4：**全量 PASS**。

---

## 6. 远端 CI 与精确提交 SHA

- **整改代码提交链**：
  - `88ec405120da9e83bb8399dc38fb590a33630610`（F01–F06 完整整改实现与自动化测试）
  - `1fa09fed59e673f94edafe9c3e16b5dd0c5e1c06`（`RESTORE_RECOVERY_REQUIRED` 精确消息契约与旧版 `ArchiveFileBatch` 兼容修复）
  - **`d127a63c791f766ea53167becbadca4aa1ec72a2`**（`@capacitor/filesystem` 独立 chunk 隔离，**全绿 CI 对应精确代码 SHA**）
- **GitHub Actions `Quality` Run ID**：**`45957580830`**（`https://github.com/Zhoubin601/ForMyself/actions/runs/45957580830`，结论：**`success` 4/4**）

| CI Job | Job ID | 耗时 | 结论 | 覆盖范围 |
| --- | --- | ---: | :---: | --- |
| `web` | `140367535035` | 181 s | **success** | `npm run check`（ESLint + 820 Node + 438 Vitest + TypeScript strict + Vite build） |
| `android` | `140367534720` | 382 s | **success** | 普通 APK Debug + UnitTest + 16 项 `connectedDebugAndroidTest` + 真实 WebView Playwright P6 (`verify.mjs` 含 `am force-stop`) |
| `m6-synthetic-android (33)` | `140367535080` | 1,108 s | **success** | Release 阻断 + API 33 全套 58/58 合成测试（含 N-05、E2E、5 阶段 SIGKILL、SAF、FIX-04、容量基准） |
| `m6-synthetic-android (34)` | `140367534954` | 1,495 s | **success** | Release 阻断 + API 34 全套 58/58 合成测试（含 N-05、E2E、5 阶段 SIGKILL、SAF、FIX-04、容量基准） |

- **已归档 CI Artifacts**：
  - `android-test-reports`（ID `15178799618`，15,273,096 B）
  - `m6-synthetic-api33-reports`（ID `15180531305`，936,375 B）
  - `m6-synthetic-api34-reports`（ID `15180422316`，1,067,794 B）

---

## 7. 未覆盖事项与剩余风险

1. **真实硬件断电实验**：本轮在 Android 模拟器完成真实多进程 `SIGKILL`、普通 APK `force-stop` 与 `fsync`/`dirFsync` 故障注入，未在实体机做拔电池级硬件断电实测。
2. **API 24/25 原厂 AOSP WebView 52.0 限制**：API 24 (`7.0`) 与 API 25 (`7.1.1`) 原厂镜像自带 WebView `52.0.2743.100`，低于 Capacitor 8 硬门槛 55 / 默认门槛 60。两台模拟器上全部 Native 层（N-05 6/6 + E2E Native 5/5 含真实 `SIGKILL` 自主冷启动收敛）均通过，Bridge 均诚实报告 `WEBVIEW_BELOW_CAPACITOR_FLOOR` / `PLUGIN_MISSING` 并阻断，未擅自修改 `minSdkVersion=24` 或宣称旧 WebView 兼容。
3. **M6-04 / M6-05 阶段边界**：主密码变更/双口令轮换（M6-04）与发行 profile `0x0001` 冻结及最终故障矩阵（M6-05）严格保留在后续阶段，本轮未提前实施。
4. **生产隔离保持不变**：`kanataCanonicalStorage` 保持 `'legacy'`，普通 APK `BuildConfig.KANATA_M2_SYNTHETIC=false`，不编译不打包任何合成插件。
