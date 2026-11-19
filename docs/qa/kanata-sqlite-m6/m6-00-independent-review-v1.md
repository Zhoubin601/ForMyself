# Kanata SQLite M6-00 独立架构审查报告 v1

- **审查日期**：2026-11-19（北京时间）
- **审查角色**：独立数据库、安全与存储架构审查员
- **审查对象**：`.worktrees/kanata-m5/docs/qa/kanata-sqlite-m6/m6-00-architecture-audit-v1.md`（GPT-6.2 Sol High 审计报告）
- **源码冻结基线**：`2b6e8e3591385024576c6606cce2acc31dbaad2b`（分支 `m5/json-archive-migration`，worktree `.worktrees/kanata-m5`）
- **规划与任务书基线**：`b695226a8495d9129e9e95cf127bfbc4a61c92c4`（`docs/20261119-kanata-sqlite-m6-encrypted-backup-recovery-plan-v1.md` 与 `docs/20261119-kanata-sqlite-m6-00-architecture-audit-task-v1.md`）
- **审查结论**：**CONDITIONAL PASS（有条件通过）** — GPT 审计报告在基线核对、旧版兼容矩阵、恢复状态机主干与部分关键隐患识别上质量扎实；但独立核查实际源码后发现 **4 项 Blocker 级遗漏/合同冲突、6 项 High 级设计缺口、4 项 Medium 级遗漏与 2 项 Low 级事实偏差**。在补齐本文第 7 节所列最小设计输入修订、并由用户明确 M5 整体仍为 OPEN 状态下的 M6-01 授权边界后，方可启动 M6-01。

> **证据标注口径**：沿用任务书要求，全文严格区分 **已实现**（经 `2b6e8e35` 源码与测试逐行核实）、**文档约定**（来自 `b695226a` 规划/任务书或 M 总计划）、**推断**（基于源码边界推导的架构结论与风险）、**待验证**（受限于未执行 Android 构建/真机/AAR 实测，需隔离环境实证的原生能力）。

---

## 1. 审计基线与工作区核验

### 1.1 Git 与双基线独立核对

通过只读命令独立核查主仓库及全部 worktree：

| 核验项 | 实际观测结果 | 判定 |
| --- | --- | --- |
| 主工作区 `main` | `41cbb66`，存在用户既有文档修改、删除项与未跟踪文件（未触动） | **已确认保留** |
| `.worktrees/kanata-m5` HEAD | `2b6e8e3591385024576c6606cce2acc31dbaad2b`（`m5/json-archive-migration`），审核前仅含未跟踪目录 `docs/qa/kanata-sqlite-m6/`（内含 GPT 报告） | **与冻结基线一致** |
| `2b6e8e35..b695226a` 差异 | 仅 2 笔纯文档提交（`85a75db`、`b695226`），分别新增 M6 规划与 M6-00 任务书；源码、测试、Schema、配置零差异 | **双基线干净一致** |
| M5 关账状态 | `docs/20261119-kanata-sqlite-m5-06-closeout-v1.md:5-6,54` 明确 **M5-06 = PASS**，但 **M5 整体仍为 OPEN / NOT ACCEPTED** | **需用户治理裁决** |

### 1.2 本轮独立审查范围与未执行项

- **已独立逐行核验的核心源码与测试**：
  - 备份格式与运行时：`src/services/fullBackup.js`、`src/features/chat/backup/kanataBackup.js`、`src/application/backupRegistry.js`、`src/application/backupParticipants.js`、`src/application/fullBackupRuntime.js`、`src/application/kanataBackupRuntime.js`、`src/application/contracts.d.ts`、`src/application/moduleRegistry.js`、`src/application/backupErrors.js`、`src/composables/settings/useBackupSettings.js`、`src/shared/crypto/passphraseAes.js`、`src/stores/settings.js`。
  - 恢复协调器与门禁：`src/application/restoreCoordinator.js`、`src/platform/storage/restoreJournal.js`、`src/platform/storage/restorePayloadCodec.js`、`src/platform/storage/restoreState.js`、`src/main.js`、`src/composables/useAppController.js`、`src/App.vue`、`src/services/nativeActivityGuard.js`、`android/app/src/main/java/com/yubin/formyself/TodoRepository.java`、`TodoPlugin.java`。
  - 受保护模块与主密码变更：`src/application/protectedModules.js`、`src/stores/protectedAccess.js`、`src/services/masterPasswordChange.js`、`src/services/masterPasswordSecurity.js`、`src/stores/auth.js`、`src/composables/settings/useSecuritySettings.js`、`src/platform/security/secureCredentials.js`、`src/features/vault/vaultStore.js`、`src/features/chat/kanataStore.js`、`src/features/chat/storage/kanataRepository.js`、`src/features/chat/storage/messageArchiveRepository.js`。
  - SQLite/SQLCipher 候选与原生桥：`src/application/kanataSqliteCandidate.js`、`src/platform/storage/androidKanataSqliteDriver.js`、`src/platform/storage/kanataSqliteTypes.d.ts`、`src/platform/security/kanataSqliteKek.js`、`android/app/src/main/java/com/yubin/formyself/KanataSqlitePlugin.java`、`KanataKeyEnvelope.java`、`MainActivity.java`、`android/app/build.gradle`、`android/variables.gradle`、`scripts/build-kanata-sqlite-catalog.mjs`、`src/features/chat/storage/sqlite/kanataSchema.js`、`kanataSchemaHardening.js`、`kanataSchemaArrayOrder.js`、`kanataSchemaMigrator.js`、`kanataDataMigrator.js`、`kanataDataMigrationRows.js`、`kanataMigrationCoordinator.js`、`kanataDomainRows.js`、`kanataMessageDetailRead.js`。
  - 测试与关账证据：`tests/fullBackup.test.js`、`tests/kanataBackup.test.js`、`tests/RestoreCoordinator.spec.js`、`tests/KanataBackupRuntime.spec.js`、`tests/KanataProductRecovery.spec.js`、`tests/ProtectedAccess.spec.js`、`tests/ProtectedDataRecovery.spec.js`、`tests/masterPasswordSecurity.test.js`、`tests/kanataSqliteDriver.test.js`、`tests/kanataSqliteSchema.test.js`、`android/app/src/androidTest/java/com/yubin/formyself/KanataSqliteTransactionTest.java`。
- **严格未执行项**：未修改任何业务代码、测试、Schema、依赖或 GPT 原报告；未执行 Android 构建、Gradle、emulator/instrumentation、数据库 checkpoint/rekey、分支操作或提交推送；仅运行 1 条只读 Node 检查命令核对 Schema v5 表清单（53 表）与 `KANATA_MIGRATION_TABLES`（50 表）差集及 `BLOB` 列存在性。

---

## 2. 逐章节复核意见

### 2.1 GPT 第 1–2 节（双基线、证据口径与检查清单）

- **总体评价**：**准确、严谨**。双基线检查方法完整，行号覆盖广泛，正确指出了 M5-06 已关账但 M5 整体仍为 OPEN 的治理前提。
- **细微偏差**：`src/stores/settings.js` 引用范围为 `390–445`（`m6-00-architecture-audit-v1.md:59`），实际 `restoreBackupSnapshot` 延伸至 `src/stores/settings.js:480`（含 `Preferences.set` 与 `customBackground` 写入及 `427–430` 的原生 `secureCredentials.storeApiKey` 写回）。

### 2.2 GPT 第 3 节（现行备份格式与导出数据流）—— 对应审查重点 1

- **已核实准确的部分**：
  1. **v1–v12 兼容矩阵准确**：`src/services/fullBackup.js:137–165` 确实通过白名单 `[1..12]` 放行并归一为 v12 DTO；v2 起规范化 `schedules`（`:152`），v3 起要求 `data.chat` 对象（`:143,154`），`todos` 仅按 `Object.hasOwn(value.data, 'todos')` 判定存在性（`:153,197`）；`tests/fullBackup.test.js:304–320` 覆盖 1–12 逐版循环。
  2. **产品 v13 与旧仓库的依赖关系准确**：**已实现**状态中，产品完整备份 v13 与单项 `kanata-chat-backup` v1 **完全依赖旧加密文件仓库（`useKanataStore` + `kanataRepository` + `messageArchiveRepository`）**，见 `src/application/fullBackupRuntime.js:8,29,34–52`、`src/features/chat/kanataStore.js:470`。导出前通过 `prepareBackup()` 将全部归档页解密并展开至单一 `KanataData` 内存图，移除 `messageArchives` 并将 `version` 置 1（`src/features/chat/kanataStore.js:339–374`）；恢复大图时在旧 Store 内按会话 >1000 条重新分页写回归档文件（`src/features/chat/kanataStore.js:235–245`）。
  3. **任务暂停策略核实准确**：`src/features/chat/backup/kanataBackup.js:56–64` 确实仅在外部导出/读入应用 `pauseOwnedSending`（将 `reply`/`proactive`/`followup` 的 `pending`/`running`/`failed` 置为 `cancelled`，其他 `running` 置为 `pending`，全部 `leaseUntil` 清零），内部 `capture()` 保留原任务和租约（`:128–131,146–149`）。
