# Kanata SQLite M4 最终收口清单 v1

**日期：** 2026-11-11（北京时间）  
**仓库 / 分支：** Zhoubin601/ForMyself / M  
**制定基线：** 5095b8ec537b1af182f7dbb091671c63aa917c6e  
**当前结论：** M4 BLOCKED；M5 NO。  
**本文件性质：** 已确认 M4-R 合同的统一状态清单和唯一当前执行索引，不是新阶段、新需求或新的 MR/ER 工作包。

> 本文件由用户确认“工程质量优先，但必须有明确终点”后建立。它合并现有 M4、M4-R、MR0–MR8、ER1、A–G 和 G1–G11 的状态，不增加新的验收要求。历史任务书、验收报告和 QA 日志全部保留，不重写历史结果。

## 0. 本轮要解决的管理问题

此前 M4 工作分散在多份续作任务书、兼容任务书、验收报告和新增探针中，出现同一缺口多次拆分、同一证据重复运行、局部 PASS 与全局 BLOCKED 反复切换的问题。

从本文件开始：

1. **M4 只保留这一份统一收口清单作为当前执行索引。**
2. 不再创建 MR9、ER1-3A、ER1-3B 等新阶段或子任务编号。
3. 新发现必须归入现有 A–G、G1–G11 或 MR0–MR8 条目；不符合当前范围的进入 P2，不新开任务。
4. 不修改原始需求、不降低已确认的验收门槛。
5. 已通过证据按源码、测试夹具、设备、APK/catalog 指纹复用；受影响的范围才重测。
6. 正式的两轮全范围审查只在最终集成候选上进行，不为每个小修复重复启动两轮完整审查。
7. M4 完成后冻结该阶段。只有新发现的可复现数据、安全、权限或产品正确性缺陷才允许重新打开；普通优化进入后续计划。

本清单是状态和执行入口。详细技术约束仍引用现有 [M4-R 最终收尾合同](20261110-kanata-sqlite-m4-r-closeout-task-v1.md) 与 [ER1 事件兼容任务书](20261111-kanata-sqlite-mr2-g4-event-compat-closure-task-v1.md)，不复制或另造第二套技术标准。

## 1. 权威来源与范围边界

### 1.1 产品语义权威

按以下顺序判断产品行为：

1. 用户在当前及此前明确确认的产品决策。
2. raw/完整需求清单.txt 与 raw/彼方 · Kanata 技术设计.txt。
3. 已存在且仍属于产品范围的 legacy 实际行为；若与用户决策或 raw 冲突，以前两项为准。
4. 已确认的 M4/M4-R 技术合同。
5. 当前源码、测试和 QA 日志用于确认实现事实与证据，不得反向覆盖产品语义。

raw/ 只读。资料没有定义的产品行为不得由 Agent 发明。当前用户已确认：事件撤销以纯领域契约为唯一权威，包括 revoked 后代、Set/data.events 顺序、同世界 Events/Effects/EffectBaselines 完整签名和 revoked no-op。

### 1.2 M4 范围

M4 的目标是完成 SQLite 隔离候选的业务访问模型重构：候选业务真实接线、状态有界、Repository 命令与查询正确、权限和租约有效、历史语义不变、Android SQLCipher 实测和证据闭环。

本轮范围以 M4-R 合同中的 A–G、MR0–MR8、G1–G11 为准。raw 中属于其他产品阶段、M5/M6/M7/P7 或未来多模态扩展的内容，不因本清单而自动提前进入 M4。

### 1.3 明确不属于本轮

- 不迁移真实 legacy JSON、旧加密归档或真实用户数据。
- 不切换生产 canonical；继续保持 legacy。
- 普通 Android APK 的 SQLite 激活位继续为 false。
- 不实施 SQLite 阶段 M5、M6、M7，不修改 P7，不合并回 Kanata/main，不发布 APK。
- 不调用真实模型 API；候选设备测试继续使用 synthetic provider。
- 不修改 Schema 001–004。Schema 005 只有在现有结构确实无法满足已确认语义、给出向前兼容与恢复证据并取得用户明确批准后才可实施；不得把新增 005 当作默认解法。
- 不为追求额外性能数据而把 M7 的 100k 完整容量目标提前塞入 M4。
- raw 未要求的语音、图像、实时语音和其他未来功能不进入本轮。

## 2. 当前基线与整体状态

### 2.1 当前检查点

- 制定清单时远端 M：5095b8ec537b1af182f7dbb091671c63aa917c6e。2026-11-11 本轮 fetch 后接管远端 10421105b745fa4bb9b2107379c39786fac68b96，既有 M worktree 普通快进；没有回退。
- 本清单只描述该检查点已记录的事实；Agent 启动时必须重新 fetch M，若远端已前进，从最新 HEAD 审查差异后接续。
- 生产 canonical：legacy。
- 普通 Android APK SQLite 激活位：false。
- Schema 001–004：保持冻结。
- 当前没有用户授权执行真实数据迁移或生产切换。

### 2.2 M4-R 工作包状态

| 现有工作包 | 当前状态 | 说明 |
|---|---|---|
| MR0 接管与证据盘点 | PASS（需启动时轻量复核 HEAD/工作区/设备） | 历史基线、设备白名单和 A–G 矩阵已有证据 |
| MR1 Android 10k 宽事件确认 | PASS | 1k/10k 综合确认、逐项 Effects 审计、强停恢复和幂等已有 Android 证据 |
| MR2 G4 provenance | BLOCKED | 普通聊天、事件/消息来源和旧兼容入口仍有未闭环边界 |
| MR3 A/B/C 管理闭环 | NOT RUN / PARTIAL | 世界复制、角色实例/文件导入、世界书完整管理未全部闭环 |
| MR4 D/E/G 管理闭环 | NOT RUN / PARTIAL | 记忆跨组处理、事件语义/兼容、历史扩展引用保护未全部闭环 |
| MR5 F 真实消费者与后台任务 | NOT RUN | 自治调度、contact/social 和生活模块消费者未闭环 |
| MR6 跨页面生命周期、权限与故障 | BLOCKED | 部分组件与 Runtime 已验证；完整页面、权限、内存矩阵缺失 |
| MR7 最终全量回归与 Android 验收 | BLOCKED | 已接线场景有实测；完整 A–G 最终候选矩阵未完成 |
| MR8 两轮全范围审查与交付 | BLOCKED | 有检查点审查；最终集成树两轮全范围审查未完成 |

