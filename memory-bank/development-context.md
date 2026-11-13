# 可复用开发背景与入口

2026-11-02最新推送授权覆盖：用户明确要求“你先推送吧”，本轮普通提交推送P7 WIP到Kanata。当前交接入口为[云端交接v2](../docs/20261102-kanata-cloud-handoff-v2.md)，先前“未获新推送授权/未提交”仅为历史开发快照。575/388、最新04e4两端13项和安全基线为既有实测，P7仍No-Go；最新三档容量NOT RUN，最近其他候选仍失败。实际提交SHA看Git，不把WIP当阶段放行或APK发布。

2026-11-02当前覆盖：用户要求继续开发，Kanata仍ddd3f10/远端一致，新增未提交P7工作。读[本轮检查点最终节](../docs/20261102-kanata-p7-archive-planner-v1.md)。规划器、字节转换、可复现Web目录有界读取及中断保存后cold-load自动完成已校验pending已实现；575 Node/388组件41文件，最新APK04e427d7两端各13回归及原生8PASS/1SKIP、608基线/七模块/设置/Home释放通过。实际冷启动曾pending阻塞，现recoveredFromBackup=true且pending/error清零，前台自然续接通过，失败证据保留。P7仍No-Go：先前3f39 Native100k首次改密207.9s、2789 Web100k883MiB失败，04e4三档容量NOT RUN；密集来源、生活旧AI链、全应用统计/趋势及完整最终验收未完成。无挂起事务/新提交/推送/发布或真实清理；后续按当前授权继续，不因旧“本地停止/云端交接”记录停工。

用户已要求建立后续 Agent 可持续使用的架构接口说明和开发规范，默认用中文协作。

- 强制工作规范：[AGENTS.md](../AGENTS.md)。
- 当前开发说明书：[架构接口与 Agent 开发规范 v1](../架构接口与Agent开发说明书.md)。
- 安装与质量命令：[README.md](../README.md)。
- 接口类型源：[contracts.d.ts](../src/application/contracts.d.ts)。
- 当前架构说明依据 P1–P6 完成版本 `995a37e`；后续开发必须核对当时实际 HEAD 和工作区，不能把此提交视为永久最新版本。

长期约束：保留 Vue + Pinia + Capacitor 模块化单体，页面/生命周期/备份/敏感能力分别接入；普通读取失败不写空；完整恢复日志和敏感会话是数据安全边界；历史备份保持兼容。当前没有数据库迁移、多端同步或全项目严格类型的实现承诺。

用户已指定说明书放在项目根目录，作为长期开发规范维护；当前文件名为架构接口与Agent开发说明书.md，无需 output 忽略白名单。更新文件名或接口版本时同步维护 AGENTS、README、HANDOFF、本索引及文档校验脚本，保留可追溯历史；其他正式交付物继续遵守 output 目录规则。

`HANDOFF.md` 为历史档案，已标注失效行为；不要按其中旧加载/凭据/导航描述恢复实现。具体接口和验收要求统一查说明书，不在长期背景中复制完整契约。

Kanata 开发入口：[连续执行 v3](../docs/20261028-kanata-continuous-execution-plan-v3.md)、[阿拜多斯五人规格](../docs/20261028-kanata-abydos-preset-spec-v1.md)，实际新仓库/受保护运行时与备份契约见根规范第15–16节。旧温馨小家内容不迁入新世界，受控清理必须应用运行时当次确认；新全备v13与旧v1–v12非chat兼容分流。不要根据历史P0文档恢复旧内容迁移或小暖默认实例。阶段放行只认当次验收证据，无法完成Android等强制检查时必须停在对应门禁。

2026-10-29长期接续入口：P1–P5已通过，P5本地be9ebc3，用户已解除P4暂停继续开发；工作在`.worktrees/kanata`的Kanata，main用户既有改动保持。P6首批时间窗口/Store门面未提交，整个P6尚未验收，直接读[准确检查点](../docs/20261029-kanata-p6-checkpoint-v1.md)接续。不要重新做P0或将旧阶段推送授权扩展到后续推送/发布。