- **发现的遗漏与不足**：
  1. **未指出 `FileReader.readAsText(file)` 对二进制便携格式的硬阻断（High）**：`src/composables/settings/useBackupSettings.js:280` 使用 `reader.readAsText(file)` 将整份备份按 UTF-8 解码为字符串。若新 SQLite 便携格式采用二进制容器头/分块帧（独立魔数 + AEAD 密文），`readAsText` 会直接以 `U+FFFD` 破坏二进制字节并引发整文件堆内存峰值；M6-01/M6-03 必须明确改用二进制流式读取（Web 侧 `File.slice`/`ReadableStream`，Android 侧原生 SAF `ContentResolver.openInputStream` 分块读取）。
  2. **未明确 `settings` 中 `ai.key` 在原生恢复时的外部安全凭据写入语义（Medium）**：`src/stores/settings.js:427–430` 在原生平台恢复设置时会先 `flushApiKeyWrite()` 再调用 `secureCredentials.storeApiKey(backup.ai.key)`（写入 `NativeBiometric` 的 `AccessControl.NONE` 命名空间，`src/platform/security/secureCredentials.js:53–66`）。新全备容器若包含非 chat 模块，同样需要确保失败补偿时能安全回滚该外部凭据，且跨设备恢复新容器时明确 `ai.key` 与密码库记录仍在受认证密文负载内。
  3. **未完整清点 Schema v5 的 53 张表与 `domain_command_receipts` 的备份语义（Blocker/High）**：详见第 3 节与第 4 节。

### 2.3 GPT 第 4 节（RestoreCoordinator 及 AES-GCM 日志）—— 对应审查重点 3

- **已核实准确的部分**：
  1. 状态机主干与 `journalRollback: true` 的行为描述准确（`src/application/restoreCoordinator.js:6–95`、`src/platform/storage/restoreJournal.js:5–84`、`src/platform/storage/restorePayloadCodec.js:2–3,80–136`）。
  2. 准确识别 `restoreJournal.commit()` 未将 `prepare()` 返回的 `digest` 作为入参绑定、也未对提交标记做密钥认证（`src/platform/storage/restoreJournal.js:74–78`）。
  3. 准确识别 Android Todo 原生组件检查 `formyself/restore-v1.enc`（`TodoRepository.java:95–97`），且发现 `KanataSqlitePlugin.java:173` 的文件名拼写漂移（`restore-v1.enc.commit`/`restore-v1.enc.tmp` vs 实际 `restore-v1.commit`/`restore-v1.tmp`）。
- **发现的严重遗漏（Blocker/High）**：
  1. **遗漏 `KanataSqlitePlugin.java:173` 对 `restore-v1.enc` 本身的硬拦截（Blocker）**：GPT 在 Risk #1 指出 JS `kanataSqliteCandidate` 在 `restoreState.blocked` 下拒绝打开，在 Risk #6 指出旁文件名不匹配，但**遗漏了 Native `verifyInventory()`（`KanataSqlitePlugin.java:171–174`）直接将 `formyself/restore-v1.enc` 纳入 `LEGACY_PRESENT` 黑名单**。只要全局恢复日志 `restore-v1.enc` 存在，Native `prepare()`/`unlock()` 就会无条件拒绝并抛出 `KANATA_SQLITE_LEGACY_PRESENT`——即便 JS 侧新增了协调器专用 restore capability，也无法打开或校验 SQLite 世代！
  2. **遗漏冷启动恢复路径的“半损坏死锁”与冗余 `prepareExports()`（Blocker）**：
     - 追踪实际调用链：`useAppController.js:536–544` (`retryFullRecovery`) → 先调用 `protectedAccess.prepareRecovery()`（`protectedAccess.js:161–168`）→ 调用 `ensureModules()` → 对 `passwords` 和 `chat` 逐一执行 `target.load(auth.savedMasterPwd)`（`protectedAccess.js:80`）。随后进入 `runtime.recover(password)` → `restoreCoordinator.js:89` 调用 `prepare({ recovering: true })` → `kanataBackupRuntime.js:65–70` 再次执行 `prepare(options)` + `registry.initialize()` + `registry.flush()` + **`registry.prepareExports()`**！
     - **致命问题**：如果上次恢复在 `apply` 阶段强停导致当前 `chat`（旧归档/新 SQLite 世代）或 `passwords` 处于半写入/损坏状态，`ensureModules()` 里的 `target.load()` 会失败并返回 `false`，导致 `retryFullRecovery()` 在第 539 行直接提前返回，**根本无法进入 `runtime.recover()` 去重放 `previous` 或 `target`**！而且 `recover()` 根本不需要 `capture()`，却在 `kanataBackupRuntime.js:69` 无条件调用 `registry.prepareExports()`（尝试展开全部归档页）！
  3. **遗漏 `useBackupSettings.js:68` 跨设备密码职责耦合与 Android SAF URI 崩溃失效（High）**：`useBackupSettings.js:68` 直接将 `authStore.savedMasterPwd` 传入 `fullBackup.restore(snapshot, authStore.savedMasterPwd, options)`。跨设备恢复时，**外部包密码**（解密备份包）与**本机主密码**（加密本地 `restore-v1.enc` 恢复日志及封装本机 SQLite DEK）可以不同。此外，Android SAF 临时文件 URI 授权在进程强停后会失效，因此目标 SQLite staging 必须**在调用 `journal.prepare()` 前于应用私有目录完整落盘并校验完毕**，`recover()` 重启后绝不能依赖外部 SAF 文件重读。
  4. **遗漏 `TodoRepository.compareAndSet` 与 `journal.prepare()` 之前的竞态窗口（Medium）**：`TodoRepository.java:41–49`（JS 写入）未检查 `ensureNoPendingRestore`，仅 `toggleCompleted`/`setCompleted`（`:98–130`，桌面小组件点击）检查 `formyself/restore-v1.enc` 是否存在。在 `restoreCoordinator.js:37` 置 `state.blocked = true` 到 `restoreJournal.js:68` rename 产出 `restore-v1.enc` 之间，桌面小组件仍可修改 `my_todo_data_v1`，可能发生在 `capture()` 之后、`apply()` 之前，造成小组件更新在恢复或回滚时被静默覆盖或触发 `TODO_CONFLICT`。
  5. **未明确 Capacitor `Filesystem` 缺少 `fsync` 与 `KanataKeyEnvelope` 的耐久性差距（Medium）**：`KanataKeyEnvelope.java:68–79` 使用 `AtomicFile` + `output.getFD().sync()` 强制落盘；而 `restoreJournal.js:46–48,67–68` 依赖 `@capacitor/filesystem` 的 `writeFile`/`rename` 加读回，读回仅证明 OS page cache 可见，不能证明断电后目录项与数据块落盘（**待验证**）。

### 2.4 GPT 第 5 节（受保护模块与全局改密）—— 对应审查重点 4

- **已核实准确的部分**：
  1. 受保护模块顺序（`passwords` → `chat`）、`runOperation` 串行队列、逆序补偿与 `verifier` 写回无读回校验均核实准确（`src/application/protectedModules.js:20–23`、`src/services/masterPasswordChange.js:1–24`、`src/stores/auth.js:38–66,232–243`）。
  2. 准确识别 `protectedAccess.recoveryRequired` 为进程内门禁、缺少跨重启的全局改密事务记录（Risk #3, Blocker）。
  3. 对 SQLCipher KEK 轮换优先于 `PRAGMA rekey` 的方向判断合理且审慎。
