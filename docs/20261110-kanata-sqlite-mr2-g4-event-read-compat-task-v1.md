# Kanata SQLite MR2-G4 · 事件读取与旧兼容边界有界化任务书 v1

**制定日期：** 2026-11-10（北京时间）  
**仓库 / 分支：** Zhoubin601/ForMyself / M（仅 M）  
**接管时远端 HEAD：** fd9f23dd39d4f8a0ab42a94f3e3a4e46de98f6e6  
**本轮事件实现提交：** fbc8ee344d6e61aef85bf6296ac5cbd4148d2eeb  
**当前状态：** 候选事件写入定向切片 PASS；G4 / MR2 / M4 BLOCKED；M5 NO  
**任务性质：** M4-R 总任务书下 MR2-G4 的下一事件切片；不替代总合同，不代表 G4/MR2/M4 已通过。

> 启动必须重新 fetch M。若远端 HEAD 已前进，先审查新增提交、工作区和 worktree，再从最新 HEAD 接续。禁止回退到本文件记录的 HEAD。总验收仍以 [M4-R 最终收尾任务书 v1](20261110-kanata-sqlite-m4-r-closeout-task-v1.md) 为准。

## 1. 本轮目标

上一轮已完成候选事件提议、提交和普通修正的来源有界写入，并取得 Android API 34 / SQLCipher 4.17.0 的 1k、10k 定向证据。

本轮不重复实现写入切片。唯一目标是处理事件读取侧及旧兼容 API 中仍然存在的完整对象物化：

1. 事件详情与列表：readFor、list、eventFromRow、loadEvent。
2. Effect 与审计读取：effects、audits 及兼容审计快照。
3. 旧命令回读：propose、commit、correct 等返回完整 Event 的兼容路径。
4. 旧撤销预览：preview/revoke/correct 中完整 descendants Set、uncertainIds、revokeIds 和 JSON ID 集合。
5. 事件关系反向读取：relationship() 中完整 sourceEventIds 的实际调用面。
6. 兼容读取与导出：在不丢字段、不改变顺序、不扩大授权的前提下，迁移到显式分页/流式读取。

本轮目标是让普通页面、Runtime、Store 和兼容调用不再默认跨桥传递随关系总量增长的完整 Event / Effect / Audit 对象图。

## 2. 已核实的当前源码事实

以下事实来自远端 M 的事件实现提交 fbc8ee344d6e61aef85bf6296ac5cbd4148d2eeb，以及验收 v2、G4 调用图和事件接管审计。执行时必须在最新 HEAD 重新确认。

### 2.1 已通过、不得重复施工的候选路径

- KanataCandidateEventLedger 使用受保护的 World Runtime。
- 提议使用 proposeAcknowledged，页面收到事件 ID。
- 提交使用 commitAcknowledged，页面不接收完整提交回读 DTO。
- 候选详情使用 managedEvent，只读取单条事件摘要。
- 因果图使用 graphPage，cursor 绑定 world、event、root revision、direction、after。
- 撤销/修正使用 openRevocation、confirmRevocation、correctConfirmed；冻结计划只保存计数、签名和根 revision，预览逐页读取，执行按最多 128 行批次处理。
- 撤销审计使用 revocationAudits；逐项 Effect 审计使用 revocationEffectAudit 分页。
- 普通修正逐页重验原顺序来源，在 SQLite 内复制规范化关系；撤销、审计、Effect 重放、替代事件和持久回执共用事务。
- 消息修订导致事件失效时，普通事件快照在 SQLite 内生成。
- 上述写入定向切片在 1k/10k AVD 通过。本轮若不影响这些路径，不得重做或改变其已验证语义。

### 2.2 当前仍存在的完整对象物化

1. kanataMessageDependents.js 的 eventFromRow：
   - gather 分别把 participants、causes、sources、lifeSources 收集为完整数组。
   - originalOrder 依赖完整数组、Set 和全量顺序提示比较。
   - eventFromRow 返回完整 Event DTO。
   - 逐页读取不等于有界：分页结果最终仍被 gather 汇总。

