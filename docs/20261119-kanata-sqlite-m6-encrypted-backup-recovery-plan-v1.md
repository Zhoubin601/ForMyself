# Kanata SQLite M6 加密备份、恢复与改密计划 v1

- 状态：**PLANNED — M6-00 架构审计待执行**
- 日期：2026-11-19
- 仓库：`Zhoubin601/ForMyself`
- 规划所在分支：`m5/json-archive-migration`
- 规划基线：`2b6e8e3591385024576c6606cce2acc31dbaad2b`
- 前置阶段：M0–M5 各阶段已有阶段记录；M5-06 已于该基线正式关账 PASS
- 权威路线来源：[SQLite 迁移与性能重构计划 M v1](20261103-kanata-sqlite-migration-plan-v1.md) 第 6 节 M6、第 7 节性能规范、第 8 节分支规则
- 本计划不授权真实用户数据操作、生产存储切换、APK 发布或合并。

## 1. 阶段目标

M6 的唯一阶段目标是：让 Kanata SQLite/SQLCipher 候选具备与应用既有安全架构兼容的加密备份、恢复、主密码变更和故障恢复能力。

M6 必须沿用应用现有的备份参与者、版本兼容、受保护模块、主密码事务和恢复协调器语义。不得另建一套绕过全局恢复门禁的平行机制。

M6 必须解决以下核心问题：

1. **便携备份**：为 Kanata SQLite 数据定义可跨设备恢复的版本化、分块、加密、可验证备份格式。格式内部建议命名为 Kanata SQLite Backup V3；必须先核对现有格式命名，避免与应用完整备份 v12、Kanata 产品组合 v13 混淆。
2. **一致性导出**：从 SQLite/SQLCipher 候选数据库导出事务一致的快照，不复制 WAL 活跃状态下的裸数据库文件，不把十万条消息重新拼成单一巨大 JSON。
3. **受控恢复**：恢复到隔离临时数据库，分批校验与导入；全部校验通过后，才通过既有 `restoreCoordinator` 统一切换。
4. **主密码变更**：通过现有 `protectedModules` / `changeMasterPasswordTransaction` 协调 Kanata 与其他受保护模块；失败时反向补偿，回滚失败必须保持 blocked。
5. **故障恢复**：覆盖强停、空间不足、错密、损坏分块、日志损坏、连接中断、恢复中断、改密部分失败与回滚失败。
6. **向后兼容**：保留完整备份 v1–v12 和 Kanata 产品备份既有版本的读取语义；新增格式必须明确旧版缺字段、未知字段和不支持版本的行为。

## 2. 已知架构约束（规划依据）

以下是当前分支源码/说明书已确认的既有边界，M6-00 必须再按实际 HEAD 复核：

- 完整备份基础类型为 `formyself-full-backup`、版本 12，兼容 v1–v12；Kanata P2 产品组合采用 v13 组合适配，不能把 Kanata 数据库文件格式版本与应用备份版本混为一谈。
- 备份参与者契约位于 `src/application/backupRegistry.js`、`src/application/backupParticipants.js` 与 `src/application/contracts.d.ts`；产品组合根位于 `src/application/fullBackupRuntime.js`。
- 完整恢复通过 `src/application/restoreCoordinator.js`、`src/platform/storage/restoreJournal.js`、`src/platform/storage/restoreState.js`；日志为独立 AES-GCM 封装。不得绕过协调器或直接清除恢复日志。
- 敏感模块注册位于 `src/application/protectedModules.js`，受保护会话位于 `src/stores/protectedAccess.js`；主密码改密事务位于 `src/services/masterPasswordChange.js`。
- Kanata Store 当前实现仍包含 legacy Repository 路径；M5 迁移器仍为 synthetic-only，未接入生产 Store、生命周期或 ordinary APK SQLite activation。M6 不得默认认为 SQLCipher 已成为生产 canonical。
- M5-06 已 PASS，但只证明合成迁移器与 Android SQLCipher 合成验收；不代表生产数据已经迁移，也不代表生产数据库已激活。
- Web 在 M 阶段继续使用现有加密文件存储适配器；不得因 Android SQLCipher 引入而强制把 Web 改为 SQLite WASM/OPFS。
- 主密码、生物凭据和 SQLCipher 原始密钥不得进入备份明文、普通 Preferences、日志或机器证据。备份必须可在另一台兼容设备通过用户凭据恢复，不能仅依赖单设备 Keystore。
- 任何真实用户数据、真实备份、真实设备数据库操作均不在本规划授权范围。

