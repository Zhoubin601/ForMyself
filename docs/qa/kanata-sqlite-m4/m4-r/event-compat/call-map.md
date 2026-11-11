# ER1-0 全仓调用审计

日期：2026-11-11。审计基线：7b6884965051d0d0da154618d2231b429ab12b11。
先 fetch，origin/M 与用户基线一致；M 从 766e768 普通快进。差异只有 ER1 任务书及 docs/plan.md。
main 保留四项 docs 修改、output APK 删除、.worktrees/、研究文档和 QA 未跟踪目录；Kanata 干净，未切换或改动。

搜索覆盖 src、tests、scripts、docs/qa、android 和文档，原始结果见 inventory.txt。区分 SQL catalog 注册、测试与产品调用，未把领域同名 legacyEvents 局部变量当作 Runtime 消费者。

| API / 函数 | 实际调用者 | 层级 / 当前对象与物化 | 目标 | 产品依赖 |
| --- | --- | --- | --- | --- |
| World Runtime select().legacyEvents 全部五项 | 只有包装定义；未发现读取/解构/转发调用 | application；完整 Event、完整预览数组 | acknowledgement、managedEvent、compact plan | 无；可独立移除包装 |
| events.legacy.propose / commit | tests/kanataSqliteDomains.test.js；candidate-smoke.mjs 强停测试使用 commit | 测试 / Android QA；loadEvent 完整事件 | fixture 用 acknowledged；对照用 test-only Oracle | 无产品消费者，但有真实设备驱动 |
| legacy.list / readFor | Domains 测试；candidate-smoke.mjs:1707 的修正回读 | Event[] / Event+全部 lifeSources | header / relations / chunk；测试 Oracle | 无产品消费者 |
| legacy.effects / audits | Domains 测试；candidate-smoke.mjs:1683–1691 | 循环 gather Effect[]，审计完整 previous/next | 页、header/chunk；测试 Oracle | 无产品消费者 |
| legacy.preview / revoke | Domains 测试；docs/qa/kanata-sqlite-m3/device-scenario.mjs:65 | 完整 revokeIds / uncertainIds，旧全世界签名 | compact plan；须先解决语义差异 | 无产品消费者，设备回归依赖 |
| legacy.correct | Runtime 包装定义，无其他直接调用 | prepareCorrection、revoke 后返回完整 Event | correctConfirmed | 包装可删；内部 correction 仍有产品调用 |
| legacy.relationship | Domains 测试 | gather 全部 sourceEventIds | relationship + relationshipEvents | 无产品消费者 |
| loadEvent → eventFromRow | Repository:297 correction、380 commit、513 legacyStatus、579 list、585 readFor、609 propose、614 commit、635 correct | 完整 extensions、4 类关系和 action spread | 字段级 action + SQL snapshot；测试专用 materializer | correction / commit 回退仍有候选产品调用，暂不可删 |
| eventFromRow 的另一个直接调用 | MessageDependents:164 reviseMessageDependents | unsupported text action 时构造完整 previous/next | 字段级转换、SQL audit | 消息修订生产候选调用，暂不可删 |
| materializeAuditSnapshot | Repository:601–602 legacy.audits only | chunk 拼完整串 + JSON.parse Event | tests/helpers Oracle | 与整个 Facade 的移除一并迁移 |
| eventProvenance 完整 collector | commitLegacyStringAction:412 only | 所有 LifeSource 数组 | visitEventProvenance + SQL proof | 字符串 action 回退仍依赖 |
| authorizeEvent 完整 collector | legacy.readFor:584 only | 所有授权来源数组 | assertEventProvenance | 只旧 Facade |
| visitEventProvenance / assertEventProvenance / visitAuthorizedEventSources | EventRead、EventRepository、MemoryRepository、提示词授权 | visitor，页内处理 | 保留 | 真实产品能力，不可误删 |
| eventAuditSupport | EventRead.assertHints；commitEvent；prepareCorrection；legacyStatus；MessageDependents | -1 损坏，0 历史字符串回退，1 SQL 支持 | action Spike 之后决定 | 全部仍须保留 |
| effectFromRow / rebuildEventEffects / visitRows | EventRead、EventRevocation、MessageDependents、其他仓库 | 单页/逐条 replay | 保留 | 真实产品调用 |
| legacyEventDdl | scripts/build-kanata-sqlite-catalog.mjs:26,60 | 临时计划表固定目录注册 | Facade 移除后再删 | 注册不是消费者 |
| sourceEventIds | Memory DTO/领域数据、Relationship 创建和旧输出 | 混有规范输入、领域 canonical 与旧输出 | 只迁候选事件旧输出 | 不可全仓机械删除 |

候选产品路径：KanataCandidateEventLedger → World Runtime → acknowledged / managedEvent / compact revocation / audit pages；Workspace 因果入口 → graphPage。eventReadFor/eventRelations/eventEffects/eventAudits/eventJsonChunk 为 Runtime/Repository API，未找到实际页面调用，不能虚构对应 UI 页面。

生产 canonical 的 experience/kanataEvents.js、kanataConversation.js 与 legacy 加密仓库不在删除范围。备份/恢复/导出源码未找到候选 events.legacy/legacyEvents 调用；没有据此新增 export sink。

ER1-0 审计结论：包装可独立收口；Repository 完整 Facade 的删除仍受 action 四条真实写入路径、测试及 Android QA 迁移、撤销 Oracle 冲突约束。先保留语义与失败证据，不把按页 gather 称为有界。
