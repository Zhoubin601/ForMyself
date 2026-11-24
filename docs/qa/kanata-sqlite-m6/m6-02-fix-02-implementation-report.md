# Kanata SQLite M6-02 第二轮定点整改实现报告 (`M6-02-FIX-02`)

- **任务编号**：`M6-02-FIX-02`
- **执行对象**：Hydrogen
- **独立审计方**：GPT-6.2（本报告提交完整代码、故障注入证据与回归结果供 GPT-6.2 独立裁定，Hydrogen 不自行标记 `CLOSED`）
- **基准分支 / 基线提交**：`m6/encrypted-backup-recovery` / `bdfbac415c22552b5056aa2535367496a165cd7b`
- **日期**：2026-11-24（北京时间）

---

## 1. 阻断问题逐项根因、修复方案与前后行为对比

### P1-01：Exporter Task ID 所有权与并发冲突
- **修改文件**：[KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java)
- **根因**：旧实现调用 `ACTIVE_TASKS.add(taskId)` 时未检查返回值；当同进程或跨进程两个任务传入相同 `explicitTaskId` 时，第二个任务在 `tmpSpool.createNewFile()` 失败后进入 `finally`，在 `!exportCommitted` 分支误删第一个任务正在使用的 `.spool.tmp` 与 `.task-<taskId>.pending`，并从 `ACTIVE_TASKS` 移除第一个任务的活跃标记。
- **修复方案**：
  1. 在进入 `try/finally` 及触碰任何目录/文件之前，先原子校验 `ACTIVE_TASKS.add(taskId)`；若返回 `false`，立即抛出 `PortableException(ERR_IO_FAILED, "task-id-already-active")` 且不进入资源清理。
  2. 显式拆解所有权标志：`ownsActiveTask`、`ownsPendingJournal`、`ownsTempSpool`、`ownsCommitTemp`（默认全为 `false`，仅当本任务成功创建/加锁后置 `true`）。
  3. 跨进程锁定：在创建 `tmpSpool` 之前先对 `.task-<taskId>.pending` 执行 `tryLock()`（捕获 `OverlappingFileLockException`）；若无法获得锁则立即拒绝（`task-id-locked`），不删除对方文件；若旧 Journal 非空且非新建则拒绝覆盖（`task-id-unrecovered-collision`）。
  4. `finally` 中仅清理本任务拥有且允许删除的文件，最后仅在 `ownsActiveTask` 时移除 `ACTIVE_TASKS`。
  5. 导出运行期间（同进程由 `ACTIVE_TASKS`、跨进程由 OS `FileLock`），`recoverIncompleteTasks()` 跳过仍在执行的任务。
- **修复前后对比**：
  - 修复前：并发重复 `explicitTaskId` 会误删先发任务的 `.spool.tmp`/`.pending` 并移除其活跃占位。
  - 修复后：同进程与跨进程重复 `explicitTaskId` 均被立即拒绝，先发任务临时文件、Journal 及最终目标完好并正常通过 SHA-256 与解密校验。
- **验证测试**：`KanataM6Fix02FaultInjectionTest.p1_01_duplicateTaskIdConcurrencyAndCrossProcessProtection`（同进程双线程暂停竞争 + `:m6worker` 跨进程 OS `FileLock` 竞争 + 活跃期 `recoverIncompleteTasks` 跳过校验）。

### P1-02：Importer 目标数据库并发提交保护
- **修改文件**：[KanataM6SchemeCImporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCImporter.java)
- **根因**：旧实现在 Step 7 读取 `hasDatabaseOrSidecar(targetAbs)` 与调用 `Os.rename()` 之间没有路径级互斥锁；两个并发 Importer 向同一未创建目标路径导入时，可能同时通过目标存在检查并在随后相互覆盖。
- **修复方案**：
  1. 实现路径级互斥器 `TargetCommitLockHandle` / `acquireTargetCommitLock(targetAbs)`：基于 `getCanonicalFile()` 路径建立 `TARGET_COMMIT_LOCKS`（`ReentrantLock(true)` 引用计数槽）序列化同进程线程，并结合目标父目录 `.kanata-import-<sha24>.lock` 的 OS `FileLock` 与 `Os.fstat == Os.stat` inode 核对循环实现跨进程互斥。
  2. 在 `afterStagingVerified` 之后、最终 `hasDatabaseOrSidecar` 检查之前获取 `TargetCommitLockHandle`，并一直持有直至 `Os.rename` 与父目录 `fsync` 全部结束（退出 `try-with-resources` 时自动释放并清理 `.lock` 文件与 map 槽位）。
  3. 保持 `allowOverwriteExistingTarget = false` 默认行为；失败后绝不删除原有目标库，仅删除本任务创建的 `.stage-target-*.db`。