- **发现的遗漏与需要补强的关键细节**：
  1. **遗漏 `kanataStore.reencrypt()` 提前退休旧归档页的时序缺陷，以及 `masterPasswordChange.js` 单阶段接口不适配二阶段 KEK 轮换（High）**：
     - `src/features/chat/kanataStore.js:318–328` 在 `repository.reencrypt()` 成功后、**`auth.commitPasswordChange()` 尚未执行之前**，就立即调用 `archives.retire(retiredArchives)` 与 `repository.retireArchives(...)` 删除旧归档文件。
     - `src/services/masterPasswordChange.js:1–24` 目前只定义单阶段 `reencrypt(password)` 回调，没有 `prepare / commit / abort / retire` 阶段划分。若 SQLite 候选直接套用单阶段 `reencrypt(new)` 覆盖 `envelope.json`，则在 `auth.commitPasswordChange(new)` 前就会覆写旧封套；即使保留临时封套，单阶段接口也无法在 `auth.commitPasswordChange` 成功后收到“安全退休旧封套”的信号。
  2. **遗漏 `protectedAccess.prepareRecovery()` 在 `rollbackFailed` 后可能过早清除门禁、且 `rollbackFailed` 不联动 `restoreState.blocked`（High）**：
     - `src/stores/protectedAccess.js:121–125` 捕获 `rollbackFailed` 后仅设进程内 `recoveryRequired.value = true` 与 `target.suspendPersistence()`（`vaultStore.js:215–217`、`kanataStore.js:455–458` 均仅为内存状态），**既不落盘，也不设置 `restoreState.blocked`**。
     - `src/stores/protectedAccess.js:161–168` 的 `prepareRecovery()` 一旦被调用，会直接把 `recoveryRequired.value = false` 并重试 `ensureModules()`，若没有持久化的改密恢复日志，重启后系统会完全忘记发生过半提交/回滚失败！
  3. **遗漏 `KanataKeyEnvelope.java` 缺少 `rewrap` 原语且 `verifyInventory()` 拒绝临时封套文件（High）**：
     - `KanataKeyEnvelope.java:110–120` 的 `create()` 固定生成**新随机 32 字节 DEK**，没有复用既有 DEK 重新封装的 `rewrap()` 方法。
     - `KanataKeyEnvelope.java:84–87,96–99` 将 `iterations = 600000` 硬编码进头校验与 AAD 字符串。
     - `KanataSqlitePlugin.java:184–185` 明确拒绝 `envelope.json.bak` / `envelope.json.new`（抛出 `INCOMPLETE_CREATION`），改密分阶段落盘新封套必须同步扩展 `verifyInventory()` 的状态机识别，使其进入显式“改密待恢复”门禁而非误报 `INCOMPLETE_CREATION`。
  4. **遗漏 KEK 轮换 vs `PRAGMA rekey` 的精确威胁模型边界（Medium）**：
     - **已实现**的架构（`KanataKeyEnvelope.java:111,132–142`、`kanataSqliteKek.js:4–25`）已将用户主密码（衍生 KEK）与 SQLCipher 原始数据库密钥（32 字节随机 DEK → 67 字节 `x'<64 hex>'`）完全解耦。因此常规主密码变更**不需要**执行高风险、高 I/O、易与 WAL 冲突的 `PRAGMA rekey`。
     - 但安全审查必须明示边界：**纯 KEK 轮换不撤销已泄露的旧 DEK**（若攻击者此前同时窃取了旧 `envelope.json` 并获知旧主密码，从而离线解出了 DEK，且未来再次窃取同一设备的 `kanata.db`，纯 KEK 轮换无法阻断其解密）。在本应用纯本地、无云同步的威胁模型下，优先采用 KEK 轮换是正确权衡；若未来确需轮换 DEK，利用**便携逻辑备份导出 + 恢复至新建随机 DEK 目标库**（或经独立实测的 `sqlcipher_export` 新库替换）比原地 `PRAGMA rekey` 更崩溃安全。

### 2.5 GPT 第 6 节（SQLCipher 候选接入点与一致性导出）—— 对应审查重点 2

- **已核实准确的部分**：
  1. 准确核实候选桥当前仅开放 10 个方法（`prepare/unlock/begin/query/execute/commit/rollback/health/completeOpen/close`），固定操作 `no_backup/kanata-sqlite-v1/kanata.db` + `envelope.json` + `creation.pending`，尚无任意路径/第二临时库能力（`kanataSqliteTypes.d.ts:55–66`、`KanataSqlitePlugin.java:147–150`）。
  2. 准确核实 SQLCipher 4.17.0 配置（WAL、`synchronous=FULL`、`foreign_keys=ON`、`temp_store=MEMORY`、`cache_size=-2048`、`wal_autocheckpoint=1000`、`busy_timeout=5000`），`begin()` 调用 `beginTransactionNonExclusive()`（`BEGIN IMMEDIATE`），且 `health().checkpoint=1000` 仅反映 autocheckpoint 阈值而非已完成 checkpoint（`KanataSqlitePlugin.java:305–313,411,601–610`）。
  3. 准确检索确认项目源码与原生插件均**未接入** SQLite Online Backup API、`VACUUM INTO`、`sqlcipher_export`、显式 `wal_checkpoint` 或 `rekey`。
  4. 准确指出 WAL 模式下裸复制 `kanata.db` 存在严重一致性风险（活跃 WAL 帧未合入主库、并发写撕裂页、与 `-wal`/`-shm` 失配）。
- **发现的严重遗漏与事实偏差（Blocker/High/Low）**：
  1. **遗漏原生 `handleOnPause()` 无条件 `revoke()` 与 `nativeActivityGuard` 的致命冲突（Blocker）**：
     - `KanataSqlitePlugin.java:103–118` 在 Activity `onPause()` 时**无条件**设置 `foreground = false`、递增 `epoch` 并异步 `closeStorage()`；**完全不感知 JS 侧 `nativeActivityGuard`**（`src/services/nativeActivityGuard.js:6–42`）。
     - 然而备份导出/导入/恢复流程必然触发系统生物识别弹窗（`secureCredentials.js:41`）、Android 系统分享面板（`useBackupSettings.js:138–139`）和 SAF 文件选择器（`useBackupSettings.js:156–157`）——这些系统 Activity 都会触发 `onPause()`！
     - 即使 JS `kanataSqliteCandidate.js:58–63` 通过 `isNativeActivityGuardActive()` 跳过释放，原生插件早已把连接关掉并撤销 `epoch`，导致恢复/导出/改密链路出现“JS 认为连接存活、Native 静默撤销”的状态撕裂与 `KANATA_SQLITE_LEASE_REVOKED` / `CHALLENGE_INVALID` 竞态失败！
  2. **遗漏原生桥 262,144 字符参数上限 + 不可变触发器 + 2 MiB CursorWindow 对逻辑导出/导入的硬阻断（Blocker）**：
     - `KanataSqlitePlugin.java:505` 硬编码限制每个字符串参数 `length() <= 262144`（256 KiB UTF-16）。
     - 若 M6 逻辑方案试图经由现有 JS→Capacitor 桥做导入，一旦角色卡 `card_versions.raw_data_json` / `definition_json`、`message_audits`、`event_audits` 或 `messages.content` 超过 262,144 字符，`execute()` 会直接拒绝（`KANATA_SQLITE_STATEMENT_DENIED`）。
     - 且无法退化为“先插占位再分段 `UPDATE ... || ?` 拼接”：因为 `card_versions_immutable`（`kanataSchema.js:293`）、`event_audits_no_update`（`kanataSchemaHardening.js:52`）、`message_audits_restrict_update`（`kanataSchemaHardening.js:57–66`）**禁止常规 UPDATE**，且 `messages_edit_revision`（`kanataSchema.js:232–234`）禁止同 `revision` 改写 `content`（而 `revision >= 1`）。
     - 导出侧同样面临 Android `CursorWindow` 约 2 MiB 硬上限（`KanataSqlitePlugin.java:521–537` 直接 `cursor.getString(col)` 且单次最多 256 行）——这正是 M4 专门引入 `kanataMessageDetailRead.js:26`（`hex(substr(CAST(... AS BLOB), ?, 2048))`）的原因，GPT 报告未引用该既有实现模式，也未指出该桥接天花板对“JS 桥执行逻辑导入”的致命影响。
  3. **遗漏 `KanataSqlitePlugin` 单线程 Executor + 单事务排他对长事务快照的影响（High）**：
     - `KanataSqlitePlugin.java:45,49,410` 采用单线程 `Executors.newSingleThreadExecutor()` 且全局只允许 `transaction == null` 时开启一个事务。因此，经由 JS 桥在单个 `begin()` 内做数千次分批 `query`（参考 M5-06 100k 导入耗时 912.31 秒、RSS 561.5 MiB），不仅阻塞 SQLite 写者，还会**阻塞全部原生插件方法（含 `health()`）并大概率突破 P7 的 512 MiB RSS 上限**。
     - 相反，SQLite WAL 模式下，使用**独立 `OPEN_READONLY` 只读连接 + `BEGIN DEFERRED`（首条 `SELECT` 建立 WAL 读快照）**（`KanataSqlitePlugin.java:317` 的 `preflightExisting()` 已经验证 `OPEN_READONLY` 可用），并在 **Native 侧流式循环**导出与分块加密，可在有界常数内存下获取严格一致快照，且不持写锁（但需监控 WAL 在快照期间的增长并限制并发写者或暂停普通写入）。
  4. **遗漏 Schema v5 实际 53 表分类、`domain_command_receipts` 决策与复杂外键/触发器导入序（High）**：
     - 独立脚本核查 `kanataSchemaMigrator.js` (`kanataSchemaObjectsAt(5)`) 证实：Schema v5 共 **53 张 `STRICT` 表**，其中 3 张为 Schema/迁移运行表（`schema_migrations`、`schema_migration_applications`、`data_migrations`），50 张在 `KANATA_MIGRATION_TABLES`（`kanataDataMigrationRows.js:427–437`）中。
     - 50 张表中又有 **5 张为触发器派生表**（`entity_ids`、`participants`、`event_array_order`、`effect_array_order`、`baseline_array_order`），禁止直接 `INSERT`（触发器会抛 `KANATA_ENTITY_REGISTRY_OWNED` / `KANATA_DOMAIN_ARRAY_ORDER_IMMUTABLE`）。
     - 剩余 **45 张业务数据表**中，`domain_command_receipts`（`kanataSchema.js:277–281`、`kanataDomainRows.js:81–107`）在 M5 中恒为空，但在 SQLite 生产运行中会存有命令幂等收据——**GPT 报告全文未提及该表是否纳入备份及恢复语义**。
     - 逻辑导出/导入还必须显式处理：循环延迟外键（`worlds`↔`world_identities`、`character_cards`↔`card_versions`，`kanataSchema.js:60–63`）、非延迟自引用外键（`messages.reply_to_message_id`、`background_tasks.window_task_id`，`kanataSchema.js:92,129`）、`world_events.replaces_event_id` 两阶段更新（`kanataSchema.js:112`），以及 `world_events`/`world_effects`/`effect_baselines` 必须按 `*_array_order.ordinal ASC` 导出以保真原序（`kanataSchemaArrayOrder.js:29–51`）。
  5. **事实偏差：Schema v5 不存在任何 `BLOB` 列，且原生桥显式拒绝 `FIELD_TYPE_BLOB`（Low）**：GPT 报告第 6.2 节（`:163`）与第 7 节（`:173`）提及“大 TEXT/BLOB”，经核实 Schema v5 全部 53 张表无任何 `BLOB` 列，`kanataSqliteTypes.d.ts:1` 无二进制值类型，且 `KanataSqlitePlugin.java:527–533` 遇到 `Cursor.FIELD_TYPE_BLOB` 直接抛 `STATEMENT_DENIED`。