2. kanataEventRepository.js：
   - eventProvenance 将 visitEventProvenance 全量收集为 sources 数组，再 uniqueLifeSources。
   - authorizeEvent 同样收集完整授权标签。
   - readFor 先物化完整 lifeSources，再 loadEvent 并返回完整 Event。
   - list 外层虽然 50 + 1，但每条记录仍调用 eventFromRow，可能形成 50 个完整嵌套 Event。
   - effects 使用 visitRows 后仍将所有 Effect push 到 result 数组。
   - audits 外层分页后，仍把 previous_json / next_json 解析为完整 Event。
   - 旧 propose、commit、correct 会通过 loadEvent 返回完整 Event。
   - 旧 preview 仍创建完整 affected Set、uncertainIds 数组和 revokeIds；旧 revoke 将完整 ID 集合 JSON.stringify 后交给 SQL，并传给 Effect 重放。
   - relationship() 读取全部 relationship_events 并返回完整 sourceEventIds。
   - commitLegacyStringAction 仍依赖历史字符串 action 的 JavaScript 对象展开语义。

3. kanataEventSnapshot.js：
   - 已支持在 SQLite 内构造普通事件审计快照并验证规范化关系与历史顺序提示。
   - eventAuditSupport 对 action 为历史字符串的记录返回 unsupported，保留旧 JS 兼容回退。
   - 审计 previous_json / next_json 即使已在 SQLite 内生成，也不能在普通读取时一次性跨桥解析成完整对象图。

4. kanataEventRevocation.js：
   - 新候选路径已用 compact plan、selectionBatch、签名和游标完成分页确认；应优先复用。
   - 不得为迁就旧接口重新引入全量 ID Set、JSON ID 数组或全量 Effect 数组。

### 2.3 本轮权威证据

- [MR2-G4 验收 v2](20261110-kanata-sqlite-mr2-g4-acceptance-v2.md)
- [G4 调用图](qa/kanata-sqlite-m4/m4-r/g4-call-map.md)
- [事件接管审计](qa/kanata-sqlite-m4/m4-r/event-provenance-audit.md)
- [增长与验证矩阵](qa/kanata-sqlite-m4/m4-r/matrix.md)
- [两轮复核](qa/kanata-sqlite-m4/m4-r/reviews.md)
- [事件原始运行证据](qa/kanata-sqlite-m4/m4-r/event-provenance-run/)

## 3. 第一阶段：调用面与兼容契约审计

编码前必须在最新 M 工作树中使用 ripgrep/AST/类型引用追踪实际消费者，不能仅凭 Repository 暴露了某个方法就推断其调用频率，也不能仅凭候选 UI 已切换新 API 就认定旧 API 无人使用。

至少审计：

- events.readFor / list / effects / audits / propose / commit / correct / preview / revoke / relationship。
- eventFromRow / loadEvent / eventProvenance / authorizeEvent / transition / commitLegacyStringAction。
- World Runtime、Domain types、contracts、Store、ViewModel、候选 UI、legacy Experience、备份/恢复/导出、测试夹具和兼容适配器。
- 旧接口的每个字段、数组顺序、未知扩展、错误码、权限和幂等回执的真实消费者。
- 旧 preview/revoke/correct 与 createEventRevocation 的并存调用者、冻结集合和 uncertain 语义。
- event_audits 的 previous_json / next_json 结构、历史 action 形状、旧 JSON 扩展与损坏数据行为。
- relationship.sourceEventIds 是否在其他页面或导出中被完整读取。

必须先交付一张调用矩阵：

| API | 真实调用者 | 当前 DTO | 完整物化点 | 可迁移目标 | 保留兼容方式 |
|---|---|---|---|---|---|

如果某旧 API 没有生产/候选调用者，仍需确认是否被备份、恢复、导出或外部模块依赖；不能直接删除。任何 API 契约调整必须先有消费者迁移和类型检查。

