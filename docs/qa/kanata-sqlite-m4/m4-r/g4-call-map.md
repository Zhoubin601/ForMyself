# G4 调用链与边界

本轮接管树为 8d3b8f768617143312fd800ab05decaa53d6114d，按最新 M 核对。结论对应同目录源码指纹和实测结果。历史 c4ba189 审计保留在 Git。

| 入口 | 当前链路 | 未关闭条件 |
| --- | --- | --- |
| 私聊、群聊、引用、延期恢复 | KanataConversationView → SQLite Chat Runtime send/runDue → transcriptForSpeaker → readPromptKnowledge / events.context → buildKanataConversationContext → 合成 provider → insertReplyBatch CAS。消息窗口、引文选择和重试采用轻量投影。普通发送拒绝 character 会话，保留历史入口。 | 宽源实际发送已测试私聊。群聊、引用和延期走共享路径并有回归。尚缺每类入口独立 1k/10k 故障组合。 |
| 普通聊天授权 | historyForSpeaker 的标准化标签约束 read 与群聊 share。回复直属引用校验同一世界、会话和精确 revision。候选用本角色最多七条模块授权，旧 origins Set 与 contextGrants 已移除。 | 旧 get、recent、older、replies、provenance 的完整兼容 DTO 仍可显式取回完整标签。 |
| 回复落库 | 预算内的消息、记忆和事件 ID/revision 进入 append。SQL 复核角色与会话 CAS，预览根重新授权。SQLite 内存临时表保留旧标签顺序、全 JSON 去重、归属去重与接收者标签。在同一事务写回复、扩展顺序提示和规范化关系。 | 保留兼容 DTO 路径需单独完成流式导出与逐条核对。 |
| 记忆提示词、管理、分享 | readPromptKnowledge → Memory.readPrompt → authorizeMemory 以 SQL 验证消息链及记忆授权。提示词逐条编码消息来源且受字节预算。append 用分页 visitor 重读来源标签，管理详情和精确来源沿用原读、记、分享区分。 | 待测管理分享及撤回的所有宽数据故障组合。 |
| 事件上下文和 Effect 可见性 | events.context / relationshipContext → assertEventProvenance → 分页事件来源和 SQLite 授权谓词，正文在证明后读取。append 通过 visitor 收集有限页，事件摘要不携带标签数组。 | insertEvent、commitEvent 仍用 eventProvenance 聚合。eventFromRow 和旧 preview/revoke/correct 完整 DTO 与因果闭包仍待改造。 |
| 消息修订和归档 | reviseMessageDependents 仍读完整审计快照。HistoryArchive 用 SQL 检查标准化引用及 SQLite JSON 扩展中的嵌套精确消息 ID，纳入同一冻结集合和 CAS。 | 旧不透明编码、兼容导出以及全量等价实测未覆盖。 |
| 自治任务来源 | enqueue、claim、finish 先校验 world、会话、actor、精确消息 revision。claim/finish 以 50 条分页读已存来源，结果引用用 SQL 精确匹配任务来源。 | 旧 loadTask 返回完整任务 DTO，仍为兼容导出缺口。待跑自治来源专用 Android 1k/10k。 |

来源为 M4-R 任务书、验收 v5、当前候选和 legacy 源码、raw/完整需求清单.txt 与 raw/彼方 · Kanata 技术设计.txt。

[本轮源码与夹具 SHA-256](g4-run/fingerprints.json) · [真设备指标](g4-run/summary.json)
