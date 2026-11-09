# Kanata SQLite M4 补齐任务书 v1（M4 Completion / Gap Closure）

**制定日期：** 2026-11-09（北京时间）  
**执行分支：** M（仅 M）  
**接管基线：** 301ad81e851f65cd5b73f883833052e7e5d1a2fb。Agent 开始时重新核对远端 HEAD；若 M 已前进，以实际新 HEAD 为准并审查差异，不得回退。  
**当前状态：** M4 BLOCKED / M5 NO。本文只定义补齐任务，不代表缺口已实现或验收。  
**执行环境：** Windows 本地 Codex + 已核验的 WHPX / Android API 34 合成 AVD。  
**任务性质：** 在现有 M4 部分实现上定点补齐，不重做 M4，不推翻已通过切片，不进入 M5。

> **最高原则：** 保留已完成的有界聊天、历史定位、领域摘要工作区、授权撤销、自治窗口、SQLCipher 故障测试等成果。只针对当前验收报告明确列出的缺口补齐。最终 G1–G11 必须全部通过；旧报告中的 G4/G7/G8/G9/G10 PASS 不能自动代替最终代码树的必要回归。

## 1. 当前检查点与权威资料

### 1.1 当前状态

- 仓库：Zhoubin601/ForMyself
- 分支：M
- 已核对 HEAD：301ad81e851f65cd5b73f883833052e7e5d1a2fb
- M3 源码基线：751da40149404deb8bc1562851a91e699c60c1e5
- M4：BLOCKED；M5：NO
- Production canonical：legacy
- 普通 Android Debug 的 SQLite 激活位：false

若远端已产生新提交，必须先读取新提交、检查差异并以新 HEAD 接续；不得覆盖其他 Agent/用户提交。

### 1.2 必须先阅读

1. AGENTS.md、架构接口与Agent开发说明书.md、memory-bank/development-context.md。
2. raw/彼方 · Kanata 技术设计.txt（只读，作为产品语义来源）。
3. docs/20261103-kanata-sqlite-migration-plan-v1.md。
4. docs/20261109-kanata-sqlite-m4-task-v1.md。
5. docs/20261109-kanata-sqlite-m4-preflight-v1.md。
6. docs/20261109-kanata-sqlite-m4-design-v1.md。
7. docs/20261109-kanata-sqlite-m4-acceptance-v1.md。
8. docs/qa/kanata-sqlite-m4/README.md、reviews.md 及 evidence 原始记录。
9. M2/M3 任务书、设计、验收、QA、Repository、Runtime 和 SQL catalog。
10. 接续时 M 分支实际源码、类型、Vue 页面、路由/组合根和测试。

产品语义以用户确认、raw 原始设计、现有产品行为和已通过阶段合同为依据。不能用通用产品经验擅自改变业务。历史报告只证明其受测 SHA 和范围，不自动证明当前代码。

## 2. 当前已完成切片：必须保留

当前 M4 验收报告已记录：
- 聊天消息 50 条分页、100 条活动窗口。
- 会话历史 keyset 检索、按 ID 定位、引用跳转。
- 轻量世界/会话/成员摘要工作区。
- read / remember / share 授权及撤权失效。
- 消息新增、流式、修订、删除、失败重试、延迟任务关联事务。
- 群聊 speaker、气泡顺序、锚点、quote、character 拒绝人工发送。
- 自治窗口分批访问、签名与水位事务。
- 已接线路径的 scope / generation / owner / lease 检查。
- Windows/WHPX API 34、Android SQLCipher 4.17.0 的候选集成和已记录故障场景。
- 原报告 G4、G7、G8、G9、G10 的 PASS 证据。

不要重写上述路径来“重新完成 M4”。如发现缺陷，先给出最小复现、影响和修复理由，再做最小修改并复测。

## 3. 必须补齐的完整候选业务交互

