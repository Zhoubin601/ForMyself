# Kanata SQLite M6-02 Native 全阶段探针报告 v1（Preflight / N-01 / N-02 / N-03 / N-04）

- **任务编号**：`KANATA-M6-02-INDEPENDENT-AUDIT-REMEDIATION-2026-11-23`（基于 `KANATA-M6-02-END-TO-END-2026-11-23` 整改）
- **任务书**：[docs/20261123-kanata-sqlite-m6-02-consistent-export-task-v1.md](../../20261123-kanata-sqlite-m6-02-consistent-export-task-v1.md)
- **执行分支 / 工作树**：`m6/encrypted-backup-recovery`（`.worktrees/kanata-m5`）
- **本报告覆盖**：`Preflight → N-01 → N-02 → Round 2.1 → N-03 → N-04` 全部 Native 探针及 API 24/25/30/34 兼容性实测（A/C 基准与 F02 故障注入分别详见 [m6-02-ac-export-report-v1.md](m6-02-ac-export-report-v1.md) 与 [m6-02-final-report-v1.md](m6-02-final-report-v1.md)）
- **日期**：2026-11-24（北京时间）

## 阶段总状态摘要

| 项目 | 状态 | 摘要说明 |
| --- | --- | --- |
| Git Preflight | **PASS** | 从 `43b26d6` → `38d0b6b` 审计基线延续整改，始终保持生产 `src/`、`package.json`、`package-lock.json` 与 `android/app/src/main/` 零变更；主工作树保持未动。 |
| N-01（API 24 / 25 / 30 / 34） | **4 平台全 PASS** | Zero-Alloc 字节安全 PBKDF2 + HKDF + AES-256-GCM 与 `vectors-v1.json` 及 Node/WebCrypto 逐字节一致；实证 API 24/25 JCA 无 `PBKDF2WithHmacSHA256`（`NoSuchAlgorithmException`），均无缝由 Zero-Alloc 实现兜底并 0–1 ms 响应取消。 |
| N-02（只读快照、A 路线复核与跨端） | **4 平台全 PASS** | `sqlite3_backup_*` 为 `NOT_SUPPORTED`；`VACUUM INTO` 不支持独立密钥 (`NOT_SUPPORTED`)；A1 (`sqlcipher_export + 元数据恢复 + 独立密钥`) 实证 **技术可行但不入选 (`FEASIBLE_AS_BLOCKING_SQLCIPHER_EXPORT / NOT_SELECTED`)**；A2 归类为 `OFFLINE_ONLY / NOT_SELECTED`。API 34 导出之 A1/A2 库已成功在 API 30、API 25、API 24 上跨版本打开并校验全表摘要。 |
| N-03（长字段 / 有界内存 / Bridge） | **API 30/34 PASS；API 24/25 部分 BLOCKED** | CursorWindow 2 MiB/3.9 MiB/4 MiB 预分配拒绝与 Scheme C 流式边界在 **API 24/25/30/34 均 PASS**；真实 `KanataM6SyntheticPortablePlugin` 通过不透明句柄驱动真实 `KanataM6SchemeCExporter` 并在 API 30/34 **PASS**；API 24/25 预装 System WebView 为 Chromium `52.0.2743.100`，低于 Capacitor 8 内核最低要求（`55`/默认 `60`），`window.Capacitor` 未注入导致 Bridge 用例在原厂镜像上诚实 **BLOCKED/FAIL**。 |
| N-04（真实 SAF / Share / Activity 生命周期 / 进程强杀） | **4 平台全 PASS** | 真实 `DocumentsProvider` + 系统 `DocumentsUI` (`ACTION_CREATE_DOCUMENT` / `ACTION_OPEN_DOCUMENT` / OS 授权撤权 / 短读 / 故障)、真实 `ACTION_SEND` + 系统分享 + 独立 `:m6sharerecv` 接收校验与清理、真实 `KanataM6LifecycleController` 自动关库与 epoch 撤销、独立 `:m6worker` 调用真实 `KanataM6SchemeCExporter.exportToSpool()` 并在 `KDF` / `DB_READ` / `SPOOL_WRITE` / `COMMIT` 4 阶段真 `SIGKILL` 后重启恢复清理——**在 API 24、25、30、34 全部 PASS**。 |

---

## 1. 执行环境

