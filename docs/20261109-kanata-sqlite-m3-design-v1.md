# Kanata SQLite M3 技术设计 v1

2026-11-09，北京时间。映射以 [M1-R 字段表](20261107-kanata-sqlite-m1-r-field-mapping-v1.md) 与 [实际调用链](20261109-kanata-sqlite-m3-preflight-v1.md) 为准。

| 接口职责 | 表、权限与事务 |
| --- | --- |
| World 创建、列表、改名、归档、身份编辑 | `worlds`、`world_identities`、`dataset_metadata`。身份与世界一起写入；归档停止自动活动，保留业务引用。 |
| Character 卡版本与实例 | `character_cards`、`card_versions` 的延迟外键保证原子创建；卡 CAS 按 currentVersionId。实例 revision 独立，新建时同步建立私聊成员。 |
| Lorebook 条目 | `lorebook_entries`、`lorebook_known_by`。按世界、owner 与可见性读取；条目及关联一起改删。 |
| Memory 内容与来源 | `memories`、`memory_sources`、`memory_events`、`memory_life_sources`、`memory_known_by`、`memory_links`。使用授权和来源元数据决定是否读取正文。对原消息精确校验世界、会话、ID、revision。SQL 候选保留可索引的归档消息，旧加密页导入归 M5。 |
| Event 及 Effects | `world_events`、参与者、来源、因果、审计、Effects 与基线。实时复核预览、事件 revision 和实际归属。从持久基线重放剩余已提交事件。 |
| Autonomy、Grants、Usage | `background_tasks` 以世界、kind、幂等键去重；`life_grants` 各权限独立；`usage_events` 按 attempt ID。窗口结果、事件、Effects、水位在同一提交边界。 |

001/002/003 DDL 与 checksum 冻结。004 追加新结构。SQL 固定且参数化，加入 M2 原生语句目录。跨表命令在同一事务内，使用真实 affectedRows 判定 CAS。相同键的重试核对命令身份；区分冲突、权限、来源及存储错误，提交完成才发布回执。

受保护用户管理、角色上下文和显式分享各有入口。角色入口先查作用域、参与者、来源与授权修订，再取敏感正文。read、remember、share 各在动作前独立检查。异步结果再次核对租约、owner 和授权。候选 Runtime 通过现有合成组合根接线。

## 编码前两轮自审

1. 安全一致性。负向验证查 SQL 轨迹，证明无权请求只触及元数据。来源只接受精确 revision。效果值受 clamp 影响，撤销须重放当前有效 Effects，不能反算增量。任务回执和水位必须同事务。
2. 业务兼容。用户确认沿用归档及因果预览。保持版本发布、character 会话、世界选择及生产 legacy 规则。SQLite 归档定位与 M5 旧页迁移单独测试。实施后的两轮反例复测另留证据。
