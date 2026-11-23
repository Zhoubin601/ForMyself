# Kanata SQLite M6-02 全阶段最终交付与审计材料 v1

- **任务编号**：`KANATA-M6-02-END-TO-END-2026-11-23`
- **基线提交**：`7c8d847ea834b571b96859c7a97cdfe20bb75b96`（起始于 M6-01 签核基线 `43b26d6ec41929a59844bb62a882bdf578391192`）
- **执行仓库 / 分支 / 工作树**：`Zhoubin601/ForMyself` / `m6/encrypted-backup-recovery` / `.worktrees/kanata-m5`
- **执行与整改**：Hydrogen
- **最终独立审计**：GPT-6（本报告不自行宣布 M6-02 `CLOSED`，仅提交完整可复现实验证据与产物供 GPT-6 独立审签）
- **日期**：2026-11-23（北京时间）

---

## 1. 全阶段完成状态总览

| 阶段 | 任务内容 | API 30 (`Codex_Todo_API30`) | API 34 (`Codex_Todo_WebView34`) | API 24/25 | 依据报告 |
| --- | --- | --- | --- | --- | --- |
| **Round 2.1** | F07 A1/A2 失败吞咽清理 + 强制完整性断言；F08 `CountDownLatch` 确定性同步取消钩子 + 缓冲区非污染断言 | **PASS** (4/4) | **PASS** (4/4) | `NOT_RUN` | [m6-02-round2.1-hardening-v1.md](m6-02-round2.1-hardening-v1.md) |
| **N-01 / N-02** | Zero-Alloc PBKDF2 / KAT / 5 边缘 UTF-8 / WAL `DEFERRED` 只读快照原语（最终代码复测） | **PASS** (4/4) | **PASS** (4/4) | `NOT_RUN` | [m6-02-native-probes-v1.md](m6-02-native-probes-v1.md) |
| **N-03** | 262144/262145/2MiB/4MiB 长字段、`CursorWindow` 分块、Bridge 控制边界、WebView JS Heap 与有界内存 (<512 MiB) | **PASS** (2/2) | **PASS** (2/2) | `NOT_RUN` | [m6-02-native-probes-v1.md](m6-02-native-probes-v1.md) |
| **N-04** | SAF 短读/零进展/半写/撤销权限、Share FileProvider、Activity 暂停/旋转、Epoch 失效、`:m6worker` 强杀重启清理 | **PASS** (2/2) | **PASS** (2/2) | `NOT_RUN` | [m6-02-native-probes-v1.md](m6-02-native-probes-v1.md) |
| **Scheme C** | Native `DEFERRED` 逻辑快照 + 45 业务 + 5 派生 + 3 运行排除 + `KPB1` 流式加解密 + Node 双向逐字节互操作 + Schema 005 目标校验 & 负向拒绝 | **PASS** (3/3) | **PASS** (3/3 + Node 双向验证) | `NOT_RUN` | [m6-02-ac-export-report-v1.md](m6-02-ac-export-report-v1.md) |
| **A / C 对照** | A1 vs A2 vs C 在 `1k` / `10k` / `100k` 统一确定性数据集上的 1 冷 + 5 交错轮换全指标实测 | **PASS** (3/3, 54 样本) | **PASS** (3/3, 54 样本) | `NOT_RUN` | [m6-02-ac-export-report-v1.md](m6-02-ac-export-report-v1.md) |
| **F02 故障注入** | `F02-01` ~ `F02-04` 并发 WAL、WriteGate drain、`BUSY` checkpoint、各阶段取消、`ENOSPC`/fsync/回读、短读/零进展/篡改 | **PASS** (3/3) | **PASS** (3/3) | `NOT_RUN` | 本文第 4 节 |
| **API 24/25 兼容** | 本地无 `android-24`/`android-25` 镜像与 `sdkmanager`，亦无实体机 | — | — | **`NOT_RUN`** | 本文第 5 节 |
| **全量回归与隔离** | `npm run check`、无标志标准 Gradle、`Synthetic Release` 阻断、生产边界 `git diff --exit-code` | — | **宿主机全 PASS** | — | 本文第 6 节 |

---

## 2. 本次交付文件清单与生产隔离边界

所有新增与变更代码均通过 [android/app/build.gradle](../../../android/app/build.gradle) 的 `-PkanataM6Synthetic=true`（强制依赖 `kanataM2Synthetic=true`）严格隔离于测试与文档目录，未修改任何产品运行时路径：

1. **Gradle 构建配置**：
   - [android/app/build.gradle](../../../android/app/build.gradle)：为 `kanataM6Synthetic=true` 挂载 `syntheticDebug` manifest/java 源码集与 `portable` 测试 assets；`release` 构建类型在任何合成标志开启时通过 `variant.enable = false` 阻断构建。
