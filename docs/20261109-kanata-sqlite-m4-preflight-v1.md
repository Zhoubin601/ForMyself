# Kanata SQLite M4 Preflight v1

2026-11-09，北京时间。起始 `M` 本地为 M3 `751da40149404deb8bc1562851a91e699c60c1e5`。远端 HEAD 为 `1e1d04fd9f7072d84e2c0289816502a104ffb2d2`，前两笔为任务说明和 Markdown 整理，源码等同 M3。独立 M 工作树无用户修改，快进后与远端一致。主工作树在 main，保留原有 4 个修改、1 个删除及未跟踪项目。

## 来源与环境

- 以 [M4 任务书](20261109-kanata-sqlite-m4-task-v1.md)、[总计划](20261103-kanata-sqlite-migration-plan-v1.md)、[M2 任务](20261107-kanata-sqlite-m2-task-v1.md)、[M2 Windows 验收](20261109-kanata-sqlite-m2-acceptance-v2.md)、[M3 任务](20261109-kanata-sqlite-m3-task-v1.md)、[M3 设计](20261109-kanata-sqlite-m3-design-v1.md)、[M3 验收](20261109-kanata-sqlite-m3-acceptance-v1.md)、[M1-R 字段映射](20261107-kanata-sqlite-m1-r-field-mapping-v1.md)、根架构规范与当前代码为依据。
- 业务规则来源为仓库 `raw/彼方 · Kanata 技术设计.txt` 与已确认的 M3 规则。设备只使用 `tests/helpers/kanataSqliteM2Fixture.js` 等合成夹具。
- Windows PowerShell、Node 24.14.1、npm 11.11.0、JDK 21。M2 启动器使用独立新 AVD home、全新数据盘、无快照。ADB 启动前无设备，启动后按序列核验 API 34、x86_64、SELinux Enforcing、无三方应用、WHPX 和剩余空间。设备预检只读，见 [设备](qa/kanata-sqlite-m4/evidence/device-preflight.json)。
- 原始源码 `npm.cmd run check` 退出 0，648 Node、392 Vue（42 文件），含 strict 及 Vite。Driver、Repository、Domains、Schema 定向 39 项通过。见 [基线 check](qa/kanata-sqlite-m4/evidence/baseline-check.txt) 和 [定向](qa/kanata-sqlite-m4/evidence/baseline-directed.txt)。

## 访问矩阵

[搜索原始命中](qa/kanata-sqlite-m4/evidence/access-search.txt) 以开始时的 HEAD 为准。以下按共同入口、持久化边界和复用规则归类。

