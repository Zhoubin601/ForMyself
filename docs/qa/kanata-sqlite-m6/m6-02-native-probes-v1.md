# Kanata SQLite M6-02 Native 前置探针报告 v1（Preflight / N-01 / N-02）

- **任务编号**：`KANATA-M6-02-START-2026-11-23`
- **任务书**：[docs/20261123-kanata-sqlite-m6-02-consistent-export-task-v1.md](../../20261123-kanata-sqlite-m6-02-consistent-export-task-v1.md)
- **执行分支 / 工作树**：`m6/encrypted-backup-recovery`（`.worktrees/kanata-m5`）
- **本轮范围**：`Preflight → N-01 → N-02`（严守阶段边界；`N-03`、`N-04`、`C` 路线完整导出与 `A/C` 性能对照均未实施）
- **日期**：2026-11-23（北京时间）

## 阶段总状态摘要

| 项目 | 状态 | 摘要说明 |
| --- | --- | --- |
| Git Preflight | **PASS** | `.worktrees/kanata-m5` 从 M6-01 签核基线 `43b26d6` fast-forward 同步至 `61ae25d`；核对 `43b26d6..61ae25d` 仅含文档变更，生产代码、Schema 与依赖清单零差异；主工作树保持未动。 |
| N-01（API 30 / API 34） | **PASS（API 30/34）；API 24/25 NOT_RUN** | Zero-Alloc 字节安全 PBKDF2 + HKDF + AES-256-GCM 与 `vectors-v1.json`（及 Node/WebCrypto）逐字节一致；**发现 P0 问题**：Conscrypt `Mac("HmacSHA256")` 600k 紧循环在 API 34 触发 Scudo 256 MiB OOM / LMK 崩溃，改用零分配 SHA-256 midstate 后 0 KiB RSS 增长且 0 ms 取消。API 24/25 因本地无镜像与 `sdkmanager` 标为 `NOT_RUN`。 |
| N-02（只读快照与物理原语） | **PASS（探测完成）；A 路线 `NOT_SUPPORTED`** | 核实 `sqlcipher-android:4.17.0` AAR 无 Online Backup Java/JNI API；`VACUUM INTO` 强制复用源 DEK；`sqlcipher_export` 在 `OPEN_READONLY` 失败且在 `OPEN_READWRITE` 丢失 `user_version` / `application_id`；`SQLiteDatabase.beginTransactionReadOnly()` 实际执行 `BEGIN EXCLUSIVE`；同包 `SQLiteSession.TRANSACTION_MODE_DEFERRED` 在独立 `OPEN_READONLY` 连接上可稳定固定 WAL 快照且不阻塞并发写入。 |
| N-03 / N-04 | **NOT_RUN** | 超出本轮授权范围，未实施，不提前标记 PASS。 |

---

## 1. 执行环境

### 1.1 宿主机与构建工具

- **操作系统**：Windows（Command Working Directory：`d:\2026Autumn Semester File\GitHub\formyself-app\.worktrees\kanata-m5`）
- **JDK**：OpenJDK 21.0.11 (`Microsoft-13877171`, `build 21.0.11+10-LTS`)
- **Node.js / npm**：通过 `npm run check` 验证（ESLint、Node test、Vitest、TypeScript、Vite）
- **Android SDK**：`E:\Android\Sdk`（已安装平台镜像：`android-30`、`android-31`、`android-34`、`android-37.0`；无 `cmdline-tools` / `sdkmanager`，无 `android-24` 或 `android-25` 系统镜像，无物理测试机连接）

### 1.2 实测 Android 设备/模拟器清单

| 目标环境 | API Level | Android 版本 | ABI (`ro.product.cpu.abilist`) | 模拟器 / 硬件 | WebView 版本 | 执行状态 |
| --- | --- | --- | --- | --- | --- | --- |
| Android API 24 | 24 | 7.0 | — | 无可用镜像/设备 | — | **`NOT_RUN`**（本地无 `android-24` 镜像及 `sdkmanager`） |
| Android API 25 | 25 | 7.1 | — | 无可用镜像/设备 | — | **`NOT_RUN`**（本地无 `android-25` 镜像及 `sdkmanager`） |
| `Codex_Todo_API30` | **30** | **11** | `x86_64,x86,arm64-v8a,armeabi-v7a,armeabi` | `sdk_gphone_x86_64` (`ranchu`, `-no-snapshot-save -read-only`) | `com.google.android.webview` `113.0.5672.136` (`567263637`) | **EXECUTED / PASS** |
| `Codex_Todo_WebView34` | **34** | **14** | `x86_64,arm64-v8a` | `sdk_gphone64_x86_64` (`ranchu`, `-no-snapshot-save -read-only`) | `com.google.android.webview` `113.0.5672.136` (`567263637`) | **EXECUTED / PASS** |