MR5 是 M4-R 内部工作包编号，不是 SQLite 阶段 M5。

### 2.3 ER1 事件兼容状态

| 既有 ER1 条目 | 当前状态 | 事实 |
|---|---|---|
| ER1-0 调用审计 | 完成 | 已区分产品、测试、Android QA 消费者 |
| ER1-1 无界完整对象边界 | PARTIAL | Runtime/Repository 旧完整 Facade 与 materializer 已移除，QA 改用有界 API/test-only Oracle；G4 其他普通消息/任务及全调用矩阵仍需关闭 |
| ER1-2 历史 action 字段级兼容 | 当前字段切片 PASS | 四条实际业务写路径 SQL UTF-16 处理、主机及同一集成 APK 的 Android 15 类输入通过；不代替 ER1 全部验收 |
| ER1-3 纯领域撤销语义 | 当前撤销切片 PASS | 原序、Set/执行顺序、完整世界增量签名、revoked no-op、两阶段重放与前后值审计通过；集成 Android 1k/10k 批次强杀回滚、恢复与幂等已通过。最终全范围矩阵仍待 MR7/MR8 |
| ER1-4 生命周期与内存 | PARTIAL / BLOCKED | 长 Effect Audit 分块及关闭/卸载/迟到页面定向通过；Android 专用生命周期、Heap retained、Pinia/局部状态分类仍缺完整证据 |
| ER1-5 最终回归与两轮审查 | PARTIAL / BLOCKED | 主机 check、既有 Android 综合回归和两轮检查点审查已完成；ER1 完整最终设备矩阵未完成 |

### 2.4 G1–G11 状态

最新完整 M4-R 报告中，G1–G9 与 G11 均为 BLOCKED；G10 为 PASS。其后 ER1 验收 v4 又确认事件兼容、原始领域顺序和专用生命周期仍未闭环，因此不能据旧报告把全局门禁提升为 PASS。

| 门禁 | 当前状态 | 最终关闭条件 |
|---|---|---|
| G1 调用覆盖 | BLOCKED | A–G 所有当前范围内真实操作都有 UI→Runtime→Repository→SQL 链路，无未分类入口 |
| G2 状态有界 | BLOCKED | 列表、详情、草稿、来源、Effects、导入 payload、Store/ViewModel 与跨桥数据均有明确预算和实际观测 |
| G3 Repository | BLOCKED | scope、owner、ID、keyset、count、CAS、continuation、事务、幂等和错误语义均有对应实测 |
| G4 普通聊天无全图 | BLOCKED | 普通聊天、管理、事件/消息 provenance 和兼容入口无随数据增长的完整对象图，且旧语义不变 |
| G5 领域正确 | BLOCKED | A–G 当前范围内业务闭环和既定产品语义通过 |
| G6 权限与租约 | BLOCKED | read/remember/share、撤权、锁屏、后台、解绑、取消、owner/revision 变化和迟到结果通过 |
| G7 错误与故障 | BLOCKED | 错密、版本拒绝、查询/事务/COMMIT 失败、强停重开、恢复 fail closed 与幂等通过 |
| G8 UI/AI | BLOCKED | 当前范围内新增页面和真实消费者实际运行；provider 合成，真实模型 API 请求为 0 |
| G9 全项目 | BLOCKED | 最终代码树 npm run check、strict 正负类型、构建和强制 Android SQLCipher JS E2E 通过 |
| G10 兼容边界 | PASS（最终树复核） | canonical legacy、普通 APK SQLite=false、Schema 001–004 checksum 不变、未提前实施 M5/M6/M7 |
| G11 证据审计 | BLOCKED | 最终树两轮全范围审查、失败/修复/复测、命令退出码及源码/设备/数据指纹完整 |

## 3. 已通过资产：禁止无原因重复施工

以下为现有报告记录的已通过切片。它们不是整个 M4 的 PASS，但不得仅因新一轮开始而推倒重做。

| 已通过资产 | 已有证据范围 | 复用条件 |
|---|---|---|
| M0–M3 | SQLite 技术验证、Schema 001–004、Driver、消息/会话与领域 Repository | 不重写基础设施；只有被当前变更影响时做针对性回归 |
| GROUP-01–05 | 空群原地编辑、历史群另建、原群历史/引用隔离、跨世界角色拒绝、并发首条消息、取消、COMMIT 失败、幂等 | 组件/Repository/共享 Runtime 指纹未变时复用；改动共享入口时重跑受影响组 |
| MR1 10k 宽事件确认 | Android API 34 / SQLCipher 4.17.0 综合 1k/10k、逐项 Effects 审计、128 行批次、强停重开、回执与幂等 | 事件写入/Effects/驱动/夹具/设备发生影响性变化时才重跑对应矩阵 |
| 普通聊天记忆来源 | 1k/10k 授权、逐条引用编码、预算拒绝、取消后零新增查询、恢复引用逐条匹配 | 聊天授权、来源编码、回复落库链路变更时重跑 |
| 事件来源写入切片 | 提议、提交、普通修正、授权、CAS、COMMIT 失败、取消、强停与幂等的既有主机/Android 证据 | action、事件来源、revision、审计或事务路径变更时重跑 |
| 事件读取切片 | header、关系、Effect、Audit、JSON chunk、深链/宽扇出/混合关系的既有 1k/10k 证据 | 读取 API、游标、权限谓词或消费者变更时重跑 |
| 记忆分享/合并等切片 | 分享撤回、自定义合并、逐项 Effect 审计、静态世界设置、候选历史整理已有部分证据 | 只对未覆盖路径补测，不把局部切片扩展成全域 PASS |
| G10 | 普通 APK 关闭 SQLite、无 synthetic 页面/seed、Schema checksum、生产 legacy | 最终普通 APK/catalog 仍须在最终树核验；不得每次局部修改都重复整套无关流程 |

复用证据必须核对源文件/树 SHA、APK SHA、catalog、fixture、设备和测试命令。测试计数不得跨报告相加；定向测试若属于 Node 套件子集，只报告一次。

## 4. 唯一剩余工作清单

本节是 M4 剩余实施和验收的唯一清单。每个条目均归入既有 A–G 或 G4，不创建新的任务编号。

### A. 世界与群聊

**当前状态：PARTIAL。**

已完成：世界创建/选择/静态设置、可逆归档相关切片；GROUP-01–05 已通过既有 Android 合成验证。

仍需关闭：

