# MR2-G4 事件来源接管审计

接管代码为 `271936dd4aa5a5421b0a71a8dda2b4848c15ea71`。fetch 后 M 为 `b199154a3c413f37dfcea901e7de55889e653c2c`，中间两笔提交仅涉及任务文档。审计及实现使用现有独立 M worktree。

| 调用链 | 基线边界和完整物化 | 授权、版本和输出 |
| --- | --- | --- |
| 候选事件台 → World Runtime → propose / commit → insertEvent / commitEvent → loadEvent | UI 只消费 proposal ID；提交回调不消费 DTO。Repository 将消息和因果闭包汇总成标签数组，提交完整加载 before / after；返回时再加载完整 Event | 可写世界门禁、受保护 Runtime 租约、参与者逐角色 read / remember / share、消息 revision 和事件状态、提交 revision CAS、事务收据 |
| 自治窗口及完成 → insertEvent / commitEvent | 调用者只用 ID；提交审计会 stringify 完整 Event | 原事务和任务回执；复用事件参与者及来源校验 |
| 候选工作台 → managementView / managedEvent / graphPage | 列表及图 50 + 1 lookahead；单条详情仅摘要字段；图闭包在 SQL | 图 cursor 绑定世界、根事件、根 revision、方向、after |
| 聊天 → context / relationshipContext → assertEventProvenance → visitEventPromptGrants | 授权在正文读取前；事件和消息来源分页；回复归集走临时 SQL 工作集 | 角色有效性、成员资格、群聊公开性、消息 revision、标签 origin/receiver 权限、事件 revision |
| readFor / list → authorizeEvent / eventFromRow | readFor 收齐授权标签；list 50 + 1 外层，每条又聚合完整关系和扩展；四类关系每页 128 | readFor 先授权再正文；旧 list 返回完整 Event |
| 候选事件台 → openRevocation / confirmRevocation / correctConfirmedEvent → createEventRevocation | 选择证明及 Effect 事务每批 128；审计在 SQL；修正仍先 loadEvent | 冻结签名、独立 uncertain 决策、Effect owner 和回执；审计头和 Effect 子页有界 |
| 兼容 Runtime / Repository → preview / revoke / correct / effects / audits | preview 聚合全世界的确认集合；revoke 读取完整 Event；correct 再复制；effects 汇总全数组；audits 解析完整 before/after JSON | 旧计划签名、CAS、重放及持久回执仍有调用和测试，不能替换为不同返回契约 |
| 消息修订 → reviseMessageDependents → eventFromRow → audit → rebuildEventEffects | 每个受影响事件读取四类完整关系并序列化审计；Effect 重放按 128 批 | 同事务 CAS，保留原事件以及独立 Effect 状态 |

旧顺序以 extensions_json 中经过规范化表校验的提示为准，缺失提示才按规范化索引键顺序回退。引用对象和标签的未知字段来自提示。标签去重与授权有两个身份层次：写入去重使用 grantId、revision、fingerprint，保留首位置与末值；完整性校验还比较 instanceId、moduleId。直接标签先于消息标签，消息标签先于因果事件标签。旧审计允许读取完整 Event，必须保存同样的字段和数组语义。

原始依据为 raw/完整需求清单.txt、raw/彼方 · Kanata 技术设计.txt；实施合同为事件任务书、M4-R 总任务书、MR2-G4 验收 v1、现有调用图、矩阵及两轮复核。旧实现参考 experience/kanataEvents.js 和当前 SQLite 兼容调用的行为测试。