当前世界书、记忆、事件、自治等主要只有摘要入口。以下完整交互仍只在 legacy 路径中，需要候选端功能等价接线。

### A. 世界与群聊管理
- 完整世界设置、世界身份查看/编辑。
- 世界复制（仅在现有产品确实支持时）、关联数据与 owner/revision 一致。
- 世界可逆归档与恢复；归档停止自治但保留角色、聊天和经历。
- 建立群聊、编辑成员、顺序和角色关联。
- 世界/会话/角色列表按 scope 分页；不得全量装配后在 JS filter/sort/slice。
- 世界切换后，旧对话框、成员选择、任务和异步结果不能写入新世界。

### B. 角色卡片库
- 卡片列表、按 ID 详情、导入、校验、编辑草稿、发布新版本、版本历史。
- 保留原导入格式、字段校验、版本发布和角色实例关联。
- 卡版本不可变；发布通过 CAS/currentVersionId，冲突明确提示。
- 原始导入 payload、图像和大型资产不得进入 Pinia 列表响应式图；列表仅轻量投影，编辑只持有当前单卡草稿。
- 不实施真实旧数据导入或备份/恢复/改密。

### C. 世界书
- 条目列表、详情、创建、编辑、启停、删除和预览。
- 保留 owner、world、known_by/可见性及角色访问语义。
- 精确保留原排序、激活条件、优先级、并列顺序和上下文预算；不能用截断第一页代替原有完整排序。
- 预览只读取本次需要的正文；权限和来源元数据先于正文。
- 大型条目正文不随列表常驻 Pinia。

### D. 记忆整理与来源
- 记忆列表、详情、整理/合并候选、冲突查看/处理、删除/失效和来源详情。
- 保留 owner、世界、角色、可见性、known_by、life source 和 links。
- 来源精确绑定 message_id + revision；禁止只按消息 ID 或相似正文猜来源。
- 来源消息已归档时，按当前 SQLite 候选内可索引消息/归档元数据按需解析。revision 不匹配、缺失、跨世界或无权限必须明确拒绝/失效，不能伪造正文。
- read / remember / share 必须在读取敏感记忆和来源正文前检查；撤权清除正文缓存并阻止迟到结果。
- M5 才负责旧加密归档文件导入；M4 不扫描、搬运或删除真实 legacy 文件。

### E. 事件账本与 Effects
- 事件提议、预览、确认、状态、审计详情和撤销交互。
- 预览列明本次处理事件及 revision；确认时重新检查 revision、owner、权限和 Effects 归属。
- 保留用户已确认的批量预览语义：用户确认的事件集合就是本次操作边界；每条事件只撤销/停用自身拥有的 Effects，不得覆盖其他事件的状态。
- 明确因果后续按现有产品流程处理；推断后续不得静默加入已确认集合，应标记待复核并按既有规则停用对应 Effects。
- 撤销从持久基线重放仍有效的已提交 Effects；禁止简单反向加减或覆盖当前状态。
- 审计记录事件、效果、前后 revision 和处理结果；失败原子回滚。
- 事件、因果边、参与者、来源、Effects、审计按世界/事件 scope 访问，不加载整张事件图。

### F. 自治、活动、联系与生活角色绑定
- 自治活动面板完整设置和状态：任务、窗口、调度、启停、回执、失败重试、授权。
- contact/social 联系与社交调度候选等价交互，保留频率、时间、状态、角色归属和权限语义。
- 全局生活角色绑定及生命周期消费者：区分全局 owner 与世界 owner；解除绑定后失效，世界归档不能误删全局绑定。
- 延迟回复、联系/社交活动、事件和自治水位保持幂等键及同事务回执。
- 水位只在业务事务成功提交后前进；重复执行不得重复生成事件、通知或 Effects。
- 后台、锁屏、撤权、世界归档、角色解绑后停止不再合法任务；重入时按 ID 和 scope 重新查询。

