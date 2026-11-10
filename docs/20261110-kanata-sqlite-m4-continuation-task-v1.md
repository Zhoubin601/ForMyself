# Kanata SQLite M4 剩余缺口续作任务书 v1

**制定日期：** 2026-11-10（北京时间）  
**仓库 / 分支：** Zhoubin601/ForMyself / M（仅 M）  
**接管基线：** e296b2c5dd082f35b95c943bd838e3fe6a506357。Agent 启动时必须重新读取远端 HEAD；若分支已前进，以新 HEAD 为准审查差异后接续，不得回退。  
**阶段状态：** M4 BLOCKED；M5 NO。  
**执行环境：** Windows 本地 Codex、WHPX、Android API 34 合成 AVD。  
**任务性质：** 在现有 M4 候选实现上关闭剩余缺口；不是重启 M4，不推翻已通过切片，不进入 M5。

> 本文件是 2026-11-10 之后 M4 剩余工作的当前执行入口。原 [M4 补齐任务书 v1](20261109-kanata-sqlite-m4-completion-task-v1.md)、[验收 v1](20261109-kanata-sqlite-m4-acceptance-v1.md)、[验收 v2](20261109-kanata-sqlite-m4-acceptance-v2.md) 和已有 QA 均作为历史证据保留。若旧任务书中的基线、状态或待办与本文件不同，以当前远端代码和最新验收事实为准；不得删除历史记录。

## 1. 当前检查点与事实

### 1.1 Git 与生产边界

- 最近已核验的 M HEAD：e296b2c5dd082f35b95c943bd838e3fe6a506357。
- 其父提交：901dd539f4acc5828dd29ad390f4793b0be28339。
- 本次提交仅修改文档和测试，没有修改运行时代码。
- 最近一次差异包含 8 个文件：7 个文档、1 个测试文件。
- 生产 canonical 仍为 legacy。
- 普通 Android APK 的 SQLite 激活位仍为 false。
- Schema 001–004 已应用的 DDL/checksum 保持冻结。
- 不触碰真实用户数据，不读取/迁移/删除 legacy 加密归档，不实施 M5、M6 或 M7。

Agent 必须重新执行 git status、git branch、git rev-parse HEAD、git fetch 和远端 M HEAD 核对。保护已有修改、删除和未跟踪文件；禁止 reset --hard、clean、覆盖或擅自 stash 用户工作。

### 1.2 最新验收状态

以 [M4 验收 v2](20261109-kanata-sqlite-m4-acceptance-v2.md) 为阶段状态基准：

| 门禁 | 当前记录 | 本轮续作目标 |
| --- | --- | --- |
| G1 调用覆盖 | BLOCKED | 关闭 |
| G2 状态有界 | BLOCKED | 关闭 |
| G3 Repository 合同 | BLOCKED | 关闭 |
| G4 普通聊天无全图 | PASS | 最终代码树复核 |
| G5 领域正确 | BLOCKED | 关闭 |
| G6 权限与租约 | BLOCKED | 关闭 |
| G7 加密与故障 | PASS | 最终代码树复核 |
| G8 UI/AI | BLOCKED | 关闭并复核原聊天路径 |
| G9 全项目与设备验证 | PASS（仅已有覆盖范围） | 最终代码树完整复核 |
| G10 兼容与边界 | PASS | 最终代码树复核 |
| G11 证据审计 | BLOCKED | 关闭 |

G4/G7/G9/G10 的旧 PASS 仅证明对应历史受测范围。若本轮改动影响这些路径，必须重新测试；不得将旧报告中的 PASS 自动复制到最终验收。

### 1.3 最新群聊策略检查点

产品已明确确认方案 1，并已写入设计、访问矩阵与 QA 用例：

- 空群：允许原地编辑成员，conversation ID 不变。
- 有历史的群：保留原群及全部历史，按新名单创建同世界、独立 conversation ID 的新群。
- 新群从空历史开始；新成员不能通过新群读取、搜索、定位、引用原群历史或取得原群角色上下文。
- 原群原成员继续按原有访问规则读取原群历史。
- 归档或软删除后仍保留在数据库中的消息也算历史，不能只看聊天窗口是否显示消息。
- 编辑空群期间若并发出现首条消息，提交时必须在事务内重新判断，不得继续原地修改；要求用户重新确认“另建新群”。
- 跨世界角色拒绝整次提交；成员顺序按用户选择保存。
- 用户取消、事务失败或 CAS 冲突时，不得产生半个新群或修改原群。
- 重试通过命令幂等键保证最多创建一个新群。

