# Kanata SQLite M6-03 隔离恢复引擎与 RestoreCoordinator 深度集成交付报告 v1

- **任务编号**：`KANATA-M6-03-RESTORE-COORDINATOR-2026-11-26`
- **最终状态**：**`PASS`**（待 GPT-6.2 独立终审签核；不自行标记 `CLOSED`，不提前启动 M6-04）
- **仓库 / 分支 / 工作树**：`Zhoubin601/ForMyself` / `m6/encrypted-backup-recovery` / `.worktrees/kanata-m5`
- **任务基线 SHA**：`b32ebb2366422bdb1a653f7bee45b56956b1722d`
- **日期**：2026-11-26（北京时间）
- **任务书**：[docs/20261126-kanata-sqlite-m6-03-restore-coordinator-task-v1.md](../../20261126-kanata-sqlite-m6-03-restore-coordinator-task-v1.md)
- **结构化机器证据**：[docs/qa/kanata-sqlite-m6/m6-03-evidence-v1.json](m6-03-evidence-v1.json)

---

## 1. 实际修改与新增文件清单

### 1.1 应用与平台源码（JS / Vue / TypeScript）
| 文件 | 变更类型 | 职责说明 |
| --- | --- | --- |
| `src/features/chat/backup/portable/restoreDecoder.js` | 新增 | 工作包 A：基于 M6-01 冻结 `containerCodec` 的有界流式 KPB1 恢复解码器，支持进度回调、分块流/Blob 有界读取、稳定错误码标准化（不泄露密码/密钥/正文）与 staging abort 保障 |
| `src/platform/storage/restoreJournal.js` | 修改 | 工作包 C：`commit(expectedDigest?)` 支持校验 `record.digest === expectedDigest`（向后兼容无参调用），闭环 H-04 提交错配风险 |
| `src/application/restoreCoordinator.js` | 修改 | 工作包 C/D：新增可选 `assertSession`（每次 `await` 后重检 owner/session/恢复世代）、`onPhase` 阶段上报、`commit(digest)` 绑定，以及 `DURABILITY_UNCONFIRMED` 保护态保留（不删除日志、保持 `blocked=true`） |
| `src/application/kanataPortableRestoreCoordinator.js` | 新增 | 工作包 C/D：将 `KanataSqliteGenerationDescriptor` 深度接入单一产品 `createRestoreCoordinator` + AES-256-GCM `RestoreJournal`，实现两阶段分离（staging 校验 → 协调器接管切换）、世代校验、10 类崩溃恢复与 UNCONFIRMED 核验/安全清理门禁 |
| `src/platform/runtime/backupCapabilityProbe.js` | 新增 | 工作包 E：平台运行能力探测与 WebView/Bridge 映射，Android 强制 `Capacitor.isPluginAvailable()` + 真实 nonce `handshake()` 双向握手；Web 沿用现有加密文件适配器，不强制 WASM/OPFS |
| `src/application/kanataPortableRestoreRuntime.js` | 新增 | 工作包 F：设置页隔离恢复状态机、防重复提交、取消信号传递、仅在 Coordinator 真正 commit 后呈现成功、UNCONFIRMED 人工核验状态管理 |
| `src/composables/useAppController.js` | 修改 | 工作包 E：启动与后台恢复前台时触发非阻塞运行能力探测 |
| `src/composables/settings/useBackupSettings.js` | 修改 | 工作包 F：进入备份页、前台恢复、操作前触发能力探测，接入文件选择/密码/进度/取消/确认/UNCONFIRMED，卸载时释放监听与密码；保持不导入 `backup/portable` 或测试常量（维持 `C01-05` 零退化） |
| `src/application/settingsModels.js` | 修改 | 工作包 F：同步更新 `SETTINGS_SECTION_FIELDS.SettingsBackup` 精确投影字段 |
| `src/components/settings/SettingsBackup.vue` | 修改 | 工作包 F：完整呈现能力状态、平台/WebView/Bridge/SQLite/SAF 详情、文件选择、独立密码、阶段与进度、错误码与重试提示、取消与协调器提交确认、完成结果、派生同步独立重试与 UNCONFIRMED 人工核验面板 |
| `src/application/contracts.d.ts` | 修改 | 同步导出 `RestoreCoordinatorPhase`、`BackupRuntimeCapability`、`KanataSqliteGenerationDescriptor`、`UnconfirmedTaskSummary`、`KanataPortableRestoreEngine` 等严格契约 |

