# Kanata SQLite MR2-G4 · 事件来源有界化任务书 v1

**制定日期：** 2026-11-10（北京时间）  
**仓库 / 分支：** Zhoubin601/ForMyself / M  
**接管基线：** 271936dd4aa5a5421b0a71a8dda2b4848c15ea71  
**状态：** MR2 BLOCKED；G4 BLOCKED；M4 BLOCKED；M5 NO  
**任务性质：** M4-R 总任务书下的 MR2-G4 单一事件来源切片；本文件是子任务约束，不替代 M4-R 总任务书。

> 启动时必须重新 fetch M。若远端 HEAD 已前进，先核对新增提交和工作区状态，再以最新 M 接续；不得回退到本文件记录的基线。当前 M4-R 总合同仍以 [最终收尾任务书 v1](20261110-kanata-sqlite-m4-r-closeout-task-v1.md) 为准。

## 1. 本轮目标与边界

本轮只推进 **MR2 的事件来源（event provenance）有界化**，目标是消除事件创建、提交、读取、列表、预览、撤销、修正和审计路径中随关系总量线性增长的 JavaScript 完整对象图，同时保持 legacy 事件语义、权限、顺序、事务和幂等结果不变。

本轮不做：
- 不开始 MR3、MR4、MR5、MR6、MR7 或 MR8；不把 M4-R 内部工作包 MR5 与 SQLite 阶段 M5 混淆。
- 不重做已通过的普通聊天标签、MR1 宽事件确认或 GROUP-01～05；若本轮影响共享代码，才做最小回归。
- 不改 Schema 001–004、索引定义或 checksum；不新增 migration 005。
- 不切换生产 canonical，不启用普通 APK SQLite，不触碰真实用户数据、真实 legacy JSON、真实备份或加密归档。
- 不调用真实模型 API；仅使用 synthetic provider。
- 不以截断、减少来源、丢弃 Effect、降低确认集合或放宽 timeout 制造 PASS。

权威依据按 M4-R 总任务书第 1 节顺序执行：用户最新决策、当前 M 源码/测试/日志、M4 acceptance v4 与 QA、raw 原始产品资料、迁移总计划和架构规范。raw/ 只读。原始资料没有定义的产品行为不得自行发明。

## 2. 已核对的源码事实

以下是从本任务基线 M 读取到的现状，执行时仍须在最新 HEAD 重新确认：

1. src/features/chat/storage/sqlite/kanataEventRepository.js
   - eventProvenance 会遍历 visitEventProvenance 后把所有授权来源 push 到 sources 数组，再调用 uniqueLifeSources。
   - authorizeEvent 同样将 visitAuthorizedEventSources 的所有结果聚合到数组。
   - insertEvent 将输入 lifeSources、sourceRefs 对应的消息授权和 causedByEventIds 对应的因果事件来源汇总为一个完整 sources 数组，再授权参与者和写入事件。
   - commitEvent 调用 eventProvenance，构造包含完整 lifeSources 的 next 事件对象，并将 previous/next 传入 transition。
   - loadEvent 调用 eventFromRow；propose、commit、correct 等入口会再次 loadEvent 并返回完整事件 DTO。
   - list 虽然事件行分页，但每条事件都通过 eventFromRow 展开其参与者、因果、消息来源和生活授权。
   - readFor 在授权后仍返回展开后的完整事件 DTO。
   - effects 会把分页查询结果再次累积成完整数组；audits 虽然外层分页，但 previous_json / next_json 可能包含完整事件关系。
   - 旧 preview/revoke/correct 路径还需审查其完整集合、Set、逐事件 loadEvent 和审计快照行为。不得因仓库另有 createEventRevocation 提供的 openRevocation / confirmRevocation / correctConfirmed API，就假设旧入口无人使用。

2. src/features/chat/storage/sqlite/kanataMessageDependents.js
   - eventFromRow 使用 gather 分别收集 participants、causes、sources、lifeSources。
   - originalOrder 会用完整数组与 extensions 中的顺序提示进行逐项等价验证，再返回完整数组。
   - transition / reviseMessageDependents 等调用链可能通过 eventFromRow 和 JSON.stringify 继续扩大对象图。