## 4. 实施要求

### 4.1 事件详情与列表投影

- 将普通列表改为最多 50 条事件摘要，不得把每条事件的四类完整关系嵌套在列表结果中。
- 单条详情先读取一个事件 header；participants、causes、sourceRefs、lifeSources 使用独立分页接口。
- 关系页默认最多 50 条，lookahead 最多 51 行。
- cursor 必须绑定 worldId、eventId、eventRevision、relationKind、afterKey；owner、revision、scope 变化后旧 cursor 必须拒绝。
- readFor 必须先完成角色、世界、事件成员、来源 grant、revision 和撤权校验，再读取正文/详情。授权证明不得通过把完整 lifeSources 传到 JS 完成。
- 复用 SQL EXISTS/JOIN、现有 provenance visitor 和 SQLite JSON1。不能把逐页结果重新 gather 为完整数组。
- 保留历史 extensions_json 顺序提示：参与者、causes、sourceRefs、lifeSources 的原顺序、重复、缺失、多余、未知字段和损坏提示必须与旧 oracle 等价。
- 规范化关系表与顺序提示的完整性验证应在 SQLite 内完成；分页只负责投影，不得绕过完整性检查。
- 未知扩展字段不得静默丢弃。若单个未知扩展字段本身很大，需设计有界读取/分块传输；不得把整个 extensions_json 作为普通列表字段跨桥传输。
- eventFromRow 可以保留为显式 legacy materializer，但普通 list/readFor/页面路径不得调用它。所有调用点必须可枚举、可解释并有专门门禁。

### 4.2 Effects 与审计

- effects 不得再把所有行累积为单一 Effect[]；提供最多 50 条的分页投影，保留 Effect 的 owner、eventId、target、path、operation、value、ruleVersion 和稳定顺序。
- audits 普通列表只返回 audit header：id、at、previousRevision、nextRevision、status、effectCount 等页面真实需要字段。
- previous_json / next_json 的详情必须支持按字段/关系分页读取；禁止一次性 JSON.parse 完整快照后跨桥传输。
- 对未知 JSON 扩展、历史数组顺序、null/缺失字段、特殊 action 和损坏 JSON，必须先建立 legacy oracle。
- 复用现有 revocationAudits / revocationEffectAudit 的有界模式，但不能把普通事件审计和撤销专用审计混为同一种语义。
- 若旧调用者确实需要完整审计导出，提供显式逐页导出接口；不得让页面、Store 或普通 API 默认收集所有快照。
- 每页和 cursor 必须绑定 world、event、audit、snapshot side、relation kind、revision 和 afterKey；不能跨事件或跨审计复用。

### 4.3 旧命令回读与兼容 API

- 对旧 propose / commit / correct 返回完整 Event 的调用面逐一审计。
- 优先迁移内部页面和 Runtime 到 acknowledgement ID、单条摘要或显式详情分页。
- 如果必须保留旧完整 DTO 契约，设计明确命名的 legacy export/compatibility adapter，并让其逐页消费关系；不得在 Repository 内先组装完整 Event 再返回。
- 不能只改 TypeScript 类型而不改运行时调用。
- 不得静默删除字段、改顺序、将错误状态改成空数组，或把 NOT FOUND / STALE / DENIED 合并。
- 保留 owner、world、actor、grant、module、revision、CAS、事务和幂等回执。
- 对直接命令输入 DTO 和收据指纹的完整性另做边界分析：不能以只返回 ID 为由擅自改变命令指纹、去重和重放语义。

### 4.4 旧撤销预览与确认集合