> 声明：API 30 与 API 34 实测结果仅代表对应 API Level，**不代替 Android API 24/25 低版本兼容证据**。

---

## 2. Git 基线

1. **起始检查**：
   - 主工作树位于 `main`（`41cbb66`），包含用户既有 `docs/` 与 `output/` 本地变更，全程未触碰。
   - 独立工作树 `.worktrees/kanata-m5` 初始位于 `m6/encrypted-backup-recovery` @ `43b26d6ec41929a59844bb62a882bdf578391192`（M6-01 最终签核代码基线）。
   - `git ls-remote origin refs/heads/m6/encrypted-backup-recovery` 返回 `61ae25df23f2acd3bdfa5142dc03e52207d15724`。
   - `git -C ".worktrees/kanata-m5" diff --exit-code 43b26d6..61ae25d -- src android` 退出码 `0`，确认 `43b26d6` 之后仅有 2 笔文档提交（`539c57e`、`61ae25d`），无任何未授权产品代码差异。
   - 执行 `git -C ".worktrees/kanata-m5" merge --ff-only origin/m6/encrypted-backup-recovery`，工作树快进至 `61ae25df23f2acd3bdfa5142dc03e52207d15724`，工作区干净。
2. **本轮新增/修改文件（全部隔离在测试与文档范围）**：
   - [android/app/build.gradle](../../../android/app/build.gradle)：新增 `kanataM6Synthetic` Gradle 属性（强制依赖 `kanataM2Synthetic=true` 方可开启），仅在开启时挂载 `docs/qa/kanata-sqlite-m6/androidTest` 与 `docs/qa/kanata-sqlite-m6/portable` 测试 assets。
   - [KanataM6N01CryptoProbeTest.java](androidTest/com/yubin/formyself/KanataM6N01CryptoProbeTest.java)：N-01 Native 密码学、KAT 逐字节对拍、UTF-8 边缘输入、资源/延迟基准与取消探针。
   - [KanataM6N02SnapshotProbeTest.java](androidTest/com/yubin/formyself/KanataM6N02SnapshotProbeTest.java)：N-02 SQLCipher API 反射/运行时检查、锁陷阱、`VACUUM INTO`、`sqlcipher_export`、WAL `DEFERRED` 一致性快照与 disposable clone 探针。
   - [KanataM6SqlCipherSessionProbe.java](androidTest/net/zetetic/database/sqlcipher/KanataM6SqlCipherSessionProbe.java)：仅用于测试探针的同包访问辅助类，暴露 `SQLiteSession.TRANSACTION_MODE_DEFERRED`。
   - 本文档 `docs/qa/kanata-sqlite-m6/m6-02-native-probes-v1.md`。
3. **非授权范围零变更证明**：生产 `src/`、`Schema 001–005`、`package.json`、`package-lock.json`、普通 APK `KANATA_M2_SYNTHETIC` 默认值（`false`）均未改动。

---

## 3. SQLCipher 依赖信息（Gradle 实际解析 + AAR 静态核查）

通过 `.\gradlew.bat --no-daemon :app:dependencies --configuration debugRuntimeClasspath` 与实际 Gradle 缓存 AAR 解包、`javap` 反编译和二进制符号扫描核实：