3. src/features/chat/storage/sqlite/kanataProvenance.js
   - visitSourceGrants、visitEventProvenance、visitAuthorizedEventSources、visitEventPromptGrants 已提供分页/迭代式基础。
   - sourceMetadata 仍会将来源收集到数组；uniqueLifeSources 使用 Map 全量去重；requireLifeSources 当前消费同步 Iterable。
   - 这些 generator 是可复用基础，不等于所有调用链已经有界。

4. 当前 G4 调用图和 MR2 验收记录：
   - docs/qa/kanata-sqlite-m4/m4-r/g4-call-map.md
   - docs/20261110-kanata-sqlite-mr2-g4-acceptance-v1.md
   - docs/qa/kanata-sqlite-m4/m4-r/matrix.md
   - docs/qa/kanata-sqlite-m4/m4-r/reviews.md

## 3. 第一阶段：先完成调用面审计

编码前递归追踪真实调用者，至少覆盖：

- 候选事件页面：创建草案、选择参与者/来源/因果、预览、确认提交、修正、撤销、查看审计、查看 Effects。
- Runtime 到 Repository 的所有调用点，以及 UI/Store 对返回 DTO 字段的实际依赖。
- eventProvenance、authorizeEvent、insertEvent、commitEvent、eventFromRow、loadEvent、readFor、list、preview、revoke、correct、effects、audits。
- createEventRevocation 的分页 API 与旧 preview/revoke/correct API 是否并存、谁在调用、语义是否一致。
- 消息修订导致事件 needsReview 的 reviseMessageDependents 路径。
- 事件 sourceRefs、causedByEventIds、lifeSources 的规范化表、extensions_json 顺序提示、审计 JSON 和 legacy 原始实现。

必须给出一张真实调用图：UI → Runtime → Repository → SQL → 返回投影，并标注每个节点的最大驻留对象数、分页边界和 owner/revision 校验点。

在核对 legacy 与 raw 之前，不得擅自把事件完整 DTO 改成只含摘要，也不得静默省略 sourceRefs、causedByEventIds、participantIds 或 lifeSources。若 UI 需要详情，设计单条详情 + 分页子关系；若旧导出必须返回全量内容，设计显式分页/流式消费，而不是在 JS 中重新聚合全量数组。

## 4. 实施要求

### 4.1 写入与授权来源

- 让事件输入来源、消息 sourceRefs、因果事件来源和已存在事件 lifeSources 的处理不再依赖全量 JS 数组/Map/Set。
- 优先复用 SQL EXISTS / JOIN、现有 keyset visitor、事务内临时工作集或受控小批次；不得先把所有 grant 标签跨桥读入 JS 再过滤。
- 授权必须在读取正文或传播来源前验证 world、owner、actor、grant、module、grant revision、fingerprint、message revision 和事件因果状态。
- 参与者 read/remember/share 语义必须按现有规则逐角色保留；跨世界、失效 revision、撤权和 owner 不匹配必须 fail closed。
- 写入规范化 event_life_sources 时必须保留当前去重语义、稳定顺序及接收者授权。不能把不同 instance/module 的来源错误合并，也不能扩大授权。
- 特别核对 uniqueLifeSources 当前 identity 为 grantId + revision + fingerprint，而 value 还含 instanceId/moduleId；重复键时 Map 的保留顺序与覆盖值行为必须通过旧实现 oracle 精确验证。
- sourceMetadata 的消息来源链必须按页访问；causedByEventIds 的来源图必须有界遍历；不能把每个祖先事件的全部来源先合并到一个大数组。
- 不允许用来源计数、摘要或 bloom filter 替代精确授权证明。

### 4.2 事件行读取与兼容顺序

- 处理 eventFromRow 的四类完整数组：参与者、因果事件、消息来源、生活授权来源。
- 保留 extensions_json 中 participantIds、causedByEventIds、sourceRefs、lifeSources 的旧顺序提示语义。
- 保留 originalOrder 的完整性检查：重复、缺失、多余、未知/损坏提示必须得到与旧行为等价的明确结果；不能因分页而绕过完整性验证。
- 列表页只返回 UI 实际需要的有界摘要；详情通过单条事件投影及各关系分页读取。任何兼容全量导出必须显式调用并逐页消费，不能被普通列表、聊天或 Store 默认触发。
- 不得把一页 50 条事件乘以每条无限关系，变成无界嵌套对象图。
- 审计 previous_json / next_json 必须保留 legacy 字段、顺序和未知扩展。评估在 SQLite 内构建/校验快照或按页导出，避免先在 JS 中构造完整 previous/next Event 后 stringify。
- 任何新投影都必须保留原事件 ID、revision、status、visibility、summary、effectiveAt、recordedAt、causality、kind、replacesEventId 和 action 字段的准确性。