- **修复前后对比**：
  - 修复前：双并发 Importer 可同时通过存在性检查并覆盖前者。
  - 修复后：同一目标路径提交完全串行化；使用 `CyclicBarrier(2)` 同时冲刺提交阶段时，`maxConcurrentCommitThreads == 1`，仅 1 个任务提交成功，另一个明确返回 `ERR_IO_FAILED:target-already-exists`，无残留 WAL/SHM/staging/lock 文件。
- **验证测试**：`KanataM6Fix02FaultInjectionTest.p1_02_importerTargetMutexConcurrencyAndSidecarSafety`。

### P1-03：统一 Capacitor Bridge 请求大小限制与响应上限
- **修改文件**：[KanataM6SyntheticPortablePlugin.java](syntheticDebug/java/com/yubin/formyself/KanataM6SyntheticPortablePlugin.java)、[KanataM6N03BoundedMemoryTest.java](androidTest/com/yubin/formyself/KanataM6N03BoundedMemoryTest.java)
- **根因**：旧实现仅 `controlStartExport` 检查了 `4096 B` 上限和 `bulkRows`/`base64Db`，`controlPollStatus` 和 `controlCancelExport` 缺失同等拦截；且 `recordSize` 在拦截之前调用，导致被拒绝的大请求污染了 `MAX_OBSERVED_BRIDGE_BYTES`。
- **修复方案**：
  1. 抽取统一请求校验方法 `validateControlRequest(PluginCall call, Set<String> allowedKeys)`：在 `Start` / `Poll` / `Cancel` 三个入口统一按 UTF-8 字节长度计算上限 `MAX_BRIDGE_CONTROL_BYTES = 4096`。
  2. 为三个入口分别执行严格白名单：`START_ALLOWED_KEYS` (`sourceId`, `targetName`, `clientRequestId`, `tableDelayMs`)、`POLL_ALLOWED_KEYS` (`handle`)、`CANCEL_ALLOWED_KEYS` (`handle`)，显式拒绝 `bulkRows`、`base64Db`、未知字段及嵌套对象/数组。
  3. 在 `resolveSmall` 中强制校验响应体 UTF-8 字节长度 `<= MAX_BRIDGE_RESPONSE_BYTES (512)`；超限时阻止 `call.resolve` 并调用 `call.reject("BRIDGE_RESPONSE_TOO_LARGE", "RESOURCE_LIMIT")`。
  4. 分离统计口径：`OBSERVED_REQUEST_BYTES` / `OBSERVED_RESPONSE_BYTES` / `MAX_OBSERVED_BRIDGE_BYTES` 仅记录已接受并正常返回的请求/响应；所有超限、非法字段、过期/重复拒绝均记入 `REJECTED_REQUEST_BYTES` / `REJECTED_RESPONSE_BYTES` 及对应拒绝计数器。
- **修复前后对比**：
  - 修复前：`Poll`/`Cancel` 可传入超限或非法字段；被拒请求污染 `MAX_OBSERVED_BRIDGE_BYTES` 达 8200+ B。
  - 修复后：三接口统一按 4096 B UTF-8 及白名单拦截，响应硬顶 512 B，`MAX_OBSERVED_BRIDGE_BYTES` 实测稳定 `<= 174 B`。
- **验证测试**：`KanataM6Fix02FaultInjectionTest.p1_03_bridgeUnifiedSizeAllowlistAndResponseGuard`（完整覆盖 P1-03 表全部 10 项，在 API 30/34 真 WebView 通过；API 24/25 因原厂 WebView 52.0 诚实记录为 `BLOCKED`）及更新断言后的 `KanataM6N03BoundedMemoryTest`。

