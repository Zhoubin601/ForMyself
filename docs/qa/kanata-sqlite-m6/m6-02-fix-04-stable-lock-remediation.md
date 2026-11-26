# Kanata M6-02 FIX-04 跨进程稳定锁生命周期最终整改报告

- **执行者**：Hydrogen
- **独立审计**：GPT-6.2
- **整改基线**：`11dea81b05280068720cf107d7c9d5afe869f9db`（`FIX-03`）
- **分支**：`m6/encrypted-backup-recovery`
- **状态**：待 GPT-6.2 最终签核（未启动 M6-03，未自行标记 `CLOSED`）
- **历史证据保留**：完整保留 FIX-02 与 FIX-03（含 [m6-02-fix-03-final-remediation.md](file:///D:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/docs/qa/kanata-sqlite-m6/m6-02-fix-03-final-remediation.md)）全部历史文件、基准样本与真实 `BLOCKED` 记录。

---

## 1. 缺陷根因与修复前后的锁生命周期差异

独立审计指出 `FIX-03` 中 Exporter 与 Importer 均存在同一 P1 竞态：`TaskLockHandle.close()` 与 `TargetCommitLockHandle.close()` 在调用 `fileLock.release()` 之前调用了 `lockFile.delete()`。若进程 A 仍在收尾但已删除路径上的目录项，进程 B 会以相同文件名创建新 inode B 并立即成功获取 OS `FileLock`，从而在进程 A 尚未释放旧 inode A 的锁之前发生跨进程互斥分裂（split-brain）。

| 维度 | FIX-03 修复前 | FIX-04 修复后（稳定锁文件） | 源码位置 |
| :--- | :--- | :--- | :--- |
| **Exporter 任务锁文件** | `.task-<tid>.lock` 在 `TaskLockHandle.close()` 内先 `lockFile.delete()` 再 `fileLock.release()` | 永久稳定锁文件，正常 `close()` 与 `recoverIncompleteTasks()` **禁止 unlink** | [KanataM6SchemeCExporter.java](file:///D:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/docs/qa/kanata-sqlite-m6/syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java#L234-L381) |
| **Importer 目标提交锁文件** | `.kanata-import-<hash>.lock` 在 `TargetCommitLockHandle.close()` 内先 `lockFile.delete()` 再 `fileLock.release()` | 永久稳定锁文件，正常 `close()` 与恢复过程 **禁止 unlink** | [KanataM6SchemeCImporter.java](file:///D:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/docs/qa/kanata-sqlite-m6/syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCImporter.java#L256-L535) |
| **释放顺序** | `delete()` → `fileLock.release()` → `raf.close()` → `mutex.unlock()` | 业务与临时文件/Journal 清理已提前完成 → 可选测试注入点 `beforeOsReleaseHook` → `fileLock.release()` → `raf.close()` → `slot.ownerActive = false` & `slot.mutex.unlock()` | Exporter `#L273-L299` / `#L1879-L1881`；Importer `#L345-L377` / `#L1306-L1311` |
| **Orphan Lock Sweep** | `recoverIncompleteTasks()` 末尾通过尝试加锁并 `close()` 清理孤立 `.lock` 文件（原 931–945 行） | **已移除**，避免借由加锁后删除造成目录项与 inode 切换竞态 | `KanataM6SchemeCExporter.java` (`recoverIncompleteTasks`) |
| **活动状态判定** | 将锁文件存在/创建副作用与活动锁混用 | `hasActiveTaskLock()` / `hasActiveCommitLock()` 在同进程先检查 `slot.ownerActive \|\| slot.mutex.isLocked()`（避免 POSIX `fcntl` 因同进程关闭新 FD 误放原锁），仅当本进程无持锁者且 `lockFile.exists()` 时通过 `FileChannel.tryLock()` 非阻塞探测 OS 锁；休眠稳定 `.lock` 文件明确返回 `false` | Exporter `#L381`；Importer `#L256` |
| **`SIGKILL` 行为** | 强杀后依赖文件存在性判断可能误判或被 orphan sweep 删除 | 内核在进程退出后自动释放原 `(st_dev, st_ino)` 的 OS `FileLock`；恢复进程与新任务直接重新获取**同一 inode** | 见第 2 节真实多进程证据 |
| **既有测试断言** | F02 与 FIX-03 个别断言要求 `spoolDir.listFiles().length == 0` 或 `.lock` 被删除 | 更新为 `assertOnlyDormantTaskLocksInSpoolDir()` 与 `!hasActiveTaskLock(...)` 断言 | [KanataM6F02FaultMatrixTest.java](file:///D:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/docs/qa/kanata-sqlite-m6/androidTest/com/yubin/formyself/KanataM6F02FaultMatrixTest.java)；[KanataM6Fix03CommitAndLockTest.java](file:///D:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/docs/qa/kanata-sqlite-m6/androidTest/com/yubin/formyself/KanataM6Fix03CommitAndLockTest.java) |

---

## 2. 确定性多进程竞争、Inode 一致性、`SIGKILL` 与对照回归证据

新增测试套件 [KanataM6Fix04StableLockTest.java](file:///D:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/docs/qa/kanata-sqlite-m6/androidTest/com/yubin/formyself/KanataM6Fix04StableLockTest.java) 与独立 `:m6worker` 服务 [KanataM6KillableWorkerService.java](file:///D:/2026Autumn%20Semester%20File/GitHub/formyself-app/.worktrees/kanata-m5/docs/qa/kanata-sqlite-m6/syntheticDebug/java/com/yubin/formyself/KanataM6KillableWorkerService.java) 覆盖以下场景：

1. **`fix04_01`（Exporter 关闭窗口多进程竞争与恢复复用）**：主进程获取 `.task-<tid>.lock` 并暂停在 `beforeTaskLockRelease`；`:m6worker` 尝试获取同一任务锁必须被阻塞并持续等待直到主进程执行 `fileLock.release()`；两进程观测到完全一致的 `(st_dev, st_ino)`；连续恢复及重复 `taskId` 复跑保持同一稳定锁文件且未破坏锁文件。
2. **`fix04_02`（Importer 关闭窗口多进程竞争与恢复复用）**：主进程获取 `.kanata-import-<hash>.lock` 并暂停在 `beforeTargetLockRelease`；`:m6worker` 阻塞等待主进程释放 OS `FileLock` 后才成功获得同一 `(st_dev, st_ino)`；连续恢复及重复提交复用稳定锁文件。
3. **`fix04_03`（`SIGKILL` 强杀与同 Inode 重新获取）**：`:m6worker` 分别在 Exporter 阶段与 Importer 阶段被真实 `Process.killProcess()` (`SIGKILL`) 强杀；新进程恢复或重新加锁直接获得**原 `st_dev / st_ino`**，证明内核释放 OS 锁后稳定锁文件无需重建目录项即可无缝接管。
4. **`fix04_04`（旧实现 `unlink`-before-`release` 对照回归）**：在确定性复现旧缺陷窗口（先 `unlink` 再延迟释放 OS `FileLock`）时，`:m6worker` 立即创建新 inode 并在旧锁尚未释放前发生互斥分裂（`oldBugControlExporterCaughtSplitBrain=true`、`oldBugControlImporterCaughtSplitBrain=true`）；而在 FIX-04 稳定锁实现下，`:m6worker` 被严格阻塞直到原锁释放（`fixedExporterBlockedSplitBrain=true`、`fixedImporterBlockedSplitBrain=true`）。

### 实测 Logcat 关键字段摘要

| 平台 | `FIX04_01` (Exporter) | `FIX04_02` (Importer) | `FIX04_03` (`SIGKILL` 同 Inode) | `FIX04_04` (旧缺陷对照回归) |
| :--- | :--- | :--- | :--- | :--- |
| **API 34** (`Android 14`, WebView `113.0.5672.136`) | `exporterCloseWindowBlockedB=true, sameInodeAcrossProcesses=true, stableLockSurvivedRecoveryAndReuse=true, dev=65064, ino=336921, workerPidB=4986` | `importerCloseWindowBlockedB=true, sameInodeAcrossProcesses=true, stableLockSurvivedRecoveryAndReuse=true, dev=65064, ino=337218, workerPidB=4986` | `exporterSigkillReacquiredSameInode=true, importerSigkillReacquiredSameInode=true, expIno=337207, impIno=337400` | `oldBugControlExporterCaughtSplitBrain=true, oldBugControlImporterCaughtSplitBrain=true, fixedExporterBlockedSplitBrain=true, fixedImporterBlockedSplitBrain=true` |
| **API 30** (`Android 11`, WebView `113.0.5672.136`) | `exporterCloseWindowBlockedB=true, sameInodeAcrossProcesses=true, stableLockSurvivedRecoveryAndReuse=true, dev=64773, ino=147469, workerPidB=6024` | `importerCloseWindowBlockedB=true, sameInodeAcrossProcesses=true, stableLockSurvivedRecoveryAndReuse=true, dev=64773, ino=147481, workerPidB=6024` | `exporterSigkillReacquiredSameInode=true, importerSigkillReacquiredSameInode=true, expIno=147478, impIno=147489` | `oldBugControlExporterCaughtSplitBrain=true, oldBugControlImporterCaughtSplitBrain=true, fixedExporterBlockedSplitBrain=true, fixedImporterBlockedSplitBrain=true` |
| **API 25** (`Android 7.1.1`, WebView `52.0.2743.100`) | 20/20 定向 Native 回归通过 | 20/20 定向 Native 回归通过 | `expIno=98985, impIno=98993`, 双向 `true` | 双向对照回归 `true` |
| **API 24** (`Android 7.0`, WebView `52.0.2743.100`) | `exporterCloseWindowBlockedB=true, sameInodeAcrossProcesses=true, stableLockSurvivedRecoveryAndReuse=true, dev=64800, ino=98815, workerPidB=3289` | `importerCloseWindowBlockedB=true, sameInodeAcrossProcesses=true, stableLockSurvivedRecoveryAndReuse=true, dev=64800, ino=98822, workerPidB=3289` | `exporterSigkillReacquiredSameInode=true, importerSigkillReacquiredSameInode=true, expIno=98818, impIno=98827` | `oldBugControlExporterCaughtSplitBrain=true, oldBugControlImporterCaughtSplitBrain=true, fixedExporterBlockedSplitBrain=true, fixedImporterBlockedSplitBrain=true` |

---

## 3. 四平台本地回归与宿主/构建校验结果

### 3.1 四平台测试矩阵

| 平台 | 设备 / AVD | WebView 版本 | 执行范围 | 结果 | 兼容性与备注 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **API 34** | `Codex_Todo_WebView34` (`Android 14`) | `113.0.5672.136` | 完整 34 项 M6 非基准套件 (`KanataM6N01..N04`, `SchemeCInterop`, `F02`, `Fix02`, `Fix03`, `Fix04`) | **34/34 PASS** (`0 skipped, 0 failed`) | Native API + WebView Bridge 全量通过 |
| **API 30** | `Codex_Todo_API30` (`Android 11`) | `113.0.5672.136`（已升级） | 完整 34 项 M6 非基准套件 (`KanataM6N01..Fix04`) | **34/34 PASS** (`0 skipped, 0 failed`) | 原厂 API 30 WebView 83 上 Bridge 失败历史 `BLOCKED` 记录保持不变 |
| **API 25** | `Codex_Kanata_API25` (`Android 7.1.1`) | `52.0.2743.100` | 定向 Native 锁与恢复 20 项（`Fix04` 4 项 + `Fix03` 5 项 + `F02` 5 项 + `Fix02` Native 5 项 + `N04` SIGKILL 1 项） | **20/20 PASS** (`0 skipped, 0 failed`) | Native API 兼容通过；WebView 52 上的 Bridge 历史 `BLOCKED` 记录保持不变 |
| **API 24** | `Codex_Kanata_API24` (`Android 7.0`) | `52.0.2743.100` | 定向 Native 锁与恢复 20 项（同 API 25 范围） | **20/20 PASS** (`0 skipped, 0 failed`) | Native API 兼容通过；WebView 52 上的 Bridge 历史 `BLOCKED` 记录保持不变 |

### 3.2 宿主、Android 标准构建、合成隔离与发行禁止校验

- **`npm run check`**：Exit `0`（ESLint + 818/818 Node 测试 + Vitest + TypeScript + Vite build）。
- **标准 Android 非合成构建与单测**（`.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest`）：Exit `0`。
- **Synthetic 调试包构建**（`-PkanataM2Synthetic=true -PkanataM5Synthetic=true -PkanataM6Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest`）：Exit `0`。
- **Synthetic Release 禁止验证**（`-PkanataM2Synthetic=true -PkanataM5Synthetic=true -PkanataM6Synthetic=true :app:assembleRelease`）：预期失败 Exit `1`（`Task 'assembleRelease' not found in project ':app'`）。
- **生产代码零改动隔离校验**（`git diff --exit-code 43b26d6ec41929a59844bb62a882bdf578391192 -- src package.json package-lock.json android/app/src/main`）：Exit `0`，未修改任何生产业务代码、Schema 001–005、KPB1 冻结合同或发行参数。

---

## 4. 远端 GitHub Actions `Quality` CI 记录

- **测试提交 SHA**：`808205c665b143c4411eb8b5128882ac966222ae`
- **Workflow / Run ID**：`Quality` / [`45763919600`](https://github.com/Zhoubin601/ForMyself/actions/runs/45763919600)（`status=completed`, `conclusion=success`）

| Job 名称 | Job ID | 状态 / 结论 | 链接 |
| :--- | :--- | :--- | :--- |
| `web` | `139720143559` | `completed` / `success` | https://github.com/Zhoubin601/ForMyself/actions/runs/45763919600/job/139720143559 |
| `android` | `139720143894` | `completed` / `success` | https://github.com/Zhoubin601/ForMyself/actions/runs/45763919600/job/139720143894 |
| `m6-synthetic-android (33)` | `139720144282` | `completed` / `success` | https://github.com/Zhoubin601/ForMyself/actions/runs/45763919600/job/139720144282 |
| `m6-synthetic-android (34)` | `139720144101` | `completed` / `success` | https://github.com/Zhoubin601/ForMyself/actions/runs/45763919600/job/139720144101 |

### 上传产物（Artifacts）

| Artifact ID | 名称 | 大小 (bytes) |
| :--- | :--- | :--- |
| `15091565863` | `android-test-reports` | `15221252` |
| `15091872139` | `m6-synthetic-api33-reports` | `967498` |
| `15092565480` | `m6-synthetic-api34-reports` | `1156893` |

---

## 5. 工作树与交付状态

- **修改与新增文件**（全部位于 `docs/qa/kanata-sqlite-m6/`）：
  - `syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCExporter.java`
  - `syntheticDebug/java/com/yubin/formyself/KanataM6SchemeCImporter.java`
  - `syntheticDebug/java/com/yubin/formyself/KanataM6KillableWorkerService.java`
  - `androidTest/com/yubin/formyself/KanataM6F02FaultMatrixTest.java`
  - `androidTest/com/yubin/formyself/KanataM6Fix03CommitAndLockTest.java`
  - `androidTest/com/yubin/formyself/KanataM6Fix04StableLockTest.java`
  - `run-m6-ci.sh`（纯 LF 换行符）
  - `docs/qa/kanata-sqlite-m6/m6-02-fix-04-stable-lock-remediation.md`
- **主工作区保护**：独立在 `.worktrees/kanata-m5` 工作，主工作区既有用户修改未受任何重置、覆盖或清理。
- **下一步**：交由 GPT-6.2 开展 FIX-04 独立终审与签核。
