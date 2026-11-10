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

## 6497d28 事件读取与旧兼容契约审计

M 从 fd9f23d 快进到 6497d28f2d18e37884d3d6aa90d1cfb153d50e9a。两笔新增提交只改变任务和计划文档。main 及 Kanata worktree 与原有脏文件均保留。已对照原始需求中世界隔离、上帝视角、事件修正与 uncertain 用户确认，以及总合同的 50/51/128 数据边界。

| API | 实际消费者 | 当前 DTO、物化点 | 迁移目标及兼容 |
| --- | --- | --- | --- |
| list / readFor | 主机域测试、M2 设备定向；候选工作区走 managementView，角色聊天走 events.context | list 分页后 eventFromRow 聚合每条四组关系及全部扩展；readFor 聚合跨因果和消息授权标签，再完整 loadEvent | 普通列表及受权详情为标量 header；分开读取验证后的关系、未知 JSON；完整旧 DTO 迁入显式 legacy |
| effects / audits | 域测试、M2 定向和强停 oracle；候选撤销用 revocationAudits / revocationEffectAudit | Effects 为全部 ID 排序数组；审计外层 51 行，每行含完整 before/after | 分离普通 Effect/审计分页及快照分块；旧解码保留 oracle |
| propose / commit / correct | SQLite World Runtime 的旧别名、M2/M3 QA 及主机域测试；候选台已用 acknowledgement/confirmed 接口 | 命令回执及完整 DTO，correct 另复用旧预览 | 已知只消费 ID 的场景迁移或留为明确旧 oracle；保留既有 receipt 和真实需要完整 DTO 的兼容入口 |
| preview / revoke / correct | M3 设备兼容驱动、域测试和 SQLite World Runtime 旧别名；候选台走 openRevocation / confirmRevocation / correctConfirmed | 全量 IDs、历史世界签名及 uncertain；旧 SQL 重放用完整 JSON ID 集 | 普通路径沿用 compact plan；旧签名和 receipt 单独隔离，不套用不同算法重解释既有 plan |
| relationship | 未找到候选/生产直接调用。关系提示词使用 relationshipContext 和 Effect 权限 | 域关系字段及完整 sourceEventIds，按 ID 排序 | 分离关系标量读取与反向关系页；旧返回隔离 |
| eventFromRow / loadEvent / authorizeEvent / transition | 上述旧接口，历史字符串 action 提交/撤销/修正，以及 reviseMessageDependents 的特殊回退 | 原 JSON 扩展完整性、四组数组、UTF-16 spread | 普通读取复用 SQLite 规范化检查；字符串回退及旧 oracle 保持 |
| legacy Experience、备份/恢复、归档 | KanataExperiencePanel 用独立 legacy Runtime 与 Store；候选归档用 SQLite 内部 JSON 引用检查 | 未找到备份/恢复调用上述 SQLite DTO 的证据 | 保持两个 canonical 边界；SQL 归档谓词不经过新的 API |

追踪范围包括 World Runtime、组合根、Domain/公开 contracts、候选台与工作区、legacy Experience、HistoryArchive、测试和设备 QA。候选调用先受 owner/session 守卫；readFor 的角色授权必须继续在任何正文读取前完成。普通管理视角与角色视角使用不同的访问门禁。历史字符串 action 必须按 UTF-16 code unit 与旧 JS 逐项对照。