- 优先复用 createEventRevocation 的 compact plan：rootRevision、revokeCount、uncertainCount、signature。
- 旧 preview 不得再构建全量 descendants Set、uncertainIds 或 revokeIds。
- 旧 preview 页面改为最多 50 条，并沿用新接口的冻结签名与 cursor stale 检查。
- revoke/correct 必须直接按 SQL selectionBatch 执行，单批最多 128 行；禁止先把所有 ID JSON.stringify 后跨桥。
- stale memories 与 Effect 重放按已冻结签名、审计归属和 SQL 选择集完成，不再依赖完整 ids 数组。
- 用户明确确认的撤销集合与推断 uncertain 集合必须分离；不允许自动扩大确认范围。
- 必须用旧实现 oracle 对照旧计划中的每个 event ID、revision、disposition、Effect count、uncertain 决策和最终领域状态。
- 如果旧 API 的消费者依赖 revokeIds / uncertainIds 全量数组，先迁移消费者；不能静默缩短数组或只返回前 50 条。

### 4.5 历史字符串 action：保护而非擅自改写

- 当前 commitLegacyStringAction 是为保留历史 action 字符串的 JavaScript object-spread UTF-16 行为而存在。
- 本轮不得直接删除该回退、把字符串强制转成普通对象、改用 Unicode code point 展开，或改变历史审计 JSON。
- 建立独立 oracle，至少覆盖空字符串、ASCII、BMP 非 ASCII、代理对、孤立 surrogate、混合字符串，以及缺失/null/数组/对象 action。
- 若本轮对 eventFromRow、transition、审计快照或 loadEvent 做改动，必须回归历史 action 语义。
- 除非证明 UTF-16 展开、属性顺序和 JSON 输出逐项等价，否则保留该兼容回退并在验收中明确标记为未关闭 G4 缺口；不能将其描述为已完成有界化。

## 5. 状态预算与证据要求

沿用 M4-R 总任务书，不得放宽：

| 数据 | 上限 |
|---|---:|
| SQL 业务数据页 | 50（lookahead 后桥接最多 51） |
| Event 列表页 | 50 |
| 单条 Event header | 1 |
| Event 关系子页 | 50 |
| Effect 页面 | 50 |
| Audit header 页面 | 50 |
| 撤销/修正事务批次 | 128 |
| 活动消息窗口 | 100 |
| 页面关闭/撤权后新增查询 | 0 |
| 撤权后正文读取 | 0 |

### 5.1 主机与 Android 样本

- 主机 SQLite 与 Android API 34 / SQLCipher 4.17.0 均覆盖 1k / 10k。
- 组合覆盖深链、宽扇出、混合关系、多参与角色、不同 grant 标签、重复 identity key、历史顺序提示和未知扩展。
- 事件读取、列表、详情、Effects、审计、撤销预览和旧兼容命令都要覆盖。
- 单独覆盖 cursor 过期、owner 切换、revision 变化、取消、查询失败、COMMIT 失败、CAS 冲突和幂等重放。
- 对照旧实现/legacy oracle 的完整字段、顺序、错误码、授权和最终状态。

### 5.2 内存峰值与对象图

每档分别采集，不得只用启动/结束两个点代替峰值：

- Android 候选进程 RSS/PSS 的阶段采样峰值。
- WebView CDP heap snapshot 或可重复的等价峰值证据。
- 事件 header、关系 DTO、Effect、Audit snapshot 的同时驻留数量。
- JS 完整 Event DTO 数、完整关系数组数、完整 Effect 数组数、完整审计快照数。
- Pinia/Store 中事件对象、来源、Effect、审计对象数量。
- 页面打开、翻页、切世界、锁屏、关闭、撤权后的对象释放和查询计数。

performance.memory / heapUsed 单次采样不能单独证明有界性。若当前 AVD 无法提供某项峰值证据，记录 NOT RUN/BLOCKED，不得伪造估算值。

### 5.3 专用事件生命周期矩阵

独立于普通聊天综合回归，至少覆盖：

- 事件详情页锁屏、解锁恢复。
- 角色解绑、grant 撤权、world 切换。
- 页面卸载/关闭时正在执行的详情、关系、Effects、Audit 分页。
- SQL 查询失败、取消和超时。
- provider 忽略 AbortSignal 的迟到结果（如事件路径有 provider）。
- owner/session/revision 变化后旧请求不发布、不写入。
- 关闭/撤权后新增查询为 0，撤权后正文读取为 0，正文、来源和审计对象释放。