| 检查项 | 实际观测值 | 证据来源 |
| --- | --- | --- |
| Gradle 解析坐标 | `net.zetetic:sqlcipher-android:4.17.0`（+ `androidx.sqlite:sqlite:2.4.0`） | `:app:dependencies` |
| 本地缓存 AAR 路径 | `...\net.zetetic\sqlcipher-android\4.17.0\8d276dfa786834efe4bc299ccd63b4af921d301\sqlcipher-android-4.17.0.aar`（`4,007,507` 字节） | Gradle 缓存 |
| AAR SHA-256 | `44fc40c33d1de597c8339072a71fa0ff20e12d01ab352d6abe4ad5df668ead94` | `Get-FileHash` |
| 包含原生 ABI | `arm64-v8a` (2,100,040 B), `armeabi-v7a` (1,046,404 B), `x86` (2,244,588 B), `x86_64` (2,231,416 B) | AAR `jni/*/libsqlcipher.so` |
| 运行时 SQLCipher / SQLite 版本 | `4.17.0 community` / SQLite `3.53.3` / `hasCodec=true` | `PRAGMA cipher_version` / `sqlite_version()` |
| 加密底层 Provider / 页大小 | `libtomcrypt` `1.18.2` / `cipher_page_size = 4096` / WAL | `PRAGMA cipher_provider*` |
| `rawKey` 入口与语义 | `SQLiteDatabase.openDatabase(path, byte[] key, ...)` → `SQLiteConnection.nativeKey(ptr, byte[])`；[KanataKeyEnvelope.java](../../../android/app/src/main/java/com/yubin/formyself/KanataKeyEnvelope.java) 传入 67 字节 `x'<64 hex>'` 原始密钥字面量，跳过 SQLCipher 内置 PBKDF2，修改任意 hex 字节立即触发 `SQLiteException` 拒绝开库 | `javap` + N-02 实测 |
| `SQLiteConnection` JNI native 列表 | 仅 30 个 native 方法（`nativeKey`, `nativeReKey`, `nativeOpen`, `nativeClose`, `nativePrepareStatement`, `nativeExecute*`, `nativeCancel` 等）；**无任何 `nativeBackup*` / `sqlite3_backup_*` JNI 方法** | `javap -p SQLiteConnection` |
| `libsqlcipher.so` C 符号 | C 层含静态/内部符号 `sqlite3_backup_init/step/finish/remaining/pagecount` 与 `sqlcipher_export`；但 Java/JNI wrapper 未绑定 `sqlite3_backup_*` | ELF 二进制扫描 |

---

## 4. N-01 测试方案

1. **KAT 逐字节对拍源**：直接从 `androidTest` assets 读取 M6-01 冻结的 [vectors-v1.json](portable/vectors-v1.json)（口令 `" 合成📦 é \u0000\ufeff "`，覆盖前导/尾随空格、中文、补充平面 U+1F4E6、NFD 组合字符 `e\u0301`、内嵌 NUL `\u0000` 与 BOM `\ufeff`）。
2. **验证链条**：
   - 严格口令校验：先检查长度 `1..1024` 字符及合法 UTF-16 代理对，拒绝空串与 6 组孤立代理项（`""`, `"\uD800"`, `"\uDC00"`, `"abc\uD83D"`, `"\uDCE6xyz"`, `"\uDBFF\u0041"`），使用 `StandardCharsets.UTF_8.newEncoder()` 严检编码并限制 `1..1024` 字节。
   - `PBKDF2-HMAC-SHA256`（对比三条路径：Conscrypt `Mac("HmacSHA256")`、JCA `SecretKeyFactory("PBKDF2WithHmacSHA256")`、以及 **Zero-Alloc 预计算 HMAC `ipad`/`opad` SHA-256 midstate 纯字节实现**）。
   - `HKDF-SHA256`（基于 `Mac("HmacSHA256")` 按 RFC 5869 Extract + Expand）生成 `wrapKey`、`manifestKey`、`dataKey`、`footerKey`，核对与 `vectors-v1.json` 逐字节一致。
   - `AES-256-GCM`（`Cipher.getInstance("AES/GCM/NoPadding")` + `GCMParameterSpec(128, nonce)`）覆盖封套 W、`emptyPackage`（2,874 B）与 `populatedPackage`（3,461 B）的 Manifest/DATA/Footer 全部帧：**不仅解密，而且用相同输入重新加密并逐字节断言密文+16B Tag 与 `packageHex`、`prefixHex`、`manifestFrameHex`、`footerFrameHex`、`transcriptHex` 及整包 SHA-256 完全一致**。
   - 负向认证：验证错误 `wrapKey`、篡改密文 1 bit、篡改 16B Tag 1 bit、篡改 AAD 1 bit、篡改 Nonce 1 bit 均抛出 `AEADBadTagException`。
3. **Node / WebCrypto 交叉验证**：用 Node v24 `createNodeCryptoProvider()`（`node:crypto`）与 `createWebCryptoProvider()`（WebCrypto `subtle`）对 Android Native 计算的 5 组边缘 UTF-8 派生键（`nfcHex`, `nfdHex`, `nulHex`, `bomHex`, `astralChineseHex`）逐字节比对。
4. **性能与资源**：实测 `100,000` / `210,000` / `300,000` / `600,000` 候选迭代（1 次冷测 + 5 次 600k 热测），记录 `/proc/self/status` `VmRSS`、`Debug.getNativeHeapAllocatedSize()`、Java heap 与后台取消信号响应延迟。

---

## 5. N-01 原始结果

### 5.1 Provider 与 JCA 行为对照