### 1.2 Android Native 与隔离测试引擎（Java / Gradle / Manifest）
| 文件 | 变更类型 | 职责说明 |
| --- | --- | --- |
| `android/app/build.gradle` | 修改 | 引入 `androidx.webkit:webkit:$androidxWebkitVersion`（复用 `variables.gradle` 已冻结 `1.14.0`），保持 `KANATA_M2_SYNTHETIC=false` 与 `minSdkVersion=24` 不变 |
| `android/app/src/main/AndroidManifest.xml` | 修改 | 新增 Android 11+ `<queries>`（`ACTION_OPEN_DOCUMENT` / `ACTION_CREATE_DOCUMENT`）使 `PackageManager.resolveActivity` 可准确探测系统 SAF 能力 |
| `android/app/src/main/java/com/yubin/formyself/KanataRuntimeCapabilityInspector.java` | 新增 | 工作包 E：通过 `WebViewCompat.getCurrentWebViewPackage()` 探测 Android API、WebView 包名/版本、Capacitor 8 门槛（55 硬门槛 / 60 默认）、插件注册、SQLite 激活隔离位与 SAF 可用性 |
| `android/app/src/main/java/com/yubin/formyself/KanataRuntimeCapabilityPlugin.java` | 新增 | 工作包 E：只读 Capacitor 插件，提供 `getCapabilities()` 与 `handshake({ nonce })` 真实双向握手 |
| `android/app/src/main/java/com/yubin/formyself/MainActivity.java` | 修改 | 注册只读 `KanataRuntimeCapabilityPlugin` |
| `docs/qa/kanata-sqlite-m6/syntheticDebug/java/com/yubin/formyself/KanataM6BridgeActivity.java` | 修改 | 在合成 Bridge 测试页注册 `KanataRuntimeCapabilityPlugin` |
| `docs/qa/kanata-sqlite-m6/syntheticDebug/java/com/yubin/formyself/KanataM6StagingRestoreEngine.java` | 新增 | 工作包 A/B/C/D：SQLCipher 4.17.0 隔离分批原子恢复引擎（`batchSize=500`、staging-DB 暂存延迟外键回填、12 项完整核验、M6-00 `KanataKeyEnvelope` 独立 DEK、复用 FIX-04 稳定锁、幂等切换、UNCONFIRMED 检查/重验/安全清理） |
| `docs/qa/kanata-sqlite-m6/syntheticDebug/java/com/yubin/formyself/KanataM6KillableWorkerService.java` | 修改 | 工作包 D：新增独立进程 `:m6worker` 7 个 M6-03 恢复阶段 `SIGKILL` 注入点（保留全部既有 M6-02 动作不变） |

### 1.3 测试套件、CI 与文档
| 文件 | 变更类型 | 职责说明 |
| --- | --- | --- |
| `tests/kanataM603RestoreDecoder.test.js` | 新增 | Node 测试：真实 Schema 005 SQLite ↔ KPB1 流式恢复与 13 项正负拒绝矩阵 |
| `tests/KanataM603RestoreCoordinator.spec.js` | 新增 | Vitest 测试：RestoreCoordinator 深度集成、10 个崩溃点、UNCONFIRMED、WebView/Bridge 能力映射、SettingsBackup 完整交互 |
| `tests/types/kanataM603Restore.ts` | 新增 | TypeScript 严格契约正向 + 5 条 `@ts-expect-error` 负向样例 |
| `docs/qa/kanata-sqlite-m6/androidTest/com/yubin/formyself/KanataM603RestoreEngineAndCoordinatorTest.java` | 新增 | Android Instrumentation：文件/SAF 恢复、12 项负向拒绝、分批回滚/ENOSPC/fsync UNCONFIRMED、7 阶段真实多进程 `SIGKILL`、Native 能力检测 |
| `docs/qa/kanata-sqlite-m6/androidTest/com/yubin/formyself/KanataM603BridgeCapabilityTest.java` | 新增 | Android Instrumentation：真实 WebView Bridge `handshake({ nonce })` 与 API 24 WebView 52 诚实阻断验证 |
| `docs/qa/kanata-sqlite-m6/androidTest/com/yubin/formyself/KanataM603CapacityBenchmarkTest.java` | 新增 | Android Instrumentation：1k / 10k / 100k 消息恢复容量与内存/批次压测 |
| `docs/qa/kanata-sqlite-m6/run-m6-ci.sh` | 修改 | 将 M6-03 三套 Android Instrumentation 类接入 M6 合成 CI（纯 LF） |
| `docs/20261126-kanata-sqlite-m6-03-restore-coordinator-task-v1.md` | 新增 | M6-03 源码审计、恢复状态机与实施任务书 |

