# Kanata SQLite M6-03-R｜Native 持久事务控制层与真实恢复链路整改任务书 v1

- **任务编号**：`KANATA-M6-03-R-REMEDIATION-2026-11-27`
- **仓库 / 分支 / 工作树**：`Zhoubin601/ForMyself` / `m6/encrypted-backup-recovery` / `.worktrees/kanata-m5`
- **整改基线 SHA**：`c8c3d6ee1987ba963d4b49473d7062f310d81e80`（原实施 `6f97b4820fb953212d93ee8106fb307a46dbda3a`，原 CI `45793217397`）
- **当前门禁状态**：`BLOCKED`（待完成 F01–F06 及原始 F03-01～10 真实端到端验证并提交 GPT-6.2 独立终审）
- **权威冻结合同**：[M6-00 最终设计收口 v1](qa/kanata-sqlite-m6/m6-00-final-closeout-v1.md)（G-04、G-07、B-01、B-06、B-07、B-09、H-04、H-05、N-05、N-06、F03-01～10）

---

## 1. 六项独立审计发现（F01–F06）与整改目标账本

| 发现编号 | 原始问题摘要 | 对应 M6-00 冻结条款 | 整改实施落点 |
| --- | --- | --- | --- |
| **F01** | 缺少 Native 持久事务控制层：无独立 no-backup 控制根、安装登记、Keystore HMAC-SHA256 认证、权威 head、排他 CAS、全写路径持久 fence 与受限恢复内部能力 | G-04, B-01, B-06, B-07, H-04, H-05, N-05 | `android/app/src/main/java/com/yubin/formyself/KanataDurableTxControl.java`；`TodoRepository.java`、`TodoPlugin.java`、`KanataSqlitePlugin.java`、`ArchiveFileBatchStore.java` 统一接入跨进程持久 fence 与统一 H-05 旧日志盘点 |
| **F02** | 原强杀测试由 Worker 自行实现测试专用 Journal 与人工判向，未走产品候选组合根、真实 `RestoreCoordinator`、真实认证控制层与冷启动恢复入口 | G-04, B-01, B-06, F03-03～08 | 保留原有 Native 原语测试并显式标注；新增真实端到端崩溃恢复测试，强杀后经真实应用组合根 + 恢复专用认证入口 + `KanataDurableTxControl` 自主判决与收敛 |
| **F03** | `useBackupSettings.js` 未注入协调器；Web 将旧 JSON 恢复可用性冒充 KPB1 可用；缺少真实 Capacitor Bridge 到 SQLCipher 的完整隔离应用链路 | G-01, G-07, B-09, N-06, F03-10 | 修正 `backupCapabilityProbe.js`（Web 诚实返回 `portableRestoreAvailable=false`）；新增隔离合成 `KanataM6RestoreBridgePlugin.java` 与 `kanataSyntheticRestoreWiring.js`，在 `com.yubin.formyself.m2qa` 贯通 `SettingsBackup → Runtime → PortableCoordinator → RestoreCoordinator → KanataDurableTxControl → StagingRestoreEngine → SQLCipher`；普通 APK 保持 `legacy` 且零测试代码 |
| **F04** | `PREPARED` 之后 UI 取消 / 重选 / 卸载仍可能误删被引用 staging 材料；`finalizeArtifacts` 清理失败与业务提交成功未解耦 | G-03, G-04, B-02, F03-04/05/09 | 显式区分 6 态材料生命周期；`PREPARED` 后禁止 UI 直接删材料，所有清理仅由控制层在 `FINALIZED` 后锁内证明无引用执行；解耦 `committed=true` 与 `cleanupError` |
| **F05** | `activeExpectedIdentity`、`restoreGeneration`、`lastCapturedPrevious` 存在共享可变状态竞争；外部构造 `verified=true` descriptor 可绕过真实登记；普通 session 失效影响已决定恢复 | G-04, B-01, B-02, F03-09 | 引入排他 `TxContext` 所有权锁与不可伪造 `StagingRegistration`（私有登记 + Native MAC 校验）；绑定 `(ownerId, sessionRevision, epoch, generation)`；恢复路径使用独立恢复能力票据 |
| **F06** | 仅切换单个 DB 文件而未与 `KanataKeyEnvelope` 原子成对切换；直接删除旧 WAL 侧文件风险；仅持 Importer 锁不等于全部 writer 已排空 | G-04, G-07, N-06, F03-01/02/10 | `generations/<generationId>/{kanata.db, envelope.json, generation-manifest.json}` 整代隔离目录；`head.activeGenerationId` Native CAS 原子切换；全写路径持久 fence + writer drain；冷启动按权威 `head` 用本机主密码解封正确世代；同一 KPB1 恢复至两隔离目标生成不同 DEK |