当前已验证的是 Repository 独立建群和新旧会话数据隔离的主机测试；**实际成员编辑入口、确认弹窗、分流命令和 GROUP-01–05 Android 端到端仍未完成**。不得把 createGroup 测试说成成员编辑流程已验收。

相关依据：
- [成员变更设计](20261109-kanata-sqlite-m4-completion-design-v1.md#群聊成员变更)
- [访问矩阵](20261109-kanata-sqlite-m4-completion-preflight-v1.md#访问矩阵补齐项)
- [GROUP-01–05 QA](qa/kanata-sqlite-m4/completion/README.md#群聊成员变更验收用例)

### 1.4 测试数字与证据差异必须先核实

现有材料存在计数口径差异：

- M4 验收 v2 记录：106 项定向、660 个 Node 用例、392 个 Vue 用例。
- Completion QA README 在加入群聊隔离用例后记录：GROUP 定向 2 项、661 个 Node 用例、392 个 Vue 用例。
- 用户最新检查点也报告 661 Node / 392 Vue。

C0 必须读取真实原始日志、执行命令和测试退出码，确认完整 check 的最终计数；区分“106 项定向任务”“GROUP 定向 2 项”和完整 Node/Vue 套件，不得把不同口径相加或混写。新报告使用最终代码树真实日志，不覆盖旧报告。

## 2. 必须先读的资料

1. AGENTS.md、架构接口与Agent开发说明书.md、memory-bank/development-context.md。
2. raw/彼方 · Kanata 技术设计.txt（只读产品依据）。
3. docs/20261103-kanata-sqlite-migration-plan-v1.md。
4. docs/20261109-kanata-sqlite-m4-task-v1.md。
5. docs/20261109-kanata-sqlite-m4-completion-task-v1.md（历史补齐任务）。
6. docs/20261109-kanata-sqlite-m4-completion-preflight-v1.md。
7. docs/20261109-kanata-sqlite-m4-completion-design-v1.md。
8. docs/20261109-kanata-sqlite-m4-acceptance-v1.md 与 acceptance-v2.md。
9. docs/qa/kanata-sqlite-m4/README.md、completion/README.md、reviews.md 和全部相关原始 evidence。
10. M2/M3 任务、设计、验收、QA、Repository、Runtime、SQL catalog、类型契约。
11. 接管时 M 分支的真实源码、页面、Store、组合根、生命周期和测试。

产品语义必须来自用户已确认决策、raw 原始设计、legacy 真实行为和已通过阶段合同。不得自行创造新语义。发现文档和源码冲突时记录冲突、定位依据，先问最小必要问题；其他不受影响的工作继续。

## 3. 已有成果：保护并复测

必须保留，不得为了重构而重写：

- M2 SQLCipher 原生 Driver、受保护租约、消息/会话 Repository、CAS、审计与故障处理。
- M3 世界、角色、世界书、记忆、事件、自治等领域 Repository。
- 已实现的有界聊天消息分页、100 条活动窗口、历史 keyset 检索、按 ID 定位、引用跳转。
- 已接线的消息新增、流式、修订、删除、失败重试、延迟任务关联事务。
- 群聊 speaker、气泡顺序、锚点、quote，以及 character 会话拒绝人工发送。
- 现有授权撤销、自治窗口、水位事务、owner/scope/lease 检查。
- 已验证的 SQLCipher 错密、COMMIT 失败、强停重开、恢复门禁等切片。
- 历史失败日志、复测日志、APK、设备、数据集与源码指纹。

修改已通过路径前，先提供最小复现、影响范围和修复理由。每次修复后复测对应历史门禁。

## 4. 剩余业务缺口：逐项做成真实候选流程

### A. 世界与群聊

- 补齐现有产品确实支持的世界设置、身份编辑、创建/复制、归档/恢复操作；复制语义只按 raw/legacy 确认，不自行扩展。
- 补齐群聊成员编辑入口和本文件第 1.3 节确认的空群/历史群分流。
- 世界、会话、成员和角色选择必须按 scope 分页；不允许整表读入后在 JS filter/sort/slice。
- 世界切换后，旧弹窗、草稿、选择器、命令和异步结果不得写入新世界。
- 世界归档应保留角色、聊天、经历和全局绑定的原有语义；自治任务按现有规则停止。

### B. 角色卡片库

- 补齐卡片列表、单卡详情、导入、校验、草稿编辑、发布新版本、版本历史、归档和指定实例加入/同步。
- 保留既有 PNG/JSON 格式与字段验证，不擅自改变导入协议。
- 卡版本不可变；发布使用 revision/currentVersionId CAS，冲突明确提示。
- 原始导入 payload、图像和大资产不得进入 Pinia 列表；仅当前导入候选或当前单卡编辑态可以暂存。
- 完成 Android 原生文件选择器真实后台往返/恢复验证；不能仅验证 Web 文件 input。

### C. 世界书

- 补齐条目列表、单条详情、创建、编辑、启停、删除和按角色预览。
- 保留 owner、world、known_by、可见性和角色访问规则。
- 精确保留 legacy 的排序、激活条件、优先级、并列顺序及上下文预算；不能用第一页截断代替完整排序语义。
- 先验证权限和来源元数据，再读取正文；大正文不得常驻全局 Store。
- 完成编辑、删除、冲突和设备矩阵。

### D. 记忆整理、冲突与分享

- 补齐记忆列表、详情、整理/合并候选、冲突查看/处理、失效/删除、来源查看与分享管理。
- 保留 owner、世界、角色、可见性、known_by、life source 和 links。
- 来源必须精确绑定 message_id + revision；不得只按消息 ID、相似文本或推测恢复来源。
- revision 不匹配、缺失、跨世界、已失效或无权限时，明确拒绝或显示来源失效；不得返回伪造正文。
- read / remember / share 必须在敏感正文读取之前完成权限检查；撤权后清除正文、来源和引用缓存，阻止迟到请求重新写入。
- 深链、宽扇出和混合来源都必须有界；旧兼容入口若仍会积累全量来源 DTO，必须纳入修复或明确证明不会进入候选路径。

### E. 事件账本、撤销与 Effects 重放

- 补齐事件提议、预览、确认、状态、审计详情和撤销的真实 UI 与 Repository 流程。
- 预览冻结本次事件集合、每条 revision、处理决定和 Effects 归属；用户确认的集合就是本次操作边界。
- 提交时重新校验 owner、scope、revision、lease、恢复门禁及 Effects 归属；预览后发生变化必须 CAS 失败并要求刷新确认。
- 每条事件只撤销/停用自己拥有的 Effects，不得影响其他事件的状态。
- 明确后续与推断后续保持 raw/legacy 语义；不得把因果遍历结果静默加入用户已确认集合。
- 从持久基线重放仍有效的已提交 Effects；禁止简单反向加减或覆盖当前状态。
- 审计记录事件、Effects、前后 revision、处理结果和失败原因；事务失败原子回滚。
- 预览、确认、撤销、Effects 重放、审计详情均必须按固定批次处理；不允许将全部事件 ID、受影响路径或 Effects 一次性放入 JS Array/Map/Set。
- 重点补齐验收 v2 指出的“事件撤销与 Effects 重放有界性”，不是只做因果浏览分页。

### F. 自治、活动、联系、社交与生活角色

- 补齐自治活动设置、任务状态、窗口、调度、启停、回执、失败重试和授权。
- 补齐 contact/social 联系与社交调度的候选交互，保留既有频率、时间、状态、角色归属和权限。
- 接通全局生活角色绑定的实际消费者；区分全局 owner 和世界 owner，解绑后旧请求失效，世界归档不能误删全局绑定。
- 延迟回复、联系/社交活动、事件与自治水位使用稳定幂等键和事务回执；业务事务成功提交后才能推进水位。
- 后台、锁屏、撤权、世界归档、角色解绑后停止不再合法任务；恢复时按 ID 和 scope 重新读取。
- 不调用真实模型 API；使用合成 provider，真实 API 请求计数必须为 0。

### G. 候选历史整理

- 补齐当前 SQLite 候选内的历史整理列表、预览、用户确认、执行和结果状态。
- 保留检索、定位、引用保护、激活状态和现有整理语义。
- 批量处理按固定范围、游标和批次执行；引用中的消息不得被错误清理。
- 严禁读取、导入、转换、搬运或删除真实 legacy JSON、kanata-v1.enc、bak/tmp 或旧加密归档文件；这些属于 M5。

## 5. 深层来源与事件图有界性：必须有真实增长证据

### 5.1 关系范围

至少覆盖：

- Memory → memory_sources / memory_events / memory_life_sources / memory_links / memory_known_by。
- Memory source → message_id + revision → 当前候选消息或候选归档索引。
- Event → participants / sources / causal edges / audit / effects / effect baseline。
- Event upstream/downstream 遍历、撤销预览、确认集合和 Effects 重放。
- Character / World / Conversation / Grant 与上述来源之间的 owner、scope 和授权边界。

### 5.2 实现合同

1. 先确定 world/owner/actor/grant scope，再读敏感正文；禁止先读正文再在 JS 过滤权限。
2. 单条详情按 ID 读取；列表和关系按固定排序、keyset/cursor 或有界批次读取。
3. 不得把整张图放入单个 JS Array/Map/Set；不得 Promise.all 展开全部来源 ID。
4. 不得用任意截断改变业务语义。跨页/跨批必须有确定 continuation，不能漏项、重复或静默当完整。
5. 循环、孤儿来源、重复边、跨世界边、归档来源、revision 冲突和无权限节点有明确状态与负向测试。
6. 事件确认集合可审计，并在提交时 CAS 复核；因果遍历不得擅自扩大确认范围。
7. 每批前后复核 owner、scope、revision、lease 和取消状态；每批完成释放临时明文。
8. 若保存 traversal checkpoint，必须说明最小化字段、有效期、scope 绑定与失效；cursor 不包含敏感正文。
9. SQL 只能位于固定 catalog、参数化并有索引；UI 不拼 SQL。
10. 旧兼容入口不得以“候选 UI 没有调用”为由被忽略；调用矩阵必须证明候选链路没有落回全图读写。

### 5.3 增长与中断测试

至少使用 1k 和 10k 合成关系数据，覆盖：

- 深链、宽扇出、混合深宽、重复边、汇合边、循环和异常关系。
- 孤儿来源、已归档消息、revision 不匹配、多世界混合、授权/拒绝权限交错。
- 多事件 Effects 交错、同一目标多来源、基线重放、预览后 revision 改变。
- 在第 N 批前切世界、锁屏、撤权、关闭页面、取消、进程强停、事务/COMMIT 失败。
- 失败后重试、重复命令和幂等回执。

必须从真实 Repository、SQLite 和 Android 候选链路记录：

- SQL 查询次数、每次返回行数、最大批次大小。
- 最大 JS 暂存节点/边、Pinia/Store 保留对象数。
- 正文读取数、未授权正文读取数。
- owner 取消/撤权后仍执行的查询数。
- 事件确认集合数量、实际执行数量、Effects 归属和审计结果。
- 事务失败、重试后是否重复创建事件、Effects、通知或水位。

超出一页的关系结果必须能继续查看，不得为了通过内存测试而静默丢弃。

## 6. Store / ViewModel / UI 状态预算

沿用既有 M4 设计预算。除非真实流程证明必要且提交实测依据，不得放大：

| 数据 | 上限 |
| --- | --- |
| 消息 | 每页 50；活动会话窗口最多 100 |
| 当前世界/会话摘要 | 各 1 条 |
| 成员摘要 | 每页最多 50 |
| 世界/角色/世界书/记忆/事件/任务可见摘要 | 每列表最多 50 |
| 单条详情 | 只保留当前打开的单条；关闭/切换/撤权清空 |
| 引用摘要 | 当前会话最多 1 条 |
| 用量列表 | 每页最多 50；关闭详情清空 |
| 回复/延迟任务控制器 | 每活跃会话最多 1 个回复 controller 和 1 个延迟轮询 |

大型卡片导入 payload、图像、世界书正文、记忆正文、事件历史和全量关系图不得进入全局响应式列表。草稿只持有当前实体；保存、取消、关闭、切换、撤权后释放。必须有运行时观测，不能只凭代码里存在 slice 认定有界。无权限、来源失效、无更多数据和真实错误必须区分，不得统一映射为空数组。

## 7. 执行阶段与完成标准

### R0｜接管、基线与证据核对

- 核对工作区、M 分支、远端 HEAD 和 e296b2c 之后的差异。
- 保护用户已有修改、删除、未跟踪文件；不 reset、不 clean、不覆盖。
- 对当前源码、SQL catalog、测试、QA 脚本、APK、设备和数据集记录指纹。
- 对照 acceptance-v2、completion README、reviews 和原始日志，解决 660/661 Node 计数口径差异。
- 输出当前 A–G × UI × Repository × Runtime × Store × 权限 × 事务 × 测试矩阵。
- 重新核验 API 34 合成 AVD 的设备身份、包清单和隔离数据；不使用日常模拟器和真实资料。

R0 PASS：基线与工作区保护有证据，历史测试范围和本轮缺口明确，测试计数口径得到原始日志支持。

### R1｜测试先行与接口合同

- 将所有未完成的业务操作映射到现有 Repository、Runtime、Vue 页面和组合根。
- 先增加会失败的 Node、组件、Repository、SQLite instrumentation 和设备用例。
- 明确 owner、scope、revision、CAS、lease、幂等键、事务边界和失败状态。
- 先覆盖 GROUP-01–05，再进入对应成员编辑实现。
- 不为了让测试通过而缩减产品语义或删掉负向用例。

R1 PASS：所有 A–G M4 操作有清晰调用链与验收用例；无未分类候选入口。

### R2｜群聊成员编辑端到端

实现实际成员编辑 UI、状态管理、确认弹窗、Repository 命令和 Android 测试：

- GROUP-01：空群 A、B 改为 A、C；conversation ID 保持不变，成员顺序正确，仍无消息。
- GROUP-02：历史群 A、B 改为 A、C；确认后创建独立新会话，原群 ID、revision、成员、消息和引用完全保留。
- GROUP-03：新群不能搜索、定位、引用或取得原群消息/角色上下文；原成员在原群仍按旧规则访问历史。
- GROUP-04：空群和历史群选择异世界角色 X 均整次拒绝，原群无变化且不创建新群。
- GROUP-05：空群编辑草稿打开后并发写入首条消息；提交必须要求重新确认另建。取消、事务失败和重试不产生半提交或重复群。
- 增加归档/软删除但仍保留消息元数据的分支；必须被判定为历史群。
- 真实 Android API 34 合成 AVD 从 UI 发起并读回 SQLite 验证，不得只调用 Repository 测试。

R2 PASS：GROUP-01–05 在主机、组件和 Android 候选链路全部通过，历史和权限隔离可复现。

### R3｜事件撤销与 Effects 有界化

- 将事件预览、确认、撤销、审计与 Effects 重放接入候选管理 UI。
- 预览快照、确认集合和执行集合一致；每条 revision/owner/Effects 归属提交前 CAS。
- 将事件与 Effects 的读取、重放、审计改为固定批次；提供确定 continuation 与可恢复进度。
- 保留用户确认的批量语义；不把推断因果后续静默并入确认集合。
- 多事件共享目标和交错 Effects 必须独立处理；只停用/撤销该事件拥有的 Effects。
- 基线重放、事务回滚、失败恢复、重复命令、取消/撤权与进程中断有真实测试。
- 记录 1k/10k 数据下每批行数、暂存上界、执行集合和审计记录。

R3 PASS：事件预览至 Effects 重放完整闭环，业务语义正确且增长有界。

### R4｜记忆整理、冲突与分享有界化

- 接入候选记忆整理/合并、冲突处理、分享管理和来源查看。
- 读取敏感正文前验证 grant、owner、world、actor 和 source revision。
- 宽扇出与混合关系分批，跨页无漏无重；撤权/切世界/关闭页面后无后续正文读取。
- 精确处理归档来源、孤儿来源、revision 不匹配和多世界关系。
- 完成 1k/10k 深链、宽扇出、混合关系与取消增长实测。

R4 PASS：记忆管理闭环和深层来源链路有界，权限前置有 SQL trace 与 Android 证据。

### R5｜A–G 其他候选交互与消费者

逐项完成并验证：

- A：世界设置、创建/复制（仅限已有产品语义）、归档/恢复及完整群聊入口。
- B：卡片 PNG/JSON 原格式导入、编辑、发布、版本历史、实例加入/同步、原生文件选择后台续接。
- C：世界书完整编辑/启停/删除/角色预览与排序语义。
- F：自治设置、contact/social 调度、回执/重试、全局生活角色绑定消费者。
- G：候选历史整理预览、确认、执行和引用保护。

所有功能都必须通过真实 Repository/Runtime，不允许空按钮、mock 成功或仅展示摘要冒充完成。

R5 PASS：A–G 中剩余管理流程和跨模块消费者均有候选端到端等价实现。

### R6｜全页面生命周期、权限与状态清理

- 覆盖所有新页面、详情、草稿、选择器、导入预览、批量预览与弹窗。
- 测试连续打开/关闭、世界切换、会话切换、角色解绑、锁屏、后台、恢复、撤权、卸载与 provider 忽略 AbortSignal。
- 确保迟到结果不能写入新 owner/scope；关闭或撤权后清理明文和大对象。
- 检查 contact/social、life companion、自治、延迟回复与事件消费者的 lease、幂等和事务回执。
- 验证每项 Store/ViewModel 预算有真实运行时观测。

R6 PASS：新增页面和消费者的生命周期/权限矩阵全部通过，无迟到写入、明文残留或后台越权操作。

### R7｜最终全量回归与 Android 验收

- 运行全部定向测试、Node、Vue、strict 正负类型测试和 npm run check。
- 复测聊天、历史、流式、修订/删除、重试、群聊、character、引用、锚点、延迟回复和自治水位。
- 运行 A–G 新增业务的组件、Repository、SQLite 与真实 Android JS→Native→SQLCipher 测试。
- 运行 1k/10k 深链、宽扇出和混合关系增长测试，记录第 5.3 节所有指标。
- 注入错密、读失败、CAS 冲突、COMMIT 失败、强停重开、重复提交、撤权迟到和恢复门禁故障。
- 构建普通 Android APK 并再次核验 SQLite 激活位 false、无合成页面和合成种子。
- Android 未实跑的场景必须标记 NOT RUN/BLOCKED；Gradle 构建成功不能替代设备验收。
- 记录最终 APK、设备、SQLCipher、catalog、数据集和受测源码 SHA。

R7 PASS：最终代码树的完整测试和真实设备场景可复现，所有增长与权限指标有证据。

### R8｜两轮全范围自检、报告与推送

第一轮：安全、权限、Repository、事务和内存反例。检查 snapshot/update/clone/stringify/readAll/filter/sort/Promise.all、无界 Map/Set、旧兼容入口、宽关系展开、事件 Effects 暂存、撤权后正文读取、后台重入、owner 失效、COMMIT 失败和重复命令。

第二轮：产品语义、UI 等价、平台、兼容和证据。逐项对照 raw/legacy 验证世界、卡片、群聊、世界书、记忆、事件撤销、contact/social、生活角色绑定和历史整理；检查普通 APK、legacy、SQL catalog、生产激活位和源码指纹。

每轮记录反例、实际失败、修复、复测命令和最终结果。只覆盖部分增量不能称为全范围自检。

交付并普通推送到 M：
- M4 剩余缺口最终验收 v3。
- completion QA README、reviews 和 evidence。
- README.md、docs/plan.md、M0–M7 总计划与 memory-bank/development-context.md 的准确入口。
- 源码/测试/SQL catalog/APK/设备/数据集指纹。
- G1–G11 逐项状态和 M5 放行结论。

R8 PASS：两轮全范围自检完成，最终证据与提交 SHA 对齐，远端 M 与本地提交一致。

## 8. G1–G11 最终验收合同

| 门禁 | 必须关闭或复核的内容 |
| --- | --- |
| G1 调用覆盖 | A–G 所有真实操作有 legacy → 候选 UI → Runtime → Repository → SQL 调用链；无未分类入口 |
| G2 状态有界 | 列表、详情、草稿、来源图、事件 Effects、导入 payload、Store/ViewModel 均有预算和运行时观测 |
| G3 Repository | scope、owner、ID、keyset、count、CAS、批次 continuation、事务与幂等命令均有实测 |
| G4 普通聊天无全图 | 最终聊天与管理路径无全量 KanataData clone/serialize/readAll；复核旧兼容路径 |
| G5 领域正确 | A–G 完整候选流程端到端通过；群聊、来源 revision、世界书排序、Effects、自治等语义正确 |
| G6 权限与租约 | read/remember/share 前置；撤权、锁屏、后台、解绑、卸载、迟到结果和取消通过 |
| G7 错误与故障 | SQLCipher 错密、版本拒绝、事务/COMMIT 失败、强停重开和恢复门禁 fail closed |
| G8 UI/AI | 私聊/群聊/character/quote/锚点/气泡/延迟及全部新增管理 UI 实际运行；真实模型 API 请求为 0 |
| G9 全项目 | 定向、npm run check、strict 正负类型、真实 Android SQLCipher JS E2E 均通过 |
| G10 兼容边界 | legacy 保留；普通 APK 激活 false；001–004 checksum 不变；M5/M6/M7 未提前实施 |
| G11 证据审计 | 两轮全范围自检、失败/修复/复测、命令退出码和源码/设备/数据指纹完整对齐 |

最终只能作以下判断：

- PASS：G1–G11 全部在最终代码树有可复现证据，才可建议 M5；不自动开始 M5。
- BLOCKED：任一 M4 功能、增长、生命周期或设备场景未完成，M5 继续 NO。
- FAIL：权限绕过、真实数据误操作、全图回读、数据丢失、Effects 串改、事务半提交、锁定后明文泄漏或生产误激活。

## 9. 严格禁止事项

1. 不导入、转换、删除真实 legacy JSON、kanata-v1.enc、bak/tmp 或旧加密归档。
2. 不迁移真实用户数据，不切 production canonical，不启用普通 Android SQLite 激活位。
3. 不实施 M6 生产便携备份、完整恢复、全局主密码改密或 DEK 重包装。
4. 不实施 M7/P7 最终容量门槛，不修改 P7 原始性能标准。
5. 不修改已应用 001–004 migration DDL/checksum；若发现不可由访问层解决的结构缺口，先证明并单独提出，不在本任务内擅自扩展 schema。
6. 不删除 legacy 功能、旧 Web 协议、旧备份兼容入口或恢复协调器。
7. 不调用真实模型 API；只使用合成 provider。
8. 不修改 Kanata/main、不合并、不强推、不发布 APK。
9. 不覆盖其他 Agent/用户提交；若远端 M 在执行期间前进，先检查并接续。
10. 不因测试耗时或实现困难降低验收范围、放宽数据预算或把 NOT RUN 写成 PASS。

## 10. Agent 执行方式与最终报告

- 先执行 R0，确认当前工作区和设备；不因已有历史证据而跳过复核。
- R1–R8 连续推进，模块完成即运行定向测试；不要只输出计划或只完成 UI 壳。
- 只有遇到会改变产品语义、数据安全或不可逆行为的真实阻塞时才向用户提问；一次只问最关键的一项，其余工作继续。
- 所有测试只使用合成数据与隔离 AVD。
- 仅在 M 分支普通提交和推送；推送后核对本地/远端 HEAD。
- 最终报告必须列出 R0–R8、A–G、GROUP-01–05、G1–G11、测试计数口径、原始命令/退出码、Android 设备、APK/catalog/数据集/源码 SHA、两轮反例自检、生产边界和 M5 YES/NO。

**最终提醒：** 这是 M4 剩余缺口关闭。群聊成员规则已确定，但成员编辑流程还未完成；事件因果浏览已有证据，但撤销与 Effects 重放仍需有界化；记忆深链已有证据，但整理/冲突/分享与宽关系增长仍需完成。M4 未全部 PASS，绝不进入 M5。