- 将 legacy 的 copyKanataWorld 静态复制语义接入候选。精确过滤与重置规则以当前 legacy 函数及 source-notes 已记录的源码证据为准；不得复制动态消息、记忆、事件、Effects、任务或权限，除非现有明确语义证明应复制。
- 对复制后静态成员、会话结构、世界书、可保留关系及重置字段逐项对照。
- 补齐世界归档/恢复、切换、旧页面请求失效和 owner/scope CAS 生命周期矩阵。
- GROUP-01–05 不重复开发；仅当共享代码变化时回归。

**关闭证据：** 真实候选 UI→Runtime→Repository→SQL；旧行为对照；Android 创建/复制/归档/切换/恢复回读；跨世界拒绝和失败回滚。

### B. 角色卡与世界实例

**当前状态：PARTIAL。**

仍需关闭：

- 角色卡 PNG/JSON 导入与原始 payload、头像和未知扩展字段保留。
- 卡片草稿、发布新版本、版本历史和字段等价。
- 角色实例加入世界；全局卡版本更新不得覆盖世界本地 override；同步字段必须按 revision/CAS 处理。
- Android 原生文件选择器的选择、取消、系统返回、后台、锁屏、恢复、世界切换和 lease 失效。
- 未支持格式给出明确诊断；不得执行卡片脚本或未经审查的扩展内容。支持格式以现有 parser 和已确认范围为准，不因本轮扩大为无限版本兼容。

**关闭证据：** 原文件 SHA、导入后原始/标准化字段和未知扩展对照、实例同步冲突、Android 文件选择往返及明文释放。

### C. 世界书

**当前状态：PARTIAL。**

仍需关闭：

- 条目列表、单条详情、创建、编辑、启停、删除和按角色预览。
- owner、world、known_by、可见性、激活条件、优先级、并列顺序和上下文预算完整保留。
- 与 legacy 排序/激活语义对照。
- 并发编辑/删除下连续分页无漏项、重复或跨世界读取。
- 关闭详情、切世界、撤权后释放正文和旧请求。

**关闭证据：** 全字段 Oracle、权限负例、并发分页、Android 实际页面回读和生命周期测试。

### D. 记忆、冲突、合并与分享

**当前状态：PARTIAL。**

仍需关闭：

- 跨冲突组批量整理/合并、冲突查看与处理、来源查看、分享对象管理和分享撤回。
- 每条来源精确绑定 message_id + revision；归档来源按 ID/revision 解析，不按文本相似度猜测。
- read/remember/share 独立授权，正文读取前校验 grant、owner、world、actor 和 source revision。
- 分享副本撤回后，后代复制链、缓存、迟到任务和旧角色访问全部失效。
- 批量预览与用户确认集合必须一致；取消、CAS 冲突、孤儿来源、失效 revision、跨世界来源和混合权限关系有证据。
- 已通过的分享撤回和自定义合并切片只补未覆盖的跨组与故障场景。

**关闭证据：** 主机和 Android 宽授权/跨组 1k/10k、撤权后正文读取 0、迟到结果不写入、原始来源顺序/去重与旧语义逐项一致。

### E. 世界事件与 Effects

**当前状态：BLOCKED；MR1 性能切片已 PASS。**

仍需关闭：

- 所有当前支持事件类型的创建、提交、修正、预览、确认、撤销、审计和 Effects 重放。
- 纯领域撤销为唯一权威：revokeIds 包含全部因果后代（包括已 revoked 后代）；顺序保留 descendants() Set 插入顺序；uncertainIds 保留 data.events 遍历顺序。
- Preview signature 增量覆盖同世界完整 Events、Effects、EffectBaselines；世界相关数据变化必须使旧预览失效。
- 已 revoked 事件可以留在确认集合，但执行不得重复增加 revision 或重复生成状态变更审计。
- 顺序存储切片已通过：005 新写入按三张旁表恢复 Events、Effects、EffectBaselines 同世界原序，历史缺序号明确拒绝；撤销算法还须实际消费该顺序。不能用 ORDER BY id 或隐式 rowid 冒充原序。
- 若 001–004 无法无损表达所需顺序，先提交最小方案、数据兼容/恢复影响和回滚证据，等待用户明确批准；未经批准不改 Schema、不新增 005。
- 历史 action 的 UTF-16 object-spread 兼容必须在 commit、correction、message revision、status/revoke 四条相关业务路径中字段级处理，不得再完整 materialize Event；不得擅自增加 action 长度限制。
- Repository 完整 Event/Effect/Audit Facade、旧 preview ID 全量数组和 QA 旧回读迁移到有界 API 或 test-only Oracle；真实产品路径不得分页后重新 gather。
- 长 Effect Audit value/path/before/after 必须有分块边界；仅限制每页 50 条不代表单字段有界。
- 旧纯领域 Oracle、历史 SQLite adapter Oracle 分开保留；历史 SQLite Oracle 只作对照，不裁决产品撤销行为。

**关闭证据：** 乱序父子事件、深链、宽扇出、混合依赖、已 revoked 后代、uncertain 交错、世界变化 stale、Effect/Baseline 变化、COMMIT 失败、强停、重试、审计与回执逐项对照；主机与 Android API 34 / SQLCipher 4.17.0 实测。

**2026-11-11 接管后的实际阻断与最小待批准方案（仍归 E / ER1-3 / MR2，未新开任务）：**

- 依据为本节纯领域顺序合同、§8–9 停止条件及 raw/完整需求清单.txt §6.7–6.8。分类 P0，影响 E、G3/G4/G5；历史 action 和专用设备证据仍另有未关闭项。
- 本轮重跑既有顺序探针、兼容探针：均退出 1；后者仍有 12 项差异。另用两份经过 `validateKanataData` 的合法合成数组（乱序父子、含 revoked 后代，同时反转 Effects/Baselines），通过现有 `m2FixtureCommands` 装入真实 v4 SQLite。**全部表声明列的逻辑快照 SHA 相同** `1338c35f2037e2654998be8a86ee153ba5ab2491cc0a4754f9893acb67355742`，纯领域 revokeIds 顺序与完整世界签名却不同。原始日志及可复现脚本见 [本轮证据](qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/README.md)。这证明当前映射缺少可恢复信息；不是声称 SQLite/JSON 不能表达顺序，也不是证明每次受控追加都会丢序。
- ID、时间和物理 rowid 不是该合同的原始数组顺序；关系内 order hint 不能恢复顶层三个数组。现有写路径不保存顶层顺序。即使未来在 extensions_json 中另设序号协议，也不能从旧行推导已经缺失的顺序；还须解决任意未知扩展的命名碰撞、协议识别、完整性与索引预算，当前没有这样的已冻结协议。不得把“可容纳 JSON”当作已有无损映射证明。

