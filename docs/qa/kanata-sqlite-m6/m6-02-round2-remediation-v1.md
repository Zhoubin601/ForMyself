# Kanata SQLite M6-02 第二轮独立复审整改报告 v1（F06 / F07 / F08）

- **任务编号**：`KANATA-M6-02-ROUND2-REMEDIATION`
- **基线提交**：`6cd84825ca1694c5f5c29b3cf7ba63654e261177`
- **执行分支 / 工作树**：`m6/encrypted-backup-recovery`（`.worktrees/kanata-m5`）
- **前置报告**：[m6-02-native-probes-v1.md](m6-02-native-probes-v1.md)
- **执行范围**：F06（Synthetic Release 隔离）、F07（A 路线补充实验与重评级）、F08（KDF 安全加固）；不启动 N-03/N-04，不实施完整 C 路线导出，不冻结 `0x0001` 发行参数。
- **日期**：2026-11-23（北京时间）

---

## 1. 整改摘要与重新评级

| 项目 | 状态 | 关键结论 |
| --- | --- | --- |
| **F06（Synthetic Release 隔离）** | **PASS** | [android/app/build.gradle](../../../android/app/build.gradle) 已禁用 `kanataM2Synthetic`、`kanataM5Synthetic`、`kanataM6Synthetic` 任意开启时的 Release Variant；普通 `:app:assembleRelease`（exit `0`）与 M6 Synthetic Debug/AndroidTest（exit `0`）均正常，三种 Synthetic 组合执行 `:app:assembleRelease` 均退出 `1` 被拦截。 |
| **F07（A 路线补充实验）** | **PASS（实验完成）；重评级更新** | 实验 A（`sqlcipher_export` + `DETACH` 前恢复 `user_version` / `application_id`）与实验 B（Disposable Clone + Checkpoint + Close + Copy + `changePassword` Rekey）在 API 30 与 API 34 上**均实测成功**。依据真实证据，将物理快照原语重新评级为：**A1 (`sqlcipher_export + 元数据恢复`) = `SUPPORTED_WITH_CONSTRAINTS`**；**A2 (`Clone + Rekey`) = `SUPPORTED_OFFLINE_ONLY`**（不再笼统标为 `NOT_SUPPORTED`）。 |
| **F08（KDF 安全加固）** | **PASS** | `pbkdf2HmacSha256ZeroAllocInto()` 在 `finally` 路径增加 `!completed` 输出缓冲区清零与 `fullBlock` 清理；新增 6 组独立标准向量（RFC 7914 / NUL / `>64 B` 长口令预哈希 / `dkLen=40` 与 `48` 多块）；在 block 1 已写入 `outBuf[0..31]` 后触发取消，实测断言全 64 B `outBuf` 被清零。API 24/25 仍因环境缺失保持 `NOT_RUN`。 |

---

## 2. F06：Synthetic Release 隔离修复与实测

### 2.1 修改内容

