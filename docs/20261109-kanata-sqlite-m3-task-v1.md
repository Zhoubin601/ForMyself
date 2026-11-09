# Kanata SQLite M3 任务书 v1

日期 2026-11-09（北京时间）。分支 M，起点 `b36bbe65ec05dea0b408867dd7acdc627ca983f2`。见 [接管](20261109-kanata-sqlite-m3-preflight-v1.md)、[技术设计](20261109-kanata-sqlite-m3-design-v1.md)与[迁移总计划](20261103-kanata-sqlite-migration-plan-v1.md)。

| 域 | 操作 | 验收 |
| --- | --- | --- |
| 世界 | 创建、查询、更新、归档与取消归档、身份关联 | 世界隔离、CAS、跨表故障、快切丢弃迟到结果 |
| 角色 | 卡、不可变历史、实例及状态、显式同步 | 版本发布不影响旧实例、跨世界实例独立、character 拒绝人工发送 |
| 世界书 | 世界与角色条目、可见范围、更新删除 | 关联保真、私有不可跨读、删后失效、CAS |
| 记忆 | 写入、查询、删除与分享、按消息 ID + revision 溯源 | 活动窗口之外和归档来源、旧 revision 与已删消息拒绝、权限失败零正文查询 |
| 事件 | 提议、确认、查询、审计、预览撤销、Effects | 同路径多事件、明确因果、旧预览、未知规则、事务回滚 |
| 自治 | 任务、授权、统计、UTC 水位 | 幂等键冲突、并发 CAS、任务和事件原子提交、失败或进程强停不推进水位 |

通过完整 `npm run check` 和真实 Android JS 至 SQLCipher 验证。对语句、COMMIT、后台与强停重开注入故障。分别完成安全架构及产品兼容的两轮反例自检。按门禁单列 PASS、FAIL、BLOCKED、NOT RUN，留存复现证据并普通提交至 M。

生产 canonical 保持 legacy，普通包保持 SQLite 关闭。合成候选复用现有 Driver 和租约。M4 全局 Store、M5 旧归档导入、M6 改密备份及 M7 容量独立验收。
