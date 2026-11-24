# Kanata SQLite M6-02 全阶段最终交付与审计材料 v1

- **任务编号**：`KANATA-M6-02-INDEPENDENT-AUDIT-REMEDIATION-2026-11-23`（基于 `KANATA-M6-02-END-TO-END-2026-11-23` 整改）
- **审计基线提交**：`38d0b6b004d2c93a0c58ffb6bf3ed56c414b89c9`（起始于 M6-01 签核基线 `43b26d6ec41929a59844bb62a882bdf578391192`）
- **执行仓库 / 分支 / 工作树**：`Zhoubin601/ForMyself` / `m6/encrypted-backup-recovery` / `.worktrees/kanata-m5`
- **执行与整改**：Hydrogen
- **最终独立审计**：GPT-6（本报告不自行宣布 M6-02 `CLOSED`，仅提交完整可复现实验证据与产物供 GPT-6 独立审签）
- **日期**：2026-11-24（北京时间）

---

## 1. 全阶段完成状态总览

| 阶段 | 任务内容 | API 24 (`7.0`) | API 25 (`7.1.1`) | API 30 (`11`) | API 34 (`14`) | 依据报告 |
| --- | --- | --- | --- | --- | --- | --- |
| **Round 2.1 + A 路线复核** | F07 A1/A2/Cross-API；F08 确定性取消；A1 重判为 `FEASIBLE_AS_BLOCKING_SQLCIPHER_EXPORT / NOT_SELECTED` | **PASS** (2/2) | **PASS** (2/2) | **PASS** (2/2) | **PASS** (2/2) | [m6-02-native-probes-v1.md](m6-02-native-probes-v1.md) |
| **N-01 / N-02** | Zero-Alloc PBKDF2 / KAT / 5 边缘 UTF-8 / WAL `DEFERRED` 只读快照 / A1&A2 跨端打开 (`CROSS_API_A1_A2`) | **PASS** (5/5) | **PASS** (5/5) | **PASS** (5/5) | **PASS** (5/5) | [m6-02-native-probes-v1.md](m6-02-native-probes-v1.md) |
| **N-03** | 262144/262145/2MiB/4MiB 长字段、`CursorWindow` 分块、真实 Bridge→Exporter 控制链与有界内存 (<512 MiB) | **1/2 (`Bridge BLOCKED on WebView 52.0`)** | **1/2 (`Bridge BLOCKED on WebView 52.0`)** | **PASS** (2/2) | **PASS** (2/2) | [m6-02-native-probes-v1.md](m6-02-native-probes-v1.md) |
| **N-04** | 真实 `DocumentsProvider`+`DocumentsUI`、真实 `ACTION_SEND`+`:m6sharerecv`、`KanataM6LifecycleController`、`:m6worker` 真导出 4 阶段 `SIGKILL` 恢复 | **PASS** (4/4) | **PASS** (4/4) | **PASS** (4/4) | **PASS** (4/4) | [m6-02-native-probes-v1.md](m6-02-native-probes-v1.md) |
| **Scheme C** | Native `DEFERRED` 逻辑快照 + 45 业务 + 5 派生 + 3 运行排除 + `KPB1` + Node 双向逐字节互操作 + 目标库完整 50 表核对 | **PASS** (3/3) | **PASS** (3/3) | **PASS** (3/3) | **PASS** (3/3 + Node 双向验证) | [m6-02-ac-export-report-v1.md](m6-02-ac-export-report-v1.md) |
| **A / C 对照（口径修正）** | `writeBlock` 前置于 `beginSnapshotFreezeAndDrain()`、A2 严格离线独立副本、10 ms `ResourceSampler`、真取消与同范围体积对照 | — | — | **PASS** (3/3, 54 样本) | **PASS** (3/3, 54 样本) | [m6-02-ac-export-report-v1.md](m6-02-ac-export-report-v1.md) |
| **F02 故障注入与原子整改** | `F02-01` ~ `F02-06`（含 Exporter 唯一任务 ID/同文件系统原子替换/并发冲突保护、Importer 目标库 A 八重保护与 50 表校验） | **PASS** (5/5) | **PASS** (5/5) | **PASS** (5/5) | **PASS** (5/5) | 本文第 4 节 |
| **全量回归与隔离** | `npm run check`、无标志标准 Gradle、`Synthetic Release` 阻断、生产边界 `git diff --exit-code` | — | — | **宿主机 + 4 API 实测归档** | — | 本文第 6 节 |

