# Kanata SQLite M4-R 验收 v5 · BLOCKED

**M4 BLOCKED，M5 NO。** 在 M 分支隔离工作树以 c4ba18911c705c5efde7f7614171659f056e2f1e 接管。MR1 修复提交为 1bc1ee168b1cae1852ce365e8d0198645615e13a。本文所在提交记录 MR2 已验证切片和剩余门禁。当前 SHA 和与远端的一致性以提交及 Git 检查为准。

[唯一执行任务书](20261110-kanata-sqlite-m4-r-closeout-task-v1.md) · [本轮 QA 与可复现命令](qa/kanata-sqlite-m4/m4-r/README.md) · [两轮检查点复核](qa/kanata-sqlite-m4/m4-r/reviews.md) · [历史 v4](20261110-kanata-sqlite-m4-acceptance-v4.md)

| 阶段 | 状态 |
| --- | --- |
| MR0 | PASS。核对远端、工作区、历史指纹、设备白名单和 A–G 缺口矩阵。 |
| MR1 | PASS。真实 SQLCipher 综合 10k 回执、逐项 Effects 审计、强停重开和同计划幂等均通过。 |
| MR2 | BLOCKED。1k/10k 独立授权的记忆详情与精确来源已通过。普通聊天发送和回复落库的整链标签、事件/消息 provenance 与旧兼容入口仍缺有界性。 |
| MR3 | NOT RUN。待 A/B/C 管理闭环。 |
| MR4 | NOT RUN。待 D/E/G 管理闭环。 |
| MR5 | NOT RUN。待 F 消费者与后台任务。 |
| MR6 | NOT RUN。全页面生命周期、权限及故障矩阵待验证。 |
| MR7 | BLOCKED。全量主机 check、当前 Android 已接线场景及普通 APK 门禁有记录。完整 A–G 和新故障矩阵尚缺。 |
| MR8 | BLOCKED。两轮检查点审查已留反例与复测。完整范围审查及最终阶段放行待完成。 |

| 域 | 接口与缺口 |
| --- | --- |
| A 世界与群聊 | 候选工作区 → World/Conversation Repository。GROUP-01～05 通过设备回归。legacy 静态复制候选入口仍缺。 |
| B 卡片与实例 | 候选卡片库 → Character Repository。实例加入、同步及原生文件选择往返未完整验收。 |
| C 世界书 | 候选世界书与预览 → Lorebook Repository。全字段等价、并发连续页未完整验收。 |
| D 记忆 | 候选记忆与来源管理 → Memory/Provenance Repository。宽授权 proof 已通过定向验证，跨组处理及标签传播仍未闭环。 |
| E 事件 | 候选账本 → EventRevocation。10k 确认和重开均通过。全事件类型与旧兼容流程仍需逐项关闭。 |
| F 自治及生活 | 候选授权、绑定和窗口 → Autonomy/RoleBinding Repository。真实生活消费者、contact/social 和生命周期未闭环。 |
| G 历史 | 候选历史整理 → Message/HistoryArchive Repository。规范化引用通过已接线场景。未知扩展引用保护及完整故障矩阵待验。 |

| 门禁 | 状态 |
| --- | --- |
| G1 调用覆盖 | BLOCKED。A–G 仍有未接线操作。 |
| G2 状态有界 | BLOCKED。SQL 返回行数与 App RSS/PSS 采样已有记录，全链路 JS、WebView 和页面峰值缺口仍在。 |
| G3 Repository | BLOCKED。MR1 和 MR2 已验证切片有 scope、CAS、事务和幂等证据，仍缺其他流程。 |
| G4 普通聊天无全图 | BLOCKED。回复链权限校验有进展，完整标签集合和旧兼容来源仍可进入 JS。 |
| G5 领域正确 | BLOCKED。群聊与宽事件通过，A–G 未全部闭环。 |
| G6 权限与租约 | BLOCKED。已覆盖撤权后正文 0、部分会话失效和迟到结果，全页面与消费者矩阵未完成。 |
| G7 错误与故障 | BLOCKED。已覆盖部分错密、事务、COMMIT、强停和恢复，完整组合未完成。 |
| G8 UI/AI | BLOCKED。实测候选使用合成 provider，真实模型 API 调用为 0。其余页面与消费者未验证。 |
| G9 全项目 | BLOCKED。全量主机 check 通过，已接线 Android 综合轮通过。强制全范围 E2E 仍缺。 |
| G10 兼容边界 | PASS。生产 canonical 为 legacy。普通 APK SQLite 激活位 false，无合成页面及种子。Schema 001–004 checksum 未变。 |
| G11 证据审计 | BLOCKED。两轮检查点复核、日志与指纹已记录，仍缺两轮完整范围复核。 |

## 实测与证据

- Windows AVD 为 emulator-5582 / kanata_m2_api34 / API 34，SQLCipher 4.17.0 community。候选 APK、测试 APK、WebView bundle、catalog、合成夹具和源码分别记录指纹。
- MR1 10k 综合耗时 152,744 ms，确认阶段 22,169 ms，单批最多 128 行。独立强停恢复后，55,449 ms 内确认 10,001 条。逐项审计数量与内容、独立状态及持久回执一致。当前树综合回归耗时 144,771 ms，其中 10k 确认耗时 15,247 ms。原 420 秒超时及失败日志保留。[MR1 汇总](qa/kanata-sqlite-m4/m4-r/mr1-metrics.json)
- MR2 的 1,000 和 10,000 个不同来源授权在记忆详情及精确来源路径上均为 25 次桥接查询、授权标签投影 0。撤权后正文投影 0。该结果只涵盖定向入口。[MR2 设备定向](qa/kanata-sqlite-m4/m4-r/mr2-grants-result.txt)
- 当前主机 npm check 退出 0，677 项 Node、397 项 Vue，lint、strict 正负类型和生产构建通过。5 项定向是 Node 子集。当前综合 Android 驱动和 MR2 定向退出 0。尚未执行的强制设备场景见 [阶段矩阵](qa/kanata-sqlite-m4/m4-r/matrix.md) 和 [G4 调用图](qa/kanata-sqlite-m4/m4-r/g4-call-map.md)。

资料来自 raw/完整需求清单.txt、raw/彼方 · Kanata 技术设计.txt、当前 legacy 与候选源码、任务书及合成日志。原工作树中的修改、删除项和未跟踪文件保留。真实资料与备份未参与本轮。未实施 SQLite 阶段 M5/M6/M7。