`0a5e0b3` 提交时建议批准的范围仅为 **附加 Schema 005 顺序元数据**，不改变 001–004 历史定义/checksum，不改变生产 canonical/default false，不开始 M5。下列为当时待批准的最小结构；该提交只有 QA 方案，尚未注册 migration。后续明确批准与实施结果紧接本方案记录：

| 旁表（拟议名称） | 所属表 | 字段与约束 |
| --- | --- | --- |
| event_array_order | world_events | world_id、entity_id、ordinal；联合主键(world_id,entity_id)，唯一(world_id,ordinal)，联合 FK→所属表(world_id,id)，ordinal 为安全非负整数 |
| effect_array_order | world_effects | 同上 |
| baseline_array_order | effect_baselines | 同上 |

- 每个世界内保存原数组相对顺序，满足纯领域同世界筛选；不据此宣称已完成 M5 的全局图导入/导出。联合唯一索引供 world+ordinal keyset，页面仍最多 50；禁止产品端 gather。`qa_` 前缀的完整 DDL 仅在 [沙箱脚本](qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/verify-order-storage.mjs) 中。
- 新实体和对应 ordinal 同一个 `BEGIN IMMEDIATE` 事务写入，已有序号不可普通更新/删除；分配与幂等回执一起提交。导入/重建只能以原数组或已验证的顺序元数据为来源，不能回填 rowid/ID 顺序。所有创建者、修正副本、Effects/Baselines 生产者及合成夹具均须同步覆盖后才可验收。
- 现有 v4 若有缺失顺序的行：不猜序、不覆盖、不清理；相关预览/签名/修改 fail closed，旧库与材料保留。有原合成 fixture 的验证在独立新库重放原数组；这不授权读取真实旧数据，也不构成 M5 迁移。005 不会自动找回历史已丢信息。
- 向前兼容要求：已知 v4 正常升级与新元数据在一个受保护迁移事务内；未知未来版本拒绝。缺序号完整性门禁保持，不能因加表自动判为 ready。旧二进制应按未来版本拒绝 v5，不降级打开。
- 回滚要求：提交前失败或强杀，整个 DDL/行事务回滚；提交后仅允许升级后的二进制重开，不提供删表/降版本的“降级恢复”。保留原 v4，任何恢复必须走既定保护协调；本轮不实施真实恢复/迁移。
- 沙箱在 **主机 SQLite 3.51.2** 通过原数组往返、冷重开、DDL 回滚、写入 DDL+行后独立进程 SIGKILL/重开、重复 ID/序号、跨世界 FK 拒绝、缺序号 fail closed；旧声明列和未知 JSON 不变。沙箱故意仍报 BLOCKED/退出 1，`experimentAssertions=PASS` 仅表示实验断言成功。**Android SQLCipher 4.17.0、新迁移校验、普通 APK catalog 和最终回归均尚未覆盖该方案**，批准后必须实跑。

上述决定已由用户在 2026-11-11 明确批准：仅在 M 分支隔离候选追加 event_array_order / effect_array_order / baseline_array_order 三张旁表；要求同一 BEGIN IMMEDIATE、覆盖所有生产者、历史缺序号 fail closed、数据库级不可更新/删除、分页及增量签名不退化，并实跑 Android 迁移/冷启动/回滚/强停/缺序号拒绝。不得将该批准扩展到真实迁移、生产切换、普通 APK 激活或 SQLite M5。

**Schema 005 结构实现及本次指定验收：PASS；E/ER1/G4/M4 仍 BLOCKED。** 三张旁表及 BEFORE INSERT 原子记录触发器已加入，不回填旧行；普通更新/删除/替换序号拒绝，完整覆盖校验在 Repository 入口保留，缺序号和部分损坏映射在相关读取/修改前拒绝。第五版最终 checksum 为 `10db9e4533df23fd0b82cd054e19703601001292a147c0ef38187a2c420840be`，001–004 checksum 与冻结值逐项一致。

- 实际候选能力：正常/历史 action 提交、两类修正、自治事件、Effects/Baseline 的新实体都会在同一 BEGIN IMMEDIATE 事务内获得 ordinal；原序可分页读取，物理 rowid 变化不改变它。原子回滚、冷启动和幂等有实际验证。
- 最终主机 `npm run check` 退出 0：700 Node、402 Vue/44 文件、strict 正负类型、生产构建；7 项新增定向为 Node 子集，不重复累计。初版 90/93 的三项迁移版本期望差异已修复，失败保留。
- 最终 Android 专项退出 0：旧合成 v4 APK 建立真实加密库后原地安装 v5，实跑 DDL/真实 COMMIT 失败、迁移中 SIGKILL 后重开 v4、成功升级、写入 Effects/Baselines/ordinal 后强停回滚、重试幂等和冷启动缺序号拒绝。旧世界 4/3/2 条记录保留，三张序号表仍为 0；没有猜序或回填。
- 综合候选最终回归退出 0，GROUP-01–05、消息/记忆/自治等现有场景和 1k/10k 均重跑。10k 综合耗时 156,693ms，确认 10,001 条，批次最多 128，原 420 秒 deadline 不变。最终原生 instrumentation 1/1 OK。全 M4 尚未接齐的 A–G、专用 Heap/生命周期及最终两轮审查不由这些切片替代。
- 原始回归失败保留：一轮在强停后 ADB `/proc/net/unix` 超时；初版逐行 count 扫描造成另一轮 10k 超过 420 秒。仅优化触发器的遗留空映射存在性检查，保留 Repository 完整覆盖检查及部分损坏反例后，原规模/原 deadline 复测通过，没有降低门槛。
- 普通 APK 仅构建复核，activation=false、无合成页面/SQL，Schema catalog=5，001–004 checksum 不变；生产 canonical legacy。真实数据/备份未触碰，真实模型调用 0，未发布 APK、未启动 M5。
- 源码/fixture 583 个文件 SHA、候选 APK/catalog、设备与 20 份压缩原始证据绑定见 [本轮 QA](qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/README.md)及其 schema005-fingerprints.json。旧 005 计数实现和旧 APK 的 PASS 不套用到最终修复树。