---

## 2. 本次交付文件清单与生产隔离边界

所有新增与变更代码均通过 [android/app/build.gradle](../../../android/app/build.gradle) 的 `-PkanataM6Synthetic=true`（强制依赖 `kanataM2Synthetic=true`）严格隔离于 `syntheticDebug/`、`androidTest/` 与 `portable/` 目录，未修改任何产品运行时路径：

1. **Gradle 构建配置**：
   - [android/app/build.gradle](../../../android/app/build.gradle)：为 `kanataM6Synthetic=true` 挂载 `syntheticDebug` manifest/java 源码集与 `portable` 测试 assets（含 `debug.assets.srcDirs`）；`release` 构建类型在任何合成标志开启时通过 `variant.enable = false` 阻断构建。
2. **Scheme C 核心实现（全部迁至 `docs/qa/kanata-sqlite-m6/syntheticDebug/java/` 供 `:m6worker` 与 `Plugin` 真实调用）**：
   - [KanataM6PortableCatalog.java](syntheticDebug/java/com/yubin/formyself/KanataM6PortableCatalog.java)：加载并 SHA-256 校验 Schema 005 冻结目录 `kanata-portable-catalog-v1.json`。
   - [KanataM6PortableCrypto.java](syntheticDebug/java/com/yubin/formyself/KanataM6PortableCrypto.java)：Zero-Alloc SHA-256 midstate PBKDF2（含 `KdfProgressHook`）+ HKDF + AES-256-GCM + RFC 3629 严格 UTF-8 解码（保留前导 `\ufeff`）。
   - [KanataM6SnapshotOwner.java](syntheticDebug/java/com/yubin/formyself/KanataM6SnapshotOwner.java)：`WriteGate` 排空与隔离 `OPEN_READONLY` `TRANSACTION_MODE_DEFERRED` 快照持有者及 Schema 005 ordinal 完整性校验。
   - [KanataM6BoundedRowReader.java](syntheticDebug/java/com/yubin/formyself/KanataM6BoundedRowReader.java)：预先 `length(CAST(col AS BLOB))` 校验、`> 256 KiB` 256 KiB BLOB 分块、2 MiB/4 MiB 预分配超限拒绝、`pause-sending-v1` 投影及异常路径行缓冲清零。
   - [KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java)：`taskId` 唯一临时文件、同文件系统 `Os.stat` 校验与回退、`.task-<taskId>.pending` 进程锁日志与启动恢复 `recoverIncompleteTasks()`、`<= 2` 帧在途 `64 KiB` 流式加密、`fsync` + 全量读回 SHA-256 + 不预先删除旧目标的 `Os.rename` 原子替换 + 父目录 `fsync` + 敏感缓冲区清零。
   - [KanataM6SchemeCImporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCImporter.java)：区分调用前既有库（默认拒绝覆盖）、独立 `.stage-target-*.db` 完整恢复及逐表验证（45 业务 + 5 派生逐表行数与 SHA-256、`user_version=5`、`application_id=1263424577`、Schema 005 指纹与结构、`integrity_check=ok`、`cipher_integrity_check` 空、`foreign_key_check` 空、005 ordinal 完整、`pause-sending-v1` 投影、3 张运行表为空）、checkpoint 并关闭后原子替换提交；`finally` 仅清理本次任务拥有的 staging 文件，绝不删除原有目标 DB。
   - [KanataM6SqlCipherSessionProbe.java](syntheticDebug/java/net/zetetic/database/sqlcipher/KanataM6SqlCipherSessionProbe.java)：`SQLiteSession.TRANSACTION_MODE_DEFERRED` 受控包内适配。
