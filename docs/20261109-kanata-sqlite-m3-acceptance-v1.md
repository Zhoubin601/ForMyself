# Kanata SQLite M3 验收 v1

2026-11-09，北京时间。范围为 M 分支的隔离 SQLite 候选。生产 canonical 为 legacy，普通 Android 包 SQLite 激活位为 false。

依据为 [接管](20261109-kanata-sqlite-m3-preflight-v1.md)、[任务书](20261109-kanata-sqlite-m3-task-v1.md)、[技术设计](20261109-kanata-sqlite-m3-design-v1.md)与用户本轮确认的产品语义。

## 结果

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| Schema | PASS | 追加 004。001/002/003 checksum 逐版相同，带数据 v3 升级保留旧消息和历史应用时间，空库及旧版升级故障回滚。 |
| 世界、角色、世界书 | PASS | 两世界隔离、归档与取消归档、角色不可变版本和独立实例、关联写入失败回滚、世界书可见性和删除。 |
| 来源与授权 | PASS | 归档后从活跃上下文排除，历史仍可定位。根据 ID + revision 精确解析。读、记忆、分享和撤权负例检查了实际查询轨迹，拒绝路径没有读取敏感正文。 |
| 事件与 Effects | PASS | 预览按事件因果集合核对，独立同路径 Effects 保留；状态、审计、效果及记忆失效同事务。原生验证移除事件甲后事件乙的地点仍保留。 |
| 自治与统计 | PASS | 稳定任务键、任务租约与 CAS；重复完成只产生一份事件。注入延迟外键触发真实 COMMIT 失败，水位保留旧值，随后重试成功。用量保留实测、缺失和估计字段。 |
| 并发及中断 | PASS | 同 revision 世界更新一胜一冲突。Android 实际强停前，窗口事务已发出事件、Effects、任务和水位写入但未 COMMIT。PID 6640 → 6766。重开后水位为 1800000，任务缺席。重试写入 1 个事件并提交到 3600000。 |
| 兼容与保护 | PASS | 候选 Android 使用实际聊天组件跑群聊、引用、失败重试、延迟回复、快切及锁定。character 拒绝人工发送。租约失效、恢复门禁与消息派生回归通过。 |
| 全项目与原生 | PASS | 完整 `npm run check`，648 Node、392 组件、strict 正负例、Vite；lint 0 错误、42 既有警告。设备 instrumentation 1/1，JS→SQLCipher 实际用例通过。普通构建门禁通过。 |
| M3 范围外 | NOT RUN | 实体设备、真实模型调用、旧 JSON/加密页导入、生产 SQLite 切换、全局 Store 重构、备份恢复与改密、M7/P7 容量。 |

**M3 合成候选 PASS。** 生产继续使用现有业务存储和管理入口。SQLite 候选以 Repository、受保护的世界 Runtime 和实际聊天 Runtime 走通领域接线。候选的归档是 SQLCipher 内逻辑归档，历史原文保留同一行。

新建 AVD 的首次 CDP 调用超时。相同 APK 与相同 JS bundle 在同一合成 AVD 重试后完成全部设备场景。超时记录与复测分别保留。普通包核验的首个 PowerShell 断言误把包名以外的 badging 行当作失败，修正为匹配 applicationId 行后，BuildConfig 和打包目录均通过。

## 文件与接口

- `src/features/chat/storage/sqlite/` 新增 `kanataWorldRepository.js`、`kanataCharacterRepository.js`、`kanataLorebookRepository.js`、`kanataMemoryRepository.js`、`kanataEventRepository.js`、`kanataAutonomyRepository.js`、`kanataUsageRepository.js`。公共投影、幂等、授权和类型在 `kanataDomainRows.js`、`kanataProvenance.js`、`kanataSqliteDomains.js`、`kanataDomainTypes.d.ts`。
- 004 新增 `domain_command_receipts`、`archived_message_marks`、四个世界域索引及角色卡版本不可更新触发器。原生固定语句目录同步加入新的参数化 SQL。
- `src/application/kanataSqliteCandidate.js` 接入 `withDomains` 和 `createWorldRuntime`。`kanataSqliteChatRuntime.js` 从同一候选读角色、世界、世界书、实时授权、记忆与事件，并接入用量记录。`KanataEventsPanel.vue` 支持异步的实际仓库预览。
- M2 的 `kanataMessageDependents.js` 继续参与消息派生失效，与事件 Repository 共用 Effects 重放。原始规则在 `kanataEvents.js`、`kanataAutonomy.js`、`kanataKnowledge.js`、`kanataConversation.js` 继续使用。
- 行为测试 `tests/kanataSqliteDomains.test.js`，类型负例 `tests/types/kanataSqliteM3.ts`。已有 Schema 测试保持历史保护断言并覆盖 004。设备复用 M2 隔离驱动，新增 M3 场景及窗口强停。
- 本页和 [QA](qa/kanata-sqlite-m3/README.md) 与总迁移计划、架构说明、长期入口共同记录接口、范围和复现命令。

## 两轮独立自检

1. **架构和安全。** 构造无变化授权保存占用撤权重试、无来源标签的回复指向受限原文、私有事件对角色状态的影响、同路径独立 Effects 及提交前强停。修正授权空操作回执，沿回复链校验来源，并让上下文先判断事件可见性再读取允许的动态状态。定向测试与完整设备复测通过。
2. **业务和兼容。** 构造归档仍进入活跃上下文、记忆软删仍保留正文、快切时旧世界请求迟到、旧卡被发布操作误改，以及两个事件竞争同一状态。候选排除已归档活跃原文，删除写入固定脱敏标记，切换淘汰旧 owner，角色版本不可更新。定向测试、完整 check 与 Android 实际聊天回归通过。

用户复核可集中在可逆归档、批量事件撤销预览、记忆来源拒绝与自治窗口的 [原始结果](qa/kanata-sqlite-m3/evidence/android-result.txt)。[机器汇总](qa/kanata-sqlite-m3/evidence/summary.json)给出环境、指纹和本轮实测命令。
