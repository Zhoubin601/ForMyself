# Kanata P4 实际验收与暂停交接

日期2026-10-28（北京时间），开发分支Kanata，工作树`.worktrees/kanata`。前置P2本地c543d52与P3 c52ddd4已通过；P1 dd9c912已有验收。用户最新授权为“继续P4，完成后推送暂停”，覆盖早先P3暂停指令，不授权P5、main合并、PR或发布。

## 功能及五项门禁

| 连续计划v3 P4门禁 | 实际覆盖 |
| --- | --- |
| 1 五私聊、群聊@、speaker、不循环 | 五实例独立真实speaker；精确@含别名优先，未知/歧义拒绝；最多两位按兴趣及最近参与选择，其他可沉默；每用户轮次只遍历一次候选，不递归模型循环 |
| 2 切换/Abort/Retry/知识权限 | 页/世界/会话卸载取消；固定目标与源消息、会话revision、实例revision、实际上下文重新核对。只当前会话、本角色卡及有权静态书；其他角色消息以有署名的user上下文呈现，不混成当前assistant；重试不复制用户或已完成角色 |
| 3 日常/RP、短句、气泡 | 会话模式持久化，不清人格/关系；600ms连续短句合一轮；日常自然段最多4气泡，RP保整段；每位角色整组原子保存；0/2/5/15秒前台等待可停止 |
| 4 每attempt用量与费用 | 每HTTP先pending、结束同ID更新；SSE/JSON真实usage、缺失null/保守估计独立，回退与截断各次单列；超时/失败/Abort安全代码。官方人民币峰谷及缓存区间，版本和来源；未知模型/服务不套价格，无Key或错误正文入事件 |
| 5 五人质量及回归 | 用户明确提供桌面测试Key后真实DeepSeek两轮合成测试，最终八组对话与九次真实usage（含一次截断重试），人工逐条审核。完整check、Web/生产APK、备份/生命周期回归见下文；结果以JSON及命令为准 |

read基础采用lazy reader先检查world×instance×module，群聊额外share；P4不读取实际生活Store、不提供授权/绑定/撤权UI，留P5。新界面使用既有主题、反馈选择和导航；输入/定时器/弹窗/返回处理/临时流式预览均随会话卸载清理。没有强建小暖或迁移旧聊天。

## 第一轮自查：架构、数据、异常、权限

1. **计费记录不能吞掉回退/失败**：详细AI接口独立于旧字符串接口，异步onAttempt是必需契约；pending保存成功才发请求，同ID只终结一次。SSE末尾usage-only chunk、兼容JSON返回、缺失usage、超时、取消、回退415及截断重试均有行为测试。部分流中断不自动重演，重试最多一次。真实模型也确实发生一次截断，其失败与成功请求均保留真实usage。
2. **半组气泡重试一致性**：逐条保存时若中途取消，第一条complete会让重试误跳过角色。改为每角色整组原子Store.update；同batch/replyTo，保留已完整角色，失败草稿走原保存重试，不自动二次计费。实际Store测试验证源消息保存失败时模型调用为0、最新待写仍保留。
3. **等待时上下文过期**：仅目标ID不足以防身份/世界书变化。模型返回时再次比较实际上下文和revision，源用户轮次变化、身份变化、切世界、失效owner均拒绝落库；测试验证旧响应不能写另一个目标。
4. **共享规范与严格接口**：初版native select被既有UI契约拒绝，改用appChoose，不删断言或放宽正则。加入Completion DTO、KanataChatRuntime与strict负向例；修复unknown错误码读取及Pinia递归类型边界，使用显式可注入Store port，无关闭strict。
5. **数据兼容**：schema1只增加可选usageEvents；无此字段旧图仍可读。校验ID/作用域、角色成员、状态与时间、安全码、非负真实计数。沿原加密、仓库、全备v13及协调器；没有改数据库/加密/旧v1–v12分流。

## 第二轮自查：实际需求、交互、隔离、角色