3. **测试套件与隔离辅助组件**：
   - [KanataM6SyntheticDataset.java](androidTest/com/yubin/formyself/KanataM6SyntheticDataset.java)、[KanataM6N01CryptoProbeTest.java](androidTest/com/yubin/formyself/KanataM6N01CryptoProbeTest.java)、[KanataM6N02SnapshotProbeTest.java](androidTest/com/yubin/formyself/KanataM6N02SnapshotProbeTest.java)、[KanataM6N03BoundedMemoryTest.java](androidTest/com/yubin/formyself/KanataM6N03BoundedMemoryTest.java)、[KanataM6N04SafLifecycleTest.java](androidTest/com/yubin/formyself/KanataM6N04SafLifecycleTest.java)、[KanataM6SchemeCInteropAndNegativeTest.java](androidTest/com/yubin/formyself/KanataM6SchemeCInteropAndNegativeTest.java)、[KanataM6AcBenchmarkTest.java](androidTest/com/yubin/formyself/KanataM6AcBenchmarkTest.java)、[KanataM6F02FaultMatrixTest.java](androidTest/com/yubin/formyself/KanataM6F02FaultMatrixTest.java)。
   - `docs/qa/kanata-sqlite-m6/syntheticDebug/`：`AndroidManifest.xml`、[KanataM6BridgeActivity.java](syntheticDebug/java/com/yubin/formyself/KanataM6BridgeActivity.java)、[KanataM6RotationActivity.java](syntheticDebug/java/com/yubin/formyself/KanataM6RotationActivity.java)、[KanataM6LifecycleController.java](syntheticDebug/java/com/yubin/formyself/KanataM6LifecycleController.java)、[KanataM6ShareReceiverActivity.java](syntheticDebug/java/com/yubin/formyself/KanataM6ShareReceiverActivity.java) (`:m6sharerecv`)、[KanataM6SyntheticPortablePlugin.java](syntheticDebug/java/com/yubin/formyself/KanataM6SyntheticPortablePlugin.java)、[KanataM6SyntheticSafProvider.java](syntheticDebug/java/com/yubin/formyself/KanataM6SyntheticSafProvider.java)、[KanataM6KillableWorkerService.java](syntheticDebug/java/com/yubin/formyself/KanataM6KillableWorkerService.java) (`:m6worker`)。
   - `docs/qa/kanata-sqlite-m6/portable/`：`buildPortableCatalogJson.mjs`、`kanata-portable-catalog-v1.json`、`buildNodeInteropFixture.mjs`、`node_interop_populated.kpb1`、`node_interop_populated.json`。
4. **交付报告**：
   - [m6-02-round2.1-hardening-v1.md](m6-02-round2.1-hardening-v1.md)、[m6-02-native-probes-v1.md](m6-02-native-probes-v1.md)、[m6-02-ac-export-report-v1.md](m6-02-ac-export-report-v1.md)、`docs/qa/kanata-sqlite-m6/m6-02-final-report-v1.md`（本报告）。

---

## 3. 核心实证发现与修复的底层陷阱

1. **Conscrypt `OpenSSLMac` 600k Tight-Loop Native OOM (API 34)**：已通过零分配 SHA-256 midstate 纯字节 PBKDF2 彻底根治（RSS 增量为 `0 KiB`，`0–1 ms` 响应取消）。
2. **SQLCipher `nativeBindString` / Android `new String(UTF_8)` 静默剥离前导 `U+FEFF` BOM**：实证二者均会丢失前导 BOM 3 字节；导出端改用 `CAST(col AS BLOB)` + 手写严格 RFC 3629 UTF-8 解码，导入端改用 `CAST(? AS TEXT)` + `bindBlob`，在 2 MiB 长文本与 Node 互操作包上实测零丢字节。
3. **Node v24 `node:sqlite` 在读取含 `\u0000` `TEXT` 列时的 C-string 截断**：`node:sqlite` 读取 `\ufeff e\u0301 \u0000\ufeff ` 时从 12 B 截断为 7 B；Android `CAST(... AS BLOB)` 不受此限制，已在参考夹具构造器中显式核正完整 UTF-8 原文。
4. **`sqlcipher_export` `ATTACH` 在未携带 `CREATE_IF_NECESSARY` 时报 `SQLITE_CANTOPEN (code 14)`，及 `enableWriteAheadLogging()` 多连接池干扰**：A1 `sqlcipher_export` 若要创建目标库，源连接需带 `CREATE_IF_NECESSARY` 且使用 `execSQL("ATTACH ...")` 保证单连接亲和性；而 Scheme C 通过独立 `OPEN_READONLY` + `SQLiteSession.TRANSACTION_MODE_DEFERRED` 完全规避了该问题。