2. **Scheme C 核心实现与测试支持（`docs/qa/kanata-sqlite-m6/androidTest/`）**：
   - [KanataM6PortableCatalog.java](androidTest/com/yubin/formyself/KanataM6PortableCatalog.java)：加载并 SHA-256 校验 Schema 005 冻结目录 `kanata-portable-catalog-v1.json`。
   - [KanataM6PortableCrypto.java](androidTest/com/yubin/formyself/KanataM6PortableCrypto.java)：Zero-Alloc SHA-256 midstate PBKDF2 + HKDF + AES-256-GCM + RFC 3629 严格 UTF-8 解码（保留前导 `\ufeff`）。
   - [KanataM6SnapshotOwner.java](androidTest/com/yubin/formyself/KanataM6SnapshotOwner.java)：`WriteGate` 排空与隔离 `OPEN_READONLY` `TRANSACTION_MODE_DEFERRED` 快照持有者及 Schema 005 ordinal 完整性校验。
   - [KanataM6BoundedRowReader.java](androidTest/com/yubin/formyself/KanataM6BoundedRowReader.java)：预先 `length(CAST(col AS BLOB))` 校验、`> 256 KiB` 256 KiB BLOB 分块、2 MiB/4 MiB 预分配超限拒绝及 `pause-sending-v1` 投影。
   - [KanataM6SchemeCExporter.java](androidTest/com/yubin/formyself/KanataM6SchemeCExporter.java)：`<= 2` 帧在途 `64 KiB` 流式加密、`fsync` + 全量读回 SHA-256 校验 + 原子重命名 + 全路径敏敏缓冲区清零。
   - [KanataM6SchemeCImporter.java](androidTest/com/yubin/formyself/KanataM6SchemeCImporter.java)：KDF 前头检验、短读/零进展/精确 EOF 校验、`CAST(? AS TEXT)` + `bindBlob` 写入、双遍自引用外键回填与 50 表校验器全核对。
   - [KanataM6SyntheticDataset.java](androidTest/com/yubin/formyself/KanataM6SyntheticDataset.java)：`1k` / `10k` / `100k` 确定性 53 表全覆盖数据集与活跃 WAL 维持器。
3. **测试套件与隔离辅助组件**：
   - [KanataM6N01CryptoProbeTest.java](androidTest/com/yubin/formyself/KanataM6N01CryptoProbeTest.java)、[KanataM6N02SnapshotProbeTest.java](androidTest/com/yubin/formyself/KanataM6N02SnapshotProbeTest.java)、[KanataM6N03BoundedMemoryTest.java](androidTest/com/yubin/formyself/KanataM6N03BoundedMemoryTest.java)、[KanataM6N04SafLifecycleTest.java](androidTest/com/yubin/formyself/KanataM6N04SafLifecycleTest.java)、[KanataM6SchemeCInteropAndNegativeTest.java](androidTest/com/yubin/formyself/KanataM6SchemeCInteropAndNegativeTest.java)、[KanataM6AcBenchmarkTest.java](androidTest/com/yubin/formyself/KanataM6AcBenchmarkTest.java)、[KanataM6F02FaultMatrixTest.java](androidTest/com/yubin/formyself/KanataM6F02FaultMatrixTest.java)。
   - `docs/qa/kanata-sqlite-m6/syntheticDebug/`：`AndroidManifest.xml`、`KanataM6BridgeActivity.java`、`KanataM6RotationActivity.java`、`KanataM6SyntheticPortablePlugin.java`、`KanataM6SyntheticSafProvider.java`、`KanataM6KillableWorkerService.java`（全部仅编译于 `kanataM6Synthetic=true` debug 变体）。
   - `docs/qa/kanata-sqlite-m6/portable/`：`buildPortableCatalogJson.mjs`、`kanata-portable-catalog-v1.json`、`buildNodeInteropFixture.mjs`、`node_interop_populated.kpb1`、`node_interop_populated.json`。
4. **交付报告**：
   - [m6-02-round2.1-hardening-v1.md](m6-02-round2.1-hardening-v1.md)
   - [m6-02-native-probes-v1.md](m6-02-native-probes-v1.md)
   - [m6-02-ac-export-report-v1.md](m6-02-ac-export-report-v1.md)
   - `docs/qa/kanata-sqlite-m6/m6-02-final-report-v1.md`（本报告）

---

## 3. 核心实证发现与修复的底层陷阱