---

## 2. 源码接口变更与恢复状态机

1. **恢复日志与协调器（保持 v1–v12 与 v13 全兼容）**：
   - `RestoreJournal.commit(expectedDigest?: string)`：可选校验提交摘要与当前持久化加密日志一致。
   - `RestoreCoordinatorOptions` 新增可选 `assertSession?: () => void`、`onPhase?: (phase: RestoreCoordinatorPhase) => void`；支持 `capture()` 返回同步对象或 Promise，所有 `await` 后均重新核对 owner、sessionRevision 与恢复世代。
2. **恢复状态流**：
   `读取 KPB1 (SAF/File 有界 64 KiB 流)` → `认证与 Header/Manifest/DATA/Footer/EOF 校验` → `创建独立 SQLCipher 4.17.0 临时库 (Schema 005 + M6-00 封装)` → `按表目录分批原子导入 (batchSize=500 + 两遍外键回填)` → `12 项完整性复核 (53 表/50 摘要/FK/integrity/cipher_integrity/005 ordinal/3 运行表为空)` → `等待用户确认` → `RestoreCoordinator.prepare (WriteGate 排空)` → `捕获已校验 previous 世代副本` → `持久化 AES-256-GCM 恢复日志 (restore-v1.enc) 并读回校验` → `受控幂等原子 apply (FIX-04 稳定锁 + 目录 fsync)` → `写入绑定 digest 的 commit 标记 (restore-v1.commit)` → `clear journal (先删 enc 再删 commit/tmp)` → `解除 blocked 并清理无引用临时文件` → `独立同步派生状态 (syncError 与业务库提交解耦)`。

---

## 3. KPB1 导入与 Staging 验证结果

- **Node (`tests/kanataM603RestoreDecoder.test.js`)**：2/2 PASS，覆盖全部 13 类场景（正确密码、错密码 `AUTH_FAILED`、未知版本 `UNSUPPORTED_FORMAT`、损坏 DATA、Footer 篡改、Manifest 篡改、缺失分块、重复分块、乱序分块、文件截断、尾部追加字节、超资源上限 `RESOURCE_LIMIT`、主动取消 `CANCELLED` 及错误信息脱敏），验证未知 JSON 扩展字段、原始文本语义、3 张 ordinal 表顺序及 3 张运行表排除。
- **Android Native (`KanataM603RestoreEngineAndCoordinatorTest`)**：API 34 与 API 24 均验证文件 + 真实 SAF `DocumentsProvider` 流式恢复、M6-00 `KanataKeyEnvelope` 独立 DEK 生成、分批原子事务回滚（`messages` 第 2 批注入 `ENOSPC` 完整回滚且原库 SHA-256 不变）、12 项负向矩阵（含 Schema 版本不匹配、外键破坏、`event_array_order` 缺失拒绝）。

---

## 4. RestoreCoordinator 接入、Journal 持久化、崩溃恢复与 UNCONFIRMED

- **Vitest (`tests/KanataM603RestoreCoordinator.spec.js`, 11/11 PASS)**：
  - 完整验证未校验 staging 零写入拒绝、异步边界后 session/owner 变更拦截、AES-256-GCM 恢复日志持久化/读回/digest 绑定、全部 **10 个崩溃中断点**、回滚失败保留日志与 `blocked=true`、派生同步失败独立重试且不重复导入业务库、以及既有 `RestoreCoordinator.spec.js` (18/18)、`KanataBackupRuntime.spec.js` (7/7)、`KanataProductRecovery.spec.js` (28/28) 零回归（v1–v12 与 v13 完整兼容）。