## 3. M6 子阶段路线

| 子阶段 | 目标 | 交付与退出条件 |
|---|---|---|
| **M6-00** | 现有备份/恢复/改密架构审计与格式设计输入冻结 | 只读审计报告、风险清单、数据流图、格式决策记录、后续实现任务拆分；不得修改业务代码 |
| **M6-01** | Kanata SQLite 便携备份格式与合成 Codec | 格式规范、manifest、分块边界、KDF/密钥封装决策、哈希/认证、确定性合成 round-trip 测试 |
| **M6-02** | SQLCipher 一致性导出与分块备份生成 | 使用 SQLite backup API 或经证明安全的 checkpoint/事务一致导出；有界内存；合成 1k/10k/100k 导出 |
| **M6-03** | 隔离临时库恢复与 RestoreCoordinator 接入 | 临时库分批恢复、完整性/Schema/指纹验证、统一协调器切换、失败回滚及重启恢复 |
| **M6-04** | 主密码变更与密钥封装轮换 | 通过 protectedModules 与 changeMasterPasswordTransaction；各参与者部分失败、补偿、回滚失败均有证据 |
| **M6-05** | 故障注入、兼容矩阵与阶段验收 | 强停、磁盘不足、错密、损坏分块、日志损坏、连接中断；v1–v12 兼容回归；独立复核及关账 |
 
M6-00 完成前不得开始 M6-01 的实现。每个子阶段单独任务书、实现 SHA、测试证据和关账记录；前一阶段 PASS 后才进入下一阶段。

## 4. 全阶段验收门禁

### 4.1 格式与加密
- 格式版本、KDF 算法/参数、salt、nonce、密钥封装版本、分块索引、明文长度、密文长度、分块 SHA-256 和认证标签均有明确规范。
- 每个分块具备防重排、防截断、防替换的认证绑定；manifest 与全部分块之间有认证关联。
- 错误密码、错误密钥、未知版本、篡改 manifest、缺块、重复块、乱序块、截断块均在目标数据写入前拒绝。
- 密钥派生、封装和 SQLCipher 数据库密钥语义必须由 M6-00 比较现有实现后决定；不得臆造或直接复用未经证明的旧派生方案。
- 密钥、密码、明文正文不进入日志、文件名、普通设置或证据 JSON。

### 4.2 有界导出
- 禁止构造全量 KanataData 或十万条消息的单一大 JSON。
- 导出必须有界分块，记录最大驻留内存、批次上限、取消行为和临时文件清理语义。
- 活跃 WAL 场景下不得直接复制主数据库文件；必须证明使用 SQLite backup API 或一致快照流程。
- 导出过程失败时不覆盖既有备份、不删除源数据库、不留下可被误认为完成的半成品。

### 4.3 恢复与切换
- 恢复始终写入隔离临时数据库；源库在验证完成前只读且不变。
- 验证 Schema/application_id、表计数/摘要、外键、integrity_check、数据集指纹和分块认证。
- 只有完整验证通过后才进入 restoreCoordinator 的受控 apply 阶段。
- 在 commit 标记前强停必须恢复 previous；commit 标记后重启必须恢复 target。
- 回滚失败、journal 损坏或状态不确定时保留材料并保持 blocked，禁止普通写入。
- 派生通知/索引同步失败与业务数据恢复失败区分处理；同步重试不得再次导入业务数据。