| 调用点 | 读取/写入及数据范围 | M4 归属与目标 | Owner、权限与失败 | 验证 |
| --- | --- | --- | --- | --- |
| `protectedModules → kanataStore.load/release/flush`、`kanataRuntime`、`KanataView`、`KanataSetupView` | 全图载入、归档读回、初始化、快照和保存状态 | legacy 保留。合成候选用独立组合根和受保护 Driver | 真实受保护模块和恢复写门禁。读取失败不初始化 | Store、Initialization、PendingRecovery、产品恢复 |
| `KanataConversationView` legacy 分支 → `kanataChatRuntime` | 全图过滤消息、角色、任务、用量。用户、AI、配置和修订经 store update | legacy 保留 | 页面和受保护租约、保存失败保留重试 | ChatRuntime、ConversationView |
| 同一组件 SQLite 分支 → `useKanataMessageWindow` | 50/100 已接线。仍读外部 metadata 的世界、实例、卡片、用量。会话获取失败被吞掉 | 本轮迁移到按 scope 读取轻量 DTO。移走 View 内 Repository 访问 | 页面 generation、连接 generation、受保护门禁。失败显式可重试 | SQLite 真实查询轨迹、Vue、Android UI |
| `kanataSqliteChatRuntime.send/reviseMessage/changeConversation/runDue` | M2 仓库单条、按 ID、回复页、CAS 和派生事务已接线。AI 仍扩展 `Omit<KanataData,'messages'>`，知识页聚合全部，来源链和世界 grants 临时无界 | 本轮迁移到明确上下文选择与小 DTO，继续使用 M2/M3 仓库 | 人工发送拒绝 character，AI 完成和用量提交重核 scope/revision，读取正文前验证授权 | 恶意输入、增长、事务故障、Android 真聊天 |
| `KanataHistoryPanel` → `readHistory/archiveHistory/activateHistoryMessage` | legacy 图、磁盘索引及分片加密归档 | legacy 保留。候选按消息 keyset/ID 和 SQL 归档状态，旧文件导入归 M5 | 受保护会话，原加密归档回滚与定位保留 | HistoryPanel、ArchiveStore、候选 quote/历史 |
| `KanataWorldManager`、`KanataGroupCreator`、`KanataCardLibrary` → `kanataWorldRuntime/kanataManagement` | 全世界/卡/实例快照及全图纯命令 | legacy 保留。候选迁移到 World/Character/Conversation 分页与命令，复用 M3 世界 Runtime | 世界归属、归档、revision、命令回执 | WorldRuntime、Management、GroupCreator、M3 Domains、候选 UI |
| `KanataLorebookPanel`、`KanataExperiencePanel` 与 Memory/Event/Permissions 子面板 → `kanataExperienceRuntime` | 全图世界书、记忆、授权、事件/撤销预览 | legacy 保留。候选按角色/世界/ID 读取及 M3 事务命令 | 先查权限和来源，撤销按预览 CAS，Effects 独立 | ExperienceRuntime/View、M3 provenance/replay、候选 UI |
| `KanataActivityPanel`、`kanataActivityLifecycle`、`kanataDeferredRuntime`、`kanataContactRuntime`、`kanataSocialRuntime`、`kanataLifeCompanion` | 旧快照的计划、任务、通知、角色绑定和跨业务权限；M3 autonomy 仍汇总世界 actor/schedule/grant 列表 | legacy 保留。候选使用按角色与窗口仓库并检查无界临时集合 | 前台、锁定、任务 lease、来源、回执和自治水位 | Deferred、Contact、Social、LifeLifecycle、M3 真设备 |
| `kanataBackupRuntime`、`fullBackupRuntime`、restore coordinator、`kanataStore` 改密 | 现有 legacy 全图与加密恢复日志、v1–v12/v13 兼容路径 | legacy 保留，SQLite 导入归 M5，候选全备/恢复/改密归 M6 | 生产恢复协调器、日志、重新认证与写门禁 | Backup、ProductRecovery、受保护生命周期 |
| `kanataRepository`、`messageArchiveRepository`、领域验证与 JSON helper | legacy 校验/复制/密文持久化，纯函数包含全图形参；若候选调用需区分局部 DTO 和真实全表 | legacy 保留；候选对共享纯规则改用精确投影。SQL 固定目录，迁移历史冻结 | 结构版本拒绝、事务与失败状态 | schema fingerprints、SQL 轨迹、序列化探针 |

生产入口使用 legacy，合成候选由 M2 QA WebView 显式装配。M3 世界 Runtime 只有命令/读边界，无完整管理 UI。M4 需要补齐功能等价的候选入口。不能以候选消息分页代表整个候选应用已经有界。

后续确认的群聊成员编辑分支已补入 [Completion 访问矩阵](20261109-kanata-sqlite-m4-completion-preflight-v1.md#访问矩阵补齐项)。

## 实施后的入口核对

候选 `KanataCandidateWorkspace → KanataConversationView → createKanataChatViewModel → createKanataSqliteChatRuntime → withRepositories/withDomains` 在隔离 WebView 装配。工作区查询走 `managementView.worlds/world/list`，当前角色授权走 `grantsForActor/setGrant`，按选定世界 owner 和候选世代撤销。会话新增、重试、延期及配置变更分别走 `turns.save` 与 `conversations.updateChatSettings`，修订和删除保留 M2 原命令。角色提示从 `promptActor`、`promptCandidates`、`relationshipContext`、`contextGrants` 和 `historyForSpeaker` 读取。历史正文按 keyset 检索，定位走 `locate`。自治配置和窗口走 scope 写入及分批签名，SQLCipher catalog 保持固定入口。

仍只接 legacy 完整交互的入口包括卡片库导入与发布、完整世界设置/复制和建群、世界书编辑及预览、动态记忆整理/冲突处理及来源页面、事件账本的提议/确认/撤销及审计 UI、自治活动面板的联系与社交调度、全局生活角色绑定。部分领域已经有 M3 Repository 命令，M4 候选 UI 尚未完成等价接线。候选未启用生产全备、改密和完整恢复，旧格式及恢复写门禁继续由现有产品入口处理。
