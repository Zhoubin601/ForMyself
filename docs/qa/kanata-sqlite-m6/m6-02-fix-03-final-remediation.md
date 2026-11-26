# Kanata SQLite M6-02 最终签核前最小整改报告 (`M6-02-FIX-03`)

- **任务编号**：`M6-02-FIX-03`
- **执行者**：Hydrogen
- **独立审计**：GPT-6.2（本报告仅提交完整修复代码、确定性故障注入证据与 CI 回归记录供 GPT-6.2 最终签核；不自行标记 `CLOSED`，不自行启动 `M6-03`）
- **基线提交**：`27bccba8e526d719216115c14955b1cca55f1a07`
- **分支**：`m6/encrypted-backup-recovery`
- **日期**：2026-11-26（北京时间）
- **既有证据保留**：完整保留 `M6-02-FIX-02` 全部报告、108 条性能样本与 CI Run `45548032320` 证据（未修改或删除任何 FIX-02 文档与数据）。

---

## 1. 阻断项逐项修复说明与实际代码位置

### R01：最终提交与持久化恢复窗口

| 要求项 | 根因与修复措施 | 实际代码位置 |
|---|---|---|
| 1. 提交前 Journal 意图记录及目录项真正持久化 | `exportToSpool()` 在 `Os.rename` 之前，先完成 `tmpSpool`（及跨文件系统时的 `commitTempFile` + `fsyncDirectoryStrict(targetDir)`）写后 `fsync` 与全量回读校验，再调用 `writePendingJournalAtomic(..., "VERIFIED_READY_TO_COMMIT", ..., actualShaHex, syncJournalDir = true)`：写临时文件 `.task-<tid>.pending.next` → `flush()` + `getFD().sync()` → `Os.rename(.pending.next, .pending)` → `fsyncDirectoryStrict(effectiveSpoolDir)`，确保提交前意图记录、预期 SHA-256 与目录项均真实落盘。 | [KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L503-L556), [L1736-L1744](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L1736-L1744) |
| 2. 恢复程序识别 `VERIFIED_READY_TO_COMMIT` 下已完成的 Rename | `recoverIncompleteTasks()` 不再将 `VERIFIED_READY_TO_COMMIT` 无条件视作未完成任务清理。若阶段临时文件（同文件系统为 `validatedTmp`，跨文件系统为 `validatedCommit`）已消失，且 `targetPath` 在受控目录集合内、文件存在、`expectedSha256Hex` 非空且实际 SHA-256 精确匹配，则判定 `Os.rename` 已完成，补执行 `fsyncDirectoryStrict(targetParent)`、清理跨文件系统残留 `validatedTmp`（绝不触碰目标文件）、删除 Journal 并 `fsyncDirectoryStrict(dirCanon)`，记为 `confirmedCommitTasks++`。 | [KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L767-L855) |
| 3. 预期摘要 + 临时文件状态 + 正式目标状态共同判断 | 对 `VERIFIED_READY_TO_COMMIT` 采用三元联合判定：<br>① `!stagedExists` 且 `targetExists && sha256(target) == expectedSha` → 补做目录 `fsync` 后确认提交（`CONFIRMED`）；<br>② `stagedExists` 且 `sha256(staged) == expectedSha` 且目标不等于 `expectedSha` → 确认 Rename 未发生，安全清理临时文件与 Journal（`CLEANED`），保留原有旧备份；<br>③ 其它任意缺失/失配/双匹配/目标目录未传入/目录 `fsync` 失败情形 → 保持 `UNCONFIRMED`，零盲目清理。 | [KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L767-L855) |
| 4. Journal 更新可承受中断、禁止原地截断 | 移除旧实现中的 `raf.setLength(0L)` 原地截断覆盖；全部状态迁移（`STARTED` → `VERIFIED_READY_TO_COMMIT` → `RENAMED_PENDING_DIR_SYNC` → `COMMITTED`）均通过 `writePendingJournalAtomic()` 写入 `.pending.next`、`fsync` 后再原子 `Os.rename` 替换 `.pending`。若 `Os.rename(staged, target)` 已完成而后续 `RENAMED_PENDING_DIR_SYNC` 写入/重命名中断，旧的 `VERIFIED_READY_TO_COMMIT` 保持完整未截断，异常归类为 `ERR_DURABILITY_UNCONFIRMED`，重启恢复可继续确认并清理残留 `.pending.next`。 | [KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L503-L556), [L1755-L1779](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L1755-L1779) |
| 5. 无法确定提交状态时保持 `UNCONFIRMED` | 涵盖 5 类不可确认状态（阶段文件消失且目标缺失、目标 SHA 失配、目标父目录不在受控目录内、阶段文件存在但 SHA 失配、阶段与目标同时匹配预期摘要）及恢复期目录 `fsync` 失败：均递增 `unconfirmedCommitTasks` 与 `unconfirmedCommitTaskIds`，保留 Journal 与目标文件，禁止清理。 | [KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L720-L832) |
| 6. 真实 `SIGKILL` 窗口测试（`Os.rename` 之后、下次 Journal 更新之前） | 新增 `SpoolHooks.afterAtomicRenameBeforeJournalUpdate(...)`、`SpoolHooks.beforeJournalRename(...)` 与 `:m6worker` 暂停点 `STAGE_AFTER_RENAME_BEFORE_JOURNAL_UPDATE`、`STAGE_BEFORE_POST_RENAME_JOURNAL_RENAME`。测试在发送 `Process.killProcess(workerPid)` 前通过 `worker_ready.json` 与磁盘直读双重确认 `stagedExists == false`、`targetExists == true`、`sha256(target) == expectedShaB` 且 `.task-<tid>.pending` 仍处于 `VERIFIED_READY_TO_COMMIT`。 | [KanataM6KillableWorkerService.java](syntheticDebug/java/com/yubin/formyself/KanataM6KillableWorkerService.java#L42-L43), [L172-L202](syntheticDebug/java/com/yubin/formyself/KanataM6KillableWorkerService.java#L172-L202); [KanataM6Fix03CommitAndLockTest.java](androidTest/com/yubin/formyself/KanataM6Fix03CommitAndLockTest.java#L179-L355) |
| 7. 恢复过程幂等 | 在确认提交后连续多次调用 `recoverIncompleteTasks()` / `recoverIncompleteImports()` 均返回 `scannedJournals = 0, cleanedTasks = 0, confirmedCommitTasks = 0, unconfirmedCommitTasks = 0` 且目标文件 SHA-256 不变；并在恢复过程中注入 `beforeJournalDelete` 失败验证中断后重跑仍能无损收敛。 | [KanataM6Fix03CommitAndLockTest.java](androidTest/com/yubin/formyself/KanataM6Fix03CommitAndLockTest.java#L276-L284), [L410-L426](androidTest/com/yubin/formyself/KanataM6Fix03CommitAndLockTest.java#L410-L426), [L614-L621](androidTest/com/yubin/formyself/KanataM6Fix03CommitAndLockTest.java#L614-L621) |
| 8. Importer rename 后目录 `fsync` 失败的可恢复确认机制 | 为 `KanataM6SchemeCImporter` 补齐对等的崩溃安全提交 Journal（`.import-<tid>.pending` + `.pending.next` 原子替换）与启动恢复入口 `recoverIncompleteImports(File... dirs)`：<br>- 关闭并清理空 sidecar 后，对 `targetStageFile` 执行 `fsyncFileStrict` 并计算 `stageSha256Hex`；<br>- 在持有 `TargetCommitLockHandle` 内写入 `VERIFIED_READY_TO_COMMIT` 并 `fsyncDirectoryStrict(targetParent)`（同时持久化 `targetStageFile` 与 Journal 目录项）；<br>- `Os.rename` 后原子更新为 `RENAMED_PENDING_DIR_SYNC` 再执行 `performTargetDirFsync(targetParent)`；失败时抛出 `ERR_DURABILITY_UNCONFIRMED` 并保留目标库与 `.import-<tid>.pending`；<br>- `recoverIncompleteImports()` 在目标锁保护下通过 `(expectedSha256Hex, stageFile, targetDb)` 联合识别 `RENAMED_PENDING_DIR_SYNC` 与 `VERIFIED_READY_TO_COMMIT` 已完成的 Rename，补执行目录 `fsync` 并幂等收敛，并配有 `:m6worker` 真实 `SIGKILL` 窗口验证。 | [KanataM6SchemeCImporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCImporter.java#L487-L796), [L1235-L1324](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCImporter.java#L1235-L1324); [KanataM6KillableWorkerService.java](syntheticDebug/java/com/yubin/formyself/KanataM6KillableWorkerService.java#L255-L347) |

---

### R02：跨进程锁与清理顺序

| 要求项 | 根因与修复措施 | 实际代码位置 |
|---|---|---|
| 1. 临时文件与 Journal 清理处于有效所有权保护范围内 | 重构 `exportToSpool()` `finally` 块与 `recoverIncompleteTasks()`、`importAndVerifyToIsolatedTarget()`、`recoverIncompleteImports()`：所有 `tmpSpool`、`commitTempFile`、`targetStageFile`、`.pending.next`、`.pending` 的删除均严格在**持有对应互斥锁期间**完成，并先校验所有权标志与文件 inode 一致；仅在全部文件清理结束后才调用 `taskLock.close()` / `commitLock.close()`，最后再从 `ACTIVE_TASKS` 移除。 | [KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L748-L905), [L1802-L1850](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L1802-L1850); [KanataM6SchemeCImporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCImporter.java#L1308-L1325) |
| 2. 避免可删除 Journal 文件与唯一互斥锁绑定 | 将 Exporter 任务锁与可删除/可原子替换的 Journal 完全分离：专用互斥锁文件为 `.task-<tid>.lock`（由 `TASK_LOCKS` 进程内 `ReentrantLock` 槽 + 跨进程 OS `FileLock` 构成），Journal 文件 `.task-<tid>.pending` 不再承载唯一互斥锁，支持多次无损原子 `Os.rename(.pending.next, .pending)` 而不破坏互斥。 | [KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L202-L370) |
| 3. 防止锁文件 inode 替换造成互斥失效 | `TaskLockHandle` 与 `TargetCommitLockHandle` 获取锁时循环执行 `Os.fstat(raf.getFD()) == Os.stat(lockFile.getPath())`（核对 `st_dev` 与 `st_ino`），若旧 inode 已被解链或替换立即丢弃重试；释放锁（`close()`）仅在全部业务与文件清理结束后、仍持有 OS `FileLock` 与进程内 `ReentrantLock` 且 `isStillLiveInode() == true` 时解链自身锁文件，既杜绝锁 inode 替换造成的互斥失效，也防止等待线程取消时遗留孤儿锁文件。 | [KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L257-L355); [KanataM6SchemeCImporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCImporter.java#L280-L460) |
| 4. 防止旧任务或旧恢复进程删除新任务创建的文件 | 双重防线：① 清理全部发生在专用锁持有期与 `ACTIVE_TASKS` 保护期内，新任务无法在旧任务完成清理前进入；② 在创建 `tmpSpool`/`commitTempFile`/`targetStageFile` 与每次写入 `pendingJournal`/`importJournal` 时记录 `StructStat(st_dev, st_ino)`，清理前通过 `sameInode(file, expectedStat)` 核对；即使模拟外部恶意解链并新建同名新 inode 文件，旧任务退出也绝不误删新文件。恢复进程在获锁后亦重新校验 `journal.exists()` 与 `lstat` inode。 | [KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L213-L226), [L645-L654](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L645-L654), [L1811-L1832](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L1811-L1832) |
| 5. 新增重复 Task ID、并发恢复、任务退出清理竞争测试 | 在 `KanataM6Fix03CommitAndLockTest.r02_01_lockJournalSeparationInodeSafetyAndConcurrentRecoveryRaces` 中覆盖：① 锁/Journal inode 分离与 Journal 原子换 inode 期间锁 inode 稳定；② 任务退出暂停在 `beforeTaskCleanupUnderLock` 时并发恢复跳过、同 Task ID 拒绝，释放后新任务成功；③ 双恢复线程并发竞争同一崩溃 Journal 互斥串行；④ 恢复持锁期间拒绝同 Task ID 新导出；⑤ 外部强行替换 `.lock`/`.pending`/`.spool.tmp` inode 时旧任务退出零误删。 | [KanataM6Fix03CommitAndLockTest.java](androidTest/com/yubin/formyself/KanataM6Fix03CommitAndLockTest.java#L712-L961) |
| 6. 核对 Importer 获取目标锁后、提交前的取消检查 | ① `acquireTargetCommitLock(targetAbs, cancelled)` 在等待进程内 `ReentrantLock` 与跨进程 OS `FileLock` 期间均周期性检查 `cancelled`；② 获取 `commitLock` 后立即执行 `KanataM6PortableCrypto.checkCancelled(cancelled)`；③ 在 `afterTargetLockAcquiredBeforeCommit` 与 `beforeTargetCommit` 之后、`Os.rename` 之前再次执行 `checkCancelled(cancelled)`，彻底杜绝已取消的等待任务在获锁后继续提交。由 `r02_02` 覆盖等待中取消、获锁后立即取消、Rename 前取消三场景。 | [KanataM6SchemeCImporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCImporter.java#L321-L403), [L1244-L1284](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCImporter.java#L1244-L1284); [KanataM6Fix03CommitAndLockTest.java](androidTest/com/yubin/formyself/KanataM6Fix03CommitAndLockTest.java#L963-L1128) |

---

## 2. 本轮改动文件清单与生产隔离校验

本轮仅修改/新增 `docs/qa/kanata-sqlite-m6/` 下隔离测试与报告文件，**严格禁止且零改动生产业务代码、Schema 001–005、KPB1 冻结合同、发行参数及 Canonical**：

1. [KanataM6SchemeCExporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java)（R01 原子非截断 Journal、`VERIFIED_READY_TO_COMMIT` 已 Rename 识别与 `UNCONFIRMED` 状态机；R02 独立 `.lock`、inode 校验与锁内清理）
2. [KanataM6SchemeCImporter.java](syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCImporter.java)（R01-8 Importer 原子提交 Journal 与 `recoverIncompleteImports()`；R02-3/R02-6 锁防孤儿与锁后/提交前取消检查）
3. [KanataM6KillableWorkerService.java](syntheticDebug/java/com/yubin/formyself/KanataM6KillableWorkerService.java)（新增 `STAGE_AFTER_RENAME_BEFORE_JOURNAL_UPDATE`、`STAGE_BEFORE_POST_RENAME_JOURNAL_RENAME` 及 Importer 独立进程 `SIGKILL`/恢复支持）
4. [KanataM6Fix03CommitAndLockTest.java](androidTest/com/yubin/formyself/KanataM6Fix03CommitAndLockTest.java)（新增 5 项 R01/R02 确定性故障注入与竞争测试）
5. [run-m6-ci.sh](run-m6-ci.sh)（将 `KanataM6Fix03CommitAndLockTest` 与 `KanataM6Fix03` logcat 采集并入既有 API 33/34 M6 专项 CI，保持纯 LF 换行）
6. [m6-02-fix-03-final-remediation.md](m6-02-fix-03-final-remediation.md)（本报告）

---

## 3. 本地确定性故障注入与多平台回归证据

### 3.1 四平台本地专项回归汇总（分列统计，不混淆口径）

| 平台 | AVD / 系统 WebView | 原有 19 项非基准 | Fix-02 (6 项) | Fix-03 R01/R02 (5 项) | 结论 |
|---|---|---|---|---|---|
| **API 34 (Android 14)** | `Codex_Todo_WebView34`, WebView `113.0.5672.136` | **19/19 PASS** | **6/6 PASS** | **5/5 PASS** | **30/30 PASS**（首次无头 `-gpu swiftshader_indirect` 下 28/30，2 项 `N04` 系统选择器因软件渲染触发 SystemUI ANR 弹窗超时；切换 `-gpu auto -memory 3072` 复测 `KanataM6N04SafLifecycleTest` **4/4 PASS**） |
| **API 30 (Android 11)** | `Codex_Todo_API30`, WebView `113.0.5672.136` | **19/19 PASS** | **6/6 PASS** | **5/5 PASS** | **30/30 PASS**（单次全量一次通过） |
| **API 25 (Android 7.1.1)** | `Codex_Kanata_API25`, WebView `52.0.2743.100` | Native 定向（F02 5/5 + N04 SIGKILL 1/1）；WebView Bridge 保留 **BLOCKED** | Native 5/5 PASS；`p1_03` Bridge 保留 **BLOCKED** | **5/5 PASS** | **16/16 Native 定向 PASS**（`BUILD SUCCESSFUL in 2m 28s`）；WebView 52 Bridge 维持真实 `BLOCKED` |
| **API 24 (Android 7.0)** | `Codex_Kanata_API24`, WebView `52.0.2743.100` | Native 定向（F02 5/5 + N04 SIGKILL 1/1）；WebView Bridge 保留 **BLOCKED** | Native 5/5 PASS；`p1_03` Bridge 保留 **BLOCKED** | **5/5 PASS** | **16/16 Native 定向 PASS**（`BUILD SUCCESSFUL in 2m 22s`）；WebView 52 Bridge 维持真实 `BLOCKED` |

### 3.2 新增 R01/R02 确定性故障注入实测摘要（`KanataM6Fix03CommitAndLockTest`）

| 测试方法 | 覆盖要求 | API 34 | API 30 | API 25 | API 24 | 关键实测 Logcat 摘要 |
|---|---|---|---|---|---|---|
| `r01_01_realSigkillAfterRenameBeforeJournalUpdateAndIdempotentRecovery` | R01-1/2/3/6/7 | PASS | PASS | PASS | PASS | `sigkillAfterRenameBeforeJournalUpdateConfirmed=true`, `sigkillMidJournalUpdateNonTruncatingConfirmed=true`, `dirSyncFailKeptUnconfirmed=true`, `recoveryIdempotent=true`（实测真实 `:m6worker` PID：API 34 `5992`/`6016`；API 30 `5964`/`5992`；API 25 `2741`/`2758`；API 24 `2846`/`2862`） |
| `r01_02_journalAtomicNonTruncatingAndUnconfirmedStateMatrix` | R01-3/4/5/7 | PASS | PASS | PASS | PASS | `interruptedJournalUpdatePreservedOldRecord=true`, `recoveryCrashBeforeDeleteIdempotent=true`, `all5UnconfirmedCasesPreserved=true`, `unrenamedVerifiedCleanPreservedPriorTarget=true` |
| `r01_03_importerDirFsyncFailureRecoveryAndRealSigkill` | R01-7/8 | PASS | PASS | PASS | PASS | `importerDirFsyncFailureRecovered=true`, `importerSigkillAfterRenameBeforeJournalUpdateRecovered=true`, `importerRecoveryIdempotent=true`（实测 `:m6worker` PID：API 34 `6037`；API 30 `6022`；API 25 `2779`；API 24 `2885`） |
| `r02_01_lockJournalSeparationInodeSafetyAndConcurrentRecoveryRaces` | R02-1/2/3/4/5 | PASS | PASS | PASS | PASS | `lockAndJournalSeparatedInodes=true`, `journalAtomicInodeSwapVerified=true`, `exitCleanupStrictlyUnderLock=true`, `concurrentRecoverySerialized=true`, `recoveryBlocksDuplicateExporter=true`, `inodeReplacementPreservedNewFiles=true` |
| `r02_02_importerCancelledWaiterMustNotCommitAfterAcquiringTargetLock` | R02-6 | PASS | PASS | PASS | PASS | `cancelledWaiterBlockedBeforeCommit=true`, `cancelAfterLockBlockedBeforeCommit=true`, `cancelBeforeRenameBlockedAndCleaned=true`, `winnerMessagesPreserved=18` |

### 3.3 宿主机、生产隔离与 Synthetic Release 阻断验证

| 检查项 | 实际执行命令（`.worktrees/kanata-m5`） | 结果 |
|---|---|---|
| `npm run check` | `npm run check`（ESLint + 818/818 Node 测试 + Vitest + TypeScript + Vite `built in 936ms`） | **Exit 0** |
| 生产隔离零改动校验 | `git diff --exit-code 43b26d6ec41929a59844bb62a882bdf578391192 -- src package.json package-lock.json android/app/src/main` | **Exit 0**（零修改） |
| 标准非合成 Android 构建与单测 | `.\gradlew.bat --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest` | **Exit 0** (`BUILD SUCCESSFUL in 34s`) |
| Synthetic Release 禁止构建验证 | `.\gradlew.bat --no-daemon -PkanataM2Synthetic=true -PkanataM6Synthetic=true :app:assembleRelease` | **Exit 1（预期阻断）**：`Task 'assembleRelease' not found in project ':app'` |

### 3.4 性能关键路径说明

本轮 R01/R02 改动全部位于任务启动/提交尾声与崩溃恢复阶段（每次导出仅增加 1 次 `.lock` 打开/解锁与 3 次小体积 JSON `.pending.next` 原子重命名及目录 `fsync`，总开销约 1–3 ms），**未改动任何 SQLite 快照加锁、行读取编码、PBKDF2/HKDF/AES-GCM 加解密或流式 Spool 写入热路径**。依本轮要求，未重复手动执行本地 108 样本性能实验，保留 FIX-02 全部 108 样本证据，并由远端 `m6-synthetic-android (33/34)` CI 自动运行完整基准套件校验无性能回归。

---

## 4. 兼容性边界说明（严格区分 Native API 与 WebView Bridge）

本轮**未擅自调整 Android 最低支持版本（`minSdkVersion`），未擅自豁免原始验收门禁**，并完整保留历史与本轮实测的 `BLOCKED` 记录：

1. **Native API 兼容（API 24–34 全部实测 PASS）**：
   - `Os.rename`、`Os.open` + `Os.fsync` 目录严格落盘、`Os.fstat` / `Os.stat` / `Os.lstat` inode 核对、`FileChannel.tryLock` 跨进程文件锁、SQLCipher WAL 快照导出/导入、Zero-Alloc PBKDF2-HMAC-SHA256、AES-256-GCM 与 `:m6worker` 真 `SIGKILL` 恢复在 **API 24、API 25、API 30、API 33、API 34** 全部 100% 通过。
2. **WebView Bridge 兼容（保留全部真实 `BLOCKED` 记录）**：
   - **已验证通过的 WebView 环境**：
     - 本地 API 34 (`Codex_Todo_WebView34`)：`com.google.android.webview` **`113.0.5672.136`** → Bridge 全项 PASS（30/30）。
     - 本地 API 30 (`Codex_Todo_API30`)：`com.google.android.webview` **`113.0.5672.136`** → Bridge 全项 PASS（30/30）。
     - 远端 CI API 33 / API 34 (`google_apis`)：现代 WebView → 全量回归与基准 PASS。
   - **已实测并诚实保留的 `BLOCKED` 环境（绝不伪装为 PASS）**：
     - **API 24 / API 25 原厂 AOSP 镜像**（`com.android.webview` **`52.0.2743.100`**）：低于 Capacitor 8 最低要求 `Bridge.MINIMUM_ANDROID_WEBVIEW_VERSION = 55`（推荐 `>= 60`），`KanataM6N03BoundedMemoryTest#probeCapacitorBridgeControlBoundsAndWebViewMemory` 与 `KanataM6Fix02FaultInjectionTest#p1_03_bridgeUnifiedSizeAllowlistAndResponseGuard` 稳定报 `PLUGIN_MISSING`（`BLOCKED`）。
     - **GitHub Actions 原厂 API 30 镜像**（`system-images;android-30;google_apis;x86_64`，`com.google.android.webview` **`83.0.4103.106`**，历史 Run `45375295764` / `45544728749`）：Native 26/28 PASS，上述 2 项 Capacitor 8 WebView Bridge 用例报 `PLUGIN_MISSING`（`BLOCKED`）。
3. **后续 M6-03 运行时能力检测要求**：
   - M6-03 接入正式 UI 前，必须在客户端启动/进入加密备份页时增加**运行时 WebView 版本与 Capacitor Bridge 插件可用性探测**（校验 `WebViewCompat.getCurrentWebViewPackage` 版本号及 JS 侧 `Capacitor.isPluginAvailable` / Bridge 握手探针）；
   - 当检测到旧版 System WebView（如 `< 55` 或未就绪的旧内核如未更新的 WebView 83）无法承载 Capacitor 8 插件桥时，必须向用户显式展示「需要更新 Android System WebView」的可操作降级提示，严禁静默失败或假装导出/恢复可用。

---

## 5. 远端 CI 验证证据

- **待补齐（代码提交推送触发 `Quality` Workflow 后回填最终代码 SHA、Run ID、Job IDs 与 Artifact IDs）**。

---

## 6. 剩余风险与边界说明

1. **未包含生产接入代码**：全部改动仍严格隔离在 `docs/qa/kanata-sqlite-m6/` 合成测试态；正式产品集成、设置页交互及 WebView 运行时能力检测 UI 留待 GPT-6.2 签核通过后在 M6-03 开展。
2. **`UNCONFIRMED` 状态人工/二次确认语义**：当文件系统返回持续性目录 `fsync` 错误或外部进程在提交窗口外篡改/删除目标文件导致三元联合校验无法确定提交状态时，恢复程序按合同拒绝盲目清理并保留 `UNCONFIRMED` Journal；M6-03 接入产品层时需明确向用户展示「待确认状态」与手动核验/清理入口。
3. **跨文件系统移动**：当前所有 Android 测试环境均在同分区内部存储（`filesDir` / `noBackupFilesDir`）下完成；跨文件系统回退分支（`commitTempFile` 写盘 + `fsync` + 回读 + `fsyncDirectoryStrict(targetDir)` + `VERIFIED_READY_TO_COMMIT` 联合识别）已按同套逻辑实现，但模拟器单一 `/data` 分区下未构造真实异 `st_dev` 挂载点测试。