| 项目 | API 30 (`Codex_Todo_API30`) | API 34 (`Codex_Todo_WebView34`) |
| --- | --- | --- |
| Security Providers | `AndroidNSSP@1.0; AndroidOpenSSL@1.0; CertPathProvider@1.0; AndroidKeyStoreBCWorkaround@1.0; BC@1.61; HarmonyJSSE@1.0; AndroidKeyStore@1.0` | `AndroidNSSP@1.0; AndroidOpenSSL@1.0; CertPathProvider@1.0; AndroidKeyStoreBCWorkaround@1.0; BC@1.68; HarmonyJSSE@1.0; AndroidKeyStore@1.0` |
| `Mac("HmacSHA256")` Provider | `AndroidOpenSSL v1.0` | `AndroidOpenSSL v1.0` |
| `Cipher("AES/GCM/NoPadding")` Provider | `AndroidOpenSSL v1.0` | `AndroidOpenSSL v1.0` |
| `SecretKeyFactory("PBKDF2WithHmacSHA256")` | `BC v1.61`（ASCII & M6-01 UTF-8+NUL 口令返回字节均匹配 `baseKekHex`） | `BC v1.68`（ASCII & M6-01 UTF-8+NUL 口令返回字节均匹配 `baseKekHex`） |

### 5.2 M6-01 KAT 与 Node/WebCrypto 逐字节对拍

- **KAT `vectors-v1.json`**：API 30 与 API 34 均对 `emptyPackage` (2,874 B, SHA-256 `1aff9f00...71cfb17c`) 和 `populatedPackage` (3,461 B, SHA-256 `16cbf8ec...f22e6130`) 全部分量（`baseKek` `5367e77e...76ed53b7`、`wrapKey`、`manifestKey`、`dataKey`、`footerKey`、`prefix`、各帧重加密密文与 Tag、transcript、5 组负向篡改 `AEADBadTagException`）**100% 逐字节通过**。
- **Node / WebCrypto 交叉验证（5 组边缘 UTF-8，1000 次迭代，salt `00..0f`）**：

| 用例 | 输入 | Android Native 输出 Hex | Node `node:crypto` & WebCrypto 对拍 |
| --- | --- | --- | --- |
| `nfcHex` | `"\u00e9"` (NFC) | `0b8803c12fd7fe90be6c02e3685bc97cbdc6e0c6202c39daf16ab175bd15e3ba` | **MATCH** |
| `nfdHex` | `"e\u0301"` (NFD) | `8167d96aa7e3312463d757ac270669928a331c7d0ffa779246b482da13649336` | **MATCH** |
| `nulHex` | `"a\u0000b"` | `f14d4674c3c9091adb73c268c3b5775fc506cd0b8167595b84d013ae3e47b6a6` | **MATCH** |
| `bomHex` | `"\ufeffabc"` | `14d3098bfe696b4dd7f94918294f1bd84c0997ca76c019cf7f813b6aa2a740a9` | **MATCH** |
| `astralChineseHex` | `"合成📦"` | `6da2b9fd40a0e405058adc478cd51215b9c84a5db6cf2cc5eaf4e22e6cee8596` | **MATCH** |

### 5.3 性能、内存与关键事故对比（候选参数对比，不冻结发行值）

#### A. Conscrypt `Mac("HmacSHA256")` 紧循环实测（已证存在原生内存隐患）

- **API 30**：600,000 次冷测 `10,204 ms`，候选测试后 `iter_600000_ms = 12,142 ms`（5 轮 `[9360, 9619, 8136, 7296, 7686]` ms），Native Heap 单轮前后波动达 `-11.0 MB` ~ `+9.9 MB`，进程峰值 RSS `174,948 KiB` (~170.8 MiB)。
- **API 34（进程崩溃）**：连续运行 600,000 次 PBKDF2 循环时，Conscrypt `OpenSSLMac` 每轮在 native 层分配 `448`-byte `HMAC_CTX` 并依赖 Java `Cleaner`/finalizer 释放，导致 `inuse: 598,601`、`mapped: 261,888 KiB`，触发 **`scudo : Scudo OOM: The process has exhausted 256M for size class 448`**，并随即引发 **`lowmemorykiller: Kill 'com.yubin.formyself.m2qa' ... to free 1043172kB rss, 1091932kB swap`**（`SIGKILL`）。

#### B. Zero-Alloc 字节安全 PBKDF2（预计算 `ipad`/`opad` SHA-256 midstate）vs JCA `SecretKeyFactory`