更新覆盖上段：P5 be9ebc3已按用户明确要求推送；P6已完成并PASS，实际证据见[P6报告](../docs/20261029-kanata-stage-p6-verification-v1.md)，后续从P7继续。用户明确允许用raw中Android快捷方式指向E:\Android的隔离模拟器完成本轮设备验收，不因缺真机停工；容量/分页/完整需求与安全门禁继续保留，不宣称全项目完成。

当前持久接续：P6本地62a2b75，P7容量源码修复/证据未提交，继续读[P7检查点](../docs/20261029-kanata-p7-storage-review-v1.md)。已测Node三档并修复来源版本校验平方级扫描，但仍未实现磁盘分页/索引/归档和全需求收口，P7未放行；不得把旧首批P6未实现记录或“无真机”当新的停止理由。

后续覆盖：P7已实现真实加密历史分页/索引/归档、备份正文展开与逐页改密，详细[接续检查点](../docs/20261029-kanata-p7-archive-checkpoint-v1.md)覆盖上段“未实现分页”。完整check518 Node/335组件、生产Web/Android归档功能已实跑；容量/完整需求收口仍No-Go，未提交。禁止把这些子集证据当整个P7完成；用户持续要求继续，不因没有真机或已有检查点停工。

当前继续入口仍P7归档检查点的最新覆盖节：完整check526/340，APK8526实际Android608消息的分片冷载/真实改密/压缩日志全恢复6项通过，原生8通过1跳过。Web100k真实全流程时限完成但峰值1140MiB超768，P7仍No-Go；最新bulk/assert性能改动尚未重打APK/重测容量，Android大图及其余需求差距未完成。不可将该检查点当暂停请求，用户持续要求继续。


2026-10-30继续覆盖：P7仍No-Go，最新533 Node/347组件完整check通过，生产APK cf213dfbf15a689122e7431359956f29111456ac6d7466b055053e0a344972f7。新增目录元数据一次核验/4页有界I/O、消费私有备份工厂/不可变canonical、UTF8与JSON内存优化、分次气泡/立即全部。df旧候选Android10k全部容量门槛通过；Web100k时间通过但RSS1054MiB失败。Android100k诊断只完成导入/冷读后驱动Profiler错误，后续未测；不要冒称通过。最新性能复测和需求缺口继续从[检查点末节](../docs/20261029-kanata-p7-archive-checkpoint-v1.md)接续；不能覆盖main/raw或自动推送/发布。


2026-10-30最新覆盖：P7候选98a1e79，完整check536 Node/348组件，实际原生8通过1跳过；Android/Web 1k/10k容量PASS，100k全流程完成但Web1135MiB、Android625MiB和改密176s超冻结门槛，P7仍No-Go、未提交推送。模拟器已通过实际协调器归还原608合成全备/原凭据，七模块+设置metadata语义一致（Todo CAS自然推进），真实后台明文释放PASS，无挂起任务。读[当前报告](../docs/20261030-kanata-p7-verification-progress-v1.md)和[P7检查点末节](../docs/20261029-kanata-p7-archive-checkpoint-v1.md)继续；不要再重复微调对象拷贝后声称容量达标，内存/改密与原需求缺口仍需实际开发。

2026-10-30后续覆盖：P7最新功能APK cc8af561，548 Node/375组件40文件通过；新建群、单群限额、活动等待/立即回复及自然冷载续接，Web/隔离Android各13检查PASS（7受控尝试/端，0真实模型），原生8PASS/1夹具SKIP。测试后通过实际协调器归还608合成全备并独立验证全部模块/设置及后台明文释放；无未完成恢复/测试。P7仍No-Go、未提交推送；容量98已失败，最新功能候选未重跑三档。接续优先密集来源/100k内存和改密、旧生活提醒角色链、全应用统计/趋势、完整十五场景。读P7检查点末节及20261030进度/需求增量；此为安全接续，用户没有请求暂停。