### P1-04：Exporter 敏感数据生命周期与全路径清零验证
- **修改文件**：[KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java)、[KanataM6BoundedRowReader.java](syntheticDebug/java/com/yubin/formyself/KanataM6BoundedRowReader.java)
- **根因**：旧实现在 `exportToSpool` 进入 `try` 之前已分配 `pwBytes`、`mat`、`baseKek`、`outPlain`（若目录校验或 `sameFileSystem` 抛错则不会触发 `finally`）；`EncodedRow` 与 `OrderTracker` 缺少 `AutoCloseable` 清理，异常发生时 `row.body`、PK/world_id 及 `OrderTracker` 保留的前一行键可能遗留未清零。
- **修复方案**：
  1. 将全部敏感缓冲区变量声明为 `null` 并移入唯一外层 `try/finally` 内分配；为 `ExportMaterial` 增加 `ownedByTask` 标记，严格区分调用方传入材料与当前任务自行生成的随机材料，仅清零本任务拥有的材料。
  2. 让 `EncodedRow` 实现 `AutoCloseable`，在其 `close()` 中清零 `body`、`pkTextBytes` 与 `ordinalWorldIdBytes`；在业务表与派生表双循环中使用 `try (EncodedRow row = ...)`。
  3. 让 `OrderTracker` 实现 `AutoCloseable`：仅保留上一行的深拷贝 PK/`world_id` 字节，每次行推进立即清零被替换的旧字节，表结束或异常退出时 `close()` 立即全数清零。
  4. 清理 `KanataM6BoundedRowReader` 中被投影替换的旧 `colInlineBytes[stateIdx]`、`manifestPlain`、`footerPlain`、`outPlain`、`pendingBuf`，并保持异常文案仅含表/列名而不含密码、密钥或明文值。
  5. 增加 `BufferObserver` / `onSensitiveBufferAllocated` 观察钩子及 8 个细分故障注入点（`afterDbRead`、`afterRowEncoded`、`afterOrderTrackerValidated`、`beforeChunkerAppend`、`afterChunkerAppend`、`beforeSpoolWrite`、`beforeFsync`、`beforeReadback`、`performAtomicReplace`）。
- **验证测试**：`KanataM6Fix02FaultInjectionTest.p1_04_sensitiveBufferLifecycleAndZeroizationAcrossAll8FaultPoints`（覆盖正常退出、调用方材料保留不误清、早期目标异常及全部 8 个注入点，运行时断言全部已分配任务缓冲字节 100% 归零）。

### P1-05：文件系统持久化与目录 `fsync` 失败显式状态
- **修改文件**：[KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java)、[KanataM6SchemeCImporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCImporter.java)、[KanataM6PortableCrypto.java](syntheticDebug/java/com/yubin/formyself/KanataM6PortableCrypto.java)、[KanataM6KillableWorkerService.java](syntheticDebug/java/com/yubin/formyself/KanataM6KillableWorkerService.java)
- **根因**：`fsyncDirectoryBestEffort` 与 Importer `defaultAtomicTargetCommit` 直接吞掉了 `Os.open`/`Os.fsync` 异常。
- **修复方案**：
  1. 用严格 `fsyncDirectoryStrict(File dir)` 替换静默吞错；同时保留可注入 `performTargetDirFsync(File targetParentDir)` 钩子用于故障测试。
  2. Exporter 提交状态机拆分为明确阶段：提交前失败（`ERR_IO_FAILED` / `ERR_CANCELLED`）→ `Os.rename` 失败（`ERR_IO_FAILED`，保留旧目标）→ `Os.rename` 已成功但目录 `fsync` 失败：立即写入 Journal `RENAMED_PENDING_DIR_SYNC`（记录 `expectedSha256Hex`），抛出 **`ERR_DURABILITY_UNCONFIRMED`**，**禁止删除或回滚已更名到位的目标文件**，并保留该 `.pending` 供恢复程序重做目录 `fsync` → 目录 `fsync` 成功后写 `COMMITTED` 并正常返回。
  3. Importer 在持有目标提交互斥锁内若 `Os.rename` 成功而 `performTargetDirFsync` 失败，同样抛出 `ERR_DURABILITY_UNCONFIRMED` 并保留已更名目标库（不删库）。
  4. `:m6worker` 新增 `STAGE_AFTER_RENAME_BEFORE_DIR_SYNC` 真 `SIGKILL` 窗口，实证进程在 `Os.rename` 后、目录 `fsync` 前被强杀后，重启调用 `recoverIncompleteTasks()` 可识别 `RENAMED_PENDING_DIR_SYNC`、校验 SHA-256 并补做目录 `fsync` 完成确认（`confirmedCommitTasks = 1`）。
  5. 在 API 24/25/30/34 上实测 `filesDir`、`cacheDir`、`noBackupFilesDir`、`externalFilesDir` 四目录的 `statvfs` 与真实目录 `fsync` 支持性，四平台四目录均返回 `dirFsyncSupported = true`。