| 指标 | API 30 (`Codex_Todo_API30`) | API 34 (`Codex_Todo_WebView34`) |
| --- | --- | --- |
| **100,000 次**耗时 / RSS 增量 / Native 增量 | `138 ms` / `-812 KiB` / `+2,128 B` | `420 ms` / `-3,400 KiB` / `-1,185,600 B` |
| **210,000 次**耗时 / RSS 增量 / Native 增量 | `297 ms` / `0 KiB` / `+3,120 B` | `862 ms` / `-76 KiB` / `+3,024 B` |
| **300,000 次**耗时 / RSS 增量 / Native 增量 | `332 ms` / `0 KiB` / `+2,992 B` | `1,268 ms` / `0 KiB` / `+3,120 B` |
| **600,000 次冷测**耗时 | `718 ms` | `2,524 ms` |
| **600,000 次热测**（单独一轮 / 5 轮原始值） | `768 ms` / `[706, 685, 719, 726, 721]`（中位 `719 ms`，最小 `685 ms`，最大 `726 ms`） | `2,511 ms` / `[2504, 2451, 2474, 2490, 2631]`（中位 `2,490 ms`，最小 `2,451 ms`，最大 `2,631 ms`） |
| **600,000 次** RSS 增量 / Native / Java Heap 增量 | `0 KiB` / `+3,056 B` / `+20,480 B` | `0 KiB` / `+3,120 B` / `+20,480 B` |
| **JCA `SecretKeyFactory` 600k 对照耗时** | `5,371 ms`（慢 ~7.4x，且不可中途取消） | `8,359 ms`（慢 ~3.3x，且不可中途取消） |
| **Zero-Alloc 600k 取消响应延迟** | `0 ms` | `0 ms` |
| **进程测试结束峰值 RSS / Native Heap** | `146,792 KiB` (~143.4 MiB) / `4,557,840 B` | `112,704 KiB` (~110.1 MiB) / `4,985,536 B` |

> 注：以上均运行在 x86_64 模拟器；实体低端 ARM 设备（尤其 API 24/25）耗时需按真机再校准，**600,000 次仍为待校准候选参数，未冻结为生产发行 profile**。

---

## 6. N-02 API 调查（Java/JNI 源码反编译 + 真实行为核查）

通过 `javap -c -p` 反编译 `sqlcipher-android-4.17.0.aar` 的 `classes.jar`，核实以下关键实现事实：

1. **Online Backup API**：`SQLiteDatabase`、`SQLiteConnection`、`SQLiteSession`、`SupportHelper` 均未提供任何 `sqlite3_backup_*` 绑定或 Java wrapper。
2. **`SQLiteDatabase.beginTransactionReadOnly()` 真实行为**：字节码仅 2 条指令，直接调用 `this.beginTransaction()` → `beginTransaction(null, true)` → `SQLiteSession.beginTransaction(TRANSACTION_MODE_EXCLUSIVE = 2, null, CONNECTION_FLAG_PRIMARY_CONNECTION_AFFINITY = 2, null)`，即**实际开启 `BEGIN EXCLUSIVE` 写事务并独占主连接**，并非只读或 `DEFERRED` 事务。
3. **`execSQL("BEGIN DEFERRED")` vs `rawExecSQL("BEGIN DEFERRED")` 陷阱**：
   - `execSQL(...)` 经过 `SQLiteSession.executeSpecial()`：遇到 `DatabaseUtils.getSqlStatementType(sql) == 4`（`STATEMENT_BEGIN`）时**强行拦截并硬编码调用 `beginTransaction(2 /* EXCLUSIVE */, ...)`**，因此 `execSQL("BEGIN DEFERRED")` 同样变成 `BEGIN EXCLUSIVE`。
   - `rawExecSQL(...)` 走 `SQLiteSession.executeRaw()`，绕过 `executeSpecial()`：虽然会把 `"BEGIN DEFERRED"` 送到某个连接，但 `SQLiteSession.mTransactionStack` 保持为 `null`，执行完当句立即 `releaseConnection()` 将处于悬空事务状态的连接放回连接池，`db.endTransaction()` 抛出 `IllegalStateException: no current transaction`。