### 2.6 GPT 第 7–9 节（便携格式选型、恢复切换与风险拆分）—— 对应审查重点 5

- **已核实准确的部分**：
  1. 正确要求新格式采用独立魔数/类型和独立版本轴，不与 `formyself-full-backup` v12 / v13 混淆；正确保持旧格式并存路由。
  2. 正确识别跨设备恢复必须使用“导出时的备份密码”解封备份专用随机密钥，而目标设备使用本机授权会话和本机主密码封装目标 DB DEK，不依赖单设备 Keystore。
  3. 正确提出每块独立 AEAD、尾记录承诺与 EOF 校验、以及防止 TOCTOU 替换文件的两遍校验/私有 spool 思路。
- **需要挑战与补强的设计判断**：
  1. **遗漏 Android `minSdkVersion = 24` 与 JCA `PBKDF2WithHmacSHA256`（API 26+）的平台兼容陷阱（High）**：`android/variables.gradle:2` 配置 `minSdkVersion = 24`。Android 原生 `SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")` 仅在 **API 26+** 提供；如果未来在 Native Java 执行备份 KDF，直接调用该方法将在 Android 7.0/7.1 崩溃（须复用 WebCrypto 派生后短时传递，或基于 API 1 起可用的 `Mac("HmacSHA256")` 实现标准 RFC 2898 PBKDF2，并用跨端测试向量验证）。
  2. **未明确区分“线格式（逻辑 vs 物理）”与“执行引擎（JS 桥 vs Native 流）”两个正交维度，遗漏混合方案（High）**：详见第 5 节独立评价。
  3. **未冻结确定性计数器 Nonce 与 HKDF 子密钥派生规则（Medium）**：GPT 仅笼统要求“每个 key 下 nonce 全局唯一”（`:182`），未明确建议在每次导出生成随机 256-bit BEK（Backup Encryption Key）后，通过 HKDF-SHA256 按用途派生子密钥并配合**确定性 96-bit 计数器 Nonce**（彻底消除多块随机 nonce 的碰撞与重用风险）。
  4. **物理镜像方案中遗漏 `VACUUM INTO` 与 `ATTACH + sqlcipher_export` 的客观评估（Medium）**：SQLCipher Android 4.17.0 Java 封装层是否暴露 C 级 `sqlite3_backup_*` 尚**待验证**；在 SQLCipher 生态中，创建新随机 DEK 的一致物理副本往往通过 `ATTACH DATABASE ... KEY "x'...'"; SELECT sqlcipher_export(...)` 或 `VACUUM INTO`（两者的密钥继承、WAL 快照及 `STRICT`/触发器兼容均**待验证**），而不仅是“Online Backup 或冻结全停 checkpoint 复制”二选一。
  5. **未明确说明 SQLCipher `rawKey`（`x'<64 hex>'`）跳过 SQLCipher 内部 PBKDF2 的事实（Low）**：`KanataKeyEnvelope.java:132–142` 使用 `x'<64 hex>'` 原始密钥格式，因此 SQLCipher 物理页兼容耦合点在于 cipher/HMAC/page_size/plaintext_header_size 配置，而非 SQLCipher 自身的 `kdf_iter`（仍**待验证** 4.17.0 AAR 实测确认）。

---

## 3. 发现的遗漏与错误汇总