- **Android 真实多进程 `Process.killProcess()` (`SIGKILL`) 崩溃矩阵**：
  - 在独立 `:m6worker` 进程中于 7 个真实中断点执行 `SIGKILL` 并冷启动按 `RestoreCoordinator` 协议恢复：
    1. `DURING_STAGING` → 收敛至 `previous`
    2. `AFTER_STAGING_BEFORE_JOURNAL` → 收敛至 `previous`
    3. `AFTER_JOURNAL_BEFORE_APPLY` → 收敛至 `previous`
    4. `DURING_APPLY_BEFORE_RENAME` → 收敛至 `previous`
    5. `BEFORE_COMMIT_MARKER` → 收敛至 `previous`
    6. `AFTER_COMMIT_MARKER` → 前向收敛至 `target`
    7. `DURING_JOURNAL_CLEAR` → 幂等收敛至 `target`
  - API 34 与 API 24 均实测 `{"stagesTested":7,"allConvergedCleanly":true}`。
- **UNCONFIRMED 保护与人工核验**：
  - `Os.rename` 后注入父目录 `fsync` 失败触发 `DURABILITY_UNCONFIRMED`，保持 `blocked=true` 与恢复日志完整。
  - 人工清理严格要求用户显式确认、无待处理恢复日志、持有 FIX-04 稳定 `.lock`（无活跃竞争进程）、inode 一致、目录包含边界与 SHA-256 校验通过；在持锁或未确认条件下均拒绝清理并保持保护态。

---

## 5. Android WebView / Bridge 兼容性矩阵

| 平台 / 环境 | Android API | WebView 包与版本 | Native SQLCipher/Crypto/SAF | Capacitor 8 Bridge 实测握手 | 隔离恢复判定 |
| --- | :---: | --- | :---: | :---: | --- |
| **Web 浏览器** | N/A | N/A | 沿用现有加密文件适配器（不强制 WASM/OPFS） | `not_applicable` | 可用（Web 路径） |
| **Android API 34 合成 QA** | 34 (`14`) | `com.google.android.webview` `113.0.5672.136` | **PASS**（5/5 + 3/3 压测 + 4/4 FIX-04） | **PASS**（`ok=true`, nonce 回显一致, `safAvailable=true`） | 可用 |
| **Android API 34 普通 APK** | 34 (`14`) | `113.0.5672.136` | `sqlitePluginActivated=false`（保持 legacy 隔离） | **PASS** | 诚实报告 `SQLITE_PLUGIN_NOT_ACTIVATED` |
| **Android API 24 原厂 AOSP** | 24 (`7.0`) | `com.android.webview` `52.0.2743.100` | **PASS**（5/5 Native 含 7 阶段 `SIGKILL` 与 SAF） | **BLOCKED**（`webviewMajorVersion=52 < 55/60`, `PLUGIN_MISSING`） | 诚实阻断 `WEBVIEW_BELOW_CAPACITOR_FLOOR`，绝不将 Native 通过冒充 Bridge 通过 |

> **产品兼容决策建议（供后续确认）**：当前未修改 `minSdkVersion=24`。实测证明 API 24/25 原厂未升级 WebView 52.0 无法承载 Capacitor 8 Bridge；后续正式启用 SQLCipher 便携恢复时，建议在产品侧明确要求系统 WebView >= 60（或引导用户升级 Android System WebView），并由运行时能力探测强制守门。

---

## 6. 1k / 10k / 100k 容量实测数据（API 34 / SQLCipher 4.17.0，`batchSize=500`）

| 规模 | KPB1 文件大小 | 恢复总耗时 | 解码耗时 | 分批写入耗时 | 50 表校验耗时 | 批次数 | 每批最大行 | 单批最大/中位耗时 | 临时库大小 | 峰值 RSS | Java Heap 峰值 | Native Heap 峰值 | WebView RSS | 50 表核验 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |
| **1k** | 193.0 KiB | 5,104 ms | 2,971 ms | 1,499 ms | 626 ms | 45 | 500 | 378 / 11 ms | 1.21 MiB | **153.0 MiB** | 37.6 MiB | 9.2 MiB | 153.0 MiB | **PASS (50/50)** |
| **10k** | 1.85 MiB | 12,204 ms | 4,354 ms | 6,161 ms | 1,682 ms | 63 | 500 | 333 / 12 ms | 4.51 MiB | **129.7 MiB** | 6.8 MiB | 11.9 MiB | 129.7 MiB | **PASS (50/50)** |
| **100k** | 18.84 MiB | 162,206 ms | 21,683 ms | 70,702 ms | 69,818 ms | 243 | 500 | 511 / 343 ms | 38.91 MiB | **132.2 MiB** | **9.2 MiB** | **11.9 MiB** | 132.2 MiB | **PASS (50/50)** |