### 1.1 宿主机与构建工具

- **操作系统**：Windows（Command Working Directory：`d:\2026Autumn Semester File\GitHub\formyself-app\.worktrees\kanata-m5`）
- **JDK**：OpenJDK 21.0.11 (`Microsoft-13877171`, `build 21.0.11+10-LTS`)
- **Node.js / npm**：通过 `npm run check` 验证（ESLint、Node test、Vitest、TypeScript、Vite）
- **Android SDK**：`E:\Android\Sdk`（已安装 `cmdline-tools/latest`、`platforms/android-24`、`platforms/android-25`、`system-images/android-24/default/x86_64`、`system-images/android-25/default/x86_64`、API 30、API 34；并通过 `avdmanager.bat` 建立独立低版本模拟器 `Codex_Kanata_API24` 与 `Codex_Kanata_API25`）

### 1.2 实测 Android 设备/模拟器清单

| 目标环境 | API Level | Android 版本 | ABI (`ro.product.cpu.abilist`) | 模拟器 / 硬件 | WebView 版本 | 执行状态 |
| --- | --- | --- | --- | --- | --- | --- |
| `Codex_Kanata_API24` | **24** | **7.0** | `x86_64,x86` | `Android SDK built for x86_64` (`Android/sdk_phone_x86_64/generic_x86_64:7.0/NYC/4174735`) | `com.android.webview` `52.0.2743.100` (`275610060`) | **EXECUTED (18/19 PASS, N-03 Bridge BLOCKED on WebView 52.0)** |
| `Codex_Kanata_API25` | **25** | **7.1.1** | `x86_64,x86` | `Android SDK built for x86_64` (`Android/sdk_phone_x86_64/generic_x86_64:7.1.1/NYC/4931657`) | `com.android.webview` `52.0.2743.100` (`275610060`) | **EXECUTED (18/19 PASS, N-03 Bridge BLOCKED on WebView 52.0)** |
| `Codex_Todo_API30` | **30** | **11** | `x86_64,x86,arm64-v8a,armeabi-v7a,armeabi` | `sdk_gphone_x86_64` (`google/sdk_gphone_x86_64/generic_x86_64_arm64:11/RSR1.240422.006/12134477`) | `com.google.android.webview` `113.0.5672.136` (`567263637`) | **EXECUTED / 19/19 PASS + Bench 3/3 PASS** |
| `Codex_Todo_WebView34` | **34** | **14** | `x86_64,arm64-v8a` | `sdk_gphone64_x86_64` (`google/sdk_gphone64_x86_64/emu64xa:14/UE1A.230829.050/12077443`) | `com.google.android.webview` `113.0.5672.136` (`567263637`) | **EXECUTED / 19/19 PASS + Bench 3/3 PASS** |

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

## 9. A 路线可行性结论复核（区分机制不可用与“可行但不入选”）

依据任务书第 5.2 与 5.4 节的全部安全与一致性约束，以及 Round 2.1 + 独立审计整改实验结果，**禁止把已跑通的功能笼统标为 `NOT_SUPPORTED`**，必须按子路线精确分类：