1. **Conscrypt `OpenSSLMac` 600k Tight-Loop Native OOM (API 34)**：已通过零分配 SHA-256 midstate 纯字节 PBKDF2 彻底根治（RSS 增量为 `0 KiB`，`0–1 ms` 响应取消）。
2. **SQLCipher `nativeBindString` / Android `new String(UTF_8)` 静默剥离前导 `U+FEFF` BOM**：实证二者均会丢失前导 BOM 3 字节；导出端改用 `CAST(col AS BLOB)` + 手写严格 RFC 3629 UTF-8 解码，导入端改用 `CAST(? AS TEXT)` + `bindBlob`，在 2 MiB 长文本与 Node 互操作包上实测零丢字节。
3. **Node v24 `node:sqlite` 在读取含 `\u0000` `TEXT` 列时的 C-string 截断**：`node:sqlite` 读取 `\ufeff e\u0301 \u0000\ufeff ` 时从 12 B 截断为 7 B；Android `CAST(... AS BLOB)` 不受此限制，已在参考夹具构造器中显式核正完整 UTF-8 原文。
4. **`sqlcipher_export` `ATTACH` 在未携带 `CREATE_IF_NECESSARY` 时报 `SQLITE_CANTOPEN (code 14)`，及 `enableWriteAheadLogging()` 多连接池干扰**：A1 `sqlcipher_export` 若要创建目标库，源连接需带 `CREATE_IF_NECESSARY` 且使用 `execSQL("ATTACH ...")` 保证单连接亲和性；而 Scheme C 通过独立 `OPEN_READONLY` + `SQLiteSession.TRANSACTION_MODE_DEFERRED` 完全规避了该问题。

---

## 4. F02-01 ～ F02-04 故障注入矩阵与 6 条安全不变量核对

在 API 30 与 API 34 实测通过 [KanataM6F02FaultMatrixTest.java](androidTest/com/yubin/formyself/KanataM6F02FaultMatrixTest.java) 与 [KanataM6N04SafLifecycleTest.java](androidTest/com/yubin/formyself/KanataM6N04SafLifecycleTest.java)：

| 编号 | 注入故障场景 | (1) 准确识别失败 | (2) 源 DB 完整 | (3) 旧成功备份完好 | (4) 半成品拒绝/清理 | (5) 零资源/连接/线程泄漏 | (6) 零假成功状态 | 实测关键指标 |
| --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | --- |
| **F02-01** | 活跃 WAL 已提交/未提交事务隔离 + 跨表原子性 (`messages`+`message_audits`) + 长生命周期并发 reader + post-snapshot 写入隔离 | **PASS** | **PASS** | — | **PASS** | **PASS** | **PASS** | `uncommittedWalExcluded=true`, `postSnapshotTxExcluded=true`, 恢复目标仅含排空前的 `201` 条与完整跨表审计 |
| **F02-02** | `WriteGate` 排空正在提交的 writer + 门禁阻塞/恢复 + 长读下 `wal_checkpoint(TRUNCATE)` `BUSY=1` 冲突应对及关闭后 `BUSY=0` | **PASS** | **PASS** | — | **PASS** | **PASS** | **PASS** | `drainedTxCaptured=true`, `busyWhileReaderActive=1`, `busyAfterReaderClose=0` |
| **F02-03a** | Pre-start 与 KDF/Mid-stream `CancellationSignal` + `AtomicBoolean` 取消 | **PASS** (`ERR_CANCELLED`) | **PASS** | **PASS** (SHA 不变) | **PASS** (`spool` 0 残留) | **PASS** | **PASS** | `sourceSha256=b0b59974...`, `priorBackupSha256` 逐字节不变 |
| **F02-03b** | Spool write 注入 `ENOSPC` / `beforeFsync` 注入 `EIO` | **PASS** (`ERR_IO_FAILED`) | **PASS** | **PASS** (SHA 不变) | **PASS** (`spool.tmp` 清理) | **PASS** | **PASS** | `enospcRejectedAndPriorPreserved=true`, `fsyncFailureRejectedAndPriorPreserved=true` |
| **F02-03c** | `beforeReadback` 篡改 spool 尾部触发回读校验失败 | **PASS** (`ERR_IO_FAILED`) | **PASS** | **PASS** (SHA 不变) | **PASS** (`spool.tmp` 删除) | **PASS** | **PASS** | `readbackMismatchCaught=true` |
| **F02-04a** | Provider 7 字节极端短读恢复、零进展上限 (8 次) 拒绝、半写 pipe 中止 | **PASS** (`ERR_IO_FAILED`) | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | `shortRead7ByteOk=true`, `zeroProgressRejected=true`, `halfWriteRejectedBeforeSuccess=true` |
| **F02-04b** | SAF URI 权限撤销 (`SecurityException`)、Activity pause 撤销 Epoch、迟到/重复回调、`:m6worker` `SIGKILL` 强杀重启清理 | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | `killedWorkerPid=6946/5074`, 重启后 `hadPending=true` -> `pendingExistsNow=false, tmpExistsNow=false` |
| **F02-04c** | Footer 后 1 字节尾部追加、DATA 密文篡改、Footer GCM Tag 篡改 | **PASS** (`ERR_INVALID_CONTAINER` / `ERR_AUTH_FAILED`) | **PASS** | **PASS** | **PASS** (`targetDb` 未提交) | **PASS** | **PASS** | `trailingByteRejected=true`, `tamperedCipherRejected=true`, `tamperedTagRejected=true` |