2026-10-31继续点：P7源码已增加逐页改密验证复用、字节兼容的原生AES计算、绑定prepare摘要的日志回滚图内存释放。557 Node/382组件完整check通过；生产9411037/78资源，Web/隔离Android各13检查PASS。最新两端三档容量正在顺序运行（exec9921），设备可能为100k合成样本；先查20261031-kanata-p7-performance-checkpoint-v1.md及QA结果，禁止同时安装/驱动/清数据。原608全备已保存在既有受控加密文件，序列会用实际协调器归还。全部结束后补原生/逐模块基线/后台释放/扫描。第一版62d容量失败已保留；P7未完成/未提交推送，不能以缺真机或Key停工。

2026-10-31云端交接最终覆盖：用户明确要求普通推送Kanata并附交接，后续云端开发，本地业务停止。读取docs/20261031-kanata-cloud-handoff-v1.md及最新verification-summary-latest.json。P7仍No-Go：941完整check565/382、原生8PASS/1SKIP、两端各13回归通过；两端1k/10k通过，100k Native内存501.7MiB通过但改回凭据148.1s失败，Web834.9MiB失败。原始漏判PASS已保留并校正。全部测量/恢复已结束，原608与其他模块保全，TodoCAS递增/原规则跨日心情空占位单列严格核验，真实Home清明文PASS。没有待接续的本地测试事务，不要按前文RUNNING重启。云端仍需处理性能、密集来源、旧生活AI角色链、全应用统计/趋势与完整十五场景；Key/SDK/AVD/真实数据不入远端，隔离guard保留。提交是WIP授权交接，不代表P7验收或发布。

M2持续入口（2026-11-09）：[完整任务书](../docs/20261107-kanata-sqlite-m2-task-v1.md)、[设计](../docs/20261107-kanata-sqlite-m2-design-v1.md)、[正式阶段报告](../docs/20261107-kanata-sqlite-m2-acceptance-v1.md)。Preflight/设计已完成，M2生产实现尚未开始，生产仍legacy，M3不得开始。用户已选择此前Windows/WHPX合成AVD作为接续环境，见[交接](../docs/20261109-kanata-sqlite-m2-windows-handoff-v1.md)；仅历史设备名不构成当前合成隔离凭证，需重新核验。

M2 Windows 接续已通过（2026-11-09）。[最新验收 v2](../docs/20261109-kanata-sqlite-m2-acceptance-v2.md)覆盖候选 Driver、消息/会话、派生失效、UI 与真实原生故障。普通构建保持 legacy，原生 SQLite 激活限显式合成 QA 包。M3 可实施剩余领域 Repository。真实资料切换继续受 M4–M7、全局改密/恢复和迁移验收约束。旧 Linux 阻塞和 P7 容量 No-Go 仍可追溯。

2026-11-09 M3 接续入口为 [M3 验收](../docs/20261109-kanata-sqlite-m3-acceptance-v1.md)和 [QA](../docs/qa/kanata-sqlite-m3/README.md)。M 的 004 追加命令回执、归档标记与领域约束。已确认世界可逆归档、按预览批量处理因果后续并保留独立 Effects、原消息 ID + revision 精确追溯。候选范围仅限合成启用。生产为 legacy，M4–M7 及 P7 门禁按总计划执行。

2026-11-09 M4 工程检查点为 [阶段验收](../docs/20261109-kanata-sqlite-m4-acceptance-v1.md)与 [QA](../docs/qa/kanata-sqlite-m4/README.md)。M 分支隔离候选已有有界聊天、工作区摘要、授权与自治窗口，并通过已接线场景的真实 Android SQLCipher 验证。继续按验收中的缺口完成候选管理、深层关联及其完整门禁。M4 BLOCKED，M5 NO。生产 legacy 与默认 SQLite false。

2026-11-09 M4 补齐接续见 [验收 v2](../docs/20261109-kanata-sqlite-m4-acceptance-v2.md)与 [Completion QA](../docs/qa/kanata-sqlite-m4/completion/README.md)。消息与共享记忆深链、事件分页及部分管理界面已有实测。M4 BLOCKED，M5 NO。保留原始验收和生产 legacy/default false。