| 编号 | 类别 | GPT 报告位置 | 实际源码/测试依据 | 遗漏或错误说明 |
| --- | --- | --- | --- | --- |
| **F-01** | 遗漏（Blocker） | 第 6.1/8/9 节 | `KanataSqlitePlugin.java:103–118`、`kanataSqliteCandidate.js:58–63`、`useBackupSettings.js:138–139,156–157`、`secureCredentials.js:41` | Native `handleOnPause()` 无条件 `revoke()` 并关闭数据库，不感知 `nativeActivityGuard`；导出 Share、导入 SAF 选文件、生物识别弹窗均触发 `onPause()`，会撕裂 JS/Native 租约状态 |
| **F-02** | 遗漏（Blocker） | 第 6.1/6.2/7 节 | `KanataSqlitePlugin.java:505,521–537`、`kanataSchema.js:232–234,293`、`kanataSchemaHardening.js:52,57–66`、`kanataMessageDetailRead.js:26` | 现有 JS→Native 桥限制单字符串参数 `<= 262144` 字符，且 `card_versions`/`*_audits`/`messages` 触发器禁止插入后分段 `UPDATE` 拼接；同时查询受 Android `CursorWindow` ~2 MiB 上限约束。经现有 JS 桥执行逻辑导入无法处理超长角色卡/审计/消息 |
| **F-03** | 遗漏（Blocker） | 第 4/8/9 节 | `KanataSqlitePlugin.java:171–174`、`restoreJournal.js:5–7` | GPT 发现了旁文件名拼写偏差（`restore-v1.enc.commit`），但遗漏了第 173 行同时将主日志 `restore-v1.enc` 列为 `LEGACY_PRESENT`：只要恢复日志存在，Native 直接拒绝全部 `prepare()`/`unlock()`，阻塞协调器内部 SQLite 恢复 |
| **F-04** | 遗漏（Blocker） | 第 4/8 节 | `useAppController.js:536–544`、`protectedAccess.js:80,161–168`、`fullBackupRuntime.js:54–58`、`kanataBackupRuntime.js:65–70` | `retryFullRecovery()` 先调 `protectedAccess.prepareRecovery()`→`ensureModules()` 加载损坏/半切换的 `passwords`/`chat`，且 `recover()` 中仍执行 `registry.prepareExports()`；一旦上次崩溃导致任一受保护存储不可读，恢复入口直接死锁 |
| **F-05** | 遗漏（High） | 第 3.3/7.2/9 节 | `useBackupSettings.js:68,163–171,280` | 导入硬编码 `FileReader.readAsText(file)`（破坏二进制便携包且整文件入堆），且 `restoreFullBackup` 复用 `authStore.savedMasterPwd` 同时承担解包与日志加密；跨设备恢复需分离“外部包密码”与“本机主密码”，且须在 `journal.prepare()` 前脱离易失效的 SAF URI 完成私有目录 staging |
| **F-06** | 遗漏（High） | 第 5/9 节 | `kanataStore.js:318–328`、`masterPasswordChange.js:1–24`、`KanataKeyEnvelope.java:84–87,110–120`、`KanataSqlitePlugin.java:184–185` | `kanataStore.reencrypt()` 在 `auth.commitPasswordChange` 前就删除旧归档页；`masterPasswordChange.js` 缺二阶段 `prepare/commit/retire` 契约；`KanataKeyEnvelope` 缺保留原 DEK 的 `rewrap()` 原语且 `verifyInventory()` 将临时封套误判为 `INCOMPLETE_CREATION` |
| **F-07** | 遗漏（High） | 第 5/9 节 | `protectedAccess.js:13,121–125,161–168`、`vaultStore.js:215–217`、`kanataStore.js:455–458`、`useSecuritySettings.js:59–61` | 改密 `rollbackFailed` 仅设内存态 `recoveryRequired`/`suspendPersistence`，既不持久化也不设置 `restoreState.blocked`，冷重启即失效；进程内 `prepareRecovery()` 亦会直接清空 `recoveryRequired` |
| **F-08** | 遗漏（High） | 第 6.1/7 节 | `kanataSchema.js:60–63,92,112,129,277–281`、`kanataSchemaArrayOrder.js:29–51`、`kanataDataMigrationRows.js:427–437`、`kanataDomainRows.js:81–107` | 未清点 Schema v5 全部 53 表分类（3 运行表 + 5 触发器派生表 + 45 业务表）；全文未提及 `domain_command_receipts` 表备份语义；未梳理循环延迟外键、非延迟自引用外键（`messages.reply_to_message_id`、`background_tasks.window_task_id`）及 `*_array_order` 按 `ordinal ASC` 导出与序号对齐契约 |
| **F-09** | 遗漏（High） | 第 7.2 节 | `android/variables.gradle:2`、`kanataSqliteKek.js:18–20`、`KanataKeyEnvelope.java:24,122–130` | `minSdkVersion = 24`，而 Android JCA `PBKDF2WithHmacSHA256` 仅 API 26+ 支持；若 Native 侧直接执行 KDF 须规避 API 24/25 `NoSuchAlgorithmException` |
| **F-10** | 遗漏（High） | 第 6.2/7 节 | `KanataSqlitePlugin.java:45,49,317,410–411`、M5-06 100k 证据（912.31s / 561.5 MiB） | 未评估“逻辑线格式 + Native 流式引擎”混合方案，低估了经由现有单线程 JS 桥导出/导入 100k 消息对 P7 512 MiB RSS 与耗时的直接威胁 |
| **F-11** | 遗漏（Medium） | 第 4 节 | `TodoRepository.java:41–49,95–130`、`restoreCoordinator.js:37,55–57`、`restoreJournal.js:46–48,68` | (1) `state.blocked=true` 至 `restore-v1.enc` rename 落盘之间，Android Todo 小组件仍可写入 `my_todo_data_v1`；(2) `restoreJournal` 依赖 Capacitor `Filesystem` 读回而无显式 `fsync` |
| **F-12** | 遗漏（Medium） | 第 3.2/4 节 | `src/stores/settings.js:427–430`、`secureCredentials.js:53–66` | 原生设置恢复会写外部 `NativeBiometric`（`API_KEY_CREDENTIAL`），新全备与补偿设计须纳入该外部凭据状态 |
| **F-13** | 遗漏（Medium） | 第 5/7.1 节 | `KanataKeyEnvelope.java:94–119`、`kanataSqliteKek.js:11` | 未明确 KEK 轮换不防御“旧封套+旧密码已同时泄露后再次窃取新库”的威胁边界；未建议便携格式使用随机 BEK + HKDF 子密钥 + 确定性计数器 96-bit Nonce；未将 `VACUUM INTO` / `sqlcipher_export` 纳入物理快照实测候选 |
| **F-14** | 遗漏（Medium） | 第 3.3/8 节 | `useBackupSettings.js:113–120,211–222`、`backupRegistry.js:51–56` | 未梳理单项 `chat` 导入脱离 `RestoreCoordinator` 的现状如何并入统一门禁，也未指出 `useBackupSettings.js:116` 空数据判定耦合内存 DTO |
| **F-15** | 事实偏差（Low） | 第 6.2/7 节 | `kanataSchema.js` 全文、`kanataSqliteTypes.d.ts:1`、`KanataSqlitePlugin.java:527–533` | 报告提及“大 TEXT/BLOB”，实际 Schema v5 全 53 表零 `BLOB` 列，且原生桥显式拒绝 `FIELD_TYPE_BLOB` |
| **F-16** | 事实偏差（Low） | 第 3.2/7.2 节 | `src/stores/settings.js:390–480`、`KanataKeyEnvelope.java:132–142` | `settings.js` 行号截断至 445；未说明 `rawKey`（`x'<64 hex>'`）跳过 SQLCipher 内部 KDF 的特性 |

---

## 4. 独立风险与缺陷分级清单（Blocker / High / Medium / Low）

> 注：下表整合 GPT 已识别的核心风险与本次独立审查新增的遗漏项，标明来源（`[沿用并深化]` 或 `[独立新发现]`），作为 M6-01～M6-04 的开工与退出检查基线。

### Blocker（直接阻塞后续阶段正确性或导致死锁/数据风险，须在对应阶段开工前冻结设计）

1. **[B-01 独立新发现 + 深化] 恢复态原生硬阻断与 `retryFullRecovery` 半损坏死锁**
   - **依据**：`KanataSqlitePlugin.java:171–174`（`restore-v1.enc` 被判 `LEGACY_PRESENT`）、`kanataSqliteCandidate.js:55–57,156–157`、`useAppController.js:536–544`、`protectedAccess.js:80,161–168`、`kanataBackupRuntime.js:65–70`。
   - **风险**：只要 `restore-v1.enc` 存在，Native 拒绝任何 SQLite 打开；同时 `retryFullRecovery` 在进入 `recover()` 前强行 `ensureModules()` 加载可能已损坏的受保护模块，且 `recover()` 中仍调用 `registry.prepareExports()`。若恢复中断，冷启动恢复入口将死锁。
   - **冻结要求**：M6-03 前必须设计受限的恢复专用认证/能力通道（`recovering: true` 允许跳过 `prepareExports()` 及受损模块普通预加载；Native 识别恢复日志并在受限恢复能力下仅允许校验/切换已登记世代）。

2. **[B-02 独立新发现] Native `handleOnPause()` 无条件撤销连接与系统弹窗/SAF/分享冲突**
   - **依据**：`KanataSqlitePlugin.java:103–118`、`kanataSqliteCandidate.js:58–63`、`useBackupSettings.js:138–139,156–157`、`secureCredentials.js:41`。
   - **风险**：备份导入（SAF）、导出（Share）与认证（生物识别）均会触发 Android `onPause()`。Native 立即撤销 `epoch` 并关库，与 JS `nativeActivityGuard` 语义不一致，导致导出/导入/恢复竞态中断。
   - **冻结要求**：M6-02/M6-03 必须冻结原则——**绝不在跨 Activity 系统弹窗期间持有未完成 SQLite 连接/事务**；先完成本地私有文件导出/校验并关闭句柄再调用 `Share`；导入时在 SAF 返回且 Activity 确认处于 `onResume` 后才进入受保护数据库阶段；同时统一 JS/Native 租约撤销同步。

3. **[B-03 独立新发现] JS→Native 桥 262,144 字符上限、不可变触发器与 CursorWindow 上限阻断纯 JS 桥逻辑导入/导出**
   - **依据**：`KanataSqlitePlugin.java:505,521–537`、`kanataSchema.js:232–234,293`、`kanataSchemaHardening.js:52,57–66`、`kanataMessageDetailRead.js:26`。
   - **风险**：若逻辑备份通过现有 JS 桥逐行导入，超 256 KiB 的 `card_versions`/`*_audits`/`messages` 将因 `STATEMENT_DENIED` 失败且被不可变触发器禁止分段 `UPDATE`；导出侧大字段还会触发 Android `CursorWindow` ~2 MiB 崩溃，且 100k 跨桥开销（参考 M5 912s / 561.5 MiB）突破 P7 512 MiB 内存红线。
   - **冻结要求**：M6-01 冻结线格式时须设计为**支持 Native Java 与 JS/Node 双端零差异流式读写**的紧凑分块格式，M6-02/M6-03 在 Android 上由 Native 流式引擎直接访问 SQLCipher（无 262k 桥参上限，长字段采用流式读取/绑定）。