在 [android/app/build.gradle](../../../android/app/build.gradle#L90-L96) 将 Release Variant 禁用条件从单一 `kanataM5Synthetic.get()` 扩展为：

```groovy
androidComponents {
    beforeVariants(selector().withBuildType('release')) { variant ->
        if (kanataM2Synthetic.get() || kanataM5Synthetic.get() || kanataM6Synthetic.get()) {
            variant.enable = false
        }
    }
}
```

### 2.2 Gradle 实际验证结果

| 验证命令（工作目录：`.worktrees/kanata-m5/android`） | 退出码 | 实际输出摘要 | 结论 |
| --- | --- | --- | --- |
| `.\gradlew.bat --no-daemon :app:assembleRelease` | `0` | `BUILD SUCCESSFUL in 3m 24s`（373 tasks） | 普通 Release 不受影响 |
| `.\gradlew.bat --no-daemon -PkanataM2Synthetic=true :app:assembleRelease` | `1` | `BUILD FAILED in 28s`（Release variant 已禁用，Task `assembleRelease` 不可构建） | M2 Synthetic Release 被禁止 |
| `.\gradlew.bat --no-daemon -PkanataM2Synthetic=true -PkanataM5Synthetic=true :app:assembleRelease` | `1` | `BUILD FAILED in 21s`（Release variant 已禁用） | M5 Synthetic Release 被禁止 |
| `.\gradlew.bat --no-daemon -PkanataM2Synthetic=true -PkanataM6Synthetic=true :app:assembleRelease` | `1` | `BUILD FAILED in 30s`（Release variant 已禁用） | M6 Synthetic Release 被禁止 |
| `.\gradlew.bat --no-daemon -PkanataM2Synthetic=true -PkanataM6Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest` | `0` | `BUILD SUCCESSFUL in 54s`（238 tasks） | M6 Synthetic Debug & AndroidTest 正常 |
| `.\gradlew.bat --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest` | `0` | `BUILD SUCCESSFUL in 1m 8s`（242 tasks） | 标准 Android CI 构建正常 |

---

## 3. F07：A 路线补充实验（API 30 & API 34 实测）

测试代码位于 [KanataM6N02SnapshotProbeTest.java](androidTest/com/yubin/formyself/KanataM6N02SnapshotProbeTest.java) 的 `probeSchemeAExportMetadataAndCloneRekey()`，仅使用隔离缓存目录下的 disposable synthetic SQLCipher 数据库（Schema 含 `probe_worlds`、`probe_messages` 外键引用、`idx_probe_msg_world` 索引、`probe_entity_ids` 触发器派生表、`user_version=5`、`application_id=1263424577` (`0x4b4e5441`)、`wal_autocheckpoint=0`）。

### 3.1 实验 A：`sqlcipher_export` + `DETACH` 前元数据恢复

流程：`ATTACH DATABASE '<expAFile>' AS exp_a KEY <newRandomDek>` → `SELECT sqlcipher_export('exp_a')` → `PRAGMA exp_a.user_version = 5` → `PRAGMA exp_a.application_id = 1263424577` → `DETACH DATABASE exp_a` → 全新连接以新随机 DEK 重开。

| 检查项 | API 30 (`Codex_Todo_API30`) | API 34 (`Codex_Todo_WebView34`) |
| --- | --- | --- |
| 导出前未 checkpoint `-wal` 字节 | `115,392 B` | `115,392 B` |
| 并发活跃 `OPEN_READONLY` `DEFERRED` 快照存在时导出 | `exportWithActiveReaderSucceeded = true` | `true` |
| 并发另起未提交写事务 (`w_uncomm`) 在途时导出 | `SUCCEEDED_EXCLUDES_UNCOMMITTED_COUNT_2`（不含未提交行） | `SUCCEEDED_EXCLUDES_UNCOMMITTED_COUNT_2` |
| 重开后 `PRAGMA user_version` / `application_id` | `5` / `1263424577` | `5` / `1263424577` |
| `PRAGMA integrity_check` / `cipher_integrity_check` / `foreign_key_check` | `ok` / 0 行 / 0 行 | `ok` / 0 行 / 0 行 |
| `sqlite_schema`（表、索引、触发器）一致性 | `schemaExactMatch = true` | `true` |
| 重开后触发器与外键实际生效验证 | `INSERT probe_worlds` 触发派生计数 `3`；非法 FK 被拒绝 (`targetFkEnforcedAfterReopen = true`) | `true` |
| 逐表行数与确定性逻辑摘要 (`SHA-256`) | `logicalDigestExactMatch = true` (`e97ab57971324540ec5ef5e4f130c976e2d31c0c8b4911cb2d4051214018412f`) | 一致 (`e97ab579...`) |
| 独立随机 DEK 可用 & **源 DEK 拒绝** | `sourceDekRejectedOnTarget = true` | `true` |
| 原始源库未发生逻辑变化 | `sourceUnchanged = true` | `true` |

### 3.2 实验 B：Disposable Clone + Checkpoint + Close + Copy + Rekey

严格按 10 步在独立 disposable synthetic clone 上实测：

| 步骤与核查项 | API 30 (`Codex_Todo_API30`) | API 34 (`Codex_Todo_WebView34`) |
| --- | --- | --- |
| 1. Checkpoint 前 `-wal` 字节 | `115,392 B` | `115,392 B` |
| 2. `PRAGMA wal_checkpoint(TRUNCATE)` | `busy=0, log=0, checkpointed=0`（注：关闭连接前无其他 reader 阻塞，完整落盘） | `busy=0, log=0, checkpointed=0` |
| 3–4. 关闭全部连接后 `-wal` / `-shm` 状态 | `walExists=false (0 B)`, `shmExists=false (0 B)` | `walExists=false (0 B)`, `shmExists=false (0 B)` |
| 5–6. 复制主文件并用源密钥打开 | `copyJournalModeBeforeRekey = "delete"` | `"delete"` |
| 7. `SQLiteDatabase.changePassword(rekeyTargetKey)` | **`rekeySucceeded = true`** | **`rekeySucceeded = true`** |
| 8–9. 重开后新密钥可用 & **旧密钥拒绝** | `reopenNewKeySucceeded = true`, `oldKeyRejectedAfterRekey = true` | `true` / `true` |
| 9b. 头元数据 / 完整性 / 密钥完整性 / 外键 / Schema & 摘要 | `user_version=5`, `application_id=1263424577`, `integrity=ok`, `schemaAndDigestExactMatch=true` | 完全一致 |
| 10. 原始 disposable clone 源库逻辑零变化 | `originalSourceUnchanged = true` | `true` |

### 3.3 根据实测证据对 A 路线的客观重新评级

撤销 Round 1 将 A 路线一概标为 `NOT_SUPPORTED` 的结论，按实验 A 与实验 B 证据精确拆分为：

1. **A1 路线（`sqlcipher_export` + `DETACH` 前恢复 `user_version` / `application_id`）**：评级 **`SUPPORTED_WITH_CONSTRAINTS`**。
   - **已证明能力**：能在 `OPEN_READWRITE` 源库保留并发只读快照、排除并发未提交写、捕获未 checkpoint WAL 数据、恢复 `user_version`/`application_id`、完整保留表/索引/触发器/外键及逻辑摘要，并使用独立随机 DEK 生成跨连接可读且拒绝源 DEK 的加密副本。
   - **固有边界与工程成本**：① 不可在 `OPEN_READONLY` 上调用（[m6-02-native-probes-v1.md §7](m6-02-native-probes-v1.md#L165) 已证）；② `ATTACH` 在源 RW 连接非事务态执行；③ 导出的是物理库文件（含 3 张运行表，不会自动过滤运行表或应用 `pause-sending-v1` 投影）；④ 用于跨设备便携交付仍须在外部额外包裹口令派生的密钥封装与 AEAD/MAC 防篡改校验。
2. **A2 路线（Disposable `Clone + Checkpoint + Close + Copy + Rekey`）**：评级 **`SUPPORTED_OFFLINE_ONLY`**。
   - **已证明能力**：在能够排他停写、完成 `wal_checkpoint(TRUNCATE)`、关闭全部连接并核查 `-wal`/`-shm` 清除后，可通过字节复制 + `changePassword(newRawKey)` 生成拥有独立随机 DEK、完整元数据与一致逻辑摘要的副本。
   - **固有边界**：必须关闭全部源库连接，不适用于在线并发读写连接不关闭的场景；同样包含全部物理表且需外部便携封装层。
3. **对 M6-02 后续实验的结论**：A1 在后续 1k / 10k / 100k A/C 对照实验中具备了可实现的物理原型依据（作为 A 路线测试实现，配合 test-only 外封套验证跨设备打开），不再因误判缺失元数据恢复路径而跳过 A/C 实测对照。同时，M6-00 既定建议主线仍为 **Scheme C**（不修改已冻结设计输入）。

---

## 4. F08：KDF 安全加固与独立标准向量

### 4.1 缓冲区清理加固细节

在 [KanataM6N01CryptoProbeTest.java](androidTest/com/yubin/formyself/KanataM6N01CryptoProbeTest.java#L210-L355) 将原 `pbkdf2HmacSha256ZeroAlloc` 重构为 `pbkdf2HmacSha256ZeroAllocInto(..., byte[] out)`：
- 将 `fullBlock`（128 B）与所有中间状态（`keyBlock`, `padBlock`, `ipadMid`, `opadMid`, `state`, `w`, `u`, `t`, `firstMsg`）均纳入 `try/finally` 强制清零；
- 增加 `boolean completed = false`，仅在全部块完成且末尾再次校验 `cancelled` 未置位后才设为 `true`；`finally` 中若 `!completed` 则执行 **`Arrays.fill(out, 0, keyLen, (byte) 0)`**，防止在多块输出（`keyLen > 32`）的后续块取消/异常时把第 1 块部分派生密钥泄露给调用方；
- 入口先校验非空及合法参数（`iterations > 0`, `keyLen > 0`, `out.length >= keyLen`），不修改或污染无效参数场景下的缓冲区。

### 4.2 新增标准向量与取消清零实测（API 30 & API 34 + Node 对拍）

新增独立测试 `probeStandardPbkdf2VectorsAndFailureBufferWipe()`，与 `node:crypto.pbkdf2Sync` 及 Python `hashlib.pbkdf2_hmac` 逐字节对拍一致：

| 向量 ID | 输入摘要 | 预期 & Android/Node 实测 Hex |
| --- | --- | --- |
| `vec_0_c1_dk32` | `P="password"`, `S="salt"`, `c=1`, `dkLen=32` | `120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b` |
| `vec_1_c2_dk32` | `P="password"`, `S="salt"`, `c=2`, `dkLen=32` | `ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43` |
| `vec_2_c4096_dk32` | `P="password"`, `S="salt"`, `c=4096`, `dkLen=32` | `c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a` |
| `vec_3_c4096_dk40` | `P="passwordPASSWORDpassword"`, `S="saltSALTsalt..."(36B)`, `c=4096`, `dkLen=40` | `348c89dbcbd32b2f32d814b8116e84cf2b17347ebc1800181c4e2a1fb8dd53e1c635518c7dac47e9` |
| `vec_4_c4096_dk16` | `P="pass\0word"`, `S="sa\0lt"`, `c=4096`, `dkLen=16` | `89b69d0516f829893c696226650a8687` |
| `vec_5_c1000_dk48` | `P='A'*70 + '\0' + 'B'*10`（`81 B` > block 64B）, `c=1000`, `dkLen=48` | `5f1a8aa74130b6f114322e03286f836a18c4b3384f2c3cf4a9d94a3200db2eccf299dde4bac2020386b3daa7d443f62c` |

- **部分块写入后取消清理验证**（API 30 & API 34 均实测 PASS）：
  - 启动 `keyLen=64`（2 blocks）、`300,000` 次迭代后台任务，轮询确认 `outBuf[0..31]` 已写入非零 block 1 数据（`sawPartialBlock1WriteBeforeCancel = true`）后触发 `cancelled.set(true)`；
  - 捕获 `InterruptedException`，逐字节断言 64 字节 `outBuf` 全为 `0x00`（`outputBufferWipedAfterCancel = true`）。
- **M6-01 KAT 与性能复测（API 30 / API 34）**：
  - API 30：`OK (4 tests)` in `31.945s`；Zero-Alloc 600k 冷测 `1,020 ms`，热 5 轮 `[1084, 896, 709, 860, 922] ms`，取消延迟 `0 ms`，峰值 RSS `146,424 KiB`，Native Heap 增量 `~3.1 KB`；JCA SKF 600k `10,413 ms`。
  - API 34：`OK (4 tests)` in `116.441s`；Zero-Alloc 600k 冷测 `8,690 ms`，热 5 轮 `[3638, 4262, 5087, 4310, 5219] ms`，取消延迟 `2 ms`，峰值 RSS `64,724 KiB`，Native Heap 增量 `~3.1 KB`；JCA SKF 600k `15,725 ms`。

### 4.3 未来生产实现接口与清理规范要求

1. **禁止使用测试代码直接迁入生产**：当前实现仅位于 `androidTest`，未来进入生产 Native 数据面时须在受控 `src/main` 包中重构为独立组件并经安全与单测门禁验证。
2. **必须遵循的字节接口契约**：
   - 接收严格验证过的 UTF-8 `byte[] passwordBytes`（禁止接受经过隐式正规化、trim 或被 `PBEKeySpec(char[])` 截断的口令），参数校验先于状态分配；
   - 支持显式传入 `CancellationSignal` / `AtomicBoolean cancelled`，并在每 `<= 1024` 次内循环检查取消信号，确保取消响应在毫秒级。
3. **缓冲区与所有权生命周期**：
   - 严禁在 tight-loop 中调用 Android Conscrypt `Mac.getInstance("HmacSHA256").doFinal()`（已在 API 34 实测引发 Scudo `448`-byte size class 256 MiB OOM）；
   - 必须使用 caller-owned `byte[]` 输出或由统一 `try/finally` 在任何异常/取消路径下 `Arrays.fill(..., 0)` 清理**全部**密钥衍生状态（`keyBlock`、`padBlock`、`ipadMid`、`opadMid`、`state`、`w`、`u`、`t`、`firstMsg`、`fullBlock` 以及未完成 `out`）；
   - 调用方在将 `baseKEK` 喂给 `HKDF-SHA256` 完成 `wrapKey` 派生并退出租约后，同样必须立即在 `finally` 中清零 `passwordBytes` 与 `baseKEK`。

---

## 5. 全量验证与边界核查记录

- **Git Diff 边界核查**：`git diff --exit-code 43b26d6ec41929a59844bb62a882bdf578391192 -- src package.json package-lock.json android/app/src/main` 退出码 `0`（零差异）；`git diff --check` 退出码 `0`。
- **`npm run check`（`.worktrees/kanata-m5`）**：退出码 `0`（ESLint `0` errors / `61` warnings，Node 测试 `818/818` 通过，Vitest `45` 文件 `420/420` 通过，TypeScript `vue-tsc` + `tsc -p tsconfig.contracts.json` 与 Vite `build` 全绿）。
- **NOT_RUN / 未越界声明**：Android API 24 与 API 25 因无镜像与设备保持 `NOT_RUN`；N-03、N-04、C 路线完整导出、A/C 1k/10k/100k 性能对照及发行参数 `0x0001` 冻结均未启动。