下一步继续本节已有的纯领域撤销消费原序、全世界增量签名、revoked no-op、历史 action 四路径和长 Audit/G4 边界，不再请求已批准的 005 权限，不新增 MR/ER 编号。MR7/MR8 的最终全范围集成与两轮独立审查仍待全部 A–G 实现后执行。

**2026-11-12 同一 E 条目内的消费者检查点：**

- 撤销临时计划按 005 ordinal 模拟纯领域每轮 data.events 扫描及 Set 插入顺序；uncertain 按原数组序，执行按原数组分两阶段处理状态、记忆和 Effects。已 revoked 后代保留在集合并参与路径重放，但不重复 revision/audit。临时表在成功结束清空，失败随事务回滚。
- SHA256 增量覆盖同世界 Events、Effects、Baselines 的全部存储列和事件规范关系；每页≤50，超长 JSON 分块≤4096，不重建完整对象。签入 raw extension 的存储表示以保守失效；不声称 hash 字面等同旧 JSON.stringify 字符串。
- 历史 action 从原始 JSON lexeme 按字节扫描，SQL 内保留 UTF-16 code unit 展开、孤立代理项、字段删除与未知属性；commit/correction/message revision/status-revoke 四条业务路径已移除完整 Event 回退，无 action 长度新限制，001–005 未修改。
- `npm run check` 退出 0：709 Node、402 Vue/44 文件、strict 正负类型、生产 build。乱序多父 DAG、1k 反向链、两阶段 Effects/记忆/审计与纯领域对照通过；1k/10k 深/宽/混合图全部原规模通过。旧兼容探针现退出 0，12 项差异清零。
- Android API34/SQLCipher4.17.0 四路径 15 类 action、长字段、35 节点乱序图、revoked no-op、无关世界事件使预览失效实测通过；query≤50、chunk≤4096、完整 Event 读取 0，instrumentation 1/1 OK。首轮 QA 误计合法 chunk、早期主机旧临时表读取断言失败均保留；不是产品 PASS。
- 证据与源码/fixture/APK/catalog/设备指纹见同一 [QA](qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/README.md) 的 event-consumer-fingerprints.json。旧005专项仅复用其冻结 DDL/约束结论，不替代本轮消费者证据。

本检查点尚未删除旧 Repository Facade/完整 QA 回读，未完成新消费者树的 Android 1k/10k 综合故障/强停、长 Effect Audit 和专用 Heap/生命周期；两轮最终独立审查未运行。此为 9445e28 的历史检查点，后续覆盖见下段。

**2026-11-12 实施与实测、2026-11-13 收齐证据的同一 E 检查点：**

- 生产源码删除 `events.legacy`、旧 preview 全量 ID 数组、`eventFromRow`、`loadEvent`、`materializeAuditSnapshot` 及其回退查询；QA 使用有界 API 或明确隔离的合成 Oracle，不以旧 SQLite ID 排序裁决产品语义。事件上下文也使用005 ordinal，物理 rowid 改变不改变上下文顺序。
- 冻结 Effect Audit 按原数组位置 keyset 分页，长 path/value/before/after/完整记录每次最多4096字符；普通短记录保持可读。游标绑定 world/event/audit、不可变 revision/signature 和字段；Runtime/实际类型/strict负例同步。页面只保留当前片段，关闭详情/父审计/卸载后清空，拒绝迟到结果。
- 撤销在同一 BEGIN IMMEDIATE 内用 TEMP 表保留阶段前值、重放后一次写入不可变审计，保存 owner 前后 revision 与命令标识；没有修改或更新已有审计，也没有修改001–005。TEMP触发器把暂存、CAS、状态和扩展规范化合为一次批次调用，临时外键级联清理并有对应索引。
- 主机 `npm run check` 退出0：714 Node、406 Vue/44文件、strict正负、生产build。1k/10k 确认1001/10001、批次≤128、批间失败回滚及回执重放通过。10k 持久化写入161，仍≤原 `2×批次数+3`；另6次 TEMP 操作，原始总数167明确保留，不隐去临时写入。
- 同一集成 APK/catalog 的 API34 / SQLCipher4.17.0：15类 action 四路径、长审计、错误分类、provenance、有界读取及深/宽/混合图1k/10k通过；实际事件写入强杀及首批撤销审计写入后强杀恢复通过。综合10k为177,113ms，10001确认、批次128；该无自有Effect扇出场景持久化159/TEMP5/总164，原420秒门槛未提高。
- 同一候选重新通过真实合成 v4→v5 原地升级、DDL/COMMIT故障、迁移/写入强杀、冷启动及缺序号拒绝。001–005 checksum不变。普通APK重新构建并检查实际DEX：激活false、包名普通、无合成页面/seed，canonical legacy；未安装、未发布。
- 原始失败保留：缺失前后值；早期无效夹具未提交Effect；有效旧表达式的NOT NULL抢先覆盖错误码；综合前值误假设；暂存增加桥接写入；TEMP级联缺索引；SQLCipher完整EXPLAIN超256行。实际修复分别有回归证据，未跳过计划、提高原生行数或缩小规模。审计快照在SQLite内复用后，主机完整计划247→197行，Android完整计划与强停场景通过。

日志、命令、失败/复测、源码/fixture/APK/catalog/设备指纹见同一[QA目录](qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/README.md)的 `event-bounded-*`、`effect-audit-*` 和 `event-bounded-fingerprints.json`。旧005证据仅复用冻结结构/历史缺信息反例；受本轮影响的设备消费者全部重测。当前 E/G4/M4 仍 BLOCKED、M5 NO：普通消息兼容 DTO、自治 loadTask、其他 A–G 产品缺口、统一生命周期/retained Heap 和两轮最终全范围审查尚未闭环。继续本清单，不新增工作包。

### F. 自治、contact/social 与生活角色消费者

**当前状态：NOT RUN / PARTIAL。**

仍需关闭：

- 自治调度、contact/social 和生活角色绑定必须接入真实候选消费者，不能只保存设置或显示任务摘要。
- 生活模块选择精确到 world + character instance；失效时要求重新选择，不回退同名角色。
- read/remember/share 三权限独立；撤权后停止新读取和传播。
- 自治关闭期间不追补事件；开启后按水位继续，不重复生成已提交事件。
- 后台任务具备 lease、幂等键、持久回执、失败重试和水位事务；Android 关闭时不假设模型仍持续运行。
- 覆盖解绑、归档、锁屏、后台、恢复、跨日/时区和 provider 忽略 AbortSignal。
- 旧 loadTask 完整 DTO 不得成为无界兼容旁路；来源校验与结果成员关系按页执行。