### 4.3 预览、撤销、修正、Effects 与审计

- 追踪旧 preview/revoke/correct 与 createEventRevocation 的真实调用者，选定一个不重复、不绕过权限和审计的主链路。
- 用户确认的撤销/修正集合必须冻结；因果推断的 uncertain 集合必须与明确因果后代分开呈现，不能自动扩大用户确认集合。
- 撤销/修正不能在 JS 中累积全部 event IDs、Effects、baseline 或完整事件 DTO。
- 每条 Effect 的 owner、eventId、target、path、operation、ruleVersion、前后值、revision、审计和幂等键必须独立保留。
- Effects 批次仍最多 128 行；页面展示按当前列表预算分页，不得将所有批次重新累积到 Store。
- audits 的外层 50 行分页不能掩盖 previous_json / next_json 的无界嵌套数据；审计详情和 Effect 快照需有界读取。
- 修正事件必须保留 replacesEventId、原事件撤销审计、替代事件来源与原子事务语义。

### 4.4 Runtime、Store 与页面生命周期

- 详情关闭、页面卸载、切世界、切角色、锁屏、撤权、lease 过期后，旧请求不得向新 owner 发布数据。
- 页面关闭/撤权后新增查询必须为 0；迟到 provider 即使忽略 AbortSignal，也不得继续写入或发布。
- Store 不得缓存全量事件来源、完整因果闭包、完整 Effects 或全部审计快照。
- 页面需要分页时，cursor 必须绑定 world、event、revision、direction 和 after key；owner/revision 变化后旧 cursor 必须拒绝。
- 关闭详情后清除正文、授权标签、来源页、Effects 和审计缓存。

## 5. 兼容语义与状态预算

沿用 M4-R 总任务书，不得自行放大：

| 数据 | 上限 |
|---|---:|
| SQL 业务数据页 | 50（可有一个 lookahead，桥接最多 51 行） |
| 事件摘要列表页 | 50 |
| 单条事件详情 | 1 |
| 事件来源/参与者/因果子关系页 | 50 |
| 单次提示词来源编码 | 1 个引用 |
| Effects 事务批次 | 128 行 |
| 活动消息窗口 | 100 |
| 关闭/撤权后新增查询 | 0 |

必须使用旧实现/legacy oracle 对照以下内容：

- 参与者、因果、sourceRefs、lifeSources 的字段完整性和顺序。
- JSON 扩展字段保留与未知字段行为。
- uniqueLifeSources 的去重键、覆盖值和顺序。
- 多来源消息、多个 cause 祖先、交错 grant 标签、重复标签及不同 owner/revision。
- 事件 create → commit → read → list/detail → preview → revoke/correct → audit/effect replay 的最终领域状态。
- 预算拒绝、来源失效、跨世界、撤权、缺失来源和损坏扩展的错误码及读取顺序。

不得静默截断。超预算请求继续沿用现有拒绝行为或显式分页；不能把 NOT FOUND、STALE、DENIED 和空集合混为一谈。

## 6. 测试与设备证据

### 6.1 主机定向

新增/扩展测试至少覆盖：

- 1k / 10k sourceRefs、cause links、不同 grant 标签和 lifeSources。
- 单事件多祖先、深链、宽扇出、混合来源、重复身份键和跨角色授权。
- create、commit、readFor、list、详情分页、preview、revoke、correct、audits、effects。
- 旧 JSON 顺序提示、未知扩展、损坏提示、缺失/重复链接。
- owner/world/actor/grant/module/revision 不匹配和撤权后禁止正文读取。
- 查询失败、写入失败、真实 COMMIT 失败、CAS 冲突、取消、强停重开和幂等重放。
- 事件修订触发 reviseMessageDependents 时，不能因有界化丢失事件审计或 Effects 重放。

### 6.2 Android API 34 / SQLCipher 4.17.0

必须使用既有隔离合成 AVD、白名单合成包和 synthetic provider；先核对 manifest、设备序列、API、SQLCipher 版本、APK/catalog/source/dataset SHA。不得连接真实数据。