### G. 候选历史整理
- 补齐 M4 设计中已列明的旧历史自动整理候选等价入口，但仅处理当前 SQLite 候选已有的消息、归档索引和历史元数据。
- 保留历史检索、定位、激活/引用、整理预览和用户确认语义。
- 不读取、导入、转换或删除 legacy 加密归档文件；旧文件迁移属于 M5。

若现有产品源码/raw 无法证明某项语义，先在矩阵标记待确认并提出最小问题；其余无关工作继续。

## 4. 深层来源与事件图有界性（核心补齐）

当前验收明确指出深层记忆/事件溯源的临时关联集合没有完成增长和权限复核。普通列表分页不能替代这项验收。

### 4.1 覆盖关系
- Memory → memory_sources / memory_events / memory_life_sources / memory_links / memory_known_by。
- Memory source → message_id + revision → 当前消息或候选归档消息元数据。
- Event → participants / sources / causal edges / audit / effects / effect baseline。
- Event causal downstream/upstream 预览与撤销范围。
- Character / World / Conversation / Grant 与上述来源的 scope 和 owner。

### 4.2 实现合同
1. 先确定 world/owner/actor/授权 scope，再取敏感正文；禁止先读正文再在 JS 过滤权限。
2. 单条详情按 ID 读取；列表/关联使用固定排序、keyset/cursor 或有界异步批次。
3. 不允许把全图放入单个 JS Array/Map/Set，也不允许 Promise.all 展开全部来源 ID。
4. 不得用任意截断改变业务语义。跨页/跨批必须有确定 continuation，记录已扫描边界和下一游标，不能漏项、重复或静默当完整。
5. 循环、孤儿来源、重复边、跨世界边、已归档来源、revision 冲突和无权限节点必须有明确状态和负向测试。
6. 事件撤销预览中的用户确认集合必须可审计并在提交时 CAS 复核；每个事件只处理自身 Effects，因果遍历不能擅自扩大确认范围。
7. 每批前后复核 owner、scope、session revision、lease 和取消状态；每批完成释放临时明文。跨批操作不得将全部节点保留在 Pinia。
8. 若保存 traversal checkpoint，必须说明数据最小化、有效期、scope 绑定和失效；cursor 不得包含敏感正文。
9. SQL 位于固定 catalog、参数化并有索引；提供实际查询轨迹/行数证据，不允许 UI 拼 SQL。

### 4.3 增长测试
至少构造 1k 和 10k 合成关系数据，覆盖深链、宽扇出、混合深宽、重复/汇合边、循环/异常关系、孤儿来源、归档消息与 revision 不匹配、多世界混合数据、允许/拒绝权限交错，以及在第 N 批前切世界/锁屏/撤权/关闭页面/取消。

记录查询次数、每次返回行数、最大批次、最大 JS 暂存节点/边、Store 保留对象、正文读取数、未授权正文读取数、owner 取消后的后续查询数。必须来自真实 Repository/SQLite/Android 路径，不能只用 mock 或 grep。

超出一页的关联结果应支持继续查看/展开，不得为内存指标静默丢弃。

## 5. Store / ViewModel / UI 预算

沿用 M4 设计的现有预算。若真实流程证明需要变化，必须写出理由、替代预算和实测，不得直接放大：

| 数据 | 设计上限 |
| --- | --- |
| 消息 | 每页 50；活动会话窗口最多 100 |
| 当前会话/世界摘要 | 各 1 条 |
| 成员摘要 | 每页最多 50 |
| 世界/角色/世界书/记忆/事件/任务可见摘要 | 每列表最多 50 |
| 单条详情 | 当前打开的单个详情；关闭/切换/撤权清空 |
| 引用摘要 | 当前会话最多 1 条 |
| 用量列表 | 每页最多 50；关闭详情清空 |
| 回复/延迟任务控制器 | 每活跃会话最多 1 个回复 controller 和 1 个延迟轮询 |