所有三档均严格保持 M6-01/M6-02 冻结上限且峰值 RSS 远低于 Android `512 MiB` 红线。

---

## 7. 两轮独立自查结果

- **Round 1 独立自查与真实设备缺陷定位（共发现 4 项问题并全部修复）**：
  1. **Android 11+ (API 30+) SAF 包可见性缺陷**：首轮 API 34 实测中 `KanataRuntimeCapabilityInspector` 报告 `safAvailable=false`（因 `AndroidManifest.xml` 缺少 `<queries>` 导致 `PackageManager.resolveActivity` 返回 `null`）。已补充 `OPEN_DOCUMENT` / `CREATE_DOCUMENT` `<queries>`，复测 API 34 `safAvailable=true`。
  2. **崩溃恢复旧 WAL 侧文件死锁缺陷**：首轮 `m603_04` 真实 `SIGKILL` 测试发现旧代数据库残留 `-wal` 会导致 `applyVerifiedGeneration()` 报错 `apply-active-dirty-sidecars` 阻断崩溃恢复。已修复为在持有 FIX-04 稳定目标锁且完成 WriteGate 排空/崩溃接管后安全清除被替换旧代侧文件，复测 7/7 `SIGKILL` 中断点全部收敛。
  3. **`m603_02` 外键注入测试触发路径偏差**：原测试更新 `memories.world_id` 提前命中 Schema 001 `memories_immutable_scope` 触发器。已修正为先删除该触发器再破坏外键，确保真实覆盖 `verifyStagingDatabase()` 的 `pragma_foreign_key_check`。
  4. **`vue-tsc` 严格类型收窄**：`restoreDecoder.js` 补齐 `ReadonlySet<string>` JSDoc 注释，全量 `vue-tsc` + `tsc -p tsconfig.contracts.json` 零错误通过。
- **Round 2 复审**：
  - 边界隔离 `git diff --exit-code`（Schema 001–005、KPB1 冻结字节合同、M6-02 FIX-04 稳定锁、`kanataCanonicalStorage='legacy'`、`variables.gradle`、`package.json`/`package-lock.json`）：**Exit 0**。
  - `dist/assets/*.js` 隔离扫描：无 `KPB1/` 或 `0xff01` 测试常量泄露。
  - `npm run check`、标准 Android Debug 构建与单测、合成 M6 构建、合成 Release 阻断、API 34 (10/10 + 3/3 压测)、API 24 (6/6)：**全量通过**。

---

## 8. 远端 CI 记录与精确提交 SHA

- **实现与报告提交 SHA**：待本次提交后写入精确 SHA 与 GitHub Actions Run ID（见后续同步更新）。

---

## 9. 未覆盖事项与剩余风险

1. **M6-04 主密码变更与密钥轮换**：按阶段计划保持独立，不在 M6-03 提前实施。
2. **M6-05 全量最终故障矩阵与跨设备发行 Profile 冻结**：合成 profile `0xff01` 与发行 profile `0x0001` 仍保持严格隔离，待后续阶段与真机校准后冻结。
3. **生产普通构建存储边界**：`kanataCanonicalStorage` 保持 `'legacy'`，普通 APK `BuildConfig.KANATA_M2_SYNTHETIC=false`，未执行真实用户迁移或激活；普通 APK 中设置页能力检测会诚实显示 `SQLITE_PLUGIN_NOT_ACTIVATED` 并引导继续使用既有 `.json` 备份/恢复。
4. **本地 API 25 模拟器**：本次本地已实测 API 34（WebView 113）与 API 24（WebView 52.0），远端 CI 覆盖 API 33 + API 34；API 25 与 API 24 同为 AOSP WebView `52.0.2743.100`，本轮未重复加跑 API 25。
