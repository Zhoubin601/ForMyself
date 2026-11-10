# M4-R 接管与验证矩阵

## MR0 基线

- fetch 后远端 M 与隔离工作树 M 均为 c4ba18911c705c5efde7f7614171659f056e2f1e。与任务书所列 d1737e7 相差一个纯文档提交。主工作树 main 的四项文档修改、一个 APK 删除和三项未跟踪入口按原状态保留。独立 Kanata 工作树未进入开发范围。
- [任务书](../../../20261110-kanata-sqlite-m4-r-closeout-task-v1.md)、[验收 v4](../../../20261110-kanata-sqlite-m4-acceptance-v4.md)、[历史 QA](../closeout/README.md)、[续作 GROUP 证据](../continuation/README.md)与[总计划](../../../20261103-kanata-sqlite-migration-plan-v1.md)作为证据入口。原始资料为 raw/完整需求清单.txt 和 raw/彼方 · Kanata 技术设计.txt。未使用资料中的旧迁移提议覆盖现行用户决策。
- 以原始 check-delivery.txt.gz 和 directed-delivery.txt 复核历史口径。675 Node、397 Vue、121 定向（Node 子集）。v4 的 28 个文件 SHA-256 及 src/tests/scripts 树对象与接管提交相符。
- GROUP-01～05 保留 v3 历史 PASS。群编辑组件、群仓库及群定向测试文件指纹仍匹配 v3。共享候选工作区、World Runtime 和驱动曾在 v4 变更。使用 v4 或本轮真实设备回归覆盖共享入口，不继承整树 PASS。
- emulator-5582 已按原合成 manifest 单独启动，WHPX 可用。AVD kanata_m2_api34，API 34，x86_64，系统指纹 google/sdk_gphone64_x86_64/emu64xa:14/UE1A.230829.050/12077443:userdebug/dev-keys。设备上仅候选包 com.yubin.formyself.m2qa 及测试包。Java instrumentation 与 WebView 实测候选 SQLCipher 4.17.0 community。
- 生产 canonical 为 legacy。普通构建 KANATA_M2_SYNTHETIC 默认为 false。生成候选 catalog 复核 001–004 校验和见 MR0 指纹。普通 APK 设备回归归 MR7。

## A–G 接管缺口

下表按接管时刻区分接线与已验证范围。完整场景仍按任务书逐项补证。

| 域 | UI 与 Runtime | Repository / SQL | Store / 权限 / 事务 | 生命周期 / 设备 | 接管缺口 |
|---|---|---|---|---|---|
| A 世界与群聊 | KanataCandidateWorkspace、GroupEditor；World Runtime 创建、选择、设置、归档和群成员编辑 | World / Conversation Repository；世界 owner 与群历史 CAS | 当前 scope 管理摘要；群写入有幂等回执 | v3 GROUP-01～05、v4 静态设置通过对应切片 | legacy 静态复制未接候选。源为 KanataWorldManager → kanataManagement → copyKanataWorld，具体过滤和重置规则可对照。归档与世界切换需完整矩阵 |
| B 卡片与实例 | KanataCandidateCardLibrary；World Runtime 打开全局卡库 | Character Repository：卡版本、实例读取 | 详情和导入工作区的明文及资产生命周期待完整验证 | 原生 PNG/JSON 选择、取消、返回、后台恢复未完整验证 | 实例加入与版本同步、扩展字段完整等价、原生选择往返 |
| C 世界书 | KanataCandidateLoreEditor、角色预览；World Runtime 管理入口 | Lorebook Repository 与 readKanataRoleLore | 角色可见性前置，启停与编辑 revision | 历史排序与预览切片有证据 | 全字段、并发连续分页和撤权后正文释放 |
| D 记忆 | KanataCandidateMemoryDetail；World Runtime 来源、管理、合并和分享 | Memory / Provenance Repository | 精确 message revision；分离 read/remember/share；已有撤回事务与迟到结果证据 | v4 来源与分享切片、聊天预算和取消有 Android 证据 | 跨组整理、宽标签与异常来源、管理生命周期矩阵 |
| E 事件 | KanataCandidateEventLedger；World Runtime 提议、修正、撤销与审计 | Event Repository / EventRevocation；冻结摘要、逐项 Effects 审计和事务回执 | 一次只保留单条详情或分页计划；旧兼容全图仍待处理 | 主机 1k/10k，Android 1k 通过；历史综合设备轮 10k timeout | MR1 定位、宽确认故障/恢复及全规则；MR2 事件和消息来源 |
| F 自治和生活 | Workspace 任务摘要、Bindings；World Runtime 配置 | Autonomy / RoleBinding Repository；窗口、水位与回执 | 授权和精确实例绑定已有；后台消费者缺接线 | M3 窗口强停回滚证据；完整后台、解绑、归档和撤权未跑 | 自治调度、contact/social 和真实生活模块消费者 |
| G 历史整理 | KanataCandidateHistoryPanel；Chat Runtime 预览、确认 | HistoryArchive / Message Repository；签名、CAS、回执 | 消息窗口与归档标记保留标准化引用 | v4 Android UI 回读及引用切片 | legacy 非规范化扩展引用扫描、软删与稀疏引用及全故障矩阵 |