**关闭证据：** 真实消费者 UI/Runtime/Repository/SQL 链路、1k/10k 自治来源、lease 过期恢复、幂等水位、权限撤销和 Android 生命周期回归；真实模型 API 请求为 0。

2026-11-13 原 F/G4 缺口复现：`verify-task-bounds.mjs` 只在内存合成库追加1000条消息来源，实际 `listTasks` 单次SQL最多50行，但返回任务含1001条完整sourceRefs。`task-bounded-before.txt`/exit=1记录源码指纹与真实断言失败，证明loadTask在页后重新gather；不是新增需求或新的工作包。任务实现尚未修改，后续沿本条目改为有界元数据/来源/结果访问并迁移既有消费者。

### G. 历史整理与引用保护

**当前状态：PARTIAL。**

仍需关闭：

- 历史整理预览、用户确认、有界执行、进度和最终回执。
- 规范引用与 legacy 非规范化扩展引用均须扫描；未知扩展不得被当作无引用。
- 归档、软删除、稀疏引用、嵌套扩展和旧不透明编码样本中，无法证明无引用时 fail closed。
- 预览签名绑定 owner、world、conversation、revision、范围和确认集合。
- 执行可取消、可恢复、幂等；失败不删除原文，不破坏 quote/reply/事件/记忆来源。
- 保留消息正文、未知扩展和精确引用语义。

**关闭证据：** 合成 legacy 扩展 Oracle、主机/Android 对照、归档预览/确认/CAS/回执、失败和强停恢复。

### G4. 普通聊天与跨域 provenance（横向合同）

**当前状态：BLOCKED。**

仍需关闭：

- 普通私聊、群聊、character 历史、引用回复、延迟回复恢复、记忆提示词、事件上下文、消息修订、归档、自治任务来源和旧兼容入口逐一列出真实调用者。
- 旧 get/recent/older/replies/provenance 等消息兼容 DTO 不得将完整标签/关系数组送入普通候选调用链；确有完整导出消费者时使用明确的 chunk/stream sink，不能在 Repository 内重新 gather。
- 事件来源与消息来源的授权、owner、world、actor、grant、source ID 和 revision 在读取正文前校验。
- 旧事件 Repository Facade、历史 action 回退、旧审计完整快照、relationship.sourceEventIds 全量输出均按 E 的要求收口。
- 旧 loadTask 完整任务 DTO 按 F 的要求收口。
- 记忆、事件、消息和自治来源在宽授权、深链、宽扇出、混合角色/权限下不得先构造随总关系规模线性增长的 JS 数组/Set/对象图。
- 保留顺序、去重、预算拒绝和错误分类；不静默丢弃尾部引用或缩小用户确认集合。

**关闭证据：** 完整调用图、1k/10k 不同授权与关系形状、单页/桥接上限、跨桥完整来源 DTO 计数为 0、撤权后正文读取为 0、取消/关闭后新增查询为 0、provider JSON 与旧语义逐项匹配。

2026-11-13 同一 G4 条目推进（尚未完成设备验收）：`0339683` 后，普通消息 revise 的 1k/10k 合成来源与长未知扩展用例均真实复现完整 DTO 跨桥，保存在既有 QA 的 `message-bounded-before.txt`。修订/状态/回复停用改为事务内单槽 TEMP 快照与 SQLite 审计，回执只含 id/revision；完整 get/recent/older/replies/latest/history 默认 DTO 与无消费者 provenance() 已移除，全部普通读取固定 transcript。输入幂等比较在 SQLite 中按 JSON 树执行，保留数组顺序、类型、缺失字段和未知扩展，不返回存储 DTO。来源页≤50、精确快照/扩展/历史审计 JSON 块≤4096 Unicode 码点，scope/revision/selection 变化拒绝游标。主机定向10项通过，1k/10k实际修订最长跨桥文本37字符/最多2行；纯领域审计、原始标签顺序/扩展记录、每步写入/真实COMMIT失败及损坏数据/意外暂存不清理的负例通过。完整check与同一隔离Android实测正在进行，未复用旧APK结果。普通消息正文自身长字段预算、自治loadTask、完整调用矩阵及其他A–G/生命周期/最终审查仍待关闭，G4/M4保持BLOCKED。

本次消息调用覆盖（不代替 A–G 全局 G1）：

| 入口 | 当前真实链路 | 边界与剩余验收 |
|---|---|---|
| 当前窗口/向前翻页/定位 | KanataConversationView → useKanataMessageWindow → recent/older/locate → 固定 transcript SQL | 不带来源/扩展；原50页/100窗口保持；长正文自身预算仍待闭环 |
| 用户发送/重试 | kanataSqliteChatRuntime → turn.persist / messages.get / latestState | 新源消息输入无历史来源图；重试读固定投影；原CAS/落库门禁保留 |
| 私聊/群聊/character 提示词历史 | kanataSqliteChatRuntime → historyForSpeaker → transcriptForSpeaker + assertTranscriptHints | 来源/receiver read-share 与回复revision在SQL筛选；原近期预算和提示词字节合同保持 |
| 回复持久化与恢复 | insertReplyBatch → withReplyProvenance → TEMP有序标签及规范链接 | 保序与精确标签不在JS重新汇总；existing回复比较只排除由proof负责的lifeSources，未知扩展仍校验 |
| 修订/删除与派生失效 | runtime.reviseMessage → readForUpdate → reviseMessageDependents → TEMP旧快照/实体CAS/审计 | 根与派生回复不桥接完整DTO；保留Effects重放、记忆/任务失效、旧审计脱敏和事务失败语义 |
| 来源/未知扩展/历史审计检查 | sourcePage / jsonChunk（Repository owner scope） | 规范链接页50；原始hint/未知字段仅4096码点片段；完整合成对照仅test sink，当前无普通产品导出消费者 |
| 旧完整消息兼容入口 | messageFromRow/provenanceFromRow/完整投影与无消费者provenance() | 已删除；不保留隐式full选项。QA只需状态的调用已用transcript/回执；主机完整字段对照改用明确test sink |

首轮check为718 Node通过、405/406组件通过（旧P7全备恢复5秒超时），不计完整check PASS；原门槛单独复测28/28通过。新SQL幂等比较的历史大整数JSON用例曾误判ID_CONFLICT，`message-numeric-before*`保留真实失败，数值比较统一到JS double语义后定向12/12通过。完整check重新执行中，未增加超时、跳过样例或改Schema。

