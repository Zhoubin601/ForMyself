# Kanata P3 实际验收

2026-10-28，Kanata，前置P2本地提交c543d5285d21fe556ae2d5cd0867447aa98ba5de已PASS。P1已有dd9c912。最新用户指令改为继续P4，P4完成后推送并暂停；本报告只验收P3，不把后续能力写成完成。

## 功能与五项门禁

| 连续计划v3 P3门禁 | 结果与实际证据 |
| --- | --- |
| 1 首次精确计数及重复进入 | PASS：真实生产APK空白合成AVD初始化1世界/5实例/5私聊/1群聊；3次强停重开不增加；消息/长记忆/事件/任务/授权0 |
| 2 五人差异与世界书、来源 | PASS：五人独立anchors/style/interests/boundary，13书=8基础+5私有，10组组织关系落实为20有向边，另5老师关系；官方事实核对见下文；无官方媒体 |
| 3 声明格式导入/错误/往返 | PASS：V1/V2 2.0/V3 3.0 JSON与静态PNG tEXt chara/ccv3；坏CRC/chunk/版本/类型/大小拒绝，源字节与未知扩展保留；原生实际FileChooser与生产全备精确恢复 |
| 4 实例版本/世界隔离/书权限 | PASS：同卡跨世界独立，基础卡新版本锁定旧实例、显式预览同步保留覆盖；复制不带经历；knownBy/owner先过滤再预算，身份单次替换 |
| 5 无Key、UI与安全回归 | PASS：Web12/Android16专项，0模型请求、0页面错误，未生成假历史；check/原生回归/备份通过 |

用户可以创建空白或预设世界、改名/复制/归档，管理身份、实例覆盖、全局卡版本、头像及静态书。当前会话只展示既有实体，真实AI发送属于P4。预设JSON保持独立，catalog提供版本/来源/授权状态；未用统一人格改名冒充五人。

## 第一轮自查：架构、数据、安全、异常

- 前置P2实际原生安全读写与恢复已通过，未跳过云端阻塞。页面修改走application门面、操作租约、sessionRevision双检与Store加载/恢复门禁，不从UI直接写磁盘或恢复。
- 故障复现并修复PNG校验缺口（无效位深/APNG未拒绝）、selective世界书缺少secondary仍可能激活、卡更新可能覆盖未知扩展。失败证据review1-before.txt为3失败；修复后review1-after.txt为24通过。
- PNG添加色深/颜色组合与APNG拒绝；无法识别的critical chunk拒绝。selective无secondary默认禁用并警告。说话习惯使用独立命名空间字段，已有非字符串冲突拒绝，旧未知primitive原值保留。
- 原始书默认角色私有，冲突只能显式跳过，不静默覆盖。纯函数校验分离草稿；持久化失败页面保留待写/错误并走实际retrySave，不把底层吞错当成功。
- schema仍1、全备仍v13；新字段可选兼容旧图；未改加密、数据库、主密码、全局Key或恢复协调器。

## 第二轮自查：需求、交互、隔离、角色

- 发现共享弹窗关闭后仍缓存角色/世界名称；复现review2-before.txt为1失败。新增sensitive/opaque Symbol owner，关闭彻底清内容；组件卸载只取消自己所属对话，不影响新页面弹窗。review2-after.txt为3通过；原生过期时弹窗与管理页均卸载。
- 验证原卡编辑不改其他世界实例、同步保留单实例覆盖、复制重置动态状态与授权。全局归档不破坏已有实例引用。书检索先权限后预算，用户名称不递归解释占位符。
- 文件选择取消/读取后卸载/预览返回不写入；首启未保存不能误报完成，管理中保存失败保留草稿可重试；路由离开释放私有内容并恢复滚动。
- Web375×812、812×375、1024×768各16px/32px根字体六组合无水平越界、按钮至少48px；减少动效；实际Web/Android截图已目视检查。AVD系统时区UTC来自设备配置，不冒充已实现P6时间补算。
- Web首轮驱动误把关系总数当20，实际20队友+5老师，按真实领域类型修正测试为25；保留web-attempt-1失败证据，无产品规则放宽。五人生成对话质量属于P4，未虚报。

## 命令及结果

全部证据在 [p3目录](qa/kanata-continuous/p3/)。使用Microsoft JDK21.0.11、E:/Android/Sdk、任务新空白AVD KanataP2Synthetic34/emulator-5580，Android14/API34/WebView113.0.5672.136。用户旧AVD/私人备份未读取。