### 4.4 主密码变更
- 全局改密仍由现有 changeMasterPasswordTransaction 统一编排。
- Kanata 密钥封装更新、数据库 rekey（若确有必要）和其他受保护模块参与者必须定义顺序及补偿语义。
- 任一参与者失败后，已完成参与者按逆序恢复旧密码/旧封装；回滚失败显式报告并保持保护状态。
- 验证新密码成功、旧密码拒绝、强停恢复、旧封装退休和跨设备恢复。
- 不得只更新 Kanata 就报告全局主密码变更成功。

### 4.5 兼容性
- 完整备份 v1–v12 保持现有兼容要求。
- Kanata 产品备份现有 v13 语义需通过实际代码与 fixture 冻结。
- 新增格式明确支持/拒绝矩阵，不静默丢弃未知字段或必需参与者。
- 旧备份缺少 Todo 等字段的既有语义保持不变。
- 单项备份与完整备份的权限、格式、合并/覆盖语义分别验收。

## 5. 安全与范围边界

M6 初始实施仍只使用合成数据和隔离候选库。除非用户另行授权，整个 M6 不允许：

- 读取、复制、扫描、导入或迁移真实用户数据、真实设备数据库、真实备份或真实归档。
- 将 M5 synthetic-only migrator 接入生产 Store、lifecycle 或 canonical。
- 修改普通 APK SQLite 激活位或将生产存储切换到 SQLCipher。
- 删除、覆盖、重命名、压缩或清理任何旧 JSON、backup、archive 或 recovery journal。
- 修改 Schema 001–005 历史 checksum、application_id 或生产数据格式。
- 发布/分发 APK、创建 Release、合并 M 到 Kanata/main。
- 绕过 restoreCoordinator、protectedModules、恢复日志或既有 v1–v12 兼容层。
- 升级无关依赖或扩大为 ForMyself 其他业务模块迁移。

M6 可以在独立隔离分支上开发新的备份格式和候选实现，但生产激活与真实数据操作必须作为后续单独审批事项。

## 6. Git 与 Agent 协作

- M5-06 关账基线：`2b6e8e3591385024576c6606cce2acc31dbaad2b`。
- M6 实现必须使用独立功能分支，建议 `m6/encrypted-backup-recovery`；不得直接在已关账的 M5 分支继续提交实现。
- M6-00 仅新增审计/设计文档，可在当前分支保留规划记录；M6-01 开始前必须创建并核对独立 M6 分支。
- 默认授权 Agent 在指定 M6 功能分支完成本任务后正常 commit + push，并等待 GitHub CI；只允许普通 fast-forward push，禁止 force-push。
- CI 通过不等于阶段 PASS；必须按任务书验证 Android 原生、加密、恢复和故障场景。
- 每个阶段交付实现 SHA、证据 SHA、CI run、工作区状态、实际测试结果和未覆盖项。
- 发现测试失败、远端分支意外前进、工作区包含未归属修改、分支冲突或需要超范围操作时停止并报告。
- 不自动合并 M6 分支，不自动合并 M 到 Kanata/main。

## 7. 本轮启动点

当前只启动 **M6-00 架构审计与设计输入冻结**。它是只读审计任务，不实现备份 Codec、不写入数据库、不改密码、不执行恢复、不创建 APK。

M6-00 的报告通过人工复核后，才制定 M6-01 的实现任务书。M6-00 不得提前替用户决定加密格式、KDF 参数、密钥封装或数据库 rekey 策略。

## 8. 最终路线

M0–M5（候选 Schema、Repository、业务访问模型、迁移器）→ M6（便携加密备份、恢复、改密与故障恢复）→ M7（性能验收、文档收口与合并准备）→ 用户明确授权后合并回 Kanata → 以合并后新基线重新执行 P7 原始门禁。

SQLite 迁移通过不等于 P7 自动通过。Android 512 MiB、完整改密 120 秒、Web 768 MiB 及原 P7 完整需求验收门槛保持有效。
