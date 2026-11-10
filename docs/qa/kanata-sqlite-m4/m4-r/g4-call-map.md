# G4 入口审计

以 MR0 树 c4ba18911c705c5efde7f7614171659f056e2f1e 为起点。以下是目前读到的调用链和实测缺口。矩阵待扩展到修复后的真实设备增量。

| 入口 | 候选调用链 | 仍需处理 |
|---|---|---|
| 私聊、群聊、character、引用及延迟回复恢复 | KanataConversationView → SQLite Chat Runtime send/runDue → historyForSpeaker、readPromptKnowledge、event context → buildKanataConversationContext → provider → append/revision CAS | historyForSpeaker 和 provenance 投影先聚合 message_life_sources。fetchReplyProvenance 最多随活动历史条数，但单条仍可包含全量标签。Chat Runtime 收集 origins Set，contextGrants 接受整数组，domain builder 展平来源并返回完整 lifeSources，最终回复按数组写回。 |
| 记忆提示词 | readPromptKnowledge → Memory.readPrompt → authorizeMemory → chainSources/chainEvents/chainLife → source refs 单条编码 | 记忆源引用 DTO 已移除。authorizeMemory 默认 collect 会累计生活来源和事件标签，readPrompt 返回 proof.provenance。 |
| 记忆管理、冲突、精确来源、分享、撤回 | CandidateMemoryDetail → World Runtime → managedDetailFor/sourcePage/resolveSource/previewConflicts/confirmConflicts/shareManaged/revokeShare | 管理详情和分页已有独立入口。合并、跨组、各权限制及旧 DTO 保存/导出仍需逐项审计。分享路径复用授权，不应该重新读回完整来源 DTO。 |
| 事件上下文、创建、修正、撤销、审计 | CandidateEventLedger → World Runtime → EventRepository/EventRevocation；聊天读取 events.context/relationshipContext | visitEventProvenance 分页，但 eventProvenance/authorizeEvent/insertEvent/commitEvent 收集数组。loadEvent → eventFromRow 累计参与者、原因、消息引用、标签并建 Set 校验旧顺序。当前候选撤销使用分页计划；兼容 preview/revoke/correct 仍建整个闭包。 |
| 消息编辑/删除、历史及兼容来源 | Chat Runtime → MessageRepository → reviseMessageDependents、HistoryArchive；get/recent/older/startingAt/replies 复用 messageProjection | reviseMessageDependents 逐事件取完整 eventFromRow 写审计。messageFromRow 同时解码归一化和扩展 lifeSources 并建 Set。旧扩展引用扫描仍需单独审计。 |
| 自治任务旧来源 | Autonomy Repository → sourceMetadata → visitSourceGrants | sourceMetadata 将整段回复链的标签组装成数组。 |

权限基础来自同世界 actor、会话成员、准确消息 revision 和授权来源/接收者。静态审计里 requireLifeSources 以 Map 暂存所有 origin/receiver。权限拒绝与来源 stale 现有码值需逐层核对，避免用数组为空来表示失败。旧兼容入口在迁移时要核查仓库实际调用和严格类型，并用源顺序、权限前置、迟到结果和回执的设备证据覆盖。