---

## 5. Android API 24/25 低版本兼容性状态与缺口声明

- **实查环境状态**：宿主机 `E:\Android\Sdk\system-images` 仅安装了 `android-30`、`android-31`、`android-34`、`android-37.0`，且不存在 `cmdline-tools` / `sdkmanager`，当前亦未接入 API 24 (Android 7.0) 或 API 25 (Android 7.1) 真机。
- **诚实记录**：所有 API 24/25 测试项均明确标记为 **`NOT_RUN`**；**严禁使用 API 30/34 结果推断或替代 API 24/25 的 `CursorWindow`、WebView Bridge、PBKDF2 延时校准或 SAF 运行表现**。
- **未覆盖风险**：在未完成 API 24/25 实体机或镜像实测及真机 600k PBKDF2 耗时校准前，**不得冻结发行 profile `0x0001`**，亦不得将 M6-02 视作低版本全量签核完毕。

---

## 6. 全量质量回归与边界检查（全部命令在最终代码定稿后运行）

| 检查项目 | 实际运行命令（工作树 `.worktrees/kanata-m5`） | 实际结果 |
| --- | --- | --- |
| **生产边界隔离** | `git diff --exit-code 43b26d6ec41929a59844bb62a882bdf578391192 -- src package.json package-lock.json android/app/src/main` | **Exit 0**（零差异） |
| **格式与空白** | `git diff --check` | **Exit 0** |
| **Web 全量检查** | `npm run check` (`lint && test && test:component && typecheck && build`) | **Exit 0**（ESLint 0 errors / 61 既有 warnings；Node **818/818 pass**；Vitest **45 文件 420/420 pass**；`vue-tsc` + `tsc -p tsconfig.contracts.json` pass；Vite `built in 1.07s`） |
| **标准 Android 构建** | `.\gradlew.bat --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest`（无 synthetic 标志） | **Exit 0** (`BUILD SUCCESSFUL in 24s`) |
| **Synthetic Release 阻断** | `.\gradlew.bat --no-daemon -PkanataM2Synthetic=true -PkanataM6Synthetic=true :app:assembleRelease` | **Exit 1（预期阻断失败）**：`release` variant 被 `beforeVariants` `variant.enable = false` 禁用，`Task 'assembleRelease' not found` |
| **API 34 隔离全套** | `am instrument ... KanataM6N01..N04,SchemeCInteropAndNegativeTest,F02FaultMatrixTest` + `KanataM6AcBenchmarkTest` | **14/14 PASS** + **3/3 PASS** (`571.776s`, 54 样本) |
| **API 30 隔离全套** | `am instrument ... KanataM6N01..N04,SchemeCInteropAndNegativeTest,F02FaultMatrixTest` + `KanataM6AcBenchmarkTest` | **14/14 PASS** + **3/3 PASS** (`463.426s`, 54 样本) |
| **Android → Node 反向解码** | 拉取 `m6_android_to_node_interop.kpb1` & `m6_bench_1000_sample.kpb1` 运行 `syntheticCodec.mjs` | **PASS**（50 表校验器、1,000 条消息与 `pause-sending-v1` 精确吻合） |

---

## 7. 待解决风险清单与 GPT-6 独立审计核验点

1. **`NOT_RUN` — API 24/25 真机/镜像缺口**：需补充 API 24/25 环境实测后再推进 M6-03 与 `0x0001` 迭代次数冻结。
2. **100k 消息下 Scheme C CPU/JNI 读库耗时 (`22.7s–26.9s`)**：虽然后台可流式取消且写阻塞恒为 `4 ms`、RSS 仅 `173–203 MiB`，但若需面向更大规模用户优化体感时间，M6-03 可考虑原生 JNI 批量行序列化或跳过冗余每行 `JSONTokener` 解析以显著加速。
3. **本阶段交付范围内暂未接入产品级 UI 与 `RestoreCoordinator`**：符合“不提前污染产品线”隔离合同；M6-03 接入正式应用层时仍需单独设计 Settings UI、`RestoreCoordinator` 协调流与加密恢复日志闭环。

> **审计提交声明**：以上所有实验数据、代码实现、回归输出与边界检查均已可由独立审签方在分支 `m6/encrypted-backup-recovery` 上按命令原样复现。本报告仅供 **GPT-6** 进行最终独立审计与验收裁定。