4. **[B-04 沿用并深化] 全局改密无跨重启持久化决策，且 `rollbackFailed` 无法在重启后保持 blocked**
   - **依据**：`src/services/masterPasswordChange.js:1–24`、`src/stores/protectedAccess.js:13,121–125,161–168`、`src/stores/auth.js:38–66,232–243`、`src/features/vault/vaultStore.js:198–217`、`src/features/chat/kanataStore.js:297–338,455–458`。
   - **风险**：进程在改密中途强停或回滚失败重启后，`recoveryRequired`/`persistenceSuspended` 清零，导致密码库、SQLite 封套与 `auth.verifier` 处于混合密码分裂态，且普通模块未受阻断。
   - **冻结要求**：M6-04 必须引入持久化改密事务日志（含启动探测门禁）、二阶段 `prepare/commit/retire` 参与者契约及 `KanataKeyEnvelope.rewrap()`。

5. **[B-05 沿用并深化] SQLite 一致性快照原语与 WAL 行为尚未在 SQLCipher 4.17.0 AAR 实测验证**
   - **依据**：`android/app/build.gradle:102`、`KanataSqlitePlugin.java:305–313,317,407–412,601–610`。
   - **风险**：当前代码未接入任何原生快照/导出原语；`sqlite3_backup_*` 在该 AAR Java 层的可用性、`VACUUM INTO` / `sqlcipher_export` 在 `rawKey` + WAL + `STRICT` 下的语义、以及只读快照期间 WAL 增长均属**待验证**。
   - **冻结要求**：M6-01 不提前押注未经验证的 SQLCipher 原生 API；M6-02 首要门禁为隔离合成环境的原生快照能力实测。

### High（影响设计完整性、安全边界或跨设备恢复可靠性，须在 M6-01～M6-04 明确闭环）

6. **[H-01 独立新发现] Schema v5 全部 53 表分类、`domain_command_receipts` 决策与外键/原序导入契约未冻结**
   - **依据**：`kanataSchema.js:53–299`、`kanataSchemaHardening.js:39–83`、`kanataSchemaArrayOrder.js:2–58`、`kanataDataMigrationRows.js:427–437`、`kanataDomainRows.js:81–107`。
   - **要求**：M6-01 必须冻结 53 表的精确归属表（3 张排除表、5 张触发器重建校验表、45 张逻辑导出表含 `domain_command_receipts` 与 `archived_message_marks` 的明确处置），并明确循环延迟 FK、非延迟自 FK（`messages.reply_to_message_id`、`background_tasks.window_task_id`）、`replaces_event_id` 二遍更新和 `*_array_order` 按 `ordinal ASC` 导出与序号校验口径。

7. **[H-02 独立新发现] `useBackupSettings.js` 的 `FileReader.readAsText`、密码耦合与 SAF URI 崩溃失效**
   - **依据**：`src/composables/settings/useBackupSettings.js:68,160–197,280`。
   - **要求**：分离“外部包密码”与“本机主密码”；二进制便携格式禁止走 `readAsText`；导入前先于应用私有空间完成全包认证与 staging 落盘，再进入 `RestoreCoordinator.prepare()`。

8. **[H-03 独立新发现] `minSdkVersion = 24` 下 Android JCA 缺少 `PBKDF2WithHmacSHA256`（API 26+）**
   - **依据**：`android/variables.gradle:2`、`src/platform/security/kanataSqliteKek.js:18–20`。
   - **要求**：M6-01 确定 KDF 参数与实现边界时，若 Native Java 参与包解封，须用 `HmacSHA256` 自实现 RFC 2898 PBKDF2 或由 WebCrypto 派生后短时传递，并提供非 ASCII / UTF-8 跨端一致性测试向量。

9. **[H-04 沿用] `restoreJournal.commit()` 缺少 `expectedDigest` 绑定与密钥认证**
   - **依据**：`src/platform/storage/restoreJournal.js:50–81`、`src/application/restoreCoordinator.js:58–72`。
   - **要求**：扩展 `commit(expectedDigest)` 并在提交标记中纳入与主日志绑定的认证 MAC（或经同一密钥派生的提交认证标签），且在原生存储层验证 `fsync` 落盘语义。

10. **[H-05 沿用] `KanataSqlitePlugin.java:173` 日志旁文件名与 `restoreJournal.js` 不一致**
    - **依据**：`KanataSqlitePlugin.java:173`（`restore-v1.enc.commit`/`restore-v1.enc.tmp`）vs `restoreJournal.js:5–7`（`restore-v1.commit`/`restore-v1.tmp`）。
    - **要求**：统一共享常量/协议清单，确保 JS 恢复日志、Android Todo 原生门禁与 Kanata SQLite 原生盘点检查完全一致。

11. **[H-06 独立新发现] `KanataKeyEnvelope` 缺 `rewrap()` 且 `verifyInventory()` 拒绝改密临时封套**
    - **依据**：`KanataKeyEnvelope.java:81–120`、`KanataSqlitePlugin.java:184–185`。
    - **要求**：M6-04 增加保留原 DEK、换新随机 salt/nonce 并读回解封核验的 `rewrap()` 原语，并扩展 `verifyInventory()` 识别改密暂存态。

### Medium

12. **[M-01 独立新发现] `state.blocked=true` 至 `restore-v1.enc` 落盘期间，Android Todo 小组件存在写竞态窗口**（`TodoRepository.java:95–130`、`restoreCoordinator.js:37,55–57`、`restoreJournal.js:68`）；且 `restoreJournal.js` 缺少显式原生 `fsync`（对比 `KanataKeyEnvelope.java:72`）。
13. **[M-02 独立新发现] `settings.restoreBackupSnapshot` 写入原生 `NativeBiometric` API Key 外部凭据**（`src/stores/settings.js:427–430`、`secureCredentials.js:53–66`），全备恢复与回滚测试须覆盖原生凭据一致性。
14. **[M-03 独立新发现] 单项 Kanata 恢复当前绕过 `RestoreCoordinator`**（`useBackupSettings.js:211–222`、`backupRegistry.js:51–56`），SQLite 单项切库须并入统一协调器或受同一全局门禁保护；同时更新 `useBackupSettings.js:116` 的空库检查与 DTO 假设。
15. **[M-04 沿用并深化] 便携格式加密契约需明确随机 BEK + HKDF 子密钥 + 确定性计数器 96-bit Nonce，并明示 KEK 轮换与 DEK 泄露的威胁模型边界**（`m6-00-architecture-audit-v1.md:182,197`）。

### Low

16. **[L-01 独立新发现] GPT 报告多处提及“大 TEXT/BLOB”，与 Schema v5 零 `BLOB` 列及原生桥拒绝 `FIELD_TYPE_BLOB` 不符**（`kanataSchema.js`、`KanataSqlitePlugin.java:527–533`）。
17. **[L-02 沿用 + 独立补充] 旧测试历史命名（`v6`/`v5→v6`）易误读（`tests/fullBackup.test.js:79,238`）；`settings.js` 行号与 `rawKey` 跳过 SQLCipher 内部 KDF 的细节可同步澄清**。

---

## 5. 对两种备份格式及混合方案的独立评价

GPT 报告第 7 节比较了 **方案 A（固定目录的版本化逻辑记录流）** 与 **方案 B（一致的 SQLCipher 物理镜像流）**，倾向以方案 A 作为首个原型，同时保留方案 B 待实测比较。

**独立架构评估认为：GPT 倾向逻辑格式的直觉方向是对的，但将“线格式”与“执行路径（JS 桥 vs Native）”绑定在了一起，导致方案 A 隐藏了严重的桥接性能/长度陷阱，而方案 B 的替代路径（`VACUUM INTO` / `sqlcipher_export`）评估不够充分。**

### 5.1 客观对比：方案 A vs 方案 B vs 混合方案 C