2026-11-10 M4 当前续作入口：[M4 剩余缺口续作任务书 v1](../docs/20261110-kanata-sqlite-m4-continuation-task-v1.md)。M 分支远端接管基线 428b7bcfeffe2722e72b4809a6d1a82b5734aeb1；M4 BLOCKED、M5 NO。当前实施和实测见 [续作验收 v3 检查点](../docs/20261110-kanata-sqlite-m4-acceptance-v3.md)。GROUP-01～05 已有候选 UI/Repository/Android 证据；完整 A–G、兼容链路、生命周期与 G1–G11 尚待关闭。生产仍 legacy，普通 Android SQLite 激活位 false；不得迁移真实数据或提前实施 M5/M6/M7。

2026-11-10 最新入口为 [M4 收尾验收 v4](../docs/20261110-kanata-sqlite-m4-acceptance-v4.md)。候选提示词逐页编码精确来源且在现有预算内保留原 JSON，仍须验证宽授权标签、A–F 其余操作、历史扩展引用、全生命周期与两轮全范围复核。M4 BLOCKED，M5 NO。


2026-11-10 M4-R 最新接续入口：[M4-R 最终收尾任务书 v1](../docs/20261110-kanata-sqlite-m4-r-closeout-task-v1.md)。M 分支已核验基线 d1737e7d598a14ec3f3ef1febd0bf8be050edbe2；M4 BLOCKED，M5 NO。以 [验收 v4](../docs/20261110-kanata-sqlite-m4-acceptance-v4.md) 和 [closeout QA](../docs/qa/kanata-sqlite-m4/closeout/README.md) 为最新证据。首要阻塞：Android API 34 / SQLCipher 4.17.0 的 10k 宽事件确认在现有 420 秒 deadline 超时；主机 10k、Android 1k 已通过但不可替代。G4 普通聊天 readFor→readMemory→sourceRefs[] 路径已关闭，生活授权标签、事件/消息 provenance 和旧兼容导出仍缺整链上界。GROUP-01～05 与 G10 有既有 PASS 证据，不重复施工，受影响时才回归。生产仍 legacy，普通 Android SQLite 激活位 false，Schema 001–004 checksum 不变；不触碰真实数据、不调用真实模型 API、不实施 M5/M6/M7。

2026-11-10 M4-R MR0/MR1 已通过。实际接管为 c4ba18911c705c5efde7f7614171659f056e2f1e。[M4-R QA](../docs/qa/kanata-sqlite-m4/m4-r/README.md)保留 420 秒基线超时及修复后的综合 10k、强停和逐项审计。生产边界仍为 legacy/default false/Schema 001–004 校验和冻结。MR2 及后续待继续，M4 BLOCKED，M5 NO。

2026-11-10 MR2 定向切片见 [M4-R QA](../docs/qa/kanata-sqlite-m4/m4-r/README.md)。回复链的记忆详情与精确来源授权已在 SQLite 内核验。普通聊天宽标签、事件/消息完整来源及旧兼容仍待处理。M4 BLOCKED，M5 NO。

2026-11-10 MR2-G4 续作入口为 [本轮验收](../docs/20261110-kanata-sqlite-mr2-g4-acceptance-v1.md)。候选聊天使用轻量 transcript 和 SQLite 回复标签工作表，嵌套精确引用纳入归档保护。旧事件、消息及任务 DTO 和完整故障矩阵待闭环。G4 BLOCKED。

2026-11-10 [MR2-G4 事件来源验收 v2](../docs/20261110-kanata-sqlite-mr2-g4-acceptance-v2.md)记录候选事件命令 ID 回执、事务内保序来源去重、普通提交/修正的 SQL 路径。旧完整事件与审计 DTO、异常历史 action 和全量故障矩阵仍有缺口。MR2/G4/M4 BLOCKED，M5 NO。

2026-11-11 事件读取与旧兼容切片见 [MR2-G4 验收 v3](../docs/20261111-kanata-sqlite-mr2-g4-acceptance-v3.md)。普通读取用 header、关系/Effect/Audit 页与 JSON 块；完整旧 DTO 显式置于 events.legacy，旧 Runtime 入口置于 legacyEvents。SQL 临时完整性证明只在连接状态与 revision 均未变化时复用，权限仍逐页校验。M4 BLOCKED，M5 NO。

