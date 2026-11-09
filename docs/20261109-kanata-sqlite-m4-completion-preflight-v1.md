# Kanata SQLite M4 Completion Preflight

2026-11-09，北京时间。M 本地原为 `301ad81e851f65cd5b73f883833052e7e5d1a2fb`，远端 `4191d7fd72723afab35f77bb9b85970f29f0f43f` 只增加补齐任务与索引。M 工作树干净后快进，主工作树的修改、删除和未跟踪文件保留。

依据为 [Completion 任务](20261109-kanata-sqlite-m4-completion-task-v1.md)、[原任务](20261109-kanata-sqlite-m4-task-v1.md)、[原 Preflight](20261109-kanata-sqlite-m4-preflight-v1.md)、[原设计](20261109-kanata-sqlite-m4-design-v1.md)、[原验收](20261109-kanata-sqlite-m4-acceptance-v1.md)、[原 QA](qa/kanata-sqlite-m4/README.md) 及 M2/M3 验收。产品依据包括 `raw/彼方 · Kanata 技术设计.txt` 的角色卡、记忆和事件章节，源码用于核对实际支持的操作。历史证据原样保留。待保持的代码包括 M2 消息仓库、候选聊天、引用、历史定位、授权、SQLCipher 租约与自治窗口。

| 范围 | 实际入口与语义 | 现有候选与缺口 | 复核 |
| --- | --- | --- | --- |
| A 世界、身份、群聊 | WorldManager、GroupCreator、Management。复制只保留静态设定、角色与初始关系。旧领域明确将历史群成员编辑作为单独策略 | World Repository 已有创建、身份 CAS 和归档。工作区仅归档、改名及列表。群聊创建、复制和配置需命令与 UI | 世界切换后旧草稿拒绝、角色与会话归属、配置 CAS |
| B 角色卡 | CardLibrary、文件选择器、原格式导入、编辑发布及指定实例同步 | Character Repository 有导入、发布、版本列表、同步和实例命令，候选缺选择器与管理 | JSON/PNG、冲突、不可变版本、原始资产不入列表 |
| C 世界书 | LorebookPanel、静态检索、知情范围和原优先级排序 | M3 有保存删除，M4 有 prompt 投影。候选需按 ID 管理、按角色预览和有界选择 | 禁止提前读不授权正文、跨页精确排名 |
| D 记忆 | MemoryPanel、ExperienceRuntime、整理/冲突/分享/来源 | Memory Repository 可精确定位 ID+revision。当前授权会组装整条共享链的关联，候选管理仅摘要 | 深链、宽扇出、撤权、源版本、归档和批次取消 |
| E 事件 | EventsPanel、明确与不确定撤销预览、Effects 基线重放 | M3 事务已存在。当前预览与重放仍积累全部事件 ID/受影响路径，候选缺确认与审计 UI | 多路径独立、预览变化、回滚及增长 |
| F 自治、联系、社交、绑定 | ActivityPanel、ContactRuntime、SocialRuntime、LifeCompanion | SQL 自治窗口和水位已有。其余候选调度、设置、全局绑定和消费仍需接线 | 频率、关闭/解绑、回执、0 真实模型调用 |
| G 历史整理 | HistoryPanel、archiveHistory、引用保护 | SQLite keyset 和按 ID 查询已接线，候选批量整理仍缺 | 预览范围、引用保护、无 legacy 文件访问 |

固定目录由构建脚本登记，Schema 001–004 冻结。测试使用新建合成 AVD，基线运行结果与设备信息见 completion evidence。