---

## 4. F02-01 ～ F02-06 故障注入与原子安全整改矩阵

在 **API 24、API 25、API 30 与 API 34** 实测全数通过 [KanataM6F02FaultMatrixTest.java](androidTest/com/yubin/formyself/KanataM6F02FaultMatrixTest.java) 与 [KanataM6N04SafLifecycleTest.java](androidTest/com/yubin/formyself/KanataM6N04SafLifecycleTest.java)：

| 编号 | 注入故障场景 | (1) 准确识别失败 | (2) 源 DB 完整 | (3) 旧备份/既有目标完好 | (4) 半成品拒绝/清理 | (5) 零资源/连接/线程泄漏 | (6) 零假成功状态 | 实测关键指标 |
| --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | --- |
| **F02-01** | 活跃 WAL 已提交/未提交事务隔离 + 跨表原子性 + 长读并发 + post-snapshot 写入隔离 | **PASS** | **PASS** | — | **PASS** | **PASS** | **PASS** | `uncommittedWalExcluded=true`, `postSnapshotTxExcluded=true`, `pkg1Bytes=46255` |
| **F02-02** | `WriteGate` 排空 writer + 门禁阻塞/恢复 + 长读下 `wal_checkpoint(TRUNCATE)` `BUSY=1` | **PASS** | **PASS** | — | **PASS** | **PASS** | **PASS** | `drainedTxCaptured=true`, `busyWhileReaderActive=1`, `busyAfterReaderClose=0` |
| **F02-03a** | Pre-start 与 KDF/Mid-stream `CancellationSignal` + `AtomicBoolean` 取消 | **PASS** (`ERR_CANCELLED`) | **PASS** | **PASS** | **PASS** (`0` 残留) | **PASS** | **PASS** | `sourceSha256=b0b59974...`, `priorBackupSha256` 不变 |
| **F02-03b** | Spool write 注入 `ENOSPC` / `beforeFsync` 注入 `EIO` | **PASS** (`ERR_IO_FAILED`) | **PASS** | **PASS** | **PASS** (`.spool.tmp` 清理) | **PASS** | **PASS** | `enospcRejectedAndPriorPreserved=true`, `fsyncFailureRejectedAndPriorPreserved=true` |
| **F02-03c** | `beforeReadback` 篡改 spool 尾部触发回读校验失败 | **PASS** (`ERR_IO_FAILED`) | **PASS** | **PASS** | **PASS** (`.spool.tmp` 删除) | **PASS** | **PASS** | `readbackMismatchCaught=true` |
| **F02-04a** | Provider 极端短读、零进展上限 (8 次)、半写 pipe 中止 | **PASS** (`ERR_IO_FAILED`) | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | `shortRead7ByteOk=true`, `zeroProgressRejected=true`, `halfWriteRejected=true` |
| **F02-04b** | 真实 `DocumentsProvider` 权限撤销、Activity 生命周期关库、`:m6worker` 4 阶段 (`KDF`/`DB_READ`/`SPOOL_WRITE`/`COMMIT`) `SIGKILL` 恢复 | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | `cleanedTasks=1` across all 4 stages (`API 24/25/30/34`) |
| **F02-04c** | Footer 后 1 字节尾部追加、DATA 密文篡改、Footer GCM Tag 篡改 | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | `trailingByteRejected=true`, `tamperedCipherRejected=true`, `tamperedTagRejected=true` |
| **F02-05 (P0)** | Exporter 原子提交整改：既有有效备份 A 存在时注入最终 `Os.rename` 失败、提交阶段进程中断恢复、目标文件系统错误，及双任务并发竞争同一目标路径 | **PASS** | **PASS** | **PASS** (A SHA-256 不变且可正常解密) | **PASS**（仅清理当前任务临时文件，不误删另一任务文件） | **PASS** | **PASS** | `renameFailPreservedA=true`, `commitInterruptRecoveryPreservedA=true`, `targetFsErrorPreservedA=true`, `concurrentTasksIsolatedTempAndPreservedA=true` |
| **F02-06 (P0/P1)** | Importer 目标库 A 保护（默认拒绝覆盖 + staging 隔离安装）及错误密码 / 错误 Magic / Footer 篡改 / DATA 篡改 / EOF 错误 / 中途取消 / staging 安装失败 / 最终提交失败 8 场景 + 50 表完整核对 | **PASS** | — | **PASS** (目标库 A SHA-256 与逻辑摘要完全不变) | **PASS**（不删除已有 DB A，仅清理本任务 staging 临时库） | **PASS** | **PASS** | `defaultOverwriteRefused=true`, `all8FailureModesPreservedA=true`, `full50TableVerificationOk=true`（含 45 业务 + 5 派生 SHA-256、Schema FP、`cipher_integrity_check`、`foreign_key_check`、ordinal、`pause-sending-v1`） |

