# Kanata SQLite M5-06 最终独立代码审查报告 v1

- 复核日期：2026-11-19
- 审查角色：独立技术审查员（只读代码审查与证据复核，未修改业务/测试代码，未运行 Android 构建/模拟器/instrumentation）
- 仓库与分支：`Zhoubin601/ForMyself`，`m5/json-archive-migration`
- 最终建议：**M5-06 PASS**（五项整改 H-01 / M-01 / M-02 / L-01 / B-01 均独立核验为 **PASS**；未发现未解决的 Blocker / High / Medium 缺陷；记录 3 项 Low 级边界/健壮性发现及若干证据限制）
- 范围声明：**本结论仅针对 M5-06 阶段**，不代表也不自动宣布 M5 整体 PASS；M5 整体仍须另行汇总复核 M5-01～M5-06 账本。

---

## 1. 复核基线与 SHA

| 对象 | SHA / URL | 核对结果 |
|---|---|---|
| M5-06 原执行基线 | `3ff66376776f46659dfc91bcbd34b9a43abfcb5e` | 与原任务书及 `git log` 一致 |
| M5-06 原实现基线 | `a781563d25e1dab66f2f18046df5b80032e09a78` | 与首轮独立复核一致 |
| M5-06 整改任务书基线 | `c1caec5e6fa040502e9de85df0478e66b8fe02b4` | 与证据 JSON `baseline` 一致 |
| **整改实现提交** | `97718ee6a4067a479e4ebe285778876d835c95fa` | 仅改动 9 个 QA/测试文件（+576 / -68）；与证据 JSON `implementation` 一致 |
| **验收证据提交** | `488a2e1d84d660a9d141b9502aa53ab4cd80897e` | 直接父提交为 `97718ee6...`；仅新增整改报告与机器证据 JSON（2 文件） |
| 远端分支当前 HEAD | `f8179c97e610fc95a68d9b7d075bbc8b0638eaee` | 在 `488a2e1d...` 上仅新增本轮复核计划 `docs/20261119-kanata-sqlite-m5-06-final-independent-review-plan-v1.md`（本地 `kanata-m5` worktree 保持在 `488a2e1d...` 未移动） |
| **严格同 SHA Web CI** | [Quality #127](https://github.com/Zhoubin601/ForMyself/actions/runs/44463304279) | API 实核 `head_sha = 97718ee6a4067a479e4ebe285778876d835c95fa`，Web Job `135355003845` 成功，Android Job `135355005580` 按策略跳过 |

---

## 2. 实际审查文件清单

以下文件均在隔离 worktree（`m5/json-archive-migration`）中逐行只读审查，规划文档通过 `git show f8179c9:...` 直接读取：

| 类别 | 文件路径（相对仓库根） |
|---|---|
| 整改实现（9 文件，提交 `97718ee`） | `docs/qa/kanata-sqlite-m2/start-windows-synthetic-avd.ps1`；`docs/qa/kanata-sqlite-m5/runner-guard.mjs`；`docs/qa/kanata-sqlite-m5/run-android.mjs`；`docs/qa/kanata-sqlite-m5/catalog.mjs`；`docs/qa/kanata-sqlite-m5/fixture.mjs`；`docs/qa/kanata-sqlite-m5/device.mjs`；`docs/qa/kanata-sqlite-m5/evidence.mjs`；`docs/qa/kanata-sqlite-m5/verify-remediation-evidence.mjs`；`tests/kanataM506Remediation.test.js` |
| 验收证据与文档（提交 `488a2e1` / `f8179c9` / 历史基线） | `docs/20261119-kanata-sqlite-m5-06-final-independent-review-plan-v1.md`；`docs/20261118-kanata-sqlite-m5-06-android-sqlcipher-synthetic-acceptance-task-v1.md`；`docs/20261118-kanata-sqlite-m5-06-remediation-task-v1.md`；`docs/qa/kanata-sqlite-m5/m5-06-independent-review-v1.md`；`docs/qa/kanata-sqlite-m5/m5-06-android-v1.md`；`docs/qa/kanata-sqlite-m5/m5-06-remediation-v1.md`；`docs/qa/kanata-sqlite-m5/m5-06-remediation-evidence-v1.json` |
| 相关契约与构建/CI 文件 | `src/features/chat/storage/sqlite/kanataDataMigrator.js`；`src/features/chat/storage/sqlite/kanataDataMigrationRows.js`；`tests/helpers/kanataSqliteFixture.js`；`tests/helpers/kanataSqliteEncryptedLegacySource.js`；`scripts/build-kanata-sqlite-catalog.mjs`；`android/app/build.gradle`；`.github/workflows/quality.yml` |
| 本地只读复算对照产物 | `android/app/build/outputs/apk/debug/app-debug.apk`（含包内 `assets/kanata-sqlite-catalog.json` 与 `lib/x86_64/libsqlcipher.so`）；`android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`；`android/app/build/generated/kanataSqlite/assets/kanata-sqlite-catalog.json`；`android/app/src/main/java/com/yubin/formyself/KanataSqlitePlugin.java` |

### 本轮实际执行的只读验证命令

1. 宿主定向测试：
   `node --test tests/kanataM506Remediation.test.js tests/kanataSqliteDataMigration.test.js tests/kanataSqliteMigration.test.js tests/kanataSqliteEncryptedLegacySource.test.js`
   结果：退出 0，**48 通过 / 0 失败 / 0 跳过**。
2. 独立机器证据验证器：
   `node docs/qa/kanata-sqlite-m5/verify-remediation-evidence.mjs docs/qa/kanata-sqlite-m5/m5-06-remediation-evidence-v1.json`
   结果：退出 0，`{"verified":true,"targetReceipts":8,"uniqueTablesPerReceipt":50}`。
3. 独立只读复算脚本（在 OS 临时目录与内存中执行，零仓库改动）：复算普通目录、M2 合成目录、M5 合成目录、QA WebView bundle、原生插件 SHA-256、APK 及其内嵌 catalog；在宿主 Node SQLite 独立重跑 55 / 1,000 / 10,000 条合成迁移并逐表对照 50 张表 SHA-256；在内存中对 `verifyRemediationEvidence` 执行 7 类篡改/遗漏探测。
4. GitHub Actions API 核验：直接查询 `actions/runs/44463304279`、`/jobs` 及 `quality.yml` 分支近期运行历史。
5. Windows CIM 时间精度只读验证：抽检本机 30 个进程，实证 `Win32_Process.CreationDate` 相对 `.NET Process.StartTime.Ticks` 恒为向微秒截断（末位 100ns 为 `0..9` 时均截为 `0`），验证 `runner-guard.mjs:9` 的 `BigInt(a) / 10n === BigInt(b) / 10n` 无舍入误判。

---

## 3. 五项专项整改逐项结论

| 编号 | 整改目标 | 独立结论 | 核心依据 |
|---|---|---|---|
| **H-01** | AVD 实例身份绑定 | **PASS** | 每轮唯一 128-bit nonce、`kanata_m5_<id>` 与独立 `-datadir`；绑定启动器 PID/微秒级启动时间/QEMU 子进程/AVD `.ini`/ADB `transport_id` 固定；全部破坏性与状态变更操作均经 `guard.command` / `guard.verify` 门禁；陈旧/篡改/过期 manifest 在操作前 fail closed（0 破坏性调用） |
| **M-01** | `event_causes` 固定 SQL 目录 | **PASS** | `fixture.mjs` 新增 1 条指向已存在事件的合法因果边并定义固定 SQL；`catalog.mjs` 与打包 APK 内固定目录均已收录（954 条，普通目录 723 条逐字节不变）；`device.mjs` 与 `targetReceipt` 从原生目标库实际读回并校验字段摘要与表摘要 |
| **M-02** | 50 张表逐表摘要与恢复机器证据 | **PASS** | `evidence.mjs` 通过固定目录重读原生 SQLCipher 全部 50 张表；8 份收据的 50 表聚合可独立复算；独立宿主对照证实 smoke、4 强杀点及 1k/10k 全部 50 张表逐表 SHA-256 逐字节一致；4 强杀点 PID/CDP/inode/cursor/manifest 及源只读性全部吻合（另记 1 项 Low 验证器交叉校验缺口） |
| **L-01** | `force-stop` 退出码与 PID 消失确认 | **PASS** | `execFileSync` 强制非零抛错；`qaPid` 用 `ps -A -o PID,NAME` 严格校验表头与行格式，查询失败抛错不视作空；PID 仍存活抛 `M5_QA_PID_STILL_LIVE`；`withQaCleanup` 以 `AggregateError` 同时保留场景与清理错误；4 类宿主单测全通过 |
| **B-01** | 严格同 SHA GitHub Web CI | **PASS** | [Quality #127](https://github.com/Zhoubin601/ForMyself/actions/runs/44463304279) `head_sha` 精确等于实现提交 `97718ee6...`，Web Job `npm run check` 成功，Android Job 按既有分支策略跳过，workflow 未修改 |

---

## 4. 逐项详细审查与代码行号核对

### 4.1 H-01：AVD 实例身份绑定（PASS）

1. **唯一实例身份与启动器绑定（`start-windows-synthetic-avd.ps1:4,20-25,52,59,82-88`）**
   - 仅当传入 `-M5Identity` 时生成 32 位小写十六进制 `$instanceId`、唯一目录 `kanata-m2-synthetic-<8位前缀>`、唯一 AVD 名 `kanata_m5_$instanceId`，向 `emulator.exe` 传入 `-datadir "<avd>"`，并在 `device-manifest.json` 写入 `identityVersion=1`、`instanceId`、`dataDirectory`、`launcherStarted`（UTC Ticks 字符串）及 6 小时 `expiresAt`。不传 `-M5Identity` 时 M2 原行为完全不变。
2. **Manifest 与实时进程/设备校验（`runner-guard.mjs:4-38`、`run-android.mjs:33-75`）**
   - `runner-guard.mjs:14-36` 校验 `identityVersion`、`syntheticOnly`、`createdBy`、32-hex `instanceId`、`avdName === 'kanata_m5_' + instanceId`、`serial === 'emulator-5582'`、`api === 34`、`launcherPid`、`launcherStarted`、有效期 `now() < manifest.expiresAt`、manifest 所在路径与 `root`/`avdHome`/`dataDirectory` 派生一致性、`sdk` 绝对路径。
   - `run-android.mjs:35-68` 的 `inspect()` 在每次核验时：
     - 重读 `manifestPath` 并断言与启动时全文逐字符相等（`:36`），防止运行中途篡改 manifest 文件；
     - 用 `Get-CimInstance Win32_Process` 查询 `launcherPid` 及其子进程，要求存在且仅存在 1 个 `qemu-system-x86_64-headless.exe` 子进程（`:38-47`）；
     - 校验启动器与 QEMU 命令行均唯一包含 `-avd`、`-port 5582`、`-datadir`（`:27-32,48,57-58,61,65-66`），且 `<avdHome>/<avdName>.ini` 的 `path=` 与 QEMU `-datadir` 路径一致（`:59-63`）；
     - 解析 `adb devices -l` 确认 `emulator-5582` 唯一且处于 `device` 状态并提取 `transport_id`（`:50-54`），校验 `adb -s serial emu avd name` 与 `adb -t transportId get-serialno`（`:55-56`），读取 `ro.build.version.sdk` 与 `sys.boot_completed`（`:66-67`）。
   - `runner-guard.mjs:33-34` 首次 `verify()` 后锁定 `transportId`，后续任意一次 `verify()` 发现 `transportId` 变化即抛 `M5_AVD_IDENTITY_UNCONFIRMED`。
3. **全量 ADB 调用点逐点审查（`run-android.mjs`）**
   - **受 `guard.command` / `guard.verify` 保护的全部变更/破坏性操作**：
     - `install -r -t`（`:98`）
     - `shell am instrument`（`:118`）
     - `shell am start -W`（`:146`）
     - `forward tcp:0 localabstract:...`（`:155`）与 `forward --remove`（`:200,203`）
     - `run()` 通过 CDP 写入候选库前调用 `guard.verify()` 并断言 `pidOfQa() === page.pid`（`:216-220`）
     - `shell pm clear`（`:225`）
     - `shell run-as <pkg> kill -9 <oldPid>`（`:318`，且 `:317` 先确认 `pidOfQa() === oldPid`）
     - `stopQa` 中的 `shell am force-stop <pkg>` 与清理阶段 PID 复查 `qaPid(guard.command, pkg)`（`:380`，且 `:379` 仅在 `installAttempted` 为真时执行）
   - **只读 ADB 调用**：`:50,55,56,66,67`（位于 `inspect()` 内部）；`:73,80,83,100,102,109,110,134,154,278`（全部使用初始 `guard.verify()` 锁定后的 `-t <transport>`，不接受任意 `-s` 漂移）；`:74` 与 `:108` 保留第三方包白名单双重防御。
4. **TOCTOU 与实例混淆风险评估**
   - `inspect()` 执行与 `execute(transport, ...)` 之间存在数毫秒进程检查窗口，且 `:55` 使用 `rawAdb('-s', serial, 'emu', 'avd', 'name')`。但由于 ADB server 为每次设备连接分配单调递增且永不复用的 `transport_id`，`:56` 验证 `-t transportId get-serialno === serial`，且所有执行均走 `-t <transportId>`，即使目标模拟器在该窗口内退出并由另一实例占用 `emulator-5582`，旧 `transport_id` 会直接失效报错，无法误命中新实例。
   - 若传入过期的或上一轮的 manifest，`guard.verify()` 在 `:71`（`withQaCleanup` 之前）即抛出 `M5_AVD_IDENTITY_UNCONFIRMED`，破坏性调用为 0。
   - 发现 1 项 Low 级边界问题（见第 7 节 **L-REV-01**：`run-android.mjs:23` 在缺少 `sdk` 字段时抛 `TypeError` 而非 `M5_AVD_IDENTITY_UNCONFIRMED`）。

### 4.2 M-01：`event_causes` 固定 SQL 目录（PASS）

- **固定 SQL 与参数**（`fixture.mjs:7`）：
  `SELECT rowid AS __rowid,world_id,event_id,cause_event_id FROM event_causes WHERE rowid>? ORDER BY rowid LIMIT 50`
  与 `kanataDataMigrator.js:351-352` 逐字符一致，单参数 `?`、按 `rowid` 升序、`LIMIT 50`，不接受运行时任意 SQL。
- **合成因果边**（`fixture.mjs:6,34-35,57`）：基于已存在 `data.events[0]`（`event-one`）追加同世界事件 `m5-06-causal-event`，`causedByEventIds: [cause.id]`，`sourceRefs: []`，`lifeSources: []`，返回 `causalEdge = [cause.worldId, 'm5-06-causal-event', 'event-one']`。
- **目录与打包验证**（`catalog.mjs:12,53-55`、`scripts/build-kanata-sqlite-catalog.mjs:116-122`）：
  - `catalog.mjs` 显式登记 `eventCausesDigestSql`，经真实 `createKanataDataMigrator` 完整迁移后独立查询验证 `probe.length === 1` 且字段元组完全等于 `causalEdge`。
  - 独立重算普通目录：723 条，SHA-256 `1886d13e6baff8a2431637ee76fcf44b7d846fcf3a3ec1f3d10bdd19ea870714`，与基线一致，不含 `eventCausesDigestSql`。
  - 独立重算 M5 合成目录：954 条（相对 M5-06 原 953 条精确 +1），SHA-256 `2c92a866a2410aa9d0e320c89a0c9e8304f9b9d873ca5d379ebedb45e4b5059b`，其中条目 `db16025a507732c234592d037b3dcc602ab4578bbd1a2a4fe343b306d1b696b4` 为 `mode="query", phase="business", arity=1`。本地保留 `app-debug.apk` 内 `assets/kanata-sqlite-catalog.json` 亦为同一 SHA-256。
- **原生读回与断言**（`device.mjs:110-115`、`run-android.mjs:240-241`）：WebView 在事务中以 `[-1]` 执行 `eventCausesDigestSql`，校验字段元组等于 `[causalEdge]`，输出 `causalFieldsSha256 = 051c1e0f03d8bef2cf81053ecdf87a981ebeed180c9edb5cf56484a3c38a246e`；同时 `targetReceipt` 复读 `event_causes` 表得到 `sha256 = 92a27afe321f6a307e25e4f5e4cdd425abc0aef63d1c6d70b1e0e00f61f74981`。两项均与宿主独立公式及 8 份原生机器收据一致。

### 4.3 M-02：50 张表逐表摘要与恢复机器证据（PASS）

1. **原生 50 表真实重读（`evidence.mjs:14-43`）**
   - `targetReceipt(tx, manifest)` 按冻结常量 `KANATA_MIGRATION_TABLES`（50 表）逐表查询真实原生 SQLCipher 连接：
     - 空表（4 张：`memory_links`、`relationship_events`、`task_social_participants`、`domain_command_receipts`）执行 `SELECT count(*) AS count FROM <name>`，断言 `row?.count === 0`，按 `kanata-m5-empty-v1:<name>` 计算确定性 SHA-256。
     - 非空表（46 张）校验列名白名单 `/^[a-z_]+$/`，以 `SELECT rowid AS __rowid,<cols> FROM <name> WHERE rowid>? ORDER BY rowid LIMIT 50` 全量游标分页读取并按 `kanata-m5-table-v1` 折叠散列，断言 `count === expected.count && sha256 === expected.digest && count > 0`。
     - 聚合摘要按 `m5-table-receipt-v1` 对 50 元素 `[name, count, empty, sha256]` 紧凑 JSON UTF-8 求 SHA-256。
2. **摘要聚合复算与原始数据独立校验的明确区分**
   - **重要边界**：`m5-06-remediation-evidence-v1.json` 仅保存 50 张表的逐表摘要和聚合摘要，不含原生数据库原始行。因此，`verify-remediation-evidence.mjs` 仅能验证“JSON 内 50 表表名/顺序/计数/空表公式/聚合 SHA-256 自洽”，**不能**声称仅从该 JSON 独立重算了原生库非空表的原始行 SHA-256。
   - **本轮补充独立宿主对照**：在 Node SQLite 上独立运行真实迁移器与 `encryptedFixture`（55、1,000、10,000 条）从原始合成行重新生成 50 张表逐表 SHA-256，与机器证据 JSON 逐项比对：
     - `smoke`（55 条）及 4 个强杀恢复点（55 条）：**50/50 表计数、空表标记、逐表 SHA-256、聚合 SHA-256（`f0e05fda...`）全部逐字节匹配**；
     - `capacity[1000]`：**50/50 表逐表 SHA-256 与聚合 SHA-256 全部逐字节匹配**；
     - `capacity[10000]`：**50/50 表逐表 SHA-256 与聚合 SHA-256 全部逐字节匹配**；
     - `capacity[100000]`：47 张固定表与宿主 55 条基准逐字节匹配，`messages=100000`、`archived_message_marks=99998`、`entity_ids=100125`，聚合 SHA-256 复算匹配（100k 原始消息行未在宿主重跑加密导入；另需注明宿主与原生共用迁移映射代码，跨后端一致可排除存储/编码/读回偏差，不覆盖双端共享映射错误）。
3. **四个强杀点与源只读性核对（`run-android.mjs:303-347`、`device.mjs:27-66,162-183`、`evidence.mjs:45-63`）**
   - 四个强杀点（`before-first-commit`、`during-batch`、`after-batch-commit`、`before-verification`）均记录 `hookReached=true`、不同旧/新 PID、`oldPidGone=true`、`oldCdpDisconnected=true`（注释 `:321` 明确要求等待远端断开后再本地 `page.close()`）、前后 `candidateDb` 的 `instanceId`/`package`/`path`/`inode` 完全一致且 `create:false`、重启前 `dataset`/`messages`/`marks`/`lifeSources`/`manifest`/`archive.cursor_json`/`imported_count`/`state` 与设计预期精确吻合、重启后 `status=complete` 与 `repeated=already-complete`。
   - 源密文（主密文 + 归档集合）与 `recovery journal` 在所有场景（含强杀前后与负例）前后 SHA-256 相等，`write`/`rename`/`delete` 调用全部为 0；`read` 调用次数与迁移阶段精准一致（`before-first-commit` 强杀前 3 / 恢复后 8，`during-batch` 4 / 8，`after-batch-commit` 4 / 7，`before-verification` 5 / 6；1k / 10k / 100k 为 41 / 401 / 4001）。
4. **验证器遗漏与可绕过边界（见第 7 节 L-REV-02）**
   - `verify-remediation-evidence.mjs` 存在 7 类未校验的交叉一致性/伪造边界（详见 L-REV-02）；但本轮已通过独立脚本证实实际提交 JSON 在上述全部维度上均真实一致，故不影响 M-02 PASS 判定。

### 4.4 L-01：`force-stop` 退出码与 PID 消失确认（PASS）

- `runner-guard.mjs:51-59`：`stopQa` 通过 `command('shell', 'am', 'force-stop', pkg)` 执行，底层 `execFileSync` 在退出码非 0 时立即抛错；随后最多轮询 16 次（每次 250ms），只有 `pid() === null` 才返回 `{ exit: 0, pidGone: true }`，否则抛出 `M5_QA_PID_STILL_LIVE`。
- `runner-guard.mjs:40-49`：`qaPid` 执行 `ps -A -o PID,NAME`，断言表头匹配 `/^\s*PID\s+NAME\s*$/`、至少 1 行有效进程且所有非空行可解析、匹配 `pkg` 不超过 1 行；任何 ADB/shell 异常或输出异常均抛错，彻底消除旧版 `pidof ... || true` 把失败误判为“进程已退出”的缺陷。
- `runner-guard.mjs:61-72` 与 `run-android.mjs:377-383`：`withQaCleanup` 嵌套包裹场景、`page?.close()` 和 `stopQa`，场景与清理同时失败时以 `AggregateError([original, error], 'M5_QA_SCENARIO_AND_CLEANUP_FAILED')` 同时保留全部异常；`stopQa` 的命令与 PID 查询均通过 `guard.command` 且受 `installAttempted` 保护，只针对本轮 QA 包 `com.yubin.formyself.m2qa`。
- `tests/kanataM506Remediation.test.js:67-92` 4 项单测覆盖正常退出、非零退出码、PID 仍存活、PID 查询失败与错误保留，全部实测通过；机器证据 `runs[0..2].cleanup` 均为 `{ exit: 0, pidGone: true }`。

### 4.5 B-01：严格同 SHA GitHub Web CI（PASS）

直接查询 GitHub Actions REST API 复核 [Quality #127](https://github.com/Zhoubin601/ForMyself/actions/runs/44463304279)：

- `id`: `44463304279`，`run_number`: `127`，`name`: `Quality`，`event`: `push`，`head_branch`: `m5/json-archive-migration`。
- `head_sha`: `97718ee6a4067a479e4ebe285778876d835c95fa`（与实现提交 SHA 逐字符完全一致）。
- `web` Job（`id: 135355003845`）：`head_sha` 相同，`conclusion = success`，`Run npm ci` 与 `Run npm run check` 均为 `success`。
- `android` Job（`id: 135355005580`）：`conclusion = skipped`，符合 `.github/workflows/quality.yml:21`（`if: github.ref != 'refs/heads/m5/json-archive-migration'`），且 workflow 文件零变更。
- 后续文档提交 `#128`（`488a2e1`）与 `#129`（`f8179c9`）亦均为 `success`，但 B-01 判定严格以实现 SHA 对应的 `#127` 为准，不存在以后代文档提交冒充实现 SHA 的情形。

---

## 5. 机器证据一致性交叉核对表

| 核对维度 | 机器证据 JSON (`488a2e1`) | 独立复核来源与结果 | 一致性 |
|---|---|---|---|
| 证据 JSON 自身 SHA-256 | Markdown 载 `3d717519...` | 仓库文件/LF/Git blob 均 `3d71751978ba0228b99ae2dda6a7c531c3b889952e4f70d879c72d185ed61dc0` | 一致 |
| 实现 SHA & 精确 CI | `implementation = 97718ee6...` | Git 实现提交 `97718ee6...`；Quality #127 `head_sha = 97718ee6...` 成功 | 一致（注：JSON 内 `ci` 为推送前快照，见 L-REV-03） |
| 普通目录 / M5 合成目录 | 723 条 `1886d13e...`；954 条 `2c92a866...` | 独立运行 `build-kanata-sqlite-catalog.mjs` 重算逐字节一致 | 一致 |
| `event_causes` 查询 SHA-256 | `db16025a...` | 独立计算 `eventCausesDigestSql` UTF-8 SHA-256 逐字节一致，且存在于 M5 目录 | 一致 |
| QA WebView bundle SHA-256 | `0c9bcd86...`（三轮 `runs[]` 相同） | 独立 `esbuild` 打包 `device.mjs` 得 `0c9bcd86c3ffdd98d53276f66b85eb7b38b2753633a42b4a57df7bb10f40da6f` | 一致 |
| 原生插件 SHA-256 | `6fddf468...` | 本机工作区 `KanataSqlitePlugin.java`（Windows CRLF 检出）SHA-256 一致（注：Git LF blob 为 `ccf54f45...`） | 一致（行尾口径说明见下） |
| 隔离 QA APK / Test APK | `1e0e178c...` / `76fc1573...` | 本地保留 APK SHA-256 一致；`app-debug.apk` 内含同 SHA catalog 及 `lib/x86_64/libsqlcipher.so` | 本地一致（APK 未入 Git，属本地复核） |
| 3 次运行实例绑定 | `id=aa6c4b48...`, `pid=5420`, `transport=5` | `smoke` / `full` / `100k` 三轮 `instance`、`artifacts`、`cleanup={exit:0,pidGone:true}` 完全一致 | 一致 |
| 50 表逐表计数与摘要（smoke & 4 强杀） | 50 表（46 非空 / 4 空），聚合 `f0e05fda...` | 宿主 SQLite 55 条独立重算 50/50 表逐字节一致；`event_causes` 行摘要 `051c1e0f...`、表摘要 `92a27afe...` 一致 | 一致 |
| 四个强杀点状态与 inode | PID `12863→13010` 等；inode `329226`/`328763`/`329226`/`329226` | JSON 与 Markdown 表格完全一致；4 点重启前 cursor/计数/manifest、重启后 50 表及幂等复跑全部一致 | 一致 |
| 1k / 10k / 100k 容量数据 | 16.79s / 109.92s / 912.31s；21/201/2001 批（max 50）；RSS 424.6/421.6/561.5 MiB；DB 2.01/11.72/109.91 MiB；分页 7.4/8.9、6.0/5.3、4.1/3.8 ms | 与整改 Markdown 表格全部逐项一致；`min <= mean <= max` 成立；1k 与 10k 宿主独立对照 50/50 表逐字节一致；100k 47 固定表与计数一致 | 一致 |
| 外键与完整性 | 全 8 份收据 `foreignKeyViolations=0`, `integrity="ok"` | JSON 与 Markdown 一致 | 一致 |
| 源密文与 recovery journal | 全部场景 `before===after`，`write/rename/delete=0` | 调用次数与 `kanataDataMigrator.js` 真实逻辑吻合；4 负例均 `writes=0` 且目标前后一致 | 一致 |

### 明确标记的证据限制（无法仅凭 Git 提交文件直接复核的项目）

以下项目由开发者本机运行并保留了 SHA-256 指纹，但原始输出文件按脱敏/不入库规则未提交至 GitHub，**本次 GitHub 复核无法仅凭提交内容直接重演原始日志**：

1. **未提交的本地原始日志**：`logs` 与 `runs[].log` 索引的 7 份日志文件（`m506-rem-directed-final.log`、`m506-rem-check.log`、`m506-rem-build.log`、`m506-rem-stale-live.log`、`m506-rem-final-smoke.log`、`m506-rem-final-full.log`、`m506-rem-100k.log`）不在 Git 树中，因此真实 AVD 在线拒绝旧 manifest（`previousPhysicalManifest`）及 instrumentation 原始终端输出无法从 Git 仓库直接审阅。
2. **未提交的 APK 二进制与实时 AVD 执行**：隔离 APK 二进制不入 Git（本机 worktree 残留构建产物已只读复算匹配，但纯远端 GitHub 复核者无法直接核对 APK 字节）；Android SQLCipher 实机/模拟器执行过程本轮按禁令未重跑，原生侧结论依赖源码链路审计、本地保留 APK 校验、宿主 55/1k/10k 逐表对拍及机器证据一致性。
3. **100k 原始行宿主全量复算**：本轮仅对 100k 的 47 张固定表与 `messages`/`archived_message_marks`/`entity_ids` 计数及聚合 SHA-256 做了核对，未在宿主重跑完整 100k 加密导入。
4. **`nativePlugin` 行尾差异**：`run-android.mjs:115` 对 Windows 检出文件（CRLF）计算 SHA-256 得 `6fddf468...`，在 Linux/Git LF 视角下同一文件内容为 `ccf54f45...`，属行尾规范差异而非源码改动。

---

## 6. 安全边界核对

| 安全边界项 | 核对结果 |
|---|---|
| 生产 Store / canonical / 普通 APK 激活位 | `git diff 3ff6637..488a2e1 -- src/ android/ scripts/ .github/ package.json package-lock.json` 确认整改提交 `97718ee` 对 `src/`、`android/`、`scripts/`、`.github/`、`package*.json` 零修改；M5 开关仍受 `kanataM2Synthetic=true` 且禁用 release variant 约束（`android/app/build.gradle:3-7,82-86`） |
| Schema 001–005 / checksum / `application_id` | 5 个 schema migration checksum、`schemaVersion=5`、`applicationId=1263424577` 与基线逐项一致 |
| 普通 SQL 目录不变 | 独立重算普通目录 723 条、SHA-256 `1886d13e...` 逐字节不变 |
| 真实用户数据与旧 JSON/backup/archive/journal | 全部 QA 仅在独立内存 Repository 与隔离 AVD `.m2qa` 包运行；无任何真实用户路径读取或旧文件清理 |
| 机密与明文泄露扫描 | 扫描 `m5-06-remediation-evidence-v1.json` 全文（3,540 行），未检出密码、密钥、合成消息正文（`合成历史`、`仅用于结构验收`）、`synthetic-user`、`m5-06-causal-event` 或私钥片段 |
| 依赖与 CI workflow | `package.json`、`package-lock.json`、`android/app/build.gradle`、`.github/workflows/quality.yml` 均无整改变更 |

---

## 7. Findings 分级汇总

本轮独立审查共发现 **0 Blocker / 0 High / 0 Medium / 3 Low**：

### Blocker / High / Medium
- **无**。

### Low

1. **L-REV-01（Low · H-01 输入边界）：缺少 `sdk` 字段的畸形 manifest 抛出 `TypeError` 而非标准身份错误**
   - **位置**：`docs/qa/kanata-sqlite-m5/run-android.mjs:23`
   - **复现依据**：`const adbPath = path.join(manifest.sdk, 'platform-tools', 'adb.exe')` 在第 71 行 `guard.verify()` 之前执行；若传入不含 `sdk` 字段或 `sdk` 非字符串的陈旧/损坏 JSON，Node 会提前抛 `TypeError [ERR_INVALID_ARG_TYPE]` 而非 `M5_AVD_IDENTITY_UNCONFIRMED`。
   - **影响**：仍在任何 ADB 调用之前 fail closed，不破坏隔离安全性，仅影响错误码一致性。
   - **最小修复建议**（可选，后续维护时处理）：在构造 `adbPath` 前校验 `typeof manifest.sdk === 'string'` 或将 `adbPath` 解析移入 `inspect()`/`execute()` 内。

2. **L-REV-02（Low · M-02 验证器覆盖缺口）：`verify-remediation-evidence.mjs` 存在 7 类未校验的交叉一致性/伪造边界**
   - **位置**：`docs/qa/kanata-sqlite-m5/verify-remediation-evidence.mjs:13-161`
   - **复现依据**：在内存中对 `m5-06-remediation-evidence-v1.json` 副本执行以下 7 项篡改并调用 `verifyRemediationEvidence()`，均返回 `{ verified: true }`：
     1. 篡改任意非空表 `sha256` 并重算其 `aggregateSha256`（仅凭证 JSON 无法重算原始行，属固有边界；但 55 条固定集未与 `m5Catalog()` 基准比对）；
     2. 篡改 `interruptions[0]` 的非空表 `sha256` 并重算其聚合值，使其与 `smoke.tableProof` 不同（`:103-127` 未断言 4 份强杀 50 表收据等于 `smoke.tableProof`）；
     3. 篡改 `catalog.qaSha256`（或 `apkSha256`/`testApkSha256`）使其与 `runs[0].artifacts.*` 不一致（未校验 `evidence.catalog`）；
     4. 篡改 `runs[0].catalogSha256` 使其与 `runs[0].artifacts.catalog` 不一致；
     5. 篡改 `eventCausesHostOracle.rowSha256` / `tableSha256` 使其与 `smoke` 不一致；
     6. 将 `evidence.issues['H-01']` 改为 `'FAIL'`；
     7. 将 `capacity[0].messageBatchTimingMs.min` 改为大于 `max`（`:140-143` 未校验 `min <= mean <= max`）。
   - **影响**：不代表本轮实际证据存在问题（本轮独立脚本已核验提交 JSON 在全部 7 项维度上均真实一致），但说明独立验证器对未来回归/手工拼接 JSON 的防伪约束仍有收紧空间。
   - **最小修复建议**（可选）：在 `verifyRemediationEvidence` 中补齐 `interruptions[].tableProof === smoke.tableProof`、`catalog.* === runs[0].artifacts.*`、`run.catalogSha256 === run.artifacts.catalog`、`eventCausesHostOracle` 与 `smoke` 交叉断言及 `min <= mean <= max` 校验。

3. **L-REV-03（Low · B-01 文档快照滞后）：证据提交 `488a2e1` 内 B-01 状态仍为推送前快照**
   - **位置**：`docs/qa/kanata-sqlite-m5/m5-06-remediation-v1.md:14,64`；`docs/qa/kanata-sqlite-m5/m5-06-remediation-evidence-v1.json:7,13-18`
   - **依据**：证据文件提交于获得推送授权与触发 Quality #127 之前，因此记录 `B-01: BLOCKED`、`ci.status: "NOT RUN"`。推送后 GitHub Actions [Quality #127](https://github.com/Zhoubin601/ForMyself/actions/runs/44463304279) 已在精确实现 SHA `97718ee6...` 上通过。
   - **影响**：仅属时序快照，无技术缺陷；按不改写历史证据原则原样保留，由本独立复核报告补充引用 `#127` 予以闭环说明。

---

## 8. 最终建议

- **建议结论：M5-06 PASS**。
- 五项专项整改（H-01、M-01、M-02、L-01、B-01）经独立源码审查、宿主实测（48/48 通过）、独立 50 表宿主对拍（55/1k/10k 全匹配）、本地保留 APK/目录复算及 GitHub Actions #127 API 核验，**全部满足关闭条件，无未解决的 Blocker、High 或 Medium 问题**。
- 本报告不修改任务书、历史报告、机器证据或分支状态，未提交、未推送，未启动 M5 整体汇总、M5-07 或 M6；后续由用户决定是否更新 M5-06 验收状态及何时开展 M5 整体独立汇总审查。
