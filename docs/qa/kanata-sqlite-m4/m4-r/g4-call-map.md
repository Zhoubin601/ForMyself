# G4 调用链与边界

本次事件切片从远端 M 的 b199154a3c413f37dfcea901e7de55889e653c2c 接管，代码审查基线为 271936dd4aa5a5421b0a71a8dda2b4848c15ea71。当前源码提交为 fbc8ee344d6e61aef85bf6296ac5cbd4148d2eeb，详细校验见 [本轮 Git 对象及 SHA-256](event-provenance-run/fingerprints.json) 为准。

| 入口 | 当前链路 | 未关闭条件 |
| --- | --- | --- |
| 私聊、群聊、引用、延期恢复 | KanataConversationView → SQLite Chat Runtime send/runDue → transcriptForSpeaker → readPromptKnowledge / events.context → buildKanataConversationContext → 合成 provider → insertReplyBatch CAS。消息窗口、引文选择和重试采用轻量投影。普通发送拒绝 character 会话，保留历史入口。 | 宽源实际发送已测试私聊。群聊、引用和延期走共享路径并有回归。尚缺每类入口独立 1k/10k 故障组合。 |
| 普通聊天授权 | historyForSpeaker 的标准化标签约束 read 与群聊 share。回复直属引用校验同一世界、会话和精确 revision。候选用本角色最多七条模块授权，旧 origins Set 与 contextGrants 已移除。 | 旧 get、recent、older、replies、provenance 的完整兼容 DTO 仍可显式取回完整标签。 |
| 回复落库 | 预算内的消息、记忆和事件 ID/revision 进入 append。SQL 复核角色与会话 CAS，预览根重新授权。SQLite 内存临时表保留旧标签顺序、全 JSON 去重、归属去重与接收者标签。在同一事务写回复、扩展顺序提示和规范化关系。 | 保留兼容 DTO 路径需单独完成流式导出与逐条核对。 |
| 记忆提示词、管理、分享 | readPromptKnowledge → Memory.readPrompt → authorizeMemory 以 SQL 验证消息链及记忆授权。提示词逐条编码消息来源且受字节预算。append 用分页 visitor 重读来源标签，管理详情和精确来源沿用原读、记、分享区分。 | 待测管理分享及撤回的所有宽数据故障组合。 |
| 事件上下文和 Effect 可见性 | events.context / relationshipContext → assertEventProvenance → 分页事件来源和 SQLite 授权谓词，正文在证明后读取。append 的 visitor 逐页处理，摘要不携带标签数组。 | 本轮聚焦写入，未重跑每种深度和混合角色的聊天故障。 |
| 候选事件提议与提交、自治事件提交 | EventLedger → World Runtime 受保护命令 → proposeAcknowledged / commitAcknowledged → 事务内 50 条来源页及暂存，SQLite 保序去重和逐角色授权。Effect 只读取所需参与关系，before/after JSON 由 SQL 写入；候选响应为一个 ID。 | 特殊历史字符串 action 仍使用旧 JS 快照；兼容 propose/commit 和显式旧读取仍返回完整 Event。直接输入的关系 DTO 由调用者提供，收据仍对完整命令计算指纹。 |
| 候选撤销、修正、事件图和审计 | 事件详情为单条摘要，图和审计子页最多 50＋1；撤销保持冻结计划、独立 uncertain 和 128 批；普通修正按旧顺序逐页重验关系并在 SQL 复制，原撤销与替代事件共用事务和回执。 | 旧 preview/revoke/correct 计划仍汇总 ID；旧 effects/audits 和 list/readFor 仍返回完整数据。现有批量撤销快照与旧 DTO 对损坏提示及非常规 JSON 的完整 oracle 尚缺。 |
| 消息修订和归档 | reviseMessageDependents 按 50 条事件读取身份及 revision，普通事件审计在 SQL 内完成；特殊字符串 action 保留兼容回退。HistoryArchive 用 SQL 检查标准化引用及 SQLite JSON 扩展中的嵌套精确消息 ID，纳入同一冻结集合和 CAS。 | 旧不透明编码、兼容导出以及全量等价实测未覆盖。 |
| 自治任务来源 | enqueue、claim、finish 先校验 world、会话、actor、精确消息 revision。claim/finish 以 50 条分页读已存来源，结果引用用 SQL 精确匹配任务来源。 | 旧 loadTask 返回完整任务 DTO，仍为兼容导出缺口。待跑自治来源专用 Android 1k/10k。 |

来源为 M4-R 任务书、验收 v5、当前候选和 legacy 源码、raw/完整需求清单.txt 与 raw/彼方 · Kanata 技术设计.txt。

[事件接管审计](event-provenance-audit.md) · [上一轮聊天源码与夹具 SHA-256](g4-run/fingerprints.json) · [上一轮设备指标](g4-run/summary.json)