2026-11-11 ER1 当前入口：[BLOCKED 验收 v4](../docs/20261111-kanata-sqlite-mr2-g4-acceptance-v4.md)。候选 Runtime 无消费者 legacyEvents 包装已移除，Repository 回退尚在。用户已确定纯领域为撤销唯一权威，包含 revoked 后代、原始领域数组/Set 顺序和同世界完整数据增量签名；不能证明原数组顺序恢复则 ER1-3 BLOCKED。当前尚无该证明，不回退旧 SQLite 契约、不改 frozen Schema/新增005、不开始M5。ER1/G4/MR2/M4 BLOCKED，M5 NO，生产 legacy/default false。


## 2026-11-11 Kanata SQLite M4 收口管理规则

2026-11-11 最新：用户已批准并完成隔离 Schema 005 三张原序旁表；001–004 checksum 不变，旧缺序号拒绝且不回填，ordinal 数据库级不可普通改删。最终 check 700 Node/402 Vue，API34/SQLCipher4.17 原地 v4→v5、回滚/强停/冷启动及 1k/10k 回归通过；曾引入逐行 count 超时，已按原 420 秒门槛修复，证据保留。普通 APK=false、生产 legacy；005 PASS 不代表 E/G4/M4 PASS，M5 NO。后续从唯一清单 E 继续纯领域撤销消费原序、完整签名/action/G4，不重复申请 005；[本轮 QA](../docs/qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/README.md)。

2026-11-11 后续接管 1042110：同一 v4 声明行不能唯一决定用户要求的领域数组顺序已有真实合成反例，见最终清单 E 与 [接管 QA](../docs/qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/README.md)。473 份既有指纹和同设备/APK/catalog 复核一致；本轮未改业务代码/Schema/Android。最小附加顺序存储方案只在 QA 临时库实验，不是已注册 005 或产品能力。新增 Schema 仍须用户明确批准；M4 BLOCKED、M5 NO，不按历史检查点 PASS 启动后续阶段。

用户已确认 Kanata 采用“工程质量优先，但必须有明确终点”。当前 M4 只按 [最终收口清单](../docs/20261111-kanata-sqlite-m4-final-closeout-ledger-v1.md) 统一推进，不再增加 MR9/ER1-3A 等新工作包。P0 是实际正确性/安全/数据问题，P1 是 M4-R 合同明确要求的强制证据；两者均阻断 M4。只有合同外新需求、无复现依据的理论风险和非必要优化进入 P2。已有 PASS 证据按源码/fixture/设备/APK/catalog 指纹与影响范围复用。M4 必须 G1–G11 全部 PASS；M5 不自动启动，必须等待用户明确授权。当前 M4 BLOCKED、M5 NO，生产 canonical legacy、普通 Android APK SQLite=false、Schema 001–004 冻结。

2026-11-12 接续仍只读M4最终收口清单。005之后的E消费者检查点已实现原序Set遍历/分阶段执行、世界增量签名、revoked no-op及SQL UTF-16 action四路径；主机check709/402和Android定向通过，源码/设备指纹见同一QA的event-consumer-fingerprints.json。旧Facade、长Effect Audit、A–G其余产品与最终综合/生命周期/两轮审查未关闭，E/G4/M4 BLOCKED、M5 NO；继续既有工作，不重问005授权或把切片PASS当M4放行。

2026-11-13接续：仍以M4最终收口清单为唯一索引。E新检查点已移除旧Facade/materializer、提供长Effect Audit分块和不可变阶段前后值审计，主机714/406、同APK/catalog的Android专项/1k10k综合/强停及005升级通过，普通APK实际DEX关闭。完整指纹与失败/修复在既有QA的event-bounded-fingerprints.json；不重跑无影响旧证据，也不将旧APK结果套用到新树。继续G4普通消息/任务及原A–G剩余项；retained Heap、统一生命周期、最终两轮审查未闭环，M4 BLOCKED、M5 NO。005授权持续有效，001–005冻结，生产legacy/default false。