- **验证测试**：`KanataM6Fix02FaultInjectionTest.p1_05_durabilityDirFsyncFailureCommitWindowKillAndFsProbe`。

### P2-01：Journal 规范路径与 Task ID 强校验
- **修改文件**：[KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java)
- **根因**：`recoverIncompleteTasks()` 过去仅凭 `endsWith(".spool.tmp")` 即删除 Journal 指向的路径，存在目录穿越或跨任务误删风险。
- **修复方案**：
  1. 使用 `getCanonicalFile()` 对传入的 `dirs` 列表及 Journal 内 `tmpSpoolPath`、`commitTempPath`、`targetPath` 进行规范化边界校验，显式拒绝含 `..`、非绝对路径及父目录不在受控 `dirs` 内的路径。
  2. 强制核对 `.task-<tid>.pending` 文件名中 `<tid>` 与 JSON `"taskId"` 完全一致，且临时文件名必须严格以 `.` 开头并以 `.<tid>.spool.tmp` / `.<tid>.commit.tmp` 结尾。
  3. 仅认可白名单状态（`STARTED`、`VERIFIED_READY_TO_COMMIT`、`RENAMED_PENDING_DIR_SYNC`、`COMMITTED`）；空文件、截断 JSON、未知状态或路径校验失败均记入 `rejectedUntrustedJournals`，触发零删除。
- **验证测试**：`KanataM6Fix02FaultInjectionTest.p2_01_journalPathValidationAndUntrustedRejection`（6 类恶意/损坏 Journal 全数拒绝、`cleanedTasks = 0`、所有外部/父目录/跨任务受害文件字节不变）。

### P2-02 与 P2-03：报告口径修正与 API 24/25 边界保留
- 在 `m6-02-final-report-v1.md` 及本轮三份报告中明确核对并统一：`38d0b6b` → `bdfbac4` 经 `git show --stat` 为 26 个条目（其中 2 个 `R100` 纯重命名零行改动、24 个内容改动；部分 GitHub compare 视图对纯重命名或不同基线显示 25），并单列 `M6-02-FIX-02` 实际改动文件清单、各版本模拟器 WebView 版本（API 24/25 为 `52.0.2743.100`，API 30/34 为 `113.0.5672.136`）以及 CI 实际执行范围。
- 严格保留 API 24/25 原厂镜像 WebView `52.0` 与 Capacitor 8（`Bridge.MINIMUM_ANDROID_WEBVIEW_VERSION = 55`）的 `BLOCKED` 事实，未将任何 Bridge 失败伪装成 PASS 或跳过。

---

## 2. 本轮新增与修改文件清单

1. **核心整改代码（全部隔离于 `syntheticDebug/`，生产 `src/` 与 `android/app/src/main/` 零改动）**：
   - [KanataM6PortableCrypto.java](syntheticDebug/java/com/yubin/formyself/KanataM6PortableCrypto.java)
   - [KanataM6BoundedRowReader.java](syntheticDebug/java/com/yubin/formyself/KanataM6BoundedRowReader.java)
   - [KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java)
   - [KanataM6SchemeCImporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCImporter.java)
   - [KanataM6SyntheticPortablePlugin.java](syntheticDebug/java/com/yubin/formyself/KanataM6SyntheticPortablePlugin.java)
   - [KanataM6KillableWorkerService.java](syntheticDebug/java/com/yubin/formyself/KanataM6KillableWorkerService.java)