## 本轮 MR2-G4 接管与验证

接管树 8d3b8f768617143312fd800ab05decaa53d6114d。工作区位于 M 的既有隔离 worktree。main 上四个文档修改、一个 APK 删除和三个未跟踪入口按原状态保留。

| 切片 | 当前覆盖 | 未验范围 |
| --- | --- | --- |
| 普通聊天 | 消息 transcript、SQL 权限、预算内根、SQLite 内存临时工作表、旧顺序逐条对照 | 每种入口独立 1k/10k 与所有故障组合 |
| 记忆和事件提示词 | SQL 验证 read、remember、share，查正文后才构建提示词。复用上一轮记忆详情定向证据并以普通聊天重测 | 旧事件创建、提交、修正和导出全图 |
| 消息归档 | 嵌套扩展中的精确 ID、正常引用、事务快照 | 不透明编码、旧导出逐条等价和独立 Android 增长 |
| 自治 | claim/finish 按页校验已存来源与精确结果成员关系 | 旧 loadTask 及真实设备自治来源宽样本 |
| 故障 | 复测源授权撤销、reply CAS、写入故障回滚、迟到 provider 的读写护栏 | 其余独立故障组合见验收报告 |

## MR2-G4 事件来源切片

| 项目 | 主机 SQLite | Android API 34 / SQLCipher 4.17.0 | 结论 |
| --- | --- | --- | --- |
| 候选提议、提交、修正混合标签 | 1k/10k 最大 50 行，完整 DTO 读取 0；双角色与旧 Map 顺序 oracle | 1k/10k 最大 50 行，最大暂存 50，完整事件 DTO 0 | 此定向切片通过 |
| 撤权及 stale | 跨世界、消息 revision、授权失效拒绝 | 两档均拒绝，撤权后正文读取 0 | 定向通过 |
| CAS、COMMIT、取消、强停与回执 | 真实 SQLite 事务、故障注入、修正回滚、重复及损坏提示 | 两档真实 COMMIT 失败及幂等，1k 取消后零新增 I/O，单事件强停回滚重放 | 定向通过 |
| 旧 Event、审计、Effect 与确认集合 | 完整读作为行为 oracle | 专用测试确认完整兼容输出仍可读取当前样本 | BLOCKED，输出和兼容计划仍无界 |
| 事件深链/宽扇出写入、故障全矩阵 | 有既有图读取和撤销证据 | 本轮宽标签形状不能替代宽写入闭包和权限生命周期组合 | BLOCKED |

[验收 v2](../../../20261110-kanata-sqlite-mr2-g4-acceptance-v2.md) · [原始证据索引](README.md)
