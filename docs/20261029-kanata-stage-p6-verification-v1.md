# Kanata P6 自主活动与视角实际验收

日期2026-10-29；分支Kanata，工作树`.worktrees/kanata`。基线P5 `be9ebc3dbe1a08e14575e044875426f0648c0179`，用户已明确要求先推送后继续完成；本次已普通推送并用ls-remote核对P5远端一致。P6最终放行见本文末尾，不以早先检查点或初轮APK覆盖最终修改。

## 实现及五项阶段门禁

| 连续计划v3 P6门禁 | 实现与证据 |
| --- | --- |
| 1 时间、水位、重试 | UTC半小时窗口，与现实时间1:1；不以本地日期时刻作唯一键，跨日/DST/时区变更/倒退有负向测试。最多六窗口/次、默认最多3小时；较早时段明确记录skippedMs，不捏造全段历史。每窗口经实际Store持久化后才取下一窗口，失败磁盘水位不前进，pending/error门禁阻止继续 |
| 2 关闭、不补算与技术上限 | 世界与角色默认关闭；切换从当前时间继续，不追补关闭期间，归档规则保留。每日完整交流默认0，可配置0–4；0不建NPC完整会话、不调用模型，可保存日程move/rest规则事件。每场2角色/2段、每轮最多2角色补算场景；最多8角色/窗口，按UTC轮转，最多16条规则事件/窗口；每前台tick最多2世界。模型回退仍独立记attempt，技术数量上限不等于费用硬限 |
| 3 社交、日程和群聊一致性 | 重叠虚拟日程拒绝，共同地点/非休息/当前角色位置由代码验证；状态/日程/政策变化作废旧场景。独立character会话无用户；明确选择group才写已有本世界群聊，同一task/resultEventIds/sourceRefs关联，不在世界动态重复演出。有当前用户交流的窗口不再演同一轮。模型只输出自己一段，世界note记录真实对话，不直接改关系真值 |
| 4 三开关、主动、延迟、通知 | 自治/主动联系/本地通知独立；角色另有独立许可。工程默认闲置6小时后排入2分钟待发，本世界每日至多1次；2小时过期取消，新增聊天使待发问候失效。前台恢复检查，不承诺关机AI。手动回复延迟持久化，离页后可恢复、显式取消/重试不重复用户原文；外部备份暂停发送。系统拒绝不丢消息、不被动请求权限；免打扰按世界时区，锁屏通用文案。新通知ID 910000000–910999999、独立channel，未复用旧820M或删除其他模块通知 |
| 5 两种视角与生命周期 | 普通只显示公开/用户参与事件；NPC私人交流隐藏。上帝视角是用户只读管理，可看私有事件和关联NPC对话，不改变角色上下文权限。群聊事件可直接打开同一群聊。生命周期独立注册到createModuleLifecycle，动态加载敏感运行时，不自动认证/解密；后台/过期/dispose释放请求、订阅、timer，恢复才有限推进。Web/Android实际结果另见末尾 |

工程默认可配置：严格/标准/自由/完全自由保留核心人格和隐私；默认严格，完整社交0，免打扰22:00–08:00（起止相同表示关闭免打扰）。当前时间精度为半小时规则抽样，不表示每秒连续执行；没有显式虚拟日程就不编造活动。通知采用已生成消息后的即时本地提示，无后台AI；dispatching先持久化，发送中断不补发旧锁屏通知，已保存消息仍可读。

## 真实修改文件与接口

- `features/chat/autonomy/`：autonomyValidation、kanataAutonomy、kanataSocial、kanataContact、KanataActivityPanel。纯规则不导入Store，模型无事件真值写口。
- `application/`：kanataWorldRuntime、kanataSocialRuntime、kanataContactRuntime、kanataDeferredRuntime、kanataActivityLifecycle；现有kanataChatRuntime加入可选persistDelay与cancelDeferred；contracts重导出真实ReturnType。
- 现有WorldManager增加入口/关联群导航，ConversationView延迟任务状态与取消；useAppController只增加生命周期参与者组合，不增加逐模块启动/保存分支；platform/kanataNotifications是可注入独立平台适配。
- schema1可选autonomyPolicies/virtualSchedules、task.simulationWindow/social/contact/deferredReply；P5旧图仍可读。没有新增数据库、加密协议或存储键，full v13及旧v1–v12非chat策略不变。备份已存在pause-sending-v1覆盖reply/proactive导入，不让恢复自动重发。
- 新增13项领域规则；真实运行时/组件测试覆盖world5、social11、view3、contact9、notification4、lifecycle5、deferred7；完整检查包含所有既有安全/恢复测试。完整实际路径清单最终见qa/kanata-continuous/p6/p6-files.txt。