4. **`SQLiteConnectionPool.waitForConnection()` 主连接抢占行为**：当 `mAvailablePrimaryConnection != null && mAvailableNonPrimaryConnections.isEmpty()` 时，即使传入 `readOnly = true`（`wantPrimaryConnection = false`），连接池也会**优先把唯一的主连接分配给只读请求**。一旦同池只读事务持有该连接，该 `SQLiteDatabase` 实例上的后续写入请求将被主连接等待阻塞。
5. **真正的 `DEFERRED` 只读事务入口**：`SQLiteSession.beginTransaction(SQLiteSession.TRANSACTION_MODE_DEFERRED /* 0 */, ...)` 在字节码中完整保留（发出 `"BEGIN;"` 并把连接 pin 在 `SQLiteSession.mConnection` 直至 `endTransaction()`），但 `SQLiteDatabase.getThreadSession()` 为 `net.zetetic.database.sqlcipher` 包级私有，Java 公开 API 未暴露 `beginTransactionDeferred()`。

---

## 7. N-02 实际测试（API 30 与 API 34 双平台实测均 PASS）

| 探测项 | API 30 实测结果 | API 34 实测结果 | 关键结论 |
| --- | --- | --- | --- |
| `beginTransactionReadOnly()` 并发写 | `SQLiteDatabaseLockedException: database is locked (code 5)` | 同左 | 实证为 `BEGIN EXCLUSIVE` 阻塞写入 |
| `execSQL("BEGIN DEFERRED")` | `sessionHasTx=true`，并发写被阻塞 (`code 5`) | 同左 | 实证被 `executeSpecial` 强转为 `BEGIN EXCLUSIVE` |
| `rawExecSQL("BEGIN DEFERRED")` | `sessionHasTx=false, sessionHasConn=false` | 同左 | 实证连接未 pin，悬空释放回池（`endTransaction()` 曾实测抛 `no current transaction`） |
| `VACUUM INTO ?` | `executed=true`，非明文头，明文 SQLite 拒读 (`SQLITE_NOTADB`)，源 DEK 可读（保留 `user_version=5`, `application_id=1263424577`） | 同左 | **强制继承源 DEK**，不支持独立随机测试 DEK |
| `sqlcipher_export()` 于 `OPEN_READONLY` | `FAILED: SQLiteException: invalid target database exp_ro (code 1)` | 同左 | **在只读连接上不可调用** |
| `sqlcipher_export()` 于 `OPEN_READWRITE` 非事务态 | `SUCCEEDED`；新 DEK 可开且拒绝源 DEK；包含未 checkpoint WAL 行；但 **`targetUserVersion="0"`, `targetAppId="0"`** | 同左 | 需 RW 连接与 `ATTACH`，且**静默丢失 `user_version` 与 `application_id`** |
| Disposable clone (`freeze -> checkpoint(TRUNCATE) -> close -> verify sidecars -> copy`) | `checkpointBusy=0`，关闭后 `-wal` / `-shm` 不存在 (`0 B`)，复制体用源 DEK 打开 `integrity=ok`、`user_version=5`、`app_id=1263424577`，但 **`copyRetainsSourceDekWithoutRekey=true`** | 同左 | 必须停写、checkpoint 并关闭全部源连接；裸复制仍携带源 DEK（不经二次打开+`rekey` 无法换用独立 DEK） |

---

## 8. WAL 一致性结果（API 30 与 API 34 实测完全一致）

使用隔离合成 WAL 库（`wal_autocheckpoint=0`，跨表结构 `probe_worlds` + `probe_messages` + 触发器派生 `probe_entity_ids`，均带 `tx_epoch` 字段）：

1. **初始 WAL 事务**：Writer 提交 T1 (`epoch=1`) 后不 checkpoint，`-wal` 达 `98,912` 字节。
2. **固定快照**：独立 `OPEN_READONLY` 连接 `roConn` 通过 `SQLiteSession.TRANSACTION_MODE_DEFERRED` + 首条 `SELECT` 固定 WAL 读视图，读到 `worlds=2:1`、`messages=2:1`、`entities=2:1`。
3. **只读保护**：在 `roConn` 内尝试 `INSERT`，立即被拒绝：`SQLiteException: Cannot execute this statement because it might modify the database but the connection is read-only.`。
4. **并发已提交 + 未提交 + Checkpoint 隔离**：
   - 在 `roConn` 保持 `DEFERRED` 事务期间，Writer 在 `db` 上提交跨表事务 T2 (`epoch=2`)，耗时仅 `10 ms` (API 30) / `4 ms` (API 34)，**完全不被只读快照阻塞**。
   - Writer 执行 `PRAGMA wal_checkpoint(TRUNCATE)`，立即返回 **`busy=1, log=30, checkpointed=24`**，证明 `roConn` 真实 pin 住了 WAL 快照帧。
   - 第三线程开启未提交写事务 T3 (`epoch=3`) 插入半截数据后挂起等待（最终回滚）。
   - `roConn` 在**同一个只读事务**内继续读取 `sqlite_schema`、3 张业务/派生表计数与 `tx_epoch`，**全部稳定维持 `2:1`**（零 T2、零 T3、零跨表混合状态）。
   - 并发第二只读连接 `ro2` 开启新 `DEFERRED` 事务，读到 `3:2`（已提交 T2，不含未提交 T3）。