| 子路线 | 机制 / 合同逐项核对 | 复核结论 |
| --- | --- | --- |
| **A0a：`sqlite3_backup_*` Online Backup JNI API** | `net.zetetic:sqlcipher-android:4.17.0` Java/JNI 未暴露 `sqlite3_backup_init/step/finish`。 | **`NOT_SUPPORTED`**（底层未暴露） |
| **A0b：`VACUUM INTO` 独立密钥导出** | `VACUUM INTO` 可生成加密快照，但强制继承源 DEK，无法在导出流中使用独立随机密码/DEK。 | **`NOT_SUPPORTED`**（不支持独立目标密钥） |
| **A1：`sqlcipher_export` + 元数据恢复 + 独立密钥** | 1. 在读写非事务 `ATTACH ... KEY` 下可运行，补充 `PRAGMA user_version=5` 与 `application_id=1263424577` 后满足冻结 Schema 005 结构与 50 表摘要（`F07_EXP_A_SQLCIPHER_EXPORT_META` PASS）。<br>2. API 34 导出之 `m6_cross_api_a1.db` (`1,245,184 B`) 在 **API 30、API 25、API 24** 上均可正常打开且全表摘要 `2e42a681...` 一致 (`CROSS_API_A1_A2` PASS)。<br>3. 但 A1 不符合页面级非阻塞快照定义，整个导出期阻塞源库写入（100k 下 API 34 中位 `4,425 ms` / API 30 `2,424 ms`），携带 3 张内部运行表且不应用 `pause-sending-v1`，产物为 SQLCipher 专有格式而非 `KPB1`。 | **`FEASIBLE_AS_BLOCKING_SQLCIPHER_EXPORT / NOT_SELECTED`**（技术可运行、可跨 API 打开，但因全周期阻塞写入与缺少 `KPB1`/运行表过滤而不选作在线主路线） |
| **A2：Disposable Clone (`freeze -> drain -> checkpoint -> close all -> verify sidecars -> copy -> rekey`)** | 1. 严格执行离线维护合同可在独立副本与 `PRAGMA changePassword` 后实现独立密钥并通过全表校验（`F07_EXP_B` PASS）。<br>2. API 34 之 `m6_cross_api_a2.db` (`1,277,952 B`) 在 **API 30 / 25 / 24** 跨端打开全表摘要一致。<br>3. 必须独占停写并关闭所有源库连接，`PRAGMA rekey` 亦不支持中途取消。 | **`OFFLINE_ONLY / NOT_SELECTED`**（仅限离线维护基线，不可替代在线导出主路线） |

综上，**Scheme C（Native 只读 `OPEN_READONLY` + `TRANSACTION_MODE_DEFERRED` 逻辑快照 + `KPB1` 流式导出）为唯一满足在线低阻塞写入（`5–20 ms`）、独立密钥、运行表剔除、`pause-sending-v1` 投影与可中断流式导出的选中主路线（`SELECTED`）。**

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

## 11. N-03 长字段、CursorWindow、Bridge 与有界内存验证（API 30/34 PASS；API 24/25 长字段 PASS、Bridge BLOCKED on WebView 52.0）

对应 [KanataM6N03BoundedMemoryTest.java](androidTest/com/yubin/formyself/KanataM6N03BoundedMemoryTest.java)、[KanataM6BoundedRowReader.java](syntheticDebug/java/com/yubin/formyself/KanataM6BoundedRowReader.java) 与 [KanataM6SyntheticPortablePlugin.java](syntheticDebug/java/com/yubin/formyself/KanataM6SyntheticPortablePlugin.java)。

### 11.1 N-03 必须回答的 7 项问题实证核对

| 核对问题 | 实证结论 | 源码与实测依据 |
| --- | --- | --- |
| 1. 是否存在整行一次性加载？ | **否（在读取超限或超大列前截断/分块）** | `KanataM6BoundedRowReader.buildSelectSql()` 先查询 `length(CAST(col AS BLOB))`；仅 `<= 262,144` B 的列随主游标以 `BLOB` 内联读取，`> 262,144` B 的列在主游标返回 `NULL` 并二次使用 `substr(CAST(col AS BLOB), offset1Based, 262144)` 按 256 KiB 分块读取，避免依赖 CursorWindow 整行膨胀。 |
| 2. 是否存在整库 Base64 转换？ | **否** | Scheme C 全程使用 `ByteBuffer` / `byte[]` 流式写入 AES-GCM 密文与 `FileOutputStream` spool，零整库/整包 Base64 字符串转换。 |
| 3. Bridge 是否真实驱动导出且仅传输小控制消息？ | **是（API 30/34 PASS）** | `KanataM6SyntheticPortablePlugin` 经由不透明句柄 (`m6-job-*`) 调用真实 `KanataM6SchemeCExporter.exportToSpool()` 并通过 `ImportAndVerifyToIsolatedTarget` 校验真实导出包 (`finalFileBytes=55,072`, `tablesDone=45`, `dataFrames=1`)；`controlCancelExport` 真实触发 `AtomicBoolean`/`CancellationSignal` 中止导出演算（`poll2.state="CANCELLED"`, `errorCode="CANCELLED"`）；`observedMaxBridgeBytes = 8,220 B`，重复/过期/超限请求全拒绝（`rejectedOversizeCalls=1`, `rejectedStaleOrDuplicateCalls=5`）。 |
| 4. 单行缓冲区是否有明确上限？ | **是** | 严格强制单列 TEXT 上限 `2,097,152 B`（2 MiB）与单行体上限 `4,194,304 B`（4 MiB），且一次仅驻留最多 1 个编码行缓冲。 |
| 5. 最大在途 DATA 帧数量是否受控？ | **是（实测 `maxInFlightFrames=2`）** | `KanataM6SchemeCExporter.FramePipeline` 采用 1 帧前瞻写管线，`65,536 B`（64 KiB）`DATA` 帧上限，API 24/25/30/34 实测均 `maxInFlightFrames = 2`（含正在加密发射与前瞻缓存，满足 `<= 2` 帧 + `1` 行约束）。 |
| 6. Native Heap、Java Heap、JS Heap 与 RSS 是否均有记录？ | **是** | 见下表 11.2 实测值（`/proc/self/status` `VmRSS`/`VmHWM`、`Debug.getNativeHeapAllocatedSize()`、Java `totalMemory()-freeMemory()` 及 WebView `performance.memory`）。 |
| 7. 超限时是否能在大规模分配之前拒绝？ | **是** | 写入 `> 2 MiB` TEXT 与 `> 4 MiB` 行数据时，`KanataM6BoundedRowReader` 在检查 `length(CAST(col AS BLOB))` 阶段即抛出 `RESOURCE_LIMIT`（`col-text-limit:messages.content`、`row-body-size:card_versions`），未分配任何 multi-MiB 行缓冲区。 |

