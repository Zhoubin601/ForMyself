# Kanata SQLite M4-R 最终收尾任务书 v1

**制定日期：** 2026-11-10（北京时间）  
**仓库 / 分支：** Zhoubin601/ForMyself / M（仅 M）  
**接管基线：** d1737e7d598a14ec3f3ef1febd0bf8be050edbe2  
**阶段状态：** M4 BLOCKED；M5 NO  
**执行环境：** Windows 本地 Codex、WHPX、Android API 34 合成 AVD、SQLCipher 4.17.0  
**任务性质：** M4 最终缺口收敛与全范围验收；不扩展产品需求，不重做已通过切片，不开始 M5。

> 本文件是 M4-R 当前唯一执行入口。M4 acceptance v4、closeout QA、历史 v3 和此前任务书均保留为证据与背景，不覆盖、不删除。若旧任务书与当前代码或 acceptance v4 冲突，以当前远端 M、用户最新检查点和 acceptance v4 为准。启动时必须重新核对远端 HEAD；若已前进，以新 HEAD 审查差异后接续，禁止回退。

## 0. 本轮目标与非目标

本轮唯一目标：关闭 M4 剩余功能、性能、有界性、权限、生命周期、Android 和证据审计缺口，使 G1–G11 在最终代码树上全部有可复现 PASS 证据。

本轮不是：
- 重启 M4 或重写 M2/M3 Repository。
- 重新实现已通过的 GROUP-01～05。
- 通过增加超时、降低数据量、丢弃引用、缩小用户确认集合来制造 PASS。
- 迁移真实用户数据、切换生产 canonical、开启普通 APK SQLite。
- 开始 M5、M6、M7、P7，或合并回 Kanata/main。

## 1. 权威依据与来源顺序

执行时按以下顺序判断：

1. 用户本轮明确决策与最新检查点。
2. 当前 M 分支源码、测试、SQL catalog、实际运行日志。
3. [M4 收尾验收 v4](20261110-kanata-sqlite-m4-acceptance-v4.md) 和 [M4 closeout QA](qa/kanata-sqlite-m4/closeout/README.md)。
4. 原始产品资料：[完整需求清单](../raw/完整需求清单.txt)、[Kanata 技术设计](../raw/彼方%20%C2%B7%20Kanata%20技术设计.txt)。
5. [M0–M7 SQLite 迁移总计划](20261103-kanata-sqlite-migration-plan-v1.md)、[M4 原始任务书](20261109-kanata-sqlite-m4-task-v1.md)、此前 M4 补齐合同与设计。
6. [AGENTS.md](../AGENTS.md)、[架构接口与 Agent 开发规范](../架构接口与Agent开发说明书.md)、[开发背景](../memory-bank/development-context.md)。

raw/ 只读，不修改、不重命名、不移动。原始资料没有定义的产品行为不得由 Agent 自行发明；先记录待确认项，并继续不依赖该决策的工作。

## 2. 接管事实与已通过资产

### 2.1 Git 与生产边界