---

## 2. 原始 M6-00 冻结门禁账本（N-05 / N-06 / F03-01～10）

| 合同编号 | 强制验收要点 | 初始状态 |
| --- | --- | :---: |
| **N-05** | Android Keystore HMAC-SHA256 / AES-GCM 冷启持续性、跨进程 CAS 与 Todo/Widget 共锁、文件+父目录 fsync、原子 rename、head 线性化、旧记录替换/重放/权限/密钥异常（API 24、API 25、API 34 实测） | PENDING |
| **N-06** | 新旧世代目录与封套共存隔离、恢复专用认证不依赖受损 Vault/Kanata/Settings、普通 APK legacy 隔离不变 | PENDING |
| **F03-01** | 写门禁与 Todo Widget 在途 CAS 排空与阻断、持久 fence 建立后普通写拒绝、capture 包含门禁前已确认写 | PENDING |
| **F03-02** | 阶段前故障、Vault 损坏 / 旧 Kanata 损坏 / Settings readiness 失败时的恢复专用认证、两代完整图与 Native 长字段绑定及 staging 有界性 | PENDING |
| **F03-03** | SQLite pointer、Todo、Settings/API Key（含安全凭据写入/读回失败注入）、Vault 任一点部分 apply；未决定 PREPARED 选 previous 并逐项复核 | PENDING |
| **F03-04** | 决定前后真实进程强杀（GATE/PREPARED/material fsync/head rename/DECISION/FINALIZED），已决定方向不可逆转，状态未知保持 blocked | PENDING |
| **F03-05** | 清理中断、FINALIZED 后清理失败与业务提交成功分离、派生通知/组件同步失败独立重试不重导入 | PENDING |
| **F03-06** | 回滚失败持续跨重启 blocked、保留材料与诊断、不以静默删除或空库绕过 | PENDING |
| **F03-07** | H-04/H-05：旧日志 5 路径统一盘点、新旧控制记录冲突、孤立 marker、损坏/旧版日志、保留 head 下的旧记录重放/替换、认证失败、ENOSPC 与目录 fsync 失败 | PENDING |
| **F03-08** | 多次重复冷启动幂等收敛、未知协议版本阻断、无权威 head 禁止扫描猜测 | PENDING |
| **F03-09** | 后台撤销、kill、force-stop、commit 响应丢失、多 owner/双进程竞争、取消竞争、调用方不能伪造恢复能力与 `verified=true` descriptor | PENDING |
| **F03-10** | 同一 KPB1 跨隔离目标恢复产生独立新 DEK；v1–v12、Kanata v13、旧 `kanata-chat-backup` v1 回归；legacy canonical 路由与普通 APK 隔离保持不变 | PENDING |

---

## 3. 执行阶段顺序（R0–R6）

- **R0**：核对基线、阅读冻结规范与现有源码、建立整改与门禁账本（本文档）。
- **R1**：实现并实机验证 **N-05** Native 持久事务控制层（`KanataDurableTxControl` + 全写路径 fence + API 24/25/34 实测）。
- **R2**：完成世代目录与封套原子切换（F06/N-06）、恢复专用认证与不可伪造能力票据、隔离合成 Capacitor Bridge（`KanataM6RestoreBridgePlugin`）。
- **R3**：重构 `KanataPortableRestoreCoordinator`（F04/F05）、`KanataPortableRestoreRuntime`（F04）、`backupCapabilityProbe`（Web 诚实不可用）与真实隔离组合根接线（F03）。
- **R4**：补齐取消、并发、双进程/多 owner 竞争、真实端到端 `SIGKILL` + 冷启动自主恢复及故障注入测试（F02/F04/F05）。
- **R5**：逐项核验原始 F03-01～10 矩阵、旧格式 v1–v12/v13/单项备份回归，以及 1k/10k/100k 真实集成容量复测。
- **R6**：两轮独立自查、修复、全量验证、同 SHA GitHub Actions CI 全绿、落盘最终整改报告与结构化证据，等待 GPT-6.2 独立终审。