### 11.2 长字段边缘字符、SQLCipher UTF-16 BOM 陷阱与四平台实测数据

> [!IMPORTANT]
> **实证发现的字符与运行时陷阱（已修复并纳入测试）**：
> 1. **SQLCipher `nativeBindString` / `sqlite3_bind_text16` 静默剥离前导 `U+FEFF` BOM**：直接绑定含前导 `\ufeff` 的 2 MiB 字符串进 SQLite 时，`length(CAST(col AS BLOB))` 会从 `2,097,152 B` 静默缩短为 `2,097,149 B`；Android `new String(bytes, UTF_8)` 及 ICU `CharsetDecoder` 在解码前导 UTF-8 BOM (`EF BB BF`) 时也会丢弃前导 BOM。Scheme C 导出端通过 `CAST(col AS BLOB)` + `KanataM6PortableCrypto.decodeStrictUtf8()`（逐字节 RFC 3629 UTF-8 校验解码器）保留前导 BOM；导入端通过 `CAST(? AS TEXT)` + `SQLiteStatement.bindBlob(...)` 实现 2 MiB 前导 BOM 数据**精确 2,097,152 B 逐字节往返无损**。
> 2. **262,144 / 262,145 与嵌入式 NUL / 补充平面边界**：`Cursor.getString()` 在包含嵌入 `\u0000` 与正好 `262,144` / `262,145` 边界时经 `CAST(... AS BLOB)` 256 KiB 分块读取完整保留（总产出 `155` 个 `DATA` 帧、最大行体 `3,900,064 B`、最终文件 `10,131,335 B`）。