5. **释放与回收**：`roConn.endTransaction()` 后开启新 `DEFERRED` 事务立即读到 `3:2`；随后 `PRAGMA wal_checkpoint(TRUNCATE)` 返回 **`busy=0`**。
6. **取消与重开**：`CancellationSignal.cancel()` 触发 `OperationCanceledException`，随后 `roConn` 保持健康可用。
7. **同池 vs 独立只读连接对照**：在同一个 `SQLiteDatabase` 实例上持有一个 `DEFERRED` 读事务时，由于 `SQLiteConnectionPool` 优先将主连接配给读请求，同池后续 writer 被阻塞 (`samePoolReaderGrabsPrimaryAndBlocksWriter=true`)。**因此 C 路线应使用独立的 `OPEN_READONLY` 连接实例（配合 `SQLiteSession.TRANSACTION_MODE_DEFERRED`）持有只读快照，而非与业务 writer 共享同一个 `SQLiteDatabase` 连接池。**

---

## 9. A 路线可行性判断

依据任务书第 5.2 与 5.4 节的全部安全与一致性约束，判定如下：

**A 路线结论：`NOT_SUPPORTED`（在本阶段冻结约束下不支持）**。

实测否定依据（非推测）：
1. **无 Online Backup API**：`net.zetetic:sqlcipher-android:4.17.0` Java/JNI wrapper 未暴露 `sqlite3_backup_init/step/finish`。
2. **`VACUUM INTO` 不支持独立密钥**：虽然可运行，但强制继承源 DEK，违反“目标副本必须使用独立随机 DEK 且不携带源 DEK”的约束。
3. **`sqlcipher_export()` 不可用于只读快照且丢失库头元数据**：在 `OPEN_READONLY` 上调用直接失败；在 `OPEN_READWRITE` 上虽可写新密钥目标库，但丢失 `PRAGMA user_version` (`0`) 与 `PRAGMA application_id` (`0`)，且要求源库处于读写非事务 `ATTACH` 态。
4. **Disposable clone（`freeze -> checkpoint -> close all -> verify sidecars -> copy`）无法满足在线与密钥隔离要求**：必须关闭源库全部连接（不可在活跃 WAL 下复制），且裸复制文件仍保留源 DEK（不进行二次打开并执行完整数据库 `PRAGMA rekey` 无法获得独立随机 DEK）。

因此，**M6-02 后续实现应聚焦于已证实可行且满足 WAL 只读一致性与密钥隔离的 Scheme C（Native 只读 `DEFERRED` 逻辑快照 + KPB1 分块导出）**。

---

## 10. 发现的问题（按 P0/P1/P2 分类）

- **P0 — Conscrypt `Mac("HmacSHA256")` 在 Android 14 (API 34) 上 600k PBKDF2 循环触发 Scudo Native OOM 崩溃**
  - **证据**：API 34 实测日志 `I scudo : Scudo OOM: The process has exhausted 256M for size class 448` (`inuse: 598601`) 及 `I lowmemorykiller: Kill 'com.yubin.formyself.m2qa' ... to free 1043172kB rss, 1091932kB swap`。
  - **原因**：`AndroidOpenSSL` Conscrypt 的 `OpenSSLMac` 每次 `doFinal()` 在 C 层分配 `HMAC_CTX` 并交由 Java `Cleaner`/finalizer 延迟回收，紧循环下回收远慢于分配。
  - **对策**：C 路线 Native KDF 禁止直接用 `javax.crypto.Mac("HmacSHA256")` 紧循环跑数十万次迭代，应采用已验证的 **Zero-Alloc 预计算 `ipad`/`opad` SHA-256 midstate 字节实现**（或经向量+资源验证的原生 C/JNI 一次调用）。
