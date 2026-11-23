# Kanata SQLite M6-02 Round 2.1 自动化测试质量补强报告 v1（F07 / F08）

- **任务编号**：`KANATA-M6-02-END-TO-END-2026-11-23`（Stage 1 / Round 2.1）
- **前置报告**：[m6-02-round2-remediation-v1.md](m6-02-round2-remediation-v1.md)、[m6-02-native-probes-v1.md](m6-02-native-probes-v1.md)
- **执行分支 / 工作树**：`m6/encrypted-backup-recovery`（`.worktrees/kanata-m5`）
- **日期**：2026-11-23（北京时间）

---

## 1. 整改摘要

| 编号 | 修复内容 | 状态 |
| --- | --- | --- |
| **F07-1** | 移除 `KanataM6N02SnapshotProbeTest` 中 A2 `changePassword(rekeyTargetKey)` 的 `try/catch` 吞错与 `if (rekeySucceeded)` 条件跳过；强制断言 rekey 成功、新密钥打开成功、旧密钥打开抛 `SQLiteException`、元数据/完整性/Schema/摘要完全一致。 | **PASS** |
| **F07-2** | 移除 A1 并发未提交写事务 `sqlcipher_export` 路径的 `catch (Throwable)` 吞错；强制断言导出成功且排除未提交行（`count=2`），并校验 `user_version=5`、`application_id=1263424577`、`integrity_check=ok`、`cipher_integrity_check` 0 行、`foreign_key_check` 0 行、Schema 与逻辑 SHA-256 摘要一致。 | **PASS** |
| **F07-3** | 为 A1 (`targetDb` / `concTarget`) 与 A2 (`copyPreRekey` / `reopened` / `verifySrc`) 补全全部元数据和完整性强制 JUnit `assertEquals` / `noRows` 断言，不再只写日志。 | **PASS** |
| **F07-4** | 为 A2 增加文件生命周期断言：`wal_checkpoint(TRUNCATE)` `busy=0`、所有 `SQLiteDatabase` 连接关闭（`assertFalse(isOpen())`）、`-wal`/`-shm` sidecar 不存在（`assertFalse(exists())`）、rekey 前复制体完整性正常、rekey 成功、原 disposable clone 零逻辑变化；同时为所有 `ExecutorService` 增加 `awaitTermination(5, SECONDS)` 确保无线程/连接泄漏。 | **PASS** |
| **F08** | 在 `KanataM6N01CryptoProbeTest` 移除对 `outBuf[0..31]` 的无同步共享内存轮询，改用 `Pbkdf2BlockHook` + 四组 `CountDownLatch(block1Written, allowBlock2, block2Entered, allowCancelCheck)` 确定性同步；验证 block 1 写入完成后再进入 block 2 并触发取消、取消后全 64 B `outBuf` 清零、无效参数不污染调用方预填 `0x55` 缓冲区；保留 6 组独立标准向量与全部 M6-01 KAT。 | **PASS** |

---

## 2. 源码修改位置

- [KanataM6N02SnapshotProbeTest.java](androidTest/com/yubin/formyself/KanataM6N02SnapshotProbeTest.java)
- [KanataM6N01CryptoProbeTest.java](androidTest/com/yubin/formyself/KanataM6N01CryptoProbeTest.java)

---

## 3. API 30 & API 34 复测结果

构建命令（`.worktrees/kanata-m5/android`）：

```powershell
.\gradlew.bat --no-daemon -PkanataM2Synthetic=true -PkanataM6Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
```

执行命令：

```powershell
adb shell am instrument -w -r -e class "com.yubin.formyself.KanataM6N01CryptoProbeTest,com.yubin.formyself.KanataM6N02SnapshotProbeTest" "com.yubin.formyself.m2qa.test/androidx.test.runner.AndroidJUnitRunner"
```

| 平台 | 结果 | 耗时 | 关键观测摘要 |
| --- | --- | --- | --- |
| **API 30** (`Codex_Todo_API30`, Android 11, `x86_64`) | **`OK (4 tests)`** | `13.742s` | `F08_STD_VECTORS_AND_WIPE`: 6 组标准向量全一致，`deterministicSync="CountDownLatch(...)"`, `outputBufferWipedAfterCancel=true`, `invalidArgRejectedWithoutPollutingCallerBuffer=true`；600k Zero-Alloc 冷测 `568 ms`，热 5 轮 `[536, 521, 542, 549, 544]` ms，取消 `1 ms`，结束 RSS `145,792 KiB`。<br>`F07_EXP_A_SQLCIPHER_EXPORT_META`: `user_version=5`, `application_id=1263424577`, `integrity_check=ok`, `targetCipherAndFkOk=true`, `schemaExactMatch=true`, `logicalDigestExactMatch=true` (`e97ab57971324540ec5ef5e4f130c976e2d31c0c8b4911cb2d4051214018412f`), `exportDuringUncommittedWriter="SUCCEEDED_EXCLUDES_UNCOMMITTED_COUNT_2"`。<br>`F07_EXP_B_CLONE_AND_REKEY`: `checkpointBusy=0`, `allConnectionsClosed=true`, `walExistsAfterClose=false`, `shmExistsAfterClose=false`, `copyPreRekeyIntegrityOk=true`, `rekeySucceeded=true`, `oldKeyRejectedAfterRekey=true`, `originalSourceUnchanged=true`。 |
| **API 34** (`Codex_Todo_WebView34`, Android 14, `x86_64`) | **`OK (4 tests)`** | `70.894s` | `F08_STD_VECTORS_AND_WIPE`: 6 组标准向量全一致，`deterministicSync` 与清零/防污染全通过；600k Zero-Alloc 冷测 `3,433 ms`，热 5 轮 `[4276, 6436, 6257, 5438, 3156]` ms，取消 `0 ms`，结束 RSS `60,036 KiB`。<br>`F07_EXP_A_SQLCIPHER_EXPORT_META` 与 `F07_EXP_B_CLONE_AND_REKEY`: 全部强制断言与摘要 (`e97ab579...`) 与 API 30 完全一致。 |
| **API 24 / API 25** | **`NOT_RUN`** | — | 宿主机 SDK 无 `android-24`/`android-25` 系统镜像及 `cmdline-tools`/`sdkmanager`（详见 Stage 7 环境检查）。 |