| 实测指标（最终代码复测） | API 24 / 25 (`Codex_Kanata_API24/25`) | API 30 (`Codex_Todo_API30`) | API 34 (`Codex_Todo_WebView34`) |
| --- | --- | --- | --- |
| `src_m2mib_blobLen` / `headHex` | `2,097,152 B` / `EFBBBFE59088E68890F09F93` | `2,097,152 B` / `EFBBBFE59088E68890F09F93` | `2,097,152 B` / `EFBBBFE59088E68890F09F93` |
| `directCursorWindow_3_9MiB_row` / `2MiB_text` | `SUCCEEDED:3899992` / `SUCCEEDED:2097144` | `SUCCEEDED:3899992` / `SUCCEEDED:2097144` | `SUCCEEDED:3899992` / `SUCCEEDED:2097144` |
| `schemeC_dataFrameCount` / `maxInFlightFrames` | `155` / **`2`** | `155` / **`2`** | `155` / **`2`** |
| `schemeC_maxRowBodyBytes` / `finalFileBytes` | `3,900,064 B` / `10,131,335 B` | `3,900,064 B` / `10,131,335 B` | `3,900,064 B` / `10,131,335 B` |
| Long-field 阶段 RSS `peak` (`VmHWM`) | `106,584 KiB` (`127,892`) / `142,036 KiB` (`145,200`) | `207,296 KiB` (`217,900`) | `127,180 KiB` (`133,484`) |
| WebView + Bridge 真实导出 (`finalFileBytes=55,072`) | **`BLOCKED`** (`WebView 52.0.2743.100 < 55/60`, `PLUGIN_MISSING`) | **PASS** (`COMPLETED`, `CANCELLED`, `55,072 B`) | **PASS** (`COMPLETED`, `CANCELLED`, `55,072 B`) |
| WebView + Bridge RSS / `VmHWM` | — | `303,024 KiB` / `311,796 KiB` (~304 MiB ≪ 512 MiB) | `211,212 KiB` / `222,068 KiB` (~217 MiB ≪ 512 MiB) |
| WebView + Bridge `NativeHeap` / `JavaHeap` / `JSHeap` | — | `23,675,920 B` / `62,004,256 B` / `10,000,000 B` | `23,372,416 B` / `47,223,496 B` / `10,000,000 B` |
| `targetExactRoundtripVerified` / 超限预分配拒绝 | **PASS**（2 MiB & 4 MiB 均预先拒绝） | **PASS**（2 MiB & 4 MiB 均预先拒绝） | **PASS**（2 MiB & 4 MiB 均预先拒绝） |

---

## 12. N-04 真实 Android 生命周期 / SAF / Share / 四阶段进程强杀（API 24 / 25 / 30 / 34 全 PASS）

对应 [KanataM6N04SafLifecycleTest.java](androidTest/com/yubin/formyself/KanataM6N04SafLifecycleTest.java)、[KanataM6BridgeActivity.java](syntheticDebug/java/com/yubin/formyself/KanataM6BridgeActivity.java)、[KanataM6RotationActivity.java](syntheticDebug/java/com/yubin/formyself/KanataM6RotationActivity.java)、[KanataM6LifecycleController.java](syntheticDebug/java/com/yubin/formyself/KanataM6LifecycleController.java)、[KanataM6ShareReceiverActivity.java](syntheticDebug/java/com/yubin/formyself/KanataM6ShareReceiverActivity.java)、[KanataM6SyntheticSafProvider.java](syntheticDebug/java/com/yubin/formyself/KanataM6SyntheticSafProvider.java) 与 [KanataM6KillableWorkerService.java](syntheticDebug/java/com/yubin/formyself/KanataM6KillableWorkerService.java)。所有能力隔离在 `syntheticDebug/` 内，未接入正式 Settings UI 或产品 RestoreCoordinator。

| 测试维度 | API 24 / 25 实测 | API 30 / 34 实测 | 验证结论 |
| --- | --- | --- | --- |
| SAF 真实 `DocumentsProvider` + 系统 `DocumentsUI` (`ACTION_CREATE_DOCUMENT` & `ACTION_OPEN_DOCUMENT`) | `realCreateDocumentOk=true`, `realOpenDocumentOk=true`, `createResultFlags=67`, `openResultFlags=67` | `true` / `true`, `createResultFlags=67`, `openResultFlags=67` | 全程由真实系统 `DocumentsUI` 弹窗拾取；API 24/25 实证同 UID 调用自身 Provider 时 AMS 跳过记录持久化授权 (`sameUidPersistableSkippedPre26=true`)，外部 UID 授权/撤权均 PASS；API 30/34 完整验证 OS 持久化授权与释放 (`persistableGrantAndReleaseOk=true`)。 |
| SAF 外部 UID `grantUriPermission` / `revokeUriPermission`、13 B 短读、零进展、半写、Provider 故障 | `osUriGrantAndRevokeOk=true`, `safShortReadImportOk=true`, `zeroProgressRejected="reader-zero-progress"` | 同左 | 真实 Android `UriGrantsManagerService` 授权、撤权、短读、零进展与异常回读全部核对通过。 |
| SAF 真实 Share (`ACTION_SEND` + 系统分享 + 独立 `:m6sharerecv` 进程接收 + 撤权 + 清理) | `chooserLaunched=true`, `receiverPid=4827/3120`, `receiverSha256Match=true`, `tempGrantRevoked=true` | `receiverPid=5301/5668`, `receiverSha256Match=true`, `tempGrantRevoked=true`, `taskFileCleanedAndSentinelPreserved=true` | 跨进程 `FileProvider` 读取加密导出内容、校验 SHA-256、撤销临时授权并删除任务副本（保留哨兵与源库）。 |
| Activity 真实托管生命周期 (`KanataM6LifecycleController` 自动关 DB / 撤租约 / epoch / 旋转) | `managedControllerClosedDbOnPauseAndStop=true`, `staleEpochAndSessionRejected=3`, `duplicateCompletionIdempotentCount=1`, `rotationCreate/Destroy=2/2` | 同左 | 不由测试手动关闭 DB；真实 `onPause`/`onStop`/`recreate()` 自动驱动控制器关库、撤销租约与屏蔽过期/重复回调。 |
| `:m6worker` 调用真实 `KanataM6SchemeCExporter.exportToSpool()` 四阶段真 `SIGKILL` (`KDF` / `DB_READ` / `SPOOL_WRITE` / `COMMIT`) + 重启恢复 | API 24/25 全 4 阶段均被 `SIGKILL` 并重启清理 `cleanedTasks=1` (`killedPid=4848→4864→4881→4898→4915` 等) | API 30 (`5532→5641`) & API 34 (`5788→5912`) 全 4 阶段均 `cleanedTasks=1` | 无模拟 KPB1 文件；真实导出进程在 4 个关键点被 `SIGKILL` 后重启执行 `recoverIncompleteTasks()`，旧备份 A、源 DB 不变且残留 `pending`/`.tmp` 清零。 |