- **P1 — `sqlcipher-android:4.17.0` 的 `SQLiteDatabase.beginTransactionReadOnly()` 实际执行 `BEGIN EXCLUSIVE`，且 `execSQL("BEGIN DEFERRED")` 被强转为 `BEGIN EXCLUSIVE`**
  - **证据**：`classes.jar` `javap -c` 字节码 + `LOCK_TRAPS` 实测（`SQLiteDatabaseLockedException: database is locked (code 5)`）。
  - **对策**：C 路线不得调用 `beginTransactionReadOnly()` 或 `execSQL`/`rawExecSQL("BEGIN DEFERRED")`，必须通过独立 `OPEN_READONLY` `SQLiteDatabase` 实例结合 `net.zetetic.database.sqlcipher` 包内受控适配调用 `SQLiteSession.beginTransaction(TRANSACTION_MODE_DEFERRED, ...)` 并在首条 `SELECT` 后核对已固定视图。
- **P1 — `SQLiteConnectionPool.waitForConnection()` 在无空闲非主连接时会将 `mAvailablePrimaryConnection` 分配给只读请求**
  - **证据**：`SQLiteConnectionPool.class` 字节码行 36–65 + `WAL_SNAPSHOT_PROBE` (`samePoolReaderGrabsPrimaryAndBlocksWriter: true`)。
  - **对策**：C 路线导出必须使用独立的 `OPEN_READONLY` 连接实例，避免与业务读写 `SQLiteDatabase` 共用同一个连接池。
- **P2 — `sqlcipher_export()` 会静默丢失 `user_version` 与 `application_id`**
  - **证据**：`SQLCIPHER_EXPORT_PROBE` 输出 `targetUserVersion: "0"`, `targetAppId: "0"`（源库为 `5` 与 `1263424577`）。
  - **对策**：仅影响实验 A，已作为否定 A 路线证据归档。

---

## 11. BLOCKED / NOT_RUN 项

| 项目 | 状态 | 原因与补充条件 |
| --- | --- | --- |
| Android API 24 / API 25 N-01 & N-02 实测 | **`NOT_RUN`** | 本地 SDK 无 `android-24`、`android-25` 系统镜像，且无 `cmdline-tools`/`sdkmanager` 及对应实体机；需要配置 API 24/25 镜像或真机后补跑 `KanataM6N01CryptoProbeTest` 与 `KanataM6N02SnapshotProbeTest`。 |
| N-03（长行、CursorWindow、JNI、Bridge 与有界内存） | **`NOT_RUN`** | 超出本轮 `Preflight → N-01 → N-02` 范围，待下一阶段授权执行。 |
| N-04（SAF / Share / Activity 生命周期） | **`NOT_RUN`** | 超出本轮范围，待下一阶段授权执行。 |
| C 路线完整导出与 1k/10k/100k A/C 性能对照 | **`NOT_RUN`** | 超出本轮范围，待用户与 GPT-6 审查本报告后授权启动。 |
| 发行参数 `0x0001` 冻结 | **`BLOCKED`** | 仍受 API 24/25 实测与 N-03 有界内存实测约束，600,000 次仅为候选测试参数。 |

---

## 12. 质量与构建回归记录（本轮工作树 `.worktrees/kanata-m5`）

- `npm run check`（ESLint + Node 测试 + Vitest + TypeScript + Vite 构建）：**退出码 0**（Node `818/818` 通过，Vitest `45` 文件 `420/420` 通过，ESLint `0` 错误 / `61` 既有告警）。
- 标准 Android 构建（无 synthetic 标志，等价 CI 构建）：`.\gradlew.bat --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest` — 验证通过后登记于本次交付汇报。
- 隔离 M6 探针构建：`.\gradlew.bat --no-daemon -PkanataM2Synthetic=true -PkanataM6Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest` — 编译通过并在 API 30 (`80.321s` / `18.829s`) 与 API 34 (`38.316s` / `1.001s`) 上运行 `OK (2 tests)`。

---

## 13. 后续建议

1. **向用户和 GPT-6 汇报**：确认本轮核心结论——**A 路线在当前 SQLCipher 4.17.0 AAR 下 `NOT_SUPPORTED`，C 路线底层密码学（Zero-Alloc PBKDF2 + HKDF + AES-GCM）与 `OPEN_READONLY` + `TRANSACTION_MODE_DEFERRED` WAL 快照原语均已实测可行**。
2. **下一阶段授权请求**：
   - 批准基于 **Scheme C（Zero-Alloc PBKDF2 + 独立 `OPEN_READONLY` `TRANSACTION_MODE_DEFERRED` 快照）** 启动 **N-03（长字段/262145/2MiB/CursorWindow 有界读取）** 与 **N-04（SAF/Share/生命周期）** 探针；
   - 明确是否需要在本机补充下载 `android-24` / `android-25` 系统镜像（或接入 API 24/25 实体机）以消除低 API `NOT_RUN` 缺口后再冻结 `0x0001` 发行 KDF 参数。
