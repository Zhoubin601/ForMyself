# Kanata P5 实际验收记录

2026-10-28开发，2026-10-29最终复测；分支Kanata，独立工作树`.worktrees/kanata`；基线f91c23c55195c62cffb3685de1db969b2f435367。用户最新“继续吧，继续开发”解除P4暂停点，按连续计划v3继续；不把旧P4推送授权扩展到后续推送/PR/发布。P1–P4已通过，P5最终放行见本文末尾。

## 功能与五项门禁

| v3 P5门禁 | 实现与真实证据 |
| --- | --- |
| 1 幂等记忆、失败保留、源修订 | L0保留，L1策略近期窗口，L2摘要与L3候选分离；成功源revision任务键去重，失败可重试。源修订审计、停用旧回复、派生记忆stale、事件needsReview并重建；删除清空选定消息全部版本正文。Node/真实Store/组件/Web/生产APK验证 |
| 2 事件真值与独立效果 | AI只提记忆候选；事件显式候选确认，闭集版本化Effects。首次字段baseline，撤销重折叠保留独立E2；未知规则/缺baseline拒绝；因果不明需人工决定。修正是新候选，前后审计；静态书不改 |
| 3 三独立权限与撤权 | 先world×instance×module权限，再lazy真实模块投影；remember/share不互相推导。共享接收者另需自身read/remember，不能无share继续转发。生成前后重验，原始/派生/因果祖先缺冗余标签亦过滤；撤权保留用户可管理记录但阻止后续使用 |
| 4 精确绑定与私人知识 | 全局默认、模块覆盖/null/继承；失效不按同名重选。私聊/跨世界/群聊隔离，群只能召回本群摘要；私有事件Effects也不泄露到群。普通模块无操作不加载敏感chat，KeepAlive停用和过期清空回复 |
| 5 管理UI/备份/check | 记忆新建/确认/冲突/分享/删除/来源版本，事件提交/预览/撤销/修正，七模块独立授权与绑定。原生产协调器完整备份精确保留来源/审计/baseline/策略/绑定；最终check/Web/Android证据在末尾 |

实际文件逐项见[文件清单](qa/kanata-continuous/p5/p5-files.txt)。主要新增`features/chat/experience/`纯规则与四个管理面板、application/kanataExperienceRuntime及kanataLifeContext/kanataLifeCompanion、共享composable/生活按钮，修改实际七模块页面、聊天源修订/生成上下文与自动整理、类型/契约/严格负向例。无新依赖/锁文件变更、数据库或加密协议变更。

## 第一轮自查：架构、数据、异常、权限

1. **实际复现19通过/2失败**：修订源消息时派生助手回复仍能被用，删除的分享父记忆仍可传播。修复依赖回复停用/审计及parent链active检查；21项复测通过，随后扩展33项。原失败保留core-before-review.txt，未删断言。
2. **事件撤销不能回写旧整对象**：逐路径保存首次baseline，重折叠有效Effects，E1/E2同字段撤销E1仍有E2增量。未知effect版本/缺baseline/不明因果预览阻断；原文修订使事件needsReview并重建，不只改列表。Node与UI真实有向trust从0.06撤到0.03。
3. **遗漏冗余来源标签的导入绕过**：来源由消息→事件→因果祖先→分享链派生；不单信memory.lifeSources。补后续用例中的原文+因果祖先漏标签、私有事件群聊状态、未授权事件参与者用例。提交生活事件核对全部角色参与者，保留private也不能传播给无权角色；L4增量同样过滤。
4. **源版本证明与删除**：replyToRevision防止导入旧回答复活；自动停用回复也审计旧源。显式删除只清选定消息全部版本正文，不承诺其他派生或已有备份被擦除；deleted同源不自动重学。source/body/revision/UI分别验证。
5. **真实Store保存与恢复语义**：请求前running/usage必须成功持久化，失败最新待写保留且provider调用0；会话过期、绑定/授权/生活投影变动拒绝迟到结果。沿既有protectedAccess/restoreCoordinator、schema1可选字段和v13整图恢复，不直调UI底层apply。全check包含既有仓库、主密码/恢复故障矩阵，未修改其协议。
6. **真实投影而非第二份业务数据**：Todo采用canonical todayItems（含已完成）及标注计划定义，未修改CAS/Java规则/共享键。修复todo参数implicit-any，保持strict/负向样例。保存与读取错误不当空记录，read denied连lazy reader都不调用。

## 第二轮自查：需求、交互、隔离与角色

1. **Web真实复现KeepAlive旧回复**：模块离开后仍保留旧角色文本，重新进入断言读到旧回复。修复onActivated/onDeactivated/卸载取消并清text/speaker/watch、请求sequence与target检查；新增3项真实bridge+KeepAlive测试，Web重跑通过。没有把敏感角色回复写进普通模块缓存。
2. **同群摘要与其他私聊隔离**：允许本群有来源证明的摘要在本群召回；其他群不能拿到它。私有事件不只隐藏summary，连mood/relationship效果也隐藏，避免间接知识泄漏。上帝管理不是NPC权限开关；双视角完整产品留P6。
3. **人工整理可用与水位**：自动关闭仍可手动force；成功同源不再计费。修复32条滚动窗口之外的旧消息被误算“新消息”，一条普通新消息不会立刻再提取。压缩坏JSON保L0/旧有效L2，页面显示可重试错误。
4. **真实模型逐条审核**：用户指定外部Key后，仅三次合成DeepSeek交流。提取偏好、玩笑和未确认推测性质正确；摘要保留否定与猜测；星野准确引用合成待办并保留轻松但有底线的口吻，没有替用户完成任务。记录2984输入/712输出/256缓存命中Token；非账单。live-results的原AWAITING状态不擅改，独立live-quality-review.json为人工审核PASS；有限样本不代表普遍无误。
5. **断言和驱动错误与产品区分**：初版组件测试对未连接DOM直接click无法submit，改真实form submit，未删业务断言。live离线验真误要求“未”字，而真实摘要为“没有确认喜欢晨跑”，保留失败并按实际否定句核对，无新联网。新隐私例撤权后唯一历史被正确过滤，补普通当前问题验证上下文，而非放行无权原文。
6. **布局与生命周期**：375×812/812×375/1024×768，16/32px字体，三tab共18组节点不溢出/按钮至少48px，reducedMotion。Web过期清preview和snapshot；原生冷重启、后台锁定、所属dialog过期实际检查。新AVD一次未boot、一轮因Google字体提供程序依赖退出终止App，保留日志/系统exit-info后等待新空白系统初始化，再测，不改guard或删真实数据。