## 第一轮自查：架构、数据、异常、安全

1. 失败待写草稿的内存水位不能当磁盘成功：运行时明确检查saveError/hasPendingSave，真实Store故障测试验证磁盘水位旧值、磁盘task0、内存待写task1，下一次advance拒绝；不吞错或空覆盖。
2. 场景生成过程中角色移动/日程/世界规则/公开知识变化：保存前重比场景状态与每个角色实际prompt。新增一位角色完成后移动的测试，拒绝旧场景，使用记录保留、不保存半段聊天、不自动重演计费。失败场次同样占每日技术上限。
3. 首个世界失败会让后续世界饥饿：改每世界异常隔离、游标先推进；生命周期测试证明独立world b仍运行。锁定/未加载不调用lazy load，迟到import释放，后台flush取消模型且timer不继续工作。
4. 主动问候排队后用户已发新消息：原实现会继续问候，补recent-message失效检查和测试；关主动立即取消待发，2小时过期与DND拒绝生成。通知先保存dispatching，不把中断当作重发资格；平台拒绝仍保存实际消息。
5. 延迟回复原先只前台等待：新增持久化任务和独立恢复执行器。准备租约结束后再调用串行chat.send，不嵌套runOperation造成死锁。旧源/新发言/过期取消；外部备份pause；显式取消后显式重试复用同源task，不复制用户。中断的running租约过期变为可观察failed，不自动再次计费。
6. 配置/任务可选字段整图校验、跨世界/孤儿/通知ID冲突拒绝；虚拟日程先全行校验再作冲突比较，坏后行不抛不明TypeError。通知新命名空间经核对避开旧温馨小家820M范围。strict负向例保持，无放宽规则。

## 第二轮自查：需求、交互、隔离、实际角色

1. 三轮真实DeepSeek两人场景共6次HTTP：首轮补造“待了一下午”且带日常模式括号动作，人工判FAIL；第二轮过去经历已约束但因日程活动未进入prompt，白子改谈骑行，判PARTIAL。补当前时间、禁止虚构过去、日常短句和双方明确活动后，最终星野提搬重书，白子给分类/搬运顺序。保留两轮原始JSON及最终人工审查，不改早期记录、不额外联网来重验断言。
2. 用户原文没有被模型或任务伪造：NPC两段均assistant/真实speaker；主动任务virtual prompt不落用户L0；延迟重试只有原先一条用户发言。Web与实际生产APK均检查，不以模拟回复冒充真实模型质量。
3. 需求复查发现现有群聊自主场景路径缺失：补显式private/group选择、已在交谈窗口抑制、原群写入及同事件跳转；group收件角色逐项检查生活来源权限。普通视角不因可看动态而获得NPC私聊原文。新增11项social测试与跨世界Web/原生场景；不把首轮仅私聊APK宣称为最终版本。
4. 显式取消的延迟任务再次点击重试曾仅显示排队却不重置cancelled：修复只允许用户显式重试重开同源任务，新增真实Store断言；被动恢复不重试failed/cancelled，也不恢复外部备份暂停发送任务。
5. 用户界面沿现有主题/48px按钮、AppTimeField/appChoose/所属dialog与back handler；普通/上帝切换清只读私聊内容。Web横竖/1024宽、16/32px字体六组检查，无横向越界；reducedMotion截图已目视。驱动截图URL转路径曾编码空格，改fileURLToPath并将自建截图归位。

## 真实命令与证据

工作目录为Kanata工作树。证据统一`docs/qa/kanata-continuous/p6/`。原始失败文件保留，最终门禁只取最新对应源码/生产APK。