1. **真实群聊过度复述**：第一轮真实结果两人都先留校，绫音复述白子安排，未形成足够独立观点。保留live-before-group-review.json，补“先独立判断、不自动同意、不复述同伴”的群聊约束；重测骑行与资料整理的合理取舍。白子优先骑行，绫音明确优先留校，指出体力消耗后的核账风险并保留条件，没有为反对而辱骂/强制恋爱。
2. **实际五人边界**：星野先确认会议事实并保留保护同伴底线；白子短句/路线/训练；野宫温和但有判断；芹香不猜金额、指出临时兼职的局限；绫音整理职责并明确无权看真实待办。白子拒绝猜测星野私聊秘密，未泄漏合成marker。所有素材和问题均合成，不使用用户生活资料。
3. **聊天打开位置**：目视截图发现打开底部会话后沿用长世界页滚动，可能看不到对话标题。修复进入聊天置顶、回世界恢复滚动；最终Web截图与升级检查核对。
4. **设备驱动与产品语义区分**：后台rAF轮询暂停，以及冷启动读取安全凭据的原有500ms native Activity guard，会影响立即Home测试。保留两次失败JSON；不改产品锁定规则、不重置guard。驱动等待750ms让既有保护结束，后台用100ms轮询，检查实际snapshot释放而非只看锁屏。
5. **短句测试时序**：模拟器顺序CDP往返可能超过600ms，变成两个正常用户轮次，原“one paid turn”断言失败。保留失败记录，改为同renderer任务分发真实input/submit事件，并实际断言事件耗时小于600ms；Node/组件假时钟验证边界，不延长产品窗口掩盖问题。
6. **真实测试断言修正**：live driver最初错误要求所有attempt都succeeded，将合法截断重试的前一次failed误判LIVE_USAGE_INCOMPLETE。原始FAIL JSON/退出1保留；修正检查为八组交流完成、没有pending且每attempt都有实际usage。validate-live-results单独重验已有真实记录并写人工质量审查，不伪称再次联网、不额外计费。

## 命令与证据

证据目录：[P4](qa/kanata-continuous/p4/)。最终自动化为Node455/455、Vitest252/252（27文件）；lint0错误/37警告，类型/strict负向/生产构建通过。新增19项Node、14项组件/运行时测试。异常stderr为既有故障注入结果，不代表隐藏失败。

| 实际命令 | 结果与文件 |
| --- | --- |
| node --test tests/kanataCompletion.test.js | 初次10通过；SSE/JSON/缺失/回退/截断/超时/取消/先保存/安全HTTP |
| node --test tests/kanataConversation.test.js tests/kanataCompletion.test.js | 初次17通过，后补read和真实双世界测试并纳入最终455项 |
| npx vitest run tests/KanataChatRuntime.spec.js | 初次8通过/1时序断言失败；等待实际进入延迟后再触发过期，最终9通过 |
| npm run check | 最终退出0，check-final.txt；历史native-select/旧入口文案及上述时序失败均保留在initial/integrated日志 |
| node docs/qa/kanata-continuous/p4/verify-web.mjs | 最终退出0，10检查PASS、pageErrors0；新context、受控API验证真实UI和持久化，web-final.txt/web-results.json |
| node docs/qa/kanata-continuous/p4/verify-live.mjs（用户明确指定的外部Key文件参数） | 第一轮八次成功；第二轮八组交流成功/九attempt均真实usage（一次OUTPUT_TRUNCATED），原driver最终断言错误退出1，live-results.json保留；不以模拟API替代 |
| node docs/qa/kanata-continuous/p4/validate-live-results.mjs | 退出0，live-validation.txt/live-quality-review.json：按修正语义验证真实已记录结果及人工审核；没有新联网 |
| pwsh -File scripts/start-kanata-qa.ps1 -NewRun | 仅任务新空白AVD，保留旧合成磁盘；raw与真实设备不改。一次启动未boot就连接报offline，等待boot_completed后重试，不当业务失败 |
| npx cap sync android | 退出0，cap-sync.txt |
| android/gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest | 退出0，android-build.txt，237任务；JVM仍既有样例，不替代功能验收 |
| pwsh -File scripts/verify-kanata-apk.ps1 -Output docs/qa/kanata-continuous/p4/production-build-verification.json | 55资源SHA一致，无QA入口；最终APK摘要见该JSON |
| node docs/qa/kanata-continuous/p4/verify-native.mjs | 新空白合成Android14/API34、WebView113，最终结果以native-results.json及native-verified-final.txt为准；受控API与实际生产Store/Files/加密/全备/生命周期，不使用测试第二入口 |