## 实际命令与结果

证据：[p5目录](qa/kanata-continuous/p5/)。命令均在Kanata工作树实际执行，退出与数量以日志/最终JSON为准。

| 命令 | 实际结果 |
| --- | --- |
| node --test tests/kanataExperience.test.js | 初次19通过2失败，修复后21；最终33通过，core-shared-event-final.txt |
| npx vitest run tests/KanataExperienceRuntime.spec.js | 12通过：真实Store/保护桥接/保存失败/授权改变/源变化/无Key/备份 |
| npx vitest run tests/KanataExperienceView.spec.js | 6通过：记忆确认/源审计/错误/三权限/事件/删除 |
| npx vitest run tests/KanataLifeLifecycle.spec.js | 3通过：KeepAlive、迟到响应、过期清理 |
| npm run check | 最终退出0，Node488/488、Vitest273/273（30文件），strict/生产build通过；lint0错误/41警告（保留未作为通过依据），check-final.txt |
| node docs/qa/kanata-continuous/p5/verify-web.mjs | 最终退出0，12检查/18布局、pageErrors0，web-results.json；新Chrome context+受控provider，不冒充真实模型 |
| node …/p5/verify-live.mjs（用户指定外部Key文件） | 退出0，3真实HTTP；live-results.json保留原候选审核状态；仅合成内容 |
| node …/p5/validate-live-results.mjs | 最终退出0，live-quality-review.json；离线验真+人工审核已有结果，0新增HTTP |
| pwsh -NoProfile -File scripts/start-kanata-qa.ps1 -NewRun | 仅任务AVD，旧合成磁盘原位保留；Windows PowerShell5误处理ADB stderr的一次失败另留，不使用用户AVD |
| npx cap sync android | 退出0，cap-sync.txt；生成文件无实质语义差异 |
| android/gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest | 退出0，android-build.txt；JDK21/API34，237任务；JVM仅原算术样例，不当业务验收 |
| pwsh …/scripts/verify-kanata-apk.ps1 -Output …/p5/production-build-verification.json | 71资源SHA一致、无QA第二入口；最终APK SHA见JSON |
| node …/p5/verify-native.mjs | 最终结果见native-results.json/native-final.txt；合成Android14/WebView113，实际生产Store/文件/加密/完整协调器。早先两轮PASS快照不充当最后加固版本证据 |

最终设备UI完成后已独立执行AndroidJUnitRunner，退出0，实际8通过/1项Assume跳过，instrumentation-direct.txt；不能把OK(9 tests)写成9个通过，TodoWidgetHarness未启用专项fixture是Assume跳过。Gradle connected的历史UTP宿主依赖局限保留，没有冒称本轮connected成功。

## 安全、兼容与仍未覆盖

raw不改，主工作树main既有64行文档修改、APK删除和未跟踪资料全部保留；本阶段只Kanata。外部真实Key只在测试进程读取、从不回显或写文档/测试，原桌面文件不改。新角色数据沿既有加密仓库和恢复协调器；v13新增字段整图备份恢复，v1–v12非聊天兼容继续以既有实际回归为证据，旧聊天不进入彼方。没有真实设备清理、新数据库、常驻服务、官方媒体或公开分发。

完整需求增量见[P5覆盖](20261028-kanata-requirements-through-p5-v1.md)。P6自治/虚拟日程/主动联系/本地通知/双视角未开始；旧通知个性化链未升级。P7真机/生物识别/厂商后台、容量/真实分页/预先阈值、长期模型质量与IP公开分发许可未通过；不以当前全量JSON支持100k。通用旧模块所有历史AI统计尚未聚合，模型特定Token动态预算亦有限。

## 最终门禁结果

P5 PASS/Go。最终check退出0：488 Node、273组件（30文件），strict/build通过；Web12检查及18布局通过，生产Android16检查通过。最终APK SHA256 `74efc43607b963ae8de19f45885b3d68c962c157bbecefdfc9cb5879e6d5b363`，71资源匹配，无QA入口。独立原生8通过/1夹具跳过。真实模型3次合成请求质量审核通过。真实Key精确扫描结果见credential-scan.json，原始资料未改。结束HEAD由包含本报告的Git checkpoint记录；不自动推送，继续P6。

接续补充自查：明确分享的事件记忆此前被接收角色的事件参与者检查挡住。修复仅对显式分享副本开放经审核的事实，仍不开放源私有事件历史；新增真实上下文断言，最终33领域用例通过。2026-10-29重建后重新运行全部Web/生产APK/原生回归，无沿用旧APK结果。