| 实际命令 | 结果 |
| --- | --- |
| git push origin HEAD:Kanata；git ls-remote origin refs/heads/Kanata | P5已普通推送be9ebc3并核对一致，未推送main/强推/发布 |
| node --test tests/kanataAutonomy.test.js | 初次10，复查12，最终13领域用例；含上限、时间/日程异常；DND执行另在contact测试 |
| npx vitest run tests/KanataWorldRuntime.spec.js | 初次4通过1测试适配器命名错误，按真实backup入口修正后5通过 |
| npx vitest run tests/KanataSocialRuntime.spec.js tests/KanataActivityView.spec.js | 最终11+3通过，group-review.txt；源类型收窄TS18048已用窗口局部常量修复，后续check验证 |
| npx vitest run tests/KanataActivityLifecycle.spec.js tests/KanataContactRuntime.spec.js tests/KanataNotifications.spec.js | 定向17通过；后续contact加新聊天取消共9项，纳入最终check |
| npx vitest run tests/KanataDeferredRuntime.spec.js | 初版5，再补显式取消重试/中断租约，共7项，纳入最终check |
| node docs/qa/kanata-continuous/p6/verify-social-live.mjs（用户外部Key参数） | 三轮共6实际请求；最终social-live-results.json保持AWAITING，另social-live-quality-review.json人工审查PASS；0私人资料 |
| npm run check | 实际多轮，最终check-final.txt与后加strict样例的check-contracts-final.txt为准；不能以中途数字覆盖最终 |
| node docs/qa/kanata-continuous/p6/verify-web.mjs | web-group.txt/Web JSON：最终12流程及6布局，冷重载精确图，受控provider；最后原文/群聊代码变化后结果须复核 |
| pwsh -NoProfile -File scripts/start-kanata-qa.ps1 -NewRun | 只任务空白AVD，旧合成磁盘保留，未用用户AVD；boot完成后等首次Google字体provider初始化，避免P5已复现的依赖退出 |
| npx cap sync android | cap-sync.txt；正常生产build，无QA第二入口 |
| android/gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest | android-build.txt；JDK21/API34，JVM仍仅既有算术样例，不能代替业务验收 |
| pwsh -NoProfile -File scripts/verify-kanata-apk.ps1 -Output docs/qa/kanata-continuous/p6/production-build-verification.json | zip内每资源SHA与dist对应，无QA入口；最终摘要见JSON |
| node docs/qa/kanata-continuous/p6/verify-native.mjs | 最终native-final.txt/native-results.json为准。首轮15检查PASS快照另存native-before-group-review，不代替最终group代码。真实LocalNotifications调度、生产文件/加密/恢复协调器、冷启动/后台/所属dialog均有场景 |

AndroidJUnitRunner须在最终UI驱动结束后单独跑，避免Activity相互打断；实际8通过1 TodoWidgetHarness Assume跳过，若未执行本轮不能引用旧轮。Gradle connected历史宿主UTP依赖问题不被写成本轮通过。

## 边界、兼容与下一阶段

主密码/平台加密协议未改，新可选字段沿既有仓库/备份协调器往返。旧v1–v12非聊天恢复继续保留，旧聊天不能回流；外部备份不自动恢复sending tasks。没有真实旧聊天删除或真实个人设备读写，main原64行文档修改、APK删除与未跟踪资料保持。Key只在六次合成请求进程读取，不拷进应用或仓库，最终字节扫描另留证据。没有官方媒体、新服务、合并main、PR或安装包发布。

P7尚未验收：用户已明确允许raw所指本地隔离模拟器完成本轮设备验收；真实手机/生物识别/厂商后台作为范围局限记录，不再以缺真机阻断本轮。当前仍全量JSON，1k/10k/100k冷启动、真分页/索引/归档、备份改密峰值内存和预先性能阈值必须另验，不能由本阶段推断通过。长期自治质量与公开IP分发授权也不由有限样本证明。

## 最终门禁结果

P6 PASS/Go（2026-10-29）。完整check退出0：501 Node、317组件（37文件）、strict/生产build通过，lint0错误42警告；后加contract负向例再跑完整check-contracts-final同样通过。Web12流程/6布局通过；最终生产Android17流程通过，包含真实系统通知允许/拒绝、完整备份、冷启动、后台释放和dialog失效。APK SHA256 `4dac23ad45a013e320d145441e609fc3e01af60e648c3c248bdaa07c8d597e7a`，79资源与dist一致，无QA入口。独立原生8通过/1夹具跳过。六次合成真实模型请求最终质量审核PASS；凭据精确扫描见credential-scan.json。允许进入P7；P7容量/分页与需求收口尚未通过。

最终设备补充：先做POST_NOTIFICATIONS系统撤权验收（消息仍保存），再跑原生Todo回归时，其“通知已开启”前置断言失败。保留instrumentation-permission-precondition-failed.txt；恢复任务AVD通知权限后独立重跑，8实际PASS/1 Assume跳过，未修改Todo源码/断言。am instrument退出码可能为0而测试FAIL，本轮同时核查输出结果，不以退出码冒充通过。