P3已运行直接AndroidJUnitRunner为8通过/1专项Assume跳过。P4最终原生回归与生产升级结果在同目录instrumentation-direct.txt及production-upgrade-results.json记录，不以Gradle connected的历史UTP宿主依赖缺失冒充成功。未执行项不得由本文推断通过。

## 来源、安全、范围与交接

官方来源读取日期2026-10-28：[中文模型价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、[Chat Completion规范](https://api-docs.deepseek.com/api/create-chat-completion/)。本次按字段自主实现，不复制第三方业务实现或新增依赖。官方价格为每百万Token，Flash峰段缓存命中0.04/未命中2/输出8元，Pro为0.30/9/27元，谷段半价；缺少节假日历时显示区间。已配置旧模型和自定义服务保留，无法对应当前价格时明确未知。

用户明确提供桌面Key文件后才做真实联网；Key只在测试进程内读取，没有回显、写入源码/日志/夹具/备份或拷进项目，原桌面文件未修改/删除。变更及未跟踪交付文件对真实Key的精确字节扫描0命中。设备/Web用合成Key，真实模型用公开人设与合成问题，不读取用户私人资料。

完整文件路径清单见[p4-files.txt](qa/kanata-continuous/p4/p4-files.txt)，包括源码/类型、测试、文档、驱动及失败/成功证据。主要新增application/kanataChatRuntime、KanataConversationView、domain会话/read权限/费用、platform/ai详细接口与DTO；修改原AI出口、管理入口、可选领域类型/校验、样式、契约、旧入口测试。保留main的64行文档修改、APK删除与未跟踪资料。

需求逐项结果见[P4覆盖增量](20261028-kanata-requirements-through-p4-v1.md)，与P3全表共同组成当前完整覆盖。P5长期记忆/因果/生活联动、P6自治/通知/双视角、P7容量/真分页未实现；真实手机/生物识别/厂商后台与通知、100k/峰值内存、长期模型质量仍未测试。IP分发授权未提供，不打包官方素材、不发布安装包。

阶段最终状态与推送提交以本文件末尾“最终门禁结果”及Git记录为准；未达到最终门禁前不将本稿视为已完成阶段。

## 最终门禁结果

**P4 PASS。P1–P4已通过，P5–P7未开始；按用户授权普通推送Kanata后暂停。**

- 最终check退出0：455项Node、252项组件（27文件），lint0错误/37警告、strict和生产build通过。最终Web10检查PASS；受控API真实生产Android14检查PASS，终态2世界/6实例/32消息/14attempt，完整备份精确恢复消息和usage；没有长期记忆/已发生事件自动生成。
- 最终生产APK SHA256 `37081ce87e5a4a5eedad9e3857484bfeec81f6058919eb79f325af85dc99180a`，55资源与dist一致，无QA入口。升级保图、聊天进入/返回滚动、升级后后台释放3项PASS；production-upgrade-results.json。初次升级驱动等待错误固定滚动值，又与instrumentation运行相互干扰导致Target closed；已按实际按钮滚入位置捕获原滚动，并在原生测试完成后独立重跑通过，未修改业务绕过检查。
- P4直接AndroidJUnitRunner退出0，实际8项通过、1项TodoWidgetHarness因未启用专项夹具Assume跳过，不能写9项全通过；Gradle connected UTP宿主缺依赖仍是P2已记录的环境局限，不冒称本轮已运行成功。
- 真实DeepSeek两轮共17次请求；最终8组交流/9次attempt，包含一次截断重试，均有真实usage，逐条质量审查PASS。原driver误判FAIL及修正后的离线验真均保留。两轮实际11951输入/4097输出Token，依已核实价格区间估算约¥0.023828～¥0.047656，非实际账单；未再为断言重验额外调用模型。
- 原始资料未改、真实设备资料未操作，Key字节扫描0命中；IP授权/真机/长期质量/后续容量及高级全应用统计限制按上文保留。没有合并main、创建PR或发布安装包。
- Git：P2本地c543d5285d21fe556ae2d5cd0867447aa98ba5de、P3 c52ddd4；P4提交hash以包含本报告的`git log -1`为准，推送后用`git rev-parse HEAD origin/Kanata`核对一致。文件清单从实际暂存路径生成，不以手写概括代替。