2. **测试套件与 CI 工作流**：
   - [KanataM6Fix02FaultInjectionTest.java](androidTest/com/yubin/formyself/KanataM6Fix02FaultInjectionTest.java)（新增 6 项独立 P1/P2 故障注入专项测试）
   - [KanataM6N03BoundedMemoryTest.java](androidTest/com/yubin/formyself/KanataM6N03BoundedMemoryTest.java)（收紧 `OBSERVED_REQUEST_BYTES` / `MAX_OBSERVED_BRIDGE_BYTES <= 4096` 断言）
   - [run-m6-ci.sh](run-m6-ci.sh)（新增 CI 专项执行与报告收集脚本）
   - [.github/workflows/quality.yml](../../../.github/workflows/quality.yml)（新增独立 `m6-synthetic-android` Job，matrix API `[30, 34]`）
3. **本轮报告**：
   - [m6-02-fix-02-implementation-report.md](m6-02-fix-02-implementation-report.md)（本报告）
   - [m6-02-fix-02-regression-report.md](m6-02-fix-02-regression-report.md)
   - [m6-02-fix-02-ci-evidence.md](m6-02-fix-02-ci-evidence.md)
   - 同步更新：[m6-02-ac-export-report-v1.md](m6-02-ac-export-report-v1.md)（追加 6C 节）、[m6-02-final-report-v1.md](m6-02-final-report-v1.md)

---

## 3. 测试环境与已知限制

| 环境 | 设备 / AVD | Android SDK / Release | 系统 WebView 版本 | 角色与结论 |
|---|---|---|---|---|
| API 34 | `Codex_Todo_WebView34` (`x86_64`) | API 34 / Android 14 | `com.google.android.webview` `113.0.5672.136` | 原 19 项 **19/19 PASS**；Fix-02 **6/6 PASS**；Bench **3/3 (54 样本) PASS** |
| API 30 | `Codex_Todo_API30` (`x86_64`) | API 30 / Android 11 | `com.google.android.webview` `113.0.5672.136` | 原 19 项 **19/19 PASS**；Fix-02 **6/6 PASS**；Bench **3/3 (54 样本) PASS** |
| API 25 | `Codex_Kanata_API25` (`x86_64`) | API 25 / Android 7.1.1 | `com.android.webview` `52.0.2743.100` | 原 19 项 **18/19 PASS**；Fix-02 **5/6 PASS**；两项 WebView Bridge 因 `WebView 52 < 55` 诚实 **BLOCKED** |
| API 24 | `Codex_Kanata_API24` (`x86_64`) | API 24 / Android 7.0 | `com.android.webview` `52.0.2743.100` | 原 19 项 **18/19 PASS**；Fix-02 **5/6 PASS**；两项 WebView Bridge 因 `WebView 52 < 55` 诚实 **BLOCKED** |

**已知限制：**
1. **最低运行环境边界**：Capacitor 8 内核硬性要求 Android System WebView >= 55（默认推荐 >= 60）；未更新系统 WebView 的原厂 AOSP Android 7.0/7.1（WebView 52.0）仅支持 Native 层加解密、SQLCipher 快照与文件原子读写（实测全部通过），但无法加载 JS Bridge。
2. **100k 消息下 Scheme C 读取耗时**：API 34 `dbReadMs` 中位数 `27,802 ms`、总耗时 `30,871 ms`（API 30 `dbReadMs = 28,044 ms`，总耗时 `33,182 ms`），同时写阻塞恒定 `4–5 ms`、可 `1–62 ms` 取消、RSS 峰值 `186.5–218.7 MiB`。
3. **测试态隔离边界**：所有 M6-02 实现仅存在于 `docs/qa/kanata-sqlite-m6/`，正式产品接入与设置页面 UI 留待 M6-03。