| 实际命令 | 结果 |
| --- | --- |
| npm run check | 退出0：Node436/436、Vitest238/238（25文件）、lint0错误/37警告（其中4项新增模板换行风格警告），strict/契约负向样例/生产build PASS；check-final.txt |
| npm run typecheck（新增owner契约后） | 退出0，typecheck-final.txt |
| node --test tests/characterCardImport.test.js tests/kanataManagement.test.js | 修复前3失败、修复后24通过，review1证据 |
| node --test tests/kanataFeedbackPrivacy.test.js | 修复前1失败、后3通过，review2证据 |
| node docs/qa/kanata-continuous/p3/verify-web.mjs | 退出0，12检查PASS、六布局PASS、0pageErrors/0AI；web-final.txt/web-results.json |
| powershell -File scripts/start-kanata-qa.ps1 -NewRun | 核验任务AVD、保留旧合成磁盘原位置，创建新空白目录；没有wipe/卸载/pm clear |
| npx cap sync android | 退出0，cap-sync.txt；生成Gradle文件无语义差异 |
| android/gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest | 退出0，BUILD SUCCESSFUL，237 tasks；android-build.txt；JVM仍既有样例，不称业务验收 |
| pwsh -File scripts/verify-kanata-apk.ps1 -Output docs/qa/kanata-continuous/p3/production-build-verification.json | 55 dist资源SHA一致、无QA入口；APK SHA256 799d48a8f1030de9185d2f64c1859a7bbbace2248d5c5e2fdebb37fdbdd45fda |
| node docs/qa/kanata-continuous/p3/verify-native.mjs | 退出0，16检查PASS、0pageErrors/0AI；生产APK真实文件桥接/加密文件/协调恢复，非P2测试入口 |
| adb -s emulator-5580 install -t android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk | 退出0；安装前任务AVD与应用合成标记双核验 |
| adb -s emulator-5580 shell am instrument -w com.yubin.formyself.test/androidx.test.runner.AndroidJUnitRunner | 退出0、OK(9 tests)：8实际通过、TodoWidgetHarness 1项Assume跳过（专项夹具未启用），instrumentation-direct.txt |

P2的Gradle connected UTP宿主依赖缺失见P2报告，本轮直接运行同一AndroidJUnitRunner，不将其写成Gradle connected通过。原生专项终态3世界/7全局卡/12实例/14会话/27书，无生成历史；生产完整备份v13保留2份导入源与PNG字节并精确恢复全图。强停、后台释放、过期对话清理均实测。

## 来源与版权审查

2026-10-28核对[官方角色列表](https://sh-anime.shochiku.co.jp/bluearchive-anime/character/)及[故事](https://sh-anime.shochiku.co.jp/bluearchive-anime/story/)、规格中的五个人物页。核对的是身份与公开概括特质：星野松弛表层/保护同伴，白子寡言/运动，野宫温和/支持，芹香会计/直率，绫音书记/设备与规则。初始关系、中文摘要和行为偏好是非官方独立改写；芹香兼职不得作为队友自动共有知识。人格差异在数据和静态上下文中核验，实际生成质量尚待P4。

没有下载官方图像/完整台词/第三方卡。卡格式仅参考协议自主实现：V2 spec_v2.md blob cde6a3bf77631ff1f298583d4af8d079e4b21cdb，V3 SPEC_V3.md blob cb9749821955047890ac88aa84ec0b235ae0fb5d，完整URL见source-notes。没有新增依赖/第三方业务实现。**IP公开分发授权资料未提供**，不能把本地开发验收视为获得分发许可。P1预设sourceNotice保留当时审查提示，P3 catalog与本报告记录当前结果。

## 文件与交接

本阶段完整路径清单见同目录 [p3-files.txt](qa/kanata-continuous/p3/p3-files.txt)（包含本报告、源码、接口、测试、文档及合成证据）；Git提交通过`git show --stat`核查。主要新增：application/kanataManagement，KanataView/WorldManager，cards导入器/类型/UI/选择器，domain管理纯函数，lorebook检索/UI，presetCatalog与样式；修改实际入口、契约/类型/校验、Store错误类型、反馈清理及既有入口测试。四过程文档/README/架构规范同步。

原main既有64行文档修改、APK删除与未跟踪资料保留；业务仅Kanata隔离worktree。raw未更改，未读取/删除真实资料。P2旧v1–v12非聊天安全恢复矩阵保持，本阶段新增原卡/头像通过实际协调器全备验证。无推送main/PR/发布。

**P3 PASS。** 后续按用户最新指令继续P4，P4验收后普通推送Kanata并暂停。未完成范围、原始需求逐项与15场景见[覆盖表](20261028-kanata-requirements-through-p3-v1.md)。真实手机/生物识别/厂商通知、100k/真分页/峰值内存、后续生成与自治未测试，不属于本次已通过结论。