大型卡片导入 payload、图像、世界书正文、记忆正文和事件历史不得进入全局响应式列表。编辑态只持有当前实体草稿，保存/取消/关闭/切换后释放。所有上限必须有运行时观测；不接受只看代码有 slice。错误、无权限、来源失效、无更多数据必须显式区分，不能以空数组掩盖错误。

## 6. 补齐阶段

### C0｜接管与冻结已有成果
- 检查 git status、分支、HEAD、远端 M；核对 301ad81 或更新后的真实 HEAD。
- 保护主工作树既有改动/删除/未跟踪文件；禁止 reset、clean、覆盖。
- 对当前已测源码、SQL catalog、QA 脚本和 APK 记录 SHA，识别代码与旧证据差异。
- 输出“已通过切片保留清单”和“待补缺口清单”。
- 只读核验 API 34 合成 AVD 身份、序列号、包清单、数据盘和 APK；不使用日常模拟器或真实资料。

C0 PASS：基线、工作区保护、设备身份和切片清单有证据。

### C1｜完整调用矩阵与测试先行
- 对 A–G 每个真实操作建立矩阵：legacy 入口、产品语义来源、M3 Repository/命令、候选 Runtime、Vue 页面、Store DTO、权限/owner、事务、失败语义、测试。
- 沿菜单、弹窗、快捷操作、定时器、生命周期、AI/自治路径追踪到实际 SQL 与响应式状态。
- 标记已候选等价、需补 UI、需补 Repository、需补生命周期、M5/M6 后续或不适用。
- 先增加可失败的 Node/组件/SQL instrumentation 测试，再编码。

C1 PASS：A–G 所有真实产品操作有目标入口与可运行验收，无未知候选入口。

### C2｜深层来源/事件图 Repository
- 审计 M3 Memory/Event Repository、SQL catalog、索引、查询、关联展开和事务。
- 补按 ID、scope、keyset、count、批次 continuation 和必要原子命令；同步 contracts.d.ts、领域类型、strict 正负测试。
- 保持 message_id + revision、事件预览确认、Effects 归属、read/remember/share 权限。
- 增加 SQL trace、行数、暂存对象、正文读取计数、owner 取消后查询计数。
- 对多事件 Effects 交错、基线重放、revision 冲突、归档/缺失来源、循环关系进行真实 SQLite 测试。

C2 PASS：1k/10k 增长下每批有界，continuation 无漏无重，权限前置由 SQL trace 证明。

### C3｜完整候选管理 UI
依次补齐：世界/群聊、角色卡片库、世界书、记忆/来源、事件账本、自治/contact/social/全局生活角色绑定、候选历史整理。

- 复用 M2/M3 Repository、Runtime 和组合根；缺命令先定义事务与 CAS。
- UI 不直接 import Driver、不拼 SQL。
- 不以摘要卡片、只读列表或 mock 按钮冒充完整交互。
- 每个操作有 loading/success/conflict/permission/error 状态。
- 批量/破坏性操作保留预览确认，确认集合与事务实际集合一致。
- legacy 完整入口保留；不将候选激活为生产入口。

C3 PASS：所有确属 M4 的产品操作都有候选端到端等价流程；M5/M6 操作明确留在后续阶段。

### C4｜生命周期、权限和跨模块消费者
- 覆盖新增页面、弹窗、详情、预览和选择器的 owner 与清理。
- 测试世界切换、角色解绑、会话切换、锁屏、后台、恢复门禁、卸载、连续打开关闭、撤权和 provider 忽略 AbortSignal。
- read/remember/share 先查 scope、来源、grant 再读正文；撤权清除正文和引用。
- 延迟任务、contact/social、life companion、事件和自治水位保持 lease、幂等和事务回执。
- 全局生活角色绑定区分全局 owner 与世界 owner。
- 预览快照绑定 revision；确认时 CAS 失败要求刷新，不沿用旧确认。

