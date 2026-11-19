# Kanata SQLite M6-00 架构审计与设计输入冻结任务书 v1

- 状态：**READY — READ-ONLY AUDIT**
- 推荐执行模型：**GPT-6.2 Sol High**
- 备选复核模型：Gemini 4 Neon High
- 任务角色：资深存储/安全架构审计员
- 仓库：`Zhoubin601/ForMyself`
- 规划分支：`m5/json-archive-migration`
- 基线 HEAD：`2b6e8e3591385024576c6606cce2acc31dbaad2b`
- 总体路线：[M6 加密备份、恢复与改密计划](20261119-kanata-sqlite-m6-encrypted-backup-recovery-plan-v1.md)
- 上游约束：[M 迁移总计划](20261103-kanata-sqlite-migration-plan-v1.md)
- 本任务只授权只读审计和新增设计输入报告；不授权业务代码修改、格式实现、数据库操作或真实数据访问。

## 1. 任务目标

为 M6-01 的实现任务书准备准确、可落地的设计输入。审计当前备份、恢复、密钥、主密码变更与 Kanata SQLite 候选实现，识别真实接口、格式兼容、事务边界和故障恢复约束。

本任务的完成标准是：**给出可由后续实现 Agent 直接执行的最小设计与接口决策依据**。本轮不写实现代码。

## 2. 必须先核对的基线

1. 确认当前远端 M5 分支 HEAD 与任务书基线是否一致。
2. 检查主工作区、worktree、分支与未提交/未跟踪文件；不得 reset、clean、stash 或覆盖其他工作。
3. 阅读根目录 `AGENTS.md`、`架构接口与Agent开发说明书.md`、`memory-bank/development-context.md`。
4. 阅读 M5-06 closeout、最终独立复核报告及 M 迁移计划第 6–10 节。
5. 任何基线不一致或工作区存在无法归属的修改，停止并报告，不要自行重置环境。

## 3. 审计范围

### A. 既有完整备份格式与兼容

重点检查：

- `src/services/fullBackup.js`
- `src/application/backupRegistry.js`
- `src/application/backupParticipants.js`
- `src/application/fullBackupRuntime.js`
- `src/application/kanataBackupRuntime.js`
- `src/features/chat/backup/kanataBackup.js`
- `src/composables/settings/useBackupSettings.js`
- 相关 DTO、格式验证、单项备份、完整备份测试。

必须明确：
1. 完整备份 v1–v12 的实际读取、写入和转换路径。
2. Kanata 产品组合 v13 的真实字段与兼容路径。
3. 现有备份是否已经包含 Kanata 完整聊天图、归档页、来源关系、扩展字段。
4. 单项备份与完整备份各自的认证、ready、flush、validate、restore 和 merge/overwrite 语义。
5. 新增 SQLite 备份内容需要在哪些真实注册点接入；哪些旧格式必须保持原样。
6. 不得仅依据架构说明推断当前实现，逐项定位源码和测试。

### B. RestoreCoordinator 与恢复日志

检查：

- `src/application/restoreCoordinator.js`
- `src/platform/storage/restoreJournal.js`
- `src/platform/storage/restoreState.js`
- `src/application/fullBackupRuntime.js`
- `src/main.js`
- 相关 RestoreCoordinator / ProtectedDataRecovery 测试。

必须画出实际恢复状态流：
输入验证 → 写入阻断 → prepare/flush → capture → journal 持久化及读回 → apply → commit → clear → unblock → synchronize。

明确：
- 当前 journal 的字段、加密封装、commit digest 绑定、清理顺序。
- 各中断点重启后 previous/target 的选择条件。
- rollback 失败、journal 损坏、sync 失败分别如何处理。
- Kanata SQLite 临时库如何进入受控 apply，而不绕过现有协调器。
- 当前协调器哪些能力可以复用，哪些需要最小扩展。

### C. 受保护模块与主密码变更

检查：

- `src/application/protectedModules.js`
- `src/stores/protectedAccess.js`
- `src/services/masterPasswordChange.js`
- `src/platform/security/secureCredentials.js`
- Kanata Store 的 `release/reencrypt/flush/suspendPersistence` 实际实现。
- 主密码变更与回滚测试。

必须明确：
- 受保护模块参与顺序和操作租约语义。
- Kanata 当前 reencrypt 的真实效果：是重加密旧 JSON、重新封装数据库密钥，还是 SQLCipher rekey。
- 其他受保护模块失败时 Kanata 如何补偿。
- rollbackFailed 后系统如何保持 blocked。
- 设备 Keystore 与跨设备恢复的职责边界。
- 当前是否存在可复用的版本化 KDF / envelope 实现；不得凭命名推断。