---

## 5. Android API 24/25 低版本实测结果与残余阻断声明

- **实建低版本测试环境**：成功安装 SDK `cmdline-tools/latest`、`platforms/android-24`、`platforms/android-25` 及 `system-images/android-24/default/x86_64`、`system-images/android-25/default/x86_64`，建立独立模拟器 `Codex_Kanata_API24` (Android 7.0) 与 `Codex_Kanata_API25` (Android 7.1.1) 并执行全量 19 项非基准套件。
- **实测结果（API 24 与 API 25 均 18/19 PASS）**：
  - **全部通过项 (18/19)**：`N-01`（Zero-Alloc PBKDF2 无 JCA `PBKDF2WithHmacSHA256` 依赖，在 API 24/25 正常运行并通过 KAT 与取消测试）、`N-02`（含 API 34→24/25 `CROSS_API_A1_A2` 打开校验）、`N-03` 长字段 / 2 MiB 前导 BOM / 3.9 MiB CursorWindow / 预分配拒绝、`N-04` 真实 `DocumentsUI` SAF + `ACTION_SEND` Share + 生命周期控制器 + 4 阶段真实导出 `SIGKILL` 恢复、Scheme C 互操作与负向拒绝、`F02-01`～`F02-06` 故障与原子保护矩阵。
  - **诚实记录之残余 `BLOCKED` 项 (1/19)**：`probeCapacitorBridgeControlBoundsAndWebViewMemory` 在 `Codex_Kanata_API24` 与 `Codex_Kanata_API25` 上稳定失败（`{"error":"PLUGIN_MISSING"}`）。实证原因：两个 AOSP 原厂镜像预装 `com.android.webview` 均为 `52.0.2743.100`，低于 Capacitor 8 内核硬性门槛（`Bridge.MINIMUM_ANDROID_WEBVIEW_VERSION = 55`，默认 `60`），`Bridge.java` 主动拒绝初始化 JS Bridge。同时在 API 24/25 实测还定位并修复了测试侧 `java.util.Base64` (API 26+) 兼容性及同 UID SAF 持久化授权行为差异 (`sameUidPersistableSkippedPre26=true`)。
- **门禁结论**：本轮严格保留低版本 WebView 真实限制记录（**API 24/25 上 Native Crypto/SQLite/SAF/Exporter/Importer 均 PASS，但未升级系统 WebView 的原厂 API 24/25 镜像无法承载 Capacitor 8 Bridge**），仍需在后续 M6-03 产品定型前结合目标用户最低系统/WebView 要求及实体真机延迟校准冻结 `0x0001`。

---

## 6. 全量质量回归与边界检查（全部命令在最终代码定稿后运行）