C4 PASS：所有新增入口通过生命周期/权限矩阵，迟到结果不污染新 scope，释放后无明文残留或后台操作。

### C5｜完整回归与增长验证
- 执行新增定向、strict 正负类型测试和完整 npm run check。
- 复测 M4 已通过聊天、历史、流式、修订/删除、重试、群聊、character、延迟和自治水位。
- 对新增管理流程做 Vue/Runtime 行为测试。
- 1k/10k 深层关系增长测试，记录查询数、最大返回行、暂存节点/边、响应式保留对象、正文读取数和取消后的查询数。
- 注入读失败、CAS 冲突、事务/COMMIT 失败、强停重开、重复提交、错误来源；确认无半提交、重复 Effects 或错误水位。
- Windows/WHPX API 34 合成 AVD 实跑 JS→Native→SQLCipher；记录 APK、设备、SQLCipher、SQL catalog、数据集 SHA、logcat 和退出码。
- 普通 Android Debug 再核验激活位 false、正式包不含合成入口/种子。
- Android 未运行则 BLOCKED/NOT RUN，不得用 Gradle 成功代替。

C5 PASS：最终代码树的完整测试可复现，增长数据证明有界。

### C6｜两轮全范围独立自检
第一轮：访问、安全、权限、事务、内存。重新搜索 snapshot/update/clone/stringify/readAll/filter/sort/Promise.all/无界 Map/Set；构造跨世界 cursor、深链/宽扇出、循环来源、孤儿 revision、无授权正文、撤权后缓存、后台重入、owner 失效、COMMIT 失败、重复 Effects、任务中途锁屏等反例。修复后重跑 SQL trace 和设备用例。

第二轮：产品语义、UI 等价、兼容、证据。对照 raw 和 legacy 流程，验证卡片发布、世界复制/归档、群聊成员、世界书优先级、记忆冲突/来源、事件预览撤销、contact/social、生活角色绑定、历史整理。检查旧 Web/legacy 未破坏，M5/M6 未提前实施，测试源码 SHA 与最终提交 SHA 对齐。

C6 PASS：两轮覆盖完整 M4，而非仅覆盖之前的聊天切片；每轮有反例、失败、修复和最终复测记录。

### C7｜最终验收、证据与提交
保留 M4 acceptance v1 作为历史 BLOCKED 记录，不覆盖、不改写。

新增：
- docs/20261109-kanata-sqlite-m4-completion-preflight-v1.md
- docs/20261109-kanata-sqlite-m4-completion-design-v1.md（设计变化时；无变化则记录差异）
- docs/20261109-kanata-sqlite-m4-acceptance-v2.md
- docs/qa/kanata-sqlite-m4/completion/README.md
- docs/qa/kanata-sqlite-m4/completion/reviews.md
- docs/qa/kanata-sqlite-m4/completion/evidence/（原始命令、SQL trace、设备日志、数据/源码指纹、机器汇总）

同步更新 README.md、docs/plan.md、M0–M7 总计划和 memory-bank/development-context.md。只描述本轮真实状态。仅在 M 普通提交/推送，核对本地/远端 HEAD；禁止强推、合并 Kanata/main、发布 APK 或删除真实资料。

## 7. 最终验收矩阵