至少覆盖：
- 1k 与 10k 深链、宽来源、混合关系和不同 grant 标签。
- 真实候选 UI 的创建、提交、读取、列表、预览、撤销/修正、审计与 Effects 分页。
- 撤权/解绑、锁屏恢复、切世界/角色、页面关闭和迟到结果。
- SQL 查询失败、CAS 冲突、写入失败、真实 COMMIT 失败、SIGKILL/重开、幂等重放。
- 普通 APK 激活位 false；无合成页面、无合成种子；Schema 001–004 checksum 不变。

沿用现有驱动和 manifest。先读取脚本支持的 Mode；如需新增模式，必须按现有结构添加，不得猜测参数。设备无法运行时如实标记 NOT RUN/BLOCKED，不能用主机测试代替。

### 6.3 有界性与观测

分别记录 SQL 行数/页数、Native 查询耗时、JS→Native 桥接次数与耗时、最大同时驻留来源节点/边/标签、完整 Event DTO 数、Store 对象数、WebView heap、Android RSS/PSS。

必须证明：
- 普通列表与详情页不跨桥传输完整来源数组。
- 单次 SQL 页不超过 51 行，正常数据页不超过 50 行。
- 任何页面/Store 都没有随 10k 关系增长的完整数组、Map、Set 或嵌套 Event 对象图。
- 撤权后正文读取为 0；取消/关闭后新增查询为 0。
- 输出给 UI/旧兼容导出的字段与 legacy oracle 逐项等价。

performance.memory / heapUsed 的单次采样不能单独作为有界性证明。

## 7. 执行顺序与停机条件

1. 核对最新 M HEAD、git status、worktree、AGENTS、raw、M4-R 总任务书和本任务书；保护所有原工作区修改、删除项与未跟踪文件。
2. 完成事件调用图、legacy 语义对照和所有全量物化点清单，先提交审计结果到 QA。
3. 先处理事件写入/提交来源链，再处理 eventFromRow/详情与列表，再处理预览/撤销/修正/审计；每个子切片先有主机测试，再接 Android。
4. 每个改动点做最小定向回归；完成后运行 npm run check、strict 正负类型和构建。
5. Android 完整设备矩阵完成后，更新 G4 调用图、matrix、reviews、QA README 和 MR2 验收报告。
6. 仅普通提交并推送 M；推送后重新 fetch，核对本地/远端 HEAD 一致。保留所有失败日志和原工作区状态。

遇到以下情况立即停止相关结构改动并报告：
- 需要新增 Schema migration 或改变 001–004 checksum。
- legacy/raw 对某个扩展字段的语义无法确定。
- 无法在不丢弃来源的前提下保持旧接口语义。
- 设备、synthetic manifest 或隔离白名单不满足。
- 测试出现真实数据接触、生产激活位变化或跨世界读取。
- 远端 M 在推送前再次前进且差异尚未审查。

禁止 force push、reset --hard、git clean、覆盖用户文件、擅自 stash、删除失败证据、合并 main/Kanata 或发布 APK。

## 8. 本切片验收与阶段判定

本切片 PASS 必须同时满足：
- 所有实际事件来源入口均已审计并有明确有界实现。
- 事件输入、授权、创建、提交、读取、列表、预览、撤销、修正、审计和 Effects 的 UI/Runtime/Repository/SQL 链路闭环。
- 旧字段、顺序提示、未知扩展、权限、revision、CAS、审计、回执和幂等语义不变。
- 1k/10k 主机与 Android 证据齐全；设备故障与生命周期矩阵真实运行。
- 最终代码树全量 check 通过，源码/设备/数据集指纹一致。
- 两轮针对本切片的独立复核完成，所有失败均保留并有复测结果。

即使本切片 PASS，也只代表事件来源切片通过，**不代表 G4、MR2、M4 通过**。消息兼容 DTO、loadTask、旧导出等其他 G4 缺口仍需独立验收。M4 继续 BLOCKED，SQLite 阶段 M5 继续 NO。

## 9. 交付物

- 本切片实现与定向测试。
- 事件真实调用图与未关闭入口清单。
- 1k/10k 主机、Android 原始日志、退出码、计时和内存证据。
- 旧语义 oracle 对照与两轮独立复核。
- 更新后的 g4-call-map.md、matrix.md、reviews.md、QA README 和 MR2 验收报告。
- 普通提交推送 M，记录最终 HEAD。