- 当前已核实 M HEAD：d1737e7d598a14ec3f3ef1febd0bf8be050edbe2。
- 代码与证据提交：[d1737e7](https://github.com/Zhoubin601/ForMyself/commit/d1737e7d598a14ec3f3ef1febd0bf8be050edbe2)。
- 生产 canonical 仍为 legacy。
- 普通 Android APK 的 SQLite 激活位仍为 false。
- Schema 001–004 DDL 与 checksum 冻结，不得修改。
- 不读取、迁移、覆盖或删除真实 legacy 数据及旧加密归档。
- 本轮仅使用隔离合成 AVD、合成数据和 synthetic provider；真实模型 API 调用必须为 0。

### 2.2 当前门禁

| 门禁 | acceptance v4 状态 | 本轮要求 |
|---|---|---|
| G1 调用覆盖 | BLOCKED | A–G 全部真实入口闭环 |
| G2 状态有界 | BLOCKED | 证明 JS、Store、页面、批处理全链路有界 |
| G3 Repository | BLOCKED | 全部命令的 scope、CAS、分页、事务、幂等与故障证据 |
| G4 普通聊天无全图 | BLOCKED | 扩展到授权标签、事件/消息 provenance、旧兼容导出 |
| G5 领域正确 | BLOCKED | A–G 业务语义完整并通过设备 E2E |
| G6 权限与租约 | BLOCKED | 全页面、解绑、后台、撤权和迟到结果矩阵 |
| G7 错误与故障 | BLOCKED | 所有新增命令及组合故障完整验证 |
| G8 UI/AI | BLOCKED | 候选页面和消费者实际运行；真实模型 API 为 0 |
| G9 全项目 | BLOCKED | 最终代码树全量测试和 Android SQLCipher E2E |
| G10 兼容边界 | PASS | 最终复核仍为 legacy/default false/schema checksum 不变 |
| G11 证据审计 | BLOCKED | 两轮全范围独立复核，命令、日志、指纹可追溯 |

### 2.3 既有测试证据口径

acceptance v4 记录的最终主机 check 为 675 项 Node、397 项 Vue；121 项定向测试是 Node 套件中的子集，不得重复相加。所有最终计数必须从本轮实际原始日志重新提取，不可复制历史数字冒充本轮结果。

### 2.4 不得重复施工的已通过资产

- GROUP-01～05 已在主机 SQLite、Vue 组件和 Android API 34 合成 AVD 上通过：空群原地编辑、历史群另建、原群历史/引用隔离、跨世界角色拒绝、并发首条消息、取消、COMMIT 失败回滚与幂等重试。
- 普通聊天的 readFor → readMemory → sourceRefs[] 完整记忆来源 DTO 路径已移除；1k/10k 分页编码、预算拒绝、取消后 0 新查询、恢复 59 条引用逐条匹配已有设备证据。
- 分享撤回、自定义记忆合并、逐条 Effect 审计、静态世界设置、候选历史整理已接入。
- 主机 1k/10k 宽事件确认已通过中断回滚和幂等恢复，确认数分别为 1,001 和 10,001，最大批次 128 行。
- 旧有 10k 深链、宽来源、混合关系和 Effects 的 Android 单项通过证据继续保留。
- G10 当前 PASS。

除非本轮改动影响这些路径，或复核发现历史证据与当前代码 SHA 不一致，否则不重写这些功能。任何影响都必须做针对性回归。

## 3. P0 阻塞：Android 10k 宽事件确认超时

这是本轮第一优先级，不得绕过。

### 3.1 已知实测事实

| 环境 | 样本 | 结果 |
|---|---:|---|
| 主机 SQLite | 1k | PASS |
| 主机 SQLite | 10k | PASS；确认 1,001 / 10,001；每批最多 128 行；批间中断回滚与重试通过 |
| Android API 34 / SQLCipher 4.17.0 | 1k | PASS；1,001 条确认 6,412 ms；22 次查询、18 次写入；每批最多 128 行 |
| Android API 34 / SQLCipher 4.17.0 | 10k | 420 秒驱动超时，无最终回执，最终设备任务退出码 1 |

10k Android 未取得回执就是 NOT PASS。主机 10k PASS、Android 1k PASS、此前其他 10k 关系样本 PASS，均不能替代本项。

证据：
- [Android 最终运行结果](qa/kanata-sqlite-m4/closeout/device-delivery-result.txt)
- [Android 退出码](qa/kanata-sqlite-m4/closeout/device-delivery-exit.txt)
- [主机宽事件批次结果](qa/kanata-sqlite-m4/closeout/event-batch-host.txt)
- [M4 验收 v4](20261110-kanata-sqlite-m4-acceptance-v4.md)

### 3.2 先定位，再优化

必须把耗时拆开，不允许直接调大 timeout 或盲目调整 batch size。至少采集：

1. 预览、冻结确认集合、准备 continuation 的耗时。
2. 每条 SQL 的次数、参数规模、EXPLAIN QUERY PLAN、执行耗时、返回行数。
3. JS → Capacitor → Native 桥接次数及往返耗时。
4. 每批读取、校验、CAS、Effect 归属核验、写入、COMMIT 的耗时。
5. 审计记录构建和回执生成耗时。
6. 页面刷新、进度回读和 provider 交互耗时。
7. 最大 JS 暂存事件数、Effect 数、Map/Set/数组对象数、Pinia 对象数。
8. AVD 的进程 RSS/PSS；可用时采集 WebView CDP heap snapshot。performance.memory 只能作为粗略辅助，不能单独证明内存峰值。

把 1k 和 10k 使用同一设备、同一 SQLCipher、同一数据生成规则、同一构建指纹对照。明确区分 seed/fixture 准备时间与被测业务操作时间。

检查重复查询、每条 Effect 的 N+1 查询、批次内重复扫描、未命中索引、无界 IN 参数、OFFSET、嵌套循环、重复 JSON 编码和桥接逐行往返。先用查询计划和计时证据确定瓶颈，再实施最小修复。

### 3.3 性能修复约束

- 保留用户预览并确认的完整集合，不能只处理前 N 条。
- 保留每个 Effect 的 owner、revision、事件归属和独立审计。
- 保留冻结集合、CAS、幂等回执、批间恢复和失败回滚语义。
- 每批最多 128 行，除非现有合同明确允许且有证据证明更改不会放大内存；本轮默认不得提高。
- 不修改 Schema 001–004；不得为方便优化而改变 migration checksum。
- 不通过增加 420 秒驱动 timeout、减少样本、减少 Effect 数、跳过审计或把 NOT RUN 标记为 PASS。
- 可以优化 SQL、索引命中方式、临时事务内工作集、批次编排和桥接调用，但不得改变领域结果。
- 若证明必须新增 Schema migration 才能满足性能，停止该结构变更，提交查询计划、对照实验和最小方案，等待用户明确批准；本任务内不擅自新增 005。

### 3.4 MR1 PASS 条件

- Android API 34 / SQLCipher 4.17.0 完整处理 10k 宽事件确认，最终确认数精确为 10,001，并取得持久化回执。
- 在现有驱动 420 秒 deadline 内完成，不增加 timeout。
- 最大批次仍不超过 128 行；每个 Effect 归属、审计和最终状态正确。
- 第 N 批后强停/模拟失败，重开后从安全 continuation 恢复；不丢失、不重复执行。
- 重放相同 command 返回同一回执，不重复产生事件、Effects 或审计副作用。
- 1k 结果不退化，主机 1k/10k 继续通过。
- 原始日志、设备身份、APK、catalog、数据集和源码 SHA 对齐。

否则 MR1 BLOCKED，继续定位；不得进入最终验收。

## 4. P0 阻塞：G4 全链路 provenance 有界化

普通聊天中记忆来源完整 DTO 路径已关闭，但 G4 仍 BLOCKED。剩余风险包括大量不同生活授权标签、事件/消息 provenance 的整链暂存，以及旧事件兼容导出中的关系集合。

### 4.1 调用面审计

从真实入口递归审计并绘制调用图，至少包括：

- 普通私聊、群聊、character、引用回复、延迟回复恢复。
- 记忆 read/remember/share、列表、详情、合并、冲突、来源查看和分享撤回。
- 事件创建、修正、预览、撤销、审计和 Effects 重放。
- 消息/事件 provenance、生活授权标签和最终回复引用。
- 旧兼容记忆/事件导出、历史查询、恢复和任何保留的 DTO 转发入口。

禁止只搜索 sourceRefs 一个字段。审计 clone、snapshot、serialize、readAll、map/filter/sort、Promise.all、全量 Map/Set、关系闭包和兼容导出。

### 4.2 有界行为要求

- 权限和 scope 在读取正文前验证；每条引用必须绑定正确 world、owner、actor、grant、source ID 与 revision。
- SQL 数据页遵守现有预算：每页最多 50 条业务数据；若使用 lookahead sentinel，最多 51 行。不得把全部页累积为一个大数组。
- 提示词编码继续逐条或小工作集处理；当前已验证的单次最多编码 1 个来源引用不得被退化。
- 不能因为宽授权标签而先把全部标签读成 JS 数组/Set，再逐条过滤。
- 使用 SQL join/EXISTS、游标迭代或受控批次，在保留原始语义和稳定顺序的前提下处理授权。
- 对合法的超预算请求，保留原有拒绝行为；不能静默丢弃尾部来源或缩短授权范围来通过。
- 来源缺失、revision 失效、跨世界、撤权和无权限必须有不同结果，不得伪装成空数组。
- 取消、锁屏、切世界、撤权或页面关闭后，停止新查询、清理正文与暂存对象，迟到 provider 结果不得发布或写入新 owner。

### 4.3 增长与观测

对 1k/10k 深链、宽扇出、混合关系和大量不同 grant 标签分别实测。记录：

- SQL 每页行数、页数、查询数和桥接次数。
- 最大同时存活 provenance 节点/边、授权标签、来源 DTO、编码对象。
- 完整来源 DTO 数必须为 0；单次编码引用数不得超过当前合同。
- 活动消息窗口最多 100，消息页最多 50。
- Pinia/Store 对象数、页面关闭后保留数。
- 取消/撤权后新增查询数必须为 0；撤权后正文读取数必须为 0。
- provider 实际收到的 JSON 与旧语义逐条对照，包含归档来源、排序、去重、预算和 message ID + revision。

### 4.4 MR2 PASS 条件

所有聊天、记忆、事件和兼容 provenance 入口都具备明确调用图、分页/流式实现和真实 Android 证据；宽授权标签增长时，任何层都没有随总关系数线性增长的 JS 完整对象图；来源准确性、顺序、提示词 JSON 和预算语义不变。否则 G4 继续 BLOCKED。

## 5. A–G 剩余业务闭环

已通过切片保持不动，只补 acceptance v4 标出的缺口。每项必须有 Legacy → 候选 UI → Runtime → Repository → SQLite 的真实链路，不允许 mock 成功、空按钮或仅 UI 壳。

### A. 世界与群聊

- 完成静态世界复制，但先核对 raw、legacy 和已确认产品语义。复制范围若没有被原始资料或现有 legacy 明确支持，先标为待确认，不擅自定义。
- 不得默认复制消息正文、动态记忆、事件、Effects、任务和权限；只有来源明确支持且用户语义确认后才可复制。
- 保留世界隔离、世界身份、角色实例和会话结构。
- GROUP-01～05 已 PASS，不重做；仅对本轮影响路径回归。
- 世界列表、成员选择、设置、归档/恢复均有界分页和 owner/scope CAS。

### B. 角色卡、版本与世界实例

- 完成卡片 PNG/JSON 原格式导入、未知扩展字段保留、校验、草稿编辑、发布新版本和版本历史。
- 卡片原始 payload、图片和大型资产不得进入全局 Pinia 列表；只允许当前导入/编辑工作区暂存。
- 完成世界角色实例加入与同步：全局卡版本变化不能覆盖世界本地 override；按 revision/CAS 决定可同步字段。
- 完成 Android 原生文件选择器真实往返：选择、取消、系统返回、后台、锁屏、应用恢复、世界切换和 lease 失效。
- 卡片内脚本/扩展内容只保留或展示，不得未经安全审查直接执行。
- 记录原文件 SHA、导入后字段/扩展等价、版本和实例关系。

### C. 世界书

- 完成条目列表、单条详情、创建、编辑、启停、删除和按角色预览。
- 完整保留 owner、world、known_by、可见性、激活条件、优先级、并列顺序和上下文预算。
- 连续分页在并发编辑/删除时不得漏项、重复或跨世界读取。
- 正文仅在权限和来源元数据校验后读取；关闭详情、切世界或撤权后释放。
- 用旧 legacy 排序与激活语义做对照，不以第一页截断替代完整排序。

### D. 记忆、冲突、合并与分享

- 完成跨冲突组批量整理/合并、冲突查看与处理、来源查看、分享对象管理、分享撤回。
- 来源精确绑定 message_id + revision；归档原文按 ID/revision 解析，不能按文本相似度猜来源。
- read/remember/share 独立授权；读取正文前校验 grant、owner、world、actor、source revision。
- 分享副本撤回后，所有后代复制链、缓存、迟到任务和旧角色访问都必须失效。
- 跨页取消、CAS 冲突、孤儿来源、失效 revision、跨世界来源和混合权限关系要有主机及 Android 证据。
- 批量处理保留预览集合和用户确认集合，不静默扩大或缩小。

### E. 世界事件与 Effects

- 补齐所有事件类型的创建、修正、预览、确认、撤销、审计和重放实际页面流程。
- 用户确认的集合冻结；因果图可以展示潜在后续，但不能自动把推断结果并入确认集合。
- 多事件共享同一目标、交错 Effects、不同 owner/revision 必须独立处理。
- 每条 Effect 独立保存归属、前后状态、审计和幂等键。
- 分页、批次、continuation、取消、强停、恢复、COMMIT 失败和重复回执完整验证。
- Android 10k 宽事件确认按第 3 节 MR1 门槛通过。

### F. 自治、contact/social 与生活角色消费者

- 接通真实自治调度与 contact/social 消费者，不允许只保存配置或显示任务摘要。
- 验证自主发展开关关闭时不追补事件；开启后按当前时间和水位继续。
- 世界间严格隔离，角色只使用自己有权知道的信息。
- 全局生活角色绑定必须由真实生活模块消费者使用，选择对象精确到 world + character instance；失效时提示重选，不回退到同名角色。
- read/remember/share 三项权限独立；撤权后停止新读取/传播，已有记忆按用户管理流程处理。
- 后台任务必须有 lease、幂等键、持久回执、失败重试和水位事务；不能假设 Android 关闭时模型仍持续运行。
- 覆盖解绑、归档、锁屏、后台、恢复、跨日/时区和 provider 忽略 AbortSignal。

### G. 历史整理与引用保护

- 完成历史整理预览、用户确认、有界执行、进度和最终回执。
- 保留原始消息与未知扩展字段；不能把未知扩展当作无引用而删除。
- 扫描并验证规范引用与 legacy 非规范化扩展引用；无法证明无引用时 fail closed。
- 预览签名必须覆盖 owner、world、conversation、revision、范围和确认集合。
- 执行过程可取消、可恢复、幂等；写失败不删除原文、不破坏 quote/reply/事件/记忆来源。
- 用归档、软删除、未知扩展、稀疏引用、并发编辑和跨世界样本验证。

## 6. 全页面生命周期、权限与状态预算

逐个页面、详情、草稿、选择器、批量预览、导入工作区和后台消费者建立矩阵，至少覆盖：

- 连续打开/关闭、返回导航、卸载与重新进入。
- 世界/会话/角色切换。
- 锁屏、后台、系统文件选择器挂起、系统返回和恢复。
- read/remember/share 撤权、角色解绑、世界归档。
- owner/revision 变化、lease 过期、恢复门禁阻塞。
- provider 忽略 AbortSignal、请求完成后页面已关闭。
- 批次中途取消、强停、COMMIT 失败、重复命令和恢复。
- 页面旧请求不得写入新 scope；关闭/撤权后清除正文和大对象。

沿用当前 M4 预算，不得无证据放大：

| 数据 | 上限 |
|---|---:|
| 消息页 | 50 |
| 活动会话窗口 | 100 |
| SQL 业务数据页 | 50（允许一个 lookahead，桥接最多 51 行） |
| 单次提示词来源编码 | 1 个引用 |
| Effects 批次 | 128 行 |
| 世界/角色/世界书/记忆/事件/任务摘要列表 | 每页最多 50 |
| 当前详情 | 仅当前单条；关闭/切换/撤权后清空 |
| 当前会话引用摘要 | 1 条 |
| 关闭/撤权后新增查询 | 0 |

需要扩大预算时先提交实际业务证据和峰值测量，不能自行修改合同。

内存证据必须区分 SQL 返回行数、JS 暂存对象数、Pinia 对象数、WebView heap、Android RSS/PSS。performance.memory 或单次 heapUsed 采样不能独立证明整链峰值。

## 7. 执行阶段与门槛

### MR0｜接管与证据盘点

- 读取 AGENTS、架构规范、memory-bank、raw、M0–M7 总计划、acceptance v4、closeout QA、源码与相关测试。
- 检查 git status、当前分支、HEAD、远端 M；保护所有既有修改、删除项和未跟踪文件。
- 建立 A–G × UI × Runtime × Repository × SQL × Store × 权限 × 事务 × 生命周期 × 设备矩阵。
- 核实设备身份 emulator-5582 / kanata_m2_api34 / API 34 / SQLCipher 4.17.0，重新确认隔离白名单和合成数据。
- 对照测试原始日志，明确 675 Node / 397 Vue / 121 定向子集的计数口径。
- 为每项历史 PASS 记录受测源码 SHA，过期证据不得直接沿用。

MR0 PASS：工作区保护、远端基线、设备身份、源码指纹、测试口径和剩余缺口矩阵全部有证据。

### MR1｜Android 10k 宽事件性能定位与修复

按第 3 节先定位再优化。保留 1k 基线，完成 10k 完整设备确认、回执、批间故障恢复和幂等重放。

MR1 PASS：满足第 3.4 节全部条件；否则 BLOCKED。

### MR2｜G4 provenance 全链路收口

按第 4 节覆盖普通聊天、授权标签、事件/消息关系、兼容导出与管理路径，完成 1k/10k 增长、取消、撤权和 JSON 等价设备验证。

MR2 PASS：所有来源路径有界且语义不变，G4 有完整设备证据。

### MR3｜A/B/C 管理闭环

完成世界静态复制（语义有依据时）、角色卡/实例/原生文件选择往返、世界书完整字段管理与连续分页。

MR3 PASS：A/B/C 每个实际操作有 UI→Runtime→Repository→SQL 证据及 Android E2E；未确认语义不得假设 PASS。

### MR4｜D/E/G 管理闭环

完成跨组记忆整理、冲突与分享，所有事件规则及 Effects 重放，历史整理扩展引用保护。

MR4 PASS：D/E/G 预览→确认→事务执行→回执完整，取消/失败/恢复/幂等和增长证据齐全。

### MR5｜F 真实消费者与后台任务

接通 contact/social、自治调度和生活角色绑定消费者，验证三权限、世界实例精确性、后台 lease、水位和重试。

MR5 PASS：没有仅配置未消费的能力；所有真实消费者有候选端到端和 Android 生命周期证据。此处 MR5 是 M4-R 内部工作包编号，不是 SQLite 阶段 M5。

### MR6｜跨页面生命周期、权限与故障矩阵

按第 6 节覆盖所有新增页面和消费者；对照 M2/M3 既有锁屏、错密、恢复、COMMIT、强停证据。改动影响旧路径时重跑。

MR6 PASS：无迟到越权写入、无撤权后正文读取、无关闭后明文残留、无重复事件/Effects/通知或水位推进。

### MR7｜最终全量回归与 Android 验收

- 执行全部定向测试、npm run check、Node、Vue、strict 正负类型和构建。
- 运行 A–G 的真实 UI→JS→Native→SQLCipher→页面回读 E2E。
- 运行 1k/10k 深链、宽扇出、混合关系、不同 grant 标签、Effects 和宽事件确认。
- 注入错密、查询失败、CAS 冲突、部分写失败、真实 COMMIT 失败、强停重开、取消、撤权迟到、恢复门禁阻塞和重复提交。
- 构建普通 Android APK，再次核验 SQLite 激活位 false、无合成页面/种子。
- 记录设备、SQLCipher、APK、catalog、数据集、源码 SHA、命令、退出码和耗时。
- Android 未实跑场景必须写 NOT RUN/BLOCKED；Gradle 构建成功不等于设备验收。

MR7 PASS：最终代码树全量 check 与全部强制设备/增长/故障矩阵通过。

### MR8｜两轮独立全范围审查、文档与推送

第一轮：安全、权限、数据边界和事务反例。
重点审查 clone/snapshot/stringify/readAll、全量数组、Map/Set、旧兼容接口、provenance 闭包、Effects 暂存、跨世界引用、撤权正文读取、lease、后台重入、COMMIT 失败和幂等。

第二轮：产品语义、UI、平台、兼容与证据。
逐项对照 raw/legacy 核对 A–G；检查群聊规则、角色卡扩展、世界书顺序、记忆 revision、事件归属、contact/social、生活绑定、历史引用；检查普通 APK、legacy、SQL catalog、Schema checksum、源码/设备/数据集指纹。

每轮必须记录反例、失败、修复、复测命令和结果。只检查本轮增量不能称为全范围自检。

交付：
- M4-R 最终验收报告 v5。
- docs/qa/kanata-sqlite-m4/m4-r/README.md、matrix.md、reviews.md、原始日志、设备与源码指纹。
- 更新 README.md、docs/plan.md、M0–M7 总计划、memory-bank 和 closeout QA 入口。
- 最终 G1–G11 状态、M5 YES/NO 和未解决风险。
- 普通提交并推送 M；推送后核对本地/远端 HEAD 一致。

MR8 PASS：两轮全范围复核完成，最终证据与最终提交 SHA 对齐。

## 8. G1–G11 最终验收合同

| 门禁 | PASS 必须满足 |
|---|---|
| G1 调用覆盖 | A–G 所有真实操作均有 UI→Runtime→Repository→SQL 链路，无未分类入口 |
| G2 状态有界 | 列表、详情、草稿、来源、Effects、导入 payload、Store/ViewModel 有预算和运行时观测 |
| G3 Repository | scope、owner、ID、keyset、count、CAS、continuation、事务、幂等均有实测 |
| G4 普通聊天无全图 | 普通聊天、管理、事件/消息 provenance 和兼容入口无完整对象图；引用与授权语义不变 |
| G5 领域正确 | A–G 完整业务闭环通过；世界、群聊、卡片、世界书、记忆、Effects、自治语义正确 |
| G6 权限与租约 | read/remember/share 前置；撤权、锁屏、后台、解绑、取消和迟到结果通过 |
| G7 错误与故障 | SQLCipher 错密、版本拒绝、查询/事务/COMMIT 失败、强停重开、恢复 fail closed |
| G8 UI/AI | 所有新增管理 UI 和消费者实际运行；真实模型 API 请求为 0 |
| G9 全项目 | 最终 npm run check、strict 正负类型、真实 Android SQLCipher JS E2E 全通过 |
| G10 兼容边界 | legacy 保留；普通 APK SQLite false；Schema 001–004 checksum 不变；未实施 M5/M6/M7 |
| G11 证据审计 | 两轮全范围自检、失败/修复/复测、命令退出码与源码/设备/数据指纹完整 |

最终判定：
- PASS：G1–G11 全部在最终代码树有可复现证据，才可建议 M5；不得自动开始 M5。
- BLOCKED：任一功能、增长、生命周期、设备场景未完成或无证据，M5 继续 NO。
- FAIL：权限绕过、真实数据误操作、全图回读、数据丢失、Effects 串改、事务半提交、锁定后明文泄漏或生产误激活。

## 9. Git、安全和数据边界

- 只在 M 分支普通提交和推送。
- 启动与每次推送前 fetch，若远端前进，先检查差异并接续。
- 禁止 force push、reset --hard、git clean、覆盖用户文件、擅自 stash、删除失败证据。
- 保留主工作树原有修改、删除项、未跟踪文件和其他 worktree。
- raw/ 不可修改。
- 不改 Schema 001–004；新增 migration 需单独证据与用户批准。
- 生产 canonical 保持 legacy；普通 Android SQLite 激活位保持 false。
- 不触碰真实用户数据、真实 legacy JSON、kanata-v1.enc、bak/tmp 或真实备份。
- 不调用真实模型 API；只用 synthetic provider。
- 不实施 M5/M6/M7，不修改 Kanata/main，不合并、不发布 APK。
- 测试超时、设备异常或证据不足必须如实 BLOCKED，不得放宽标准。

## 10. 最终报告格式

最终报告至少包含：

1. 最终本地/远端 M HEAD 和提交链接。
2. MR0–MR8 状态。
3. A–G 每项真实入口与验收状态。
4. GROUP-01～05 历史 PASS 是否受本轮影响及复测结果。
5. G1–G11 逐项 PASS/BLOCKED/FAIL。
6. Node/Vue/定向测试计数口径、完整命令和退出码。
7. Android 设备身份、API、SQLCipher、APK/catalog/源码/数据集 SHA。
8. 1k/10k 事件确认耗时、查询/桥接/写入/COMMIT/批次/回执和内存指标。
9. G4 不同授权标签、provenance、旧兼容入口的完整增长证据。
10. 两轮全范围审查记录。
11. 生产 canonical、普通 APK 激活位、Schema checksum 和真实数据保护结果。
12. 未覆盖项、风险、M5 YES/NO 及理由。

**最终原则：M4 的 PASS 是证据结论，不是任务目标倒逼出来的标签。任何一项缺失就保持 BLOCKED。**