| 门禁 | 本次目标 | 最低 PASS 证据 |
| --- | --- | --- |
| G1 调用覆盖 | 关闭 | 所有真实管理操作有调用链和明确归属；无未分类候选入口、隐藏全图回读 |
| G2 状态有界 | 关闭 | 所有管理 Store/ViewModel 的列表、详情、草稿、关系遍历有预算和运行时观测 |
| G3 Repository | 关闭 | SQL scope、keyset/ID/count/事务/CAS/批次 continuation 实测 |
| G4 普通聊天无全图 | 复核 | 最终候选管理与聊天路径均无完整 KanataData clone/serialize/readAll |
| G5 领域正确 | 关闭 | A–G 所有 M4 业务流程端到端验证，Effects/来源/版本/自治语义正确 |
| G6 权限与租约 | 关闭 | read/remember/share 前置；撤权、锁屏、后台、解绑、卸载、迟到结果通过 |
| G7 错误与故障 | 复核 | 加密/版本/权限/事务/COMMIT/强停/重开 fail closed |
| G8 UI/AI | 复核 | 私聊/群聊/character/quote/锚点/气泡/延迟/取消和新增管理 UI 实跑 |
| G9 全项目 | 复核 | 定向、npm run check、strict 正负类型、真实 Android SQLCipher JS E2E |
| G10 兼容与边界 | 复核 | legacy 保留、普通 Android 激活 false、001–004 checksum 不变、M5/M6/M7 未提前实施 |
| G11 证据审计 | 关闭 | 两轮全范围自检、原始失败/复测、设备/数据/源码 SHA 对齐 |

**最终判定：**
- PASS：G1–G11 全部在最终代码树有可复现证据；仅代表隔离候选 M4 PASS，才可建议进入 M5。
- BLOCKED：仍有 M4 功能、增长、生命周期或设备测试未完成；M5 继续 NO。
- FAIL：权限绕过、真实数据误操作、全图回读、数据丢失、Effects 串改、事务半提交、锁定后明文泄漏或生产误激活。

## 8. 严格禁止事项

1. 不导入、转换、删除真实 legacy JSON、kanata-v1.enc、bak/tmp 或旧加密归档。
2. 不迁移真实用户数据，不切 production canonical，不启用普通 Android SQLite 激活位。
3. 不实施 M6 生产便携备份 V3、完整恢复、全局主密码改密或 DEK 重包装。
4. 不实施 M7/P7 最终容量门槛、P50/P95/RSS 最终验收或修改原 P7 标准。
5. 不修改已应用 001–004 migration DDL/checksum；若确有结构缺口，先证明访问层无法解决并提出向前兼容方案，单独审批。
6. 不删除 legacy 功能、旧 Web 协议、旧备份兼容入口或恢复协调器。
7. 不调用真实模型 API；只用合成 provider，API 请求计数必须为 0。
8. 不修改 Kanata/main、不合并、不强推、不发布。

## 9. Agent 执行规则与最终报告

- 先接管和复核，再实施；不要重新生成另一套 M4 计划取代本文。
- 每完成 C1–C5 的模块即运行定向测试；保留已通过切片。
- 任何关键项未运行，整体不得 PASS。
- 产品语义冲突时引用 raw/源码提出最小问题；不受阻工作继续。
- 本任务由用户交给本地 Codex 执行；按本次授权完成本地实现、合成测试、M 分支普通提交与推送，不触碰主工作树未提交内容。

最终回复必须包含：
- M4 PASS / BLOCKED / FAIL；接管基线、最终 HEAD、远端 HEAD。
- C0–C7 状态；A–G 业务交互实现与端到端证据。
- 深层 provenance/event graph 查询策略、增长数据、最大暂存量。
- G1–G11 逐项结论。
- 每类 Store/Pinia 数据真实保留上界。
- 权限、owner、lease、撤权、锁屏、后台、卸载、迟到结果证据。
- Node/Vue/strict/npm run check/Android SQLCipher 命令和退出码。
- 源码、SQL catalog、APK、设备、数据集 SHA。
- 两轮自检反例、修复和复测。
- 生产 canonical、普通 Android 激活位、真实用户数据是否保持未触碰。
- 文件清单、提交 SHA、GitHub 报告/QA 链接。
- 是否可进入 M5：YES / NO 及理由。

**最终提醒：** 这是 M4 缺口关闭，不是重启 M4，也不是提前做 M5。完整管理流程和深层溯源必须成为真正有界、可授权、可复核的候选业务路径。