**2026-11-13 消息切片检查点已收齐：** `message-bounded-check-final`退出0，720 Node / 406 Vue（44文件）/ strict正负 / 生产build通过。同一候选APK `f538e0b6ed3bcbf11dfc4fe0abcd4be876cfe6d5b3c44ea234c90fe811b19312`、catalog `1211724b100a7ffbb4db00b0e81857f9d6221af4b5d27fcea8d6e9e3789fdf3e`在API34/SQLCipher4.17.0完成消息1k/10k全部来源页/JSON块、精确审计、stage/真实COMMIT回滚、SIGKILL冷开和CAS重试；10k为370590ms，原420秒门槛保持。宽来源回复、事件四路径/乱序图/长影响审计、工作区定向和完整基础回归退出0。综合Growth轮的聊天1k/10k、取消/恢复/撤权及归档已通过，但该整轮在世界书点击禁用按钮处失败，只按未受后续QA等待条件影响的切片复用；没有将失败整轮改标PASS。

旧P7超时、QA浏览器node:crypto导入、Oracle对象键顺序、AVD SystemUI缺失/keyguard sleep token、工作区驱动未等按钮enabled等失败及复测均保留，详见同QA README。SystemUI只通过同一隔离AVD的reboot恢复，无wipe；生产门禁/驱动未修改。runner新增真实SystemUI/Activity前台检查，原超时和数据规模均未放宽。普通APK实际DEX=false、canonical legacy、17条专用合成SQL未打包，APK `8bbc0c1e1d86e13d499915c1f1d00c0a6c58448a9933d9b7e28746f415d2c08b`仅构建检查、未安装发布。

`message-bounded-fingerprints.json`保存源码/fixture、各轮QA bundle、APK/catalog、设备和001–005 checksum，44份原始设备记录以压缩及原始双SHA归档；源码aggregate `e3f92d8affc2dc3b1dcea9e8342aae77ad03d26e5347f6bcdbe7806633931a9e`。005旧证据只保持其冻结结构范围，不套用为新APK升级实测。**G4/M4仍BLOCKED、M5 NO**：原F/loadTask实际1001来源gather未修复，普通消息长正文预算、A–G其他能力、专用retained Heap/统一生命周期、最终MR7和两轮MR8全范围审查仍待闭环；继续本清单。

## 5. 横向最终验收合同

以下 G1–G11 是 M4 最终门禁。A–G 的工作必须映射到这些门禁，不能重复建立第二份标准。

### G1 调用覆盖

- A–G 当前范围内每个真实操作有 UI→Runtime→Repository→SQL 调用链。
- 标出未接线、测试专用、历史兼容和真实产品消费者。
- 无未分类入口、空按钮、仅 UI 壳或 mock 成功。

### G2 状态有界

沿用已冻结预算，不得自行放宽：

| 数据 | 上限 |
|---|---:|
| 消息页 | 50 |
| 活动会话窗口 | 100 |
| SQL 业务数据页 | 50（含 sentinel 最多 51） |
| 单次提示词来源编码 | 1 个引用 |
| Effects 事务批次 | 128 行 |
| 世界/角色/世界书/记忆/事件/任务摘要 | 每页最多 50 |
| 当前详情 | 只保留当前单条；关闭/切换/撤权后清空 |
| 当前会话引用摘要 | 最多 1 条 |
| 关闭/撤权后新增查询 | 0 |
| 撤权后正文读取 | 0 |

同时区分 SQL 行数、JS 暂存对象、跨桥 DTO、Pinia、组件局部状态、WebView heap 和 Android RSS/PSS。ER1 要求的 retained/Heap/Store 分类必须在最终设备矩阵中完成；不得以单次 heapUsed/RSS 代替。

### G3 Repository

所有当前范围内命令与查询验证 scope、owner、ID、keyset、count、CAS、continuation、事务、幂等、affectedRows 和错误语义。

### G4 无全图

普通聊天、管理、消息/事件 provenance 和兼容入口不构造随总数据量增长的完整对象图；保留旧顺序、引用、授权、错误与预算语义。

### G5 领域正确

A–G 当前范围内真实产品行为正确；事件撤销以用户确认的纯领域契约为准。

### G6 权限与租约

read/remember/share 前置授权；撤权、锁屏、后台、解绑、取消、owner/revision 变化和迟到结果均不能越权读取或写入。

### G7 错误与故障

覆盖错密、未知版本、查询失败、部分写失败、真实 COMMIT 失败、CAS 冲突、取消、强停重开、恢复门禁和幂等重放；必须 fail closed。

### G8 UI/AI

所有当前范围新增页面和真实消费者在候选设备实际运行；仅使用 synthetic provider，真实模型 API 请求为 0。

### G9 全项目

最终代码树执行 npm run check、strict 正负类型、构建和强制 Android SQLCipher JS E2E。历史测试数量不代替本轮最终输出。

### G10 兼容边界

生产 canonical 继续 legacy；普通 Android APK SQLite 激活位 false；Schema 001–004 checksum 不变；不提前实施 M5/M6/M7。

### G11 证据审计

最终集成树完成两轮全范围审查；失败、修复、复测、命令、退出码、源码/设备/数据/APK/catalog 指纹可追溯。

## 6. 问题分级与准入规则

### P0：实际正确性/安全阻断

满足任一项即为 P0，必须修复：

- 数据丢失、未知扩展丢失、来源/引用损坏。
- 跨世界、跨角色或未经授权的数据读取/传播。
- 撤权后正文读取、迟到结果越权写入。
- 事务半提交、Effects 串改、重复事件/审计/水位推进。
- 纯领域事件顺序、撤销集合、签名或历史语义不一致。
- 旧数据兼容路径静默改变字段、顺序、错误或回执语义。
- 当前范围内的真实产品功能与已确认需求不符。

P0 必须有复现、影响说明和修复验证；理论可能性本身不等于 P0。

### P1：原合同明确要求的证据

以下即使没有已知功能失败，只要 M4-R 合同要求而未实际验证，仍是 M4 阻断项：

- Android API 34 / SQLCipher 4.17.0 对应的真实 JS→Native→SQLite 路径。
- 1k/10k 指定增长形状和预算观测。
- 页面/Runtime 生命周期、权限、取消、锁屏、后台、解绑、恢复和强停矩阵。
- Heap/Store/组件状态分类及 retained 证据。
- 最终 npm run check、strict 正负类型、构建、Android 集成回归。
- 两轮最终全范围独立审查。