---

## 13. BLOCKED 项与低版本实测限制声明

| 项目 | 状态 | 原因与约束 |
| --- | --- | --- |
| **Android API 24 / API 25 原厂镜像 WebView Bridge (`N-03`)** | **`BLOCKED`** | 独立模拟器 `Codex_Kanata_API24` (7.0) 与 `Codex_Kanata_API25` (7.1.1) 已完整安装并运行 19 项回归（**各 18/19 PASS**）；仅 `probeCapacitorBridgeControlBoundsAndWebViewMemory` 因 AOSP 原厂镜像预装 `com.android.webview` 为 `52.0.2743.100`，低于 Capacitor 8 内核硬性门槛（`MINIMUM_ANDROID_WEBVIEW_VERSION = 55`，默认 `60`），`Bridge.java` 主动阻断注入而诚实报 `PLUGIN_MISSING`。需端设备更新 System WebView (>= 60) 后方可在 API 24/25 上加载 Capacitor Bridge。 |
| **发行参数 `0x0001` 冻结与 UI/RestoreCoordinator 接入** | **`BLOCKED`（待立阶段 M6-03）** | 本阶段按边界约束仅使用合成参数 `0xff01` 与隔离目录，不触碰正式产品源码；待 GPT-6 审签本整改提交后再进入 M6-03。 |

---

## 14. 最终代码版本四平台复测回归记录（API 24 / 25 / 30 / 34）

所有 M6 测试在最终代码定稿后于以下 4 个独立模拟器重新编译并完整执行（`KanataM6N01..N04`, `KanataM6SchemeCInteropAndNegativeTest`, `KanataM6F02FaultMatrixTest` 共 19 项 + `KanataM6AcBenchmarkTest` 共 3 档规模 108 条修订样本）：
- **API 34 (`Codex_Todo_WebView34`)**：19/19 非基准测试 **19/19 PASS** (`221.309s` / 首次 `349.421s`) + 3/3 A/C 基准测试 **PASS**（54 修订样本）。
- **API 30 (`Codex_Todo_API30`)**：19/19 非基准测试 **19/19 PASS** (`114.979s`) + 3/3 A/C 基准测试 **PASS** (`798.929s`, 54 修订样本）。
- **API 25 (`Codex_Kanata_API25`)**：19 项测试 **18/19 PASS** (`101.976s`；仅 N-03 Bridge 受限于原厂 WebView `52.0.2743.100` 为 `BLOCKED`)。
- **API 24 (`Codex_Kanata_API24`)**：19 项测试 **18/19 PASS** (`94.769s`；仅 N-03 Bridge 受限于原厂 WebView `52.0.2743.100` 为 `BLOCKED`)。
- **标准与隔离构建矩阵**：详见总报告 [m6-02-final-report-v1.md](m6-02-final-report-v1.md)。