## 6. 禁止事项

- 不修改 Schema 001–004，不新增 migration 005。
- 不修改索引定义或 checksum。
- 不切换生产 canonical，不启用普通 APK SQLite。
- 不触碰真实 legacy 数据、真实用户备份或加密归档。
- 不调用真实模型 API。
- 不重做本轮已通过的候选写入切片，除非本轮改动影响它。
- 不开始 MR3、M5、M6、M7 或 P7。
- 不通过截断关系、降低确认集合、减少 Effect、缩小样本或放宽 timeout 制造 PASS。
- 不 force push、reset --hard、git clean、擅自 stash、覆盖用户文件或删除失败证据。
- 任何需要改变原始产品语义的字段或导出决策，先列为待确认，不得自行发明。

## 7. 执行顺序与停止条件

1. fetch 最新 M；检查 main、M、Kanata worktree、git status 和未跟踪文件；保护原工作区。
2. 阅读 AGENTS、raw、M4-R 总合同、验收 v2、事件调用图、接管审计和历史 legacy oracle。
3. 完成真实调用矩阵和旧 DTO 契约审计；先提交 QA 审计结果，再开始结构改动。
4. 优先完成 Event header / relation page，再完成 effects/audits page，再迁移旧 command readback，最后统一旧 preview/revoke/correct。
5. 每个切片先跑主机定向和 oracle，再跑 Android 1k/10k；保留首轮失败和复测。
6. 完成专用事件生命周期与每档峰值证据。
7. 运行 npm run check、严格类型正负测试、生产构建和 Android 综合回归。
8. 更新 g4-call-map、event-provenance-audit、matrix、reviews、QA README 和 MR2-G4 验收报告。
9. 普通提交推送 M，重新 fetch，核对本地/远端 HEAD 一致。

若 legacy 语义无法确认、需要 migration、出现真实数据接触、设备白名单不满足、发现未审查的远端提交或工作区状态异常，停止相关改动并报告。

## 8. 本切片验收与阶段判定

本切片 PASS 必须同时满足：

- 所有实际 Event read/list/effects/audits/legacy preview/command readback 调用者均已审计。
- 普通列表、详情、Runtime、Store 和兼容读取不再默认物化完整 Event / Effect / Audit 对象图。
- 旧字段、顺序、未知扩展、历史 JSON、权限、错误码、CAS、事务、审计、Effect 和幂等语义逐项等价。
- 撤销确认集合冻结且可分页，执行不跨桥传输完整 ID 集合。
- 1k/10k 主机与 Android 证据齐全；深链、宽扇出、混合关系组合真实运行。
- 每档内存峰值和事件生命周期矩阵有真实证据；缺项明确 BLOCKED。
- 最终代码树 check、类型检查、构建和设备回归通过；源码/设备/catalog/dataset 指纹一致。
- 两轮独立复核完成，失败证据保留且复测结论可追溯。

即使本切片 PASS，也不代表 G4 或 MR2 PASS。普通消息兼容 DTO、自治 loadTask、旧 JSON 全量导出、历史字符串 action 等其他缺口必须继续单独验收。M4 保持 BLOCKED，SQLite 阶段 M5 继续 NO。

## 9. 交付物

- 本切片代码与定向测试。
- Event API 调用矩阵和迁移后的兼容契约。
- Event header、关系、Effect、Audit 和撤销预览分页调用图。
- 1k/10k 主机与 Android 原始日志、峰值内存及对象图证据。
- 历史 action / JSON / 顺序 oracle 对照。
- 专用事件生命周期矩阵和两轮独立复核。
- 更新后的 G4 调用图、矩阵、reviews、QA README、MR2-G4 验收报告。
- 普通提交推送 M，记录最终 HEAD。