P1 的作用是区分“实现错误”和“缺少验收证据”，不是降低验收标准；P1 未关闭仍不能 PASS。

### P2：不阻断 M4 的后续事项

仅以下情况进入 P2：

- 不属于 raw、用户确认或 M4/M4-R 合同的新增功能。
- 没有可复现失败证据、也不影响当前正确性/安全/性能预算的理论风险。
- M5/M6/M7/P7 的工作或 M4 明确排除的 100k 完整容量测试。
- 非必要的重复压力测试、额外 UI 润色和不改变正确性的微优化。

P2 记录在后续计划，不新建 M4 子任务、不改变 M4 门禁。若后来出现真实复现缺陷，按证据重新归类。

## 7. 测试与证据复用规则

1. 修改后先运行受影响的定向测试；不要求每个小改动都重跑完整项目和完整 Android 矩阵。
2. 完成所有当前范围实现后，执行一次最终 npm run check、strict 正负类型、构建和最终集成回归。
3. 只有当被测源码/测试夹具/设备/驱动/SQLite catalog/APK 指纹一致，且本轮改动没有影响该行为时，才复用历史 PASS。
4. 任何影响事件写入、撤销、Effects、授权、来源、Repository、Driver 或 fixture 的修改，都必须重跑对应定向和设备场景；不得套用未受测的新 SHA。
5. MR1 的 10k 性能结果可在依赖指纹不变时复用；最终集成回归仍需确认改动未破坏该路径，不要求无原因重复全部性能归因。
6. 定向测试属于 Node/Vue 套件子集时不得重复累计；测试数字从实际最终日志提取。
7. 失败日志必须保留。不得删除断言、降低样本、增加 timeout、截断引用或缩小用户确认集合来取得 PASS。
8. 两轮全范围审查只在最终集成候选执行；期间可以做局部代码 review 和针对性反例测试，但不能把它们重复命名为 MR8。

## 8. 固定执行顺序（不增加新编号）

按现有 MR0–MR8 和 A–G 推进，不另建子任务：

1. **接管复核：** fetch M、核对 HEAD/worktree/用户文件/设备白名单；复用 MR0 已通过证据，仅刷新变化项。
2. **事件与 G4 阻断项：** 先收口 E/ER1 的纯领域顺序、增量签名、action 四路径、完整对象兼容边界、长 Audit 分块；同步收口普通消息兼容 DTO、自治 loadTask 和其他 provenance 全链路。
3. **A/B/C：** 完成世界复制与生命周期、角色卡导入/版本/实例同步/原生文件往返、世界书全字段和连续分页。
4. **D/E/G：** 完成记忆跨组整理/冲突/分享撤回、事件全规则和 Effects、历史未知扩展引用保护。
5. **F：** 接通真实自治、contact/social 与生活角色消费者，完成 lease、水位、权限和恢复。
6. **MR6：** 对所有新增/修改页面和消费者执行统一生命周期、权限、状态预算与故障矩阵。
7. **MR7：** 对最终集成树执行完整主机、Android、增长、故障、普通 APK 与 Schema 门禁。
8. **MR8：** 两轮全范围审查、更新报告/QA/计划/长期入口、普通提交推送 M，并核对本地/远端 HEAD。

如果依赖问题阻断某项，只停止受影响的行为；不依赖该决策的工作可以继续。确需用户决定时，只提出一个有明确影响的最小问题，不创建新的探针任务体系。

## 9. 停止条件与防循环规则

新的审计发现必须同时提供：

- 对应的 raw 条款、用户决策或现有 M4-R 合同条款；或明确证明是当前代码中的真实缺陷。
- 可复现的失败、具体调用链或真实影响。
- 影响的现有 A–G / G1–G11 条目。
- 是否属于 P0、P1 或 P2，以及理由。

不满足上述条件的发现不能加入 M4 阻断清单。

发现属于当前合同但此前漏列的项目，只补入本清单对应 A–G/G 门禁，不创建新 MR/ER 编号、不另写独立任务书。

发现超出当前合同的建议，进入 P2。不得借审计将 M4 范围扩大到 M5/M6/M7/P7。

若现有 001–004 无法满足用户已确认的事件顺序语义，停止相关生产实现并向用户提交最小 Schema 方案及兼容/恢复证据；不得自行加 005。其他不受影响的 M4 工作继续。

**M4 关闭后：** 冻结本清单和最终报告。后续只因可复现的数据、安全、权限或正确性缺陷重新打开；普通优化和新增需求进入后续版本，不回滚 M4 PASS。

## 10. M4 最终 PASS 与 M5 放行

M4 只有在以下条件全部满足时才可 PASS：

- A–G 当前范围内所有强制产品操作真实接线并通过。
- MR0–MR8 的强制阶段均有最终树可复现证据；MR1 等历史通过资产按第 7 节规则复用。
- G1–G11 全部 PASS。
- 事件纯领域撤销语义、历史 action 兼容和 provenance 无界边界闭环。
- Android API 34 / SQLCipher 4.17.0 强制设备矩阵完成。
- 最终 npm run check、strict、构建、普通 APK 门禁完成。
- 两轮全范围审查完成，失败和修复均可追溯。
- 生产 canonical 仍为 legacy，普通 APK SQLite=false，Schema 001–004 未被擅自修改，真实用户数据未触碰。

M4 PASS 仅表示隔离候选访问模型完成，不表示生产已经切换。

M4 PASS 后，报告可以建议 M5 YES，但**不得自动开始 M5**；必须等待用户明确授权。M4 BLOCKED 时 M5 始终 NO。

## 11. 本轮交付与文件职责

- 本文件：M4 唯一当前收口索引、状态、范围和停止条件。
- M4-R 最终收尾合同：详细技术预算、工作包与 G1–G11 原始验收契约。
- ER1 任务书、ER1 QA、MR2/G4 调用图、矩阵和 Oracle：事件与 provenance 的细节证据。
- 历史验收报告：保留当时事实，不被覆盖，不作为未复测代码的当前 PASS。
- docs/plan.md：只链接本文件作为当前执行入口，历史章节保留。
- memory-bank/development-context.md：只记录当前稳定状态与管理规则，不复制大段验收内容。

**清单制定提交仅更新项目管理文档。本轮接管追加了上述 E 阻断反例、QA 沙箱和证据复用审计；仍未修改业务源码、常规测试、产品 Schema、Android 配置或生产数据。**