| 检查项目 | 实际运行命令（工作树 `.worktrees/kanata-m5`） | 实际结果 |
| --- | --- | --- |
| **生产边界隔离** | `git diff --exit-code 43b26d6ec41929a59844bb62a882bdf578391192 -- src package.json package-lock.json android/app/src/main` | **Exit 0**（零差异） |
| **格式与空白** | `git diff --check` | **Exit 0** |
| **Web 全量检查** | `npm run check` (`lint && test && test:component && typecheck && build`) | **Exit 0**（ESLint 0 errors；Node 全部通过；Vitest 全部通过；`vue-tsc` + `tsc` 通过；Vite `built in 903ms`） |
| **标准 Android 构建** | `.\gradlew.bat --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest`（无 synthetic 标志） | **Exit 0** (`BUILD SUCCESSFUL in 49s`)，标准 Debug APK SHA-256 = `62f5df78f4fd27ab639149dcca7d8923f8c01f9ad0a26bd02d0327a227d9ba18` |
| **Synthetic Release 阻断** | `.\gradlew.bat --no-daemon -PkanataM2Synthetic=true -PkanataM6Synthetic=true :app:assembleRelease` | **Exit 1（预期阻断失败）**：`Task 'assembleRelease' not found in project ':app'` |
| **API 34 隔离全套** | `am instrument`（19 项套件 + 3 档 `KanataM6AcBenchmarkTest`） | **19/19 PASS** (`221.309s`) + **3/3 Bench PASS** (`1k+10k: 212.5s`, `100k: 1,421.967s`, 54 修订样本) |
| **API 30 隔离全套** | `am instrument`（19 项套件 + 3 档 `KanataM6AcBenchmarkTest` + API 34→30 `CROSS_API_A1_A2`） | **19/19 PASS** (`114.979s`) + **3/3 Bench PASS** (`798.929s`, 54 修订样本) |
| **API 25 隔离套件** | `am instrument`（19 项套件 + API 34→25 `CROSS_API_A1_A2`） | **18/19 PASS** (`101.976s`, `N-03 Bridge` 因 WebView `52.0` `BLOCKED`) |
| **API 24 隔离套件** | `am instrument`（19 项套件 + API 34→24 `CROSS_API_A1_A2`） | **18/19 PASS** (`94.769s`, `N-03 Bridge` 因 WebView `52.0` `BLOCKED`) |
| **Android → Node 反向解码** | 拉取 API 34 `m6_android_to_node_interop.kpb1` (`4,292 B`) & `m6_bench_1000_sample.kpb1` (`197,584 B`) 运行 [syntheticCodec.mjs](portable/syntheticCodec.mjs) | **PASS**（50 表校验器、1,000 条消息、`integrity_check=ok`、`0` 外键冲突） |

---

## 7. 待解决风险清单与 GPT-6 独立审计核验点

1. **API 24/25 原厂镜像 WebView 52.0 阻断 Capacitor 8 Bridge**：Native 加密、SQLCipher、SAF、生命周期、进程强杀恢复与 F02 原子提交均已在 API 24/25 通过实测（18/19），但未升级系统 WebView 的 AOSP 7.0/7.1 无法初始化 Capacitor 8 Bridge，产品决策时需明确 WebView >= 60 门槛或提升 `minSdkVersion`。
2. **100k 消息下 Scheme C CPU/JNI 读库耗时 (`26.3s–64.4s`)**：虽然后台可 5–62 ms 中断且写阻塞恒为 `5–20 ms`、RSS `190–217 MiB` 远低于红线，若面向更大数据量用户，M6-03 可评估原生 JNI 批量行序列化进一步加速。
3. **本阶段交付范围严格隔离于测试态**：未修改生产 `src/` 与 `android/app/src/main/`；M6-03 产品接入时仍需在产品侧 `RestoreCoordinator`、加密恢复日志与 Settings UI 完成闭环后另行验收。

> **审计提交声明**：以上所有整改代码、四平台实测数据（含保留历史 108 条原始样本与新修订 108 条样本）、回归输出与边界检查均已提交至分支 `m6/encrypted-backup-recovery` 供 **GPT-6** 最终独立审计裁定。