### D. Kanata SQLite M5 候选与 M6 交接点

检查：

- `src/features/chat/storage/sqlite/`
- `src/features/chat/storage/kanataRepository.js`
- `src/features/chat/kanataStore.js`
- M5 migrator、Schema、SQLCipher QA 与 M5-06 关账证据。

必须明确：
- M5 当前哪些代码仅供 synthetic QA，哪些已被业务代码引用。
- SQLCipher 插件/原生桥的真实 API、open/close、事务、backup API、checkpoint、连接所有权。
- 当前 Schema/application_id/version 和迁移表结构。
- 是否存在 SQLite Online Backup API；若无，需比较可行的一致快照路径。
- WAL 状态下裸文件复制的风险及现有可用能力。
- M6 应如何在临时数据库中恢复，避免提前触及生产 canonical。

### E. 格式与加密设计选项（只做分析，不做最终实现）

比较至少两种可行的便携备份结构，明确：
- manifest 结构和版本管理。
- chunk 的边界、顺序、压缩（如有）、明文/密文长度。
- KDF 元数据与跨设备密码恢复。
- 随机数据库密钥与密码 KEK 封装的关系。
- 每块 AEAD 认证及 manifest/chunk 之间的防重排、防替换、防截断绑定。
- 数据集指纹、schema version、application_id、表计数/摘要。
- 导出过程有界内存、取消、临时文件和失败清理。
- 目标端分块导入、验证、切换和回滚。

不得在缺少源码依据时选定 KDF 算法/参数、SQLCipher key 语义或是否执行 rekey。列出选择条件和需要实际测量的数据。

## 4. 必须产出的报告

新增：

`docs/qa/kanata-sqlite-m6/m6-00-architecture-audit-v1.md`

报告至少包含：

1. 复核基线、工作区状态、检查文件清单。
2. 当前备份格式版本矩阵（v1–v12、Kanata v13）。
3. 当前备份导出数据流图。
4. 当前完整恢复状态机与故障状态表。
5. 当前主密码变更参与者顺序、补偿与 blocked 行为。
6. Kanata M5 SQLCipher 候选的真实接入点与限制。
7. 至少两种便携备份格式方案的对比表。
8. KDF / envelope / SQLCipher key / rekey 决策表，明确已知、未知、需实测。
9. M6-01～M6-05 的最小实现拆分与各自验收条件。
10. Blocker / High / Medium / Low 风险清单，逐项附文件路径、行号和测试依据。
11. 明确禁止事项与本轮未执行项。

## 5. 完成定义

报告必须做到：
- 每项关键结论有实际源码/测试定位。
- 区分当前已实现、文档约定、推断和待实测。
- 不把 SQLite 原生 API 能力当成项目当前已接入能力。
- 不把 M5 合成验收当作生产接线或真实数据迁移证据。
- 不把应用备份 v12、Kanata 产品组合 v13 和新 SQLite 便携备份格式混为一谈。
- 对无法从 Git 确认的本地设备/插件实测，明确标注证据来源和限制。

## 6. 严格禁止

- 不修改任何业务代码、测试、Schema、依赖或构建配置。
- 不生成/导入/恢复/改密任何真实数据或真实备份。
- 不执行 SQLCipher rekey、生产 DB checkpoint 或生产数据库备份。
- 不接入生产 Store、lifecycle、canonical 或 ordinary APK activation。
- 不删除/覆盖/重命名旧 JSON、backup、archive、recovery journal。
- 不执行 Android build、install、emulator、instrumentation。
- 不发布 APK、创建 Release、合并分支。
- 不推送代码；只允许在本地新增审计报告并提交普通文档提交。
- 不提前实现 M6-01，不提前选定未经验证的 KDF 参数。
- 不扩展至 ForMyself 其他业务模块或 M7 性能/合并工作。

## 7. Git 与默认推送规则

本项目已采用默认正常提交与推送工作流，但本任务明确是只读审计，且规划位于 M5 分支：
- 只新增审计报告。
- 可在本地提交报告；不得推送 M5 分支以外的任何内容。
- 如果报告要推送，必须先确认 M6 分支已经创建且目标分支正确；不得把 M6 代码或报告混入 M5 关账历史。
- 不创建分支，不移动远端 ref，不执行 push。
- 完成后提供报告路径、commit SHA（如有）、工作区状态和 M6-01 是否具备开工条件。

完成后停止，等待后续 M6-01 任务书。