| 评审维度 | A. 纯 JS 桥逻辑记录流（GPT 隐含形态） | B. SQLCipher 物理镜像流 | **C. 混合架构（推荐）：外层统一分块 AEAD 容器 + 逻辑记录流线格式 + Android Native 流式引擎** |
| --- | --- | --- | --- |
| **跨设备 / 跨版本便携性** | **高**：与 SQLCipher 版本、ABI、页大小、Schema 物理布局解耦；Web/Node 可纯 JS 互读 | **低–中**：耦合 SQLCipher 4.x cipher/HMAC/page_size 规范及精确 `sqlite_schema` DDL 校验（`KanataSqlitePlugin.java:341–361`）；Web 无法原生读取 | **高**：线格式与 A 100% 相同，M6-01 纯 JS/Node 参考 Codec 与 Android Native 引擎共享同一套冻结格式与测试向量 |
| **密钥域隔离** | **优**：源 DB DEK 永不离开源设备；目标库始终生成全新随机 DEK | **中**：若直接导源库需封装源 DEK（风险高）；若用 `ATTACH + sqlcipher_export` 到新临时 DEK 则可隔离，但 API 行为**待验证** | **优**：源 DB DEK 永不离开源设备；目标库恢复自动完成新随机 DEK 轮换 |
| **100k 性能与 P7 512 MiB 内存** | **高风险（大概率超标）**：参考 M5-06 100k 跨桥导入耗时 **912.31s、RSS 561.5 MiB**，已突破 512 MiB 红线 | **优**：顺序页读写，常数级 RSS，无索引重建开销 | **良–优**：Android 端在 Native Java 内通过单只读快照游标 + 有界缓冲区直接流式编码/AEAD 写盘，消除数千次 Capacitor JSON 桥接序列化与 V8 堆膨胀 |
| **超长字段（>256 KiB）兼容** | **硬失败**：受 `KanataSqlitePlugin.java:505` 262,144 字符上限与不可变触发器阻断 | **天然支持**：不受 JS 桥参数上限与 CursorWindow 约束 | **支持**：Native `SQLiteStatement.bindString` 无 262k 桥限制；超 CursorWindow 字段在 Native 侧分段读/拼装或按需流式读取 |
| **任务暂停策略（`pause-sending-v1`）** | **优**：导出与导入时直接按规则改写逻辑记录，零源库修改 | **较差**：需在临时物理副本上以读写模式 `UPDATE background_tasks` 并重做 checkpoint，导致物理哈希与源库脱节 | **优**：与 A 相同，导出与导入双端确定性强制执行，源库严格只读 |
| **安全防御（恶意包注入）** | **优**：目标库由固定 `migrateKanataSchema` 重建，所有 `STRICT`/`CHECK`/FK/触发器全量重验 | **中–高**：依赖 `verifyReadOnlySchema()` + `integrity_check` + `foreign_key_check`；仍暴露 SQLite C 解析器攻击面 | **优**：与 A 相同，不信任外部 SQLite 二进制页结构 |
| **存储体积** | **优**：不含 B-tree 空洞与 18+ 二级索引（约缩小 50%–70%） | **中**：含全部索引与 B-tree 内部碎片（除非先 `VACUUM INTO`） | **优**：与 A 相同，再叠加可选有界分块压缩 |
| **实现复杂度** | 中（45 表逻辑映射 + FK 序 + 桥接改造） | 中–高（依赖未验证的 SQLCipher 快照/导出 API + 双份磁盘空间 + 任务改写） | 中（M6-01 冻结线格式与 JS 参考 Codec；M6-02/M6-03 实现 Native 流式读写，逻辑与 M5 行契约高度一致） |

### 5.2 独立选型裁决建议

1. **推荐首选混合架构 C（外层载荷无关的分块 AEAD 容器 + 内部逻辑记录流 `kanata-logical-v1` + Android 侧 Native 流式执行引擎）**：
   - **为什么不建议用“纯 JS 桥逻辑流”**：不是逻辑格式不好，而是 **262,144 字符桥参上限 + 不可变触发器 + M5 实测 912s / 561.5 MiB** 已经证明现有 Capacitor SQL 桥不适合承担 100k 级全库备份/恢复的数据面搬运。
   - **为什么不建议将“物理镜像流”作为唯一便携格式**：物理镜像在跨版本升级、Web 兼容、DEK 隔离与任务暂停语义上存在结构性短板，且依赖尚未实测的 SQLCipher 4.17.0 快照 API。
   - **保留外层容器扩展位**：M6-01 将外层容器设计为**载荷无关的流式加密容器**（`streams[]` 可携带 `kanata-logical-v1` 以及未来完整备份的 `nonchat-full-v1` 等命名流），这样即便 M6-02 实测发现极端场景需要物理镜像补充，容器加密与认证层也无需推倒重来。
   - **是否需要在 M6-02 顺带实测物理快照 API？** 建议以极低成本做一次只读能力探测（确认 `sqlcipher-android:4.17.0` 是否暴露 `sqlite3_backup_*`、`VACUUM INTO` 加密语义及 `OPEN_READONLY` WAL 读快照并发表现），但**核心主路线应锚定“逻辑线格式 + Native 只读快照流式导出”**。

### 5.3 KDF、密钥信封与分块 AEAD 的严格安全规格建议（给 M6-01）

为防止 M6-01 设计留下密码学漏洞，补充以下硬性设计约束：

1. **KDF 与跨设备密码编码**：
   - **编码规范**：密码按严格 UTF-8 字节编码（拒绝孤立 UTF-16 代理项，同 `src/shared/crypto/utf8Words.js`；**不做** NFC/NFKC 静默规范化）。
   - **算法与域分离**：优先在 M6-01 实测并冻结 **PBKDF2-HMAC-SHA256**（全平台 WebCrypto 零外部依赖；Android API 24/25 兼容需注意 [H-03]），强制使用便携备份专属域分离前缀（例如 `ForMyself/Backup/KEK/v1\0` + 16 字节随机盐），**严禁复用**本地数据库 KEK 域前缀 `ForMyself/Kanata/KEK/v1\0`（`kanataSqliteKek.js:11`）。
   - **参数上下界白名单**：读端同时校验 `minIterations`（防降级攻击）与 `maxIterations`（防恶意包 CPU DoS）。
2. **两层密钥体系（KEK → BEK → 子密钥）**：
   - 每次导出由 CSPRNG 生成**全新随机 32 字节 `BEK`（Backup Encryption Key）**与随机 16 字节 `backupId`。
   - `KEK` 用 AES-256-GCM 封装 `BEK`（随机 12 字节 `wrapNonce`，AAD = 完整未加密的规范公开头字节，绑定魔数、容器版本、KDF 算法/参数/盐、`backupId`、`scope`、`payloadKind`）。
   - 用 `HKDF-SHA256(ikm=BEK, salt=backupId, info=...)` 派生独立子密钥（或按域分离 `info` 派生）：`K_manifest`、`K_chunk`、`K_footer`。
   - **跨设备恢复保证**：源设备数据库 DEK 与设备 Keystore **零参与**；目标设备仅凭“外部包密码”解出 `BEK` 还原数据，再由目标设备本机认证会话生成**全新目标数据库 DEK**并用目标机主密码封装。
3. **分块 AEAD 防重排、防截断、防替换、防串包**：
   - **确定性 96-bit 计数器 Nonce**：因每次导出 `BEK` 严格唯一，采用确定性 12 字节 Nonce：`streamId (uint16 BE) || frameType (uint8) || reserved (uint8=0) || chunkIndex (uint64 BE)`。从数学上杜绝同密钥下 Nonce 碰撞与重试复用（重试导出必须重新生成随机 `BEK` 与 `backupId`）。
   - **二进制定长结构化 AAD**（禁止歧义字符串拼接）：`SHA-256(rawPublicHeader) (32B) || streamId (u16) || frameType (u8) || flags (u8, 含压缩位与 final 位) || chunkIndex (u64) || plaintextLen (u32) || ciphertextLen (u32)`。
   - **防截断与防追加**：
     - 除末尾数据块置 `FINAL` 标志外，强制以独立的受认证 `FOOTER` 帧收尾（`frameType = FOOTER`），内含每条流的 `totalChunks`、`totalPlainBytes`、`totalCipherBytes`、逐块密文链式哈希（running SHA-256）以及逻辑表行数/内容摘要。
     - 读端强制校验 `chunkIndex` 从 `0` 严格加 1 连续递增、收到 `FOOTER` 后**精确到达 EOF（零尾随字节）**；0 行空库也必须具备合法 `MANIFEST` + `FOOTER`。
   - **两遍校验 vs 单遍隔离 staging 的磁盘/安全权衡**：
     - 若严格执行“损坏包在目标 staging 写前拒绝”且防 Android SAF 二次读取 TOCTOU：先将外部流单遍拷贝至应用私有临时 spool 文件（同时完成 pass-1 全量 AEAD + `FOOTER` + EOF 认证并记录文件总 SHA-256），全部通过后再从私有 spool 流式解包至隔离 staging 库（pass-2 仍逐块重验 AEAD 标签与总 SHA-256），失败即删 spool 与 staging。需在 M6-01/M6-02 实测并记录低存储空间下（~2×–3× 空间需求）的容量预算与提前空间检查。

---

## 6. 对 M6-01 开工条件的判断

**独立判定：有条件允许进入 M6-01（CONDITIONAL GO），但当前状态尚不可直接动手编码，必须先满足以下 2 类前置条件：**

### 6.1 治理前置条件（须用户书面确认）

1. **明确 M5 整体状态与 M6-01 启动授权的关系**：`docs/20261119-kanata-sqlite-m5-06-closeout-v1.md:6,54` 明确记录 **M5 整体仍为 OPEN / NOT ACCEPTED**，且未授权启动 M6。须由用户决定是先关闭 M5 整体账本，还是明确授权在 M5-06 PASS 基线 `2b6e8e35` 上并行切出独立分支 `m6/encrypted-backup-recovery` 启动 M6-01。
2. **确认分支隔离**：不得在 `m5/json-archive-migration` 分支混入 M6 实现代码；须另立 M6-01 任务书并在新分支推进。

### 6.2 技术前置条件（须写入 M6-01 任务书 / 格式规范，无需返工重做整份 M6-00）

GPT 的 M6-00 审计报告整体信息准确、边界清晰，**无需推倒重写**；但 M6-01 任务书必须吸收本文以下 5 项强制补充输入后方可冻结格式规范：

1. 明确采用 **外层载荷无关的分块 AEAD 容器 + 逻辑记录流 `kanata-logical-v1`**，并要求格式规范同时满足 **JS/Node（M6-01）与 Android Native Java（M6-02/M6-03）零差异流式编解码**（规避 [B-03] 262k 桥参上限与 512 MiB RSS 风险）。
2. 在 M6-01 规范中冻结 **Schema v5 全部 53 表的归属矩阵**（特别是明确 `domain_command_receipts` 的导出/恢复策略、5 张触发器派生表的重放校验规则、循环延迟 FK 与非延迟自 FK 拓扑序、`*_array_order` 按 `ordinal ASC` 导出契约，见 [H-01]）。
3. 明确 **KDF 的 API 24/25 兼容策略**（[H-03]）、严格 UTF-8 无规范化编码、备份专属域分离盐、随机 `BEK` + HKDF 子密钥 + 确定性 96-bit 计数器 Nonce（[M-04]）。
4. 明确 **外部包密码与本机主密码职责分离**、二进制流式输入（禁止 `FileReader.readAsText`）以及 SAF 私有 spool 策略（[H-02]）。
5. 提前把 [B-01]（`KanataSqlitePlugin.java:173` `restore-v1.enc` 拦截与 `retryFullRecovery` 死锁）、[B-02]（`handleOnPause` vs `nativeActivityGuard`）与 [B-04]/[H-06]（二阶段改密日志与 `rewrap()`）正式登记为 M6-02/M6-03/M6-04 的硬性退出门禁，避免 M6-01 做出与后续集成冲突的接口假设。

---

## 7. 建议的最小设计调整

在不扩大 M6 范围、不引入外部重型依赖、不破坏 v1–v13 既有兼容性的前提下，建议按阶段实施以下最小调整：

### M6-01（便携格式规范与纯 JS/Node 合成 Codec）

1. **冻结二进制流式容器格式（建议内部标识 `kanata-portable-backup` v1，独立魔数如 `FMKB\x00\x01`）**：
   - 支持 `scope: 'kanata-single' | 'full'` 与多命名流（`manifest`、`kanata-logical-v1`、预留 `nonchat-full-v1`、`footer`），实现纯流式有界编码/解码（禁止整文件字符串拼接或 `readAsText`）。
   - 固化随机 `BEK` + HKDF-SHA256 子密钥 + 确定性 96-bit 计数器 Nonce + 定长二进制 AAD + `FOOTER` + 严格 EOF。
2. **冻结 53 表逻辑目录与确定性校验口径**：
   - 排除 3 张 Schema/迁移表；5 张派生表由触发器重建后校验（`*_array_order` 按每世界相对序号保真，而非硬绑旧稀疏 ordinal）；明确 `domain_command_receipts` 纳入或排除（建议：若便携恢复视为新实例状态起点，可明确选择**纳入并验证**或**显式清空**并写入格式规范，避免模糊）。
   - 明确 `messages.reply_to_message_id` 与 `background_tasks.window_task_id` 的父先于子拓扑序（或安全二遍写入），以及 `pause-sending-v1` 在导出与导入双端的一致应用与摘要计算点（建议：导出端先应用 `pause-sending-v1` 再计算逻辑表摘要，使导出包内数据与目标库恢复后数据摘要完全一致）。
3. **跨端兼容测试向量**：产出含非 ASCII 密码、空库、超 262 KiB 长字段、恶意截断/尾随/重排/串包/降级 KDF/超限 KDF 的确定性二进制测试向量，供 M6-02 Native Java 引擎直接复用对拍。

### M6-02（Android SQLCipher 一致性快照与有界流式导出）

1. **优先实施 Native 只读快照流式导出**：
   - 在隔离合成环境实测 `OPEN_READONLY` 连接 + `BEGIN DEFERRED` WAL 读快照（参考 `KanataSqlitePlugin.java:317`）在并发读写与 100k 下的 WAL 增长、RSS、耗时；同步低成本探测 `sqlcipher-android:4.17.0` 是否暴露 `sqlite3_backup_*` / `VACUUM INTO` / `sqlcipher_export` 行为并留档。
   - 导出数据面在 Native Java 侧以固定游标分批读取（大字段经 `substr` / 流式读取规避 CursorWindow 2 MiB 上限），直接分块 AEAD 写入应用私有临时文件，全部完成并关闭数据库快照句柄后，再交由前端触发 `Share.share()`（彻底规避 [B-02] `handleOnPause()` 冲突）。
2. **补齐 API 24/25 KDF 兼容**：Native 侧如执行 PBKDF2-HMAC-SHA256，使用基于 `Mac("HmacSHA256")` 的标准实现或 WebCrypto 短时派生传入（并立刻清零缓冲），与 M6-01 向量逐字节一致。

### M6-03（隔离临时库恢复、世代切换与 RestoreCoordinator 集成）

1. **世代目录与原子指针切换（原生最小扩展）**：
   - 在 `no_backup/kanata-sqlite-v1/` 下引入版本化世代目录（如 `gen-<uuid>/` 内含成对的 `kanata.db` + `envelope.json`）与 `AtomicFile` + `fsync` 保护的 `active-generation.json` 指针，拒绝跨代复用 `-wal`/`-shm` 或封套。
2. **解除 `RestoreCoordinator` 与 Native 的恢复态死锁（[B-01]）**：
   - 修正 `KanataSqlitePlugin.java:173` 的旁文件名拼写（对齐 `restore-v1.commit`/`restore-v1.tmp`），并将“存在 `restore-v1.enc`”与 `LEGACY_PRESENT` 分离为显式 `RESTORE_PENDING` 门禁。
   - 新增仅限协调器恢复阶段调用的受限原生能力（允许在 `restore-v1.enc` 存在时仅对日志已认证绑定的 `previous`/`target` 世代做校验、指针切换与冷开验证，严禁普通业务读写）。
   - 修复 `kanataBackupRuntime.js:65–70` 与 `useAppController.js:536–544`：`recover()` 路径跳过 `registry.prepareExports()`，且允许在受保护模块因上次崩溃无法普通加载时仍能通过身份验证进入恢复重放。
3. **加固 `restoreJournal.commit(expectedDigest)` 与单/全备统一门禁**：
   - `commit()` 接收并校验精确 `expectedDigest`，且写入经密钥认证的提交标记；Android 侧核验 `fsync` 耐久语义；单项 Kanata SQLite 恢复走同一协调器与门禁，不另建平行恢复机制。

### M6-04（主密码变更跨重启持久化与二阶段 KEK 轮换）

1. **升级 `masterPasswordChange.js` 为持久化二阶段事务（默认 KEK 轮换，不启用 `PRAGMA rekey`）**：
   - 顺序：`writePersistentPwChangeJournal(prepared)` → 各受保护模块 `prepareReencrypt(newPwd)`（SQLite 调用新增 `KanataKeyEnvelope.rewrap()` 写出并读回核验独立新封套 `envelope.next.json`，**不动旧 `envelope.json` 与 `kanata.db`**）→ `auth.commitPasswordChange(newPwd)`（带读回核验）→ `commitPersistentPwChangeJournal()` → 各模块 `commitAndRetire()`（原子替换 `envelope.json` 并退休旧材料）→ 清理改密日志。
   - 若 `commit` 前任一步失败或崩溃：冷启动探针识别未提交改密日志，**统一置全局 blocked**，提示验证身份后回滚/清理暂存新封套并保持旧密码生效；若 `commit` 后崩溃：冷启动探针按已提交决定继续完成剩余模块重加密与旧封套退休。
   - 若回滚失败：持久化保留改密日志与全局 `blocked` 状态，确保重启后不会自动解除门禁或被 `prepareRecovery()` 误清空。
