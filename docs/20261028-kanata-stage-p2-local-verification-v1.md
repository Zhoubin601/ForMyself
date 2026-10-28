# Kanata P2 本地设备接续验收

日期：2026-10-28（北京时间）。基线：Kanata `e4b46efdfbbdff3cfc35e6577d5058810306035e`。此前 P1 `dd9c912` 已验收，P2 云端交接为 BLOCKED。本记录补实际本地验证，不重新执行 P0，也不跳过 P2 开发 P3。

## 环境与资料保护

- 原工作区 main `41cbb66` 的四文档修改、APK删除和未跟踪资料保留。开发在 `.worktrees/kanata` 的 Kanata 分支，未覆盖或暂存 main 的内容。
- 依序阅读 AGENTS、架构规范、连续计划v3、五人预设规格v1、clean-start-v2、raw需求与四过程文件及本地交接。只读解析原工作区 `raw/Android - 快捷方式.lnk`，目标 `E:/Android`。未读取真实私人备份。
- SDK `E:/Android/Sdk`，完整 Microsoft JDK 21.0.11，WHPX。AVD 为本任务新建空白 `KanataP2Synthetic34 / emulator-5580`，Android 14/API34，WebView 113.0.5672.136；未复制用户userdata。每轮磁盘在 `.kanata-device.local/avds/` 独立保留，不清数据、不卸载真实App。
- Git未推送、未建PR、未合并main、未发布安装包。测试包仅在本地合成AVD安装，不能用于分发。

## 实际修复与验证入口

生产修复：`src/features/chat/storage/kanataRepository.js` 对 Android Filesystem 的明确“目录已存在”码 `OS-PLUG-FILE-0010` 作兼容。此前目录已存在时初始化写入失败，界面保留未保存状态；没有伪造成功或覆盖为空。权限码仍失败，保留待写及错误。

新增专用构建 `scripts/build-kanata-native-qa.mjs`、设备创建 `scripts/start-kanata-qa.ps1`、身份门禁 `scripts/kanata-device-guard.mjs`、负向测试 `tests/kanataDeviceGuard.test.js`；新增原生驱动及测试专用第二入口位于 `docs/qa/kanata-local-20261028/`。同一 Vite 图中调用真实生产 Store、原生插件、全备运行时与加密恢复日志。普通 build/check 不包含第二入口。Web驱动新增 `KANATA_QA_OUTPUT`，避免覆盖云端历史证据。package/README/架构规范同步记录新命令。

## 第一轮自查：架构、数据、异常、安全

1. **真实Android保存失败**：设备确认初始化报 `KANATA_SAVE_FAILED`。从已安装依赖的 `FilesystemErrors.kt` 核实0010语义；新增回归先22过/1失败，再兼容明确码后23/23通过；权限码0007仍拒绝、旧主文件不变。证据：[失败](qa/kanata-local-20261028/repository-before-directory-fix.txt)、[修复后](qa/kanata-local-20261028/repository-after-directory-fix.txt)、[设备现场](qa/kanata-local-20261028/native-before-directory-fix.json)。
2. **驱动误连风险**：仅 `emulator-*` 不足以证明隔离。身份门禁同时检查任务清单、AVD名、指定序列号、允许的绝对目录及synthetic标记，错误路径/其他AVD/物理序列号/false标记均被负向测试拒绝。ADB的CRCRLF只规范化换行，不放宽身份匹配。
3. **测试入口隔离**：测试入口需要原生Android与任务标记双重核验；只由显式第二入口构建打包。真实Key、密码或私人备份不作为输入；唯一Key是假字符串，驱动拦截模型网络请求。
4. **原生恢复失败语义**：新增在实际参与者写入后注入失败，验证补偿；持续失败保留加密日志与写门禁，冷启动再由实际协调器恢复。没有删除日志、手动取消blocked或绕过协调器。

## 第二轮自查：需求、交互、隔离、行为

1. **取消/中断/重入**：真实WebView按钮取消时零删除零seed；合成旧文件清理中途故障后强停，重启再次确认才能继续；五实例/五私聊/一群聊精确计数，重复三次不增。初始真实消息/长期记忆/已发生事件均0。
2. **完整备份覆盖不足**：只有空集合往返不能证明所有新实体。设备夹具补入合成私聊/群聊、L3来源、事件/effect、完成任务、独立授权、原卡未知扩展和合成头像字节，再检验全图精确往返。它们是测试运行期合成记录，不进入预设种子。
3. **两个入口模式与生命周期**：除默认全屏解锁，还补关闭全屏验证后普通模块可用、Kanata不自动解密、取消按需验证、成功验证及后台过期释放等真实产品路径。精确结果以最终设备摘要为准。
4. **驱动与产品故障区分**：UIAutomator首次安装会背景化App并触发原有锁定，改为真实WebView的CDP输入，不改App安全策略。异步probe时按钮短暂禁用，使用Playwright正常可操作等待。WebView113首次连接关闭只允许有限连接重试并留记录，业务失败不自动改成PASS。
5. **容量不夸大**：1k/10k只作整包增长基线；JS堆采样和meminfo采样都不是峰值，没有真分页/索引或100k，P7必须独立设计与验收。

## 本轮命令与证据

- `npm ci --replace-registry-host=always --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=30000 --loglevel=error`：退出0；锁文件未改，三个postinstall补丁执行成功。最初沙箱安装EPERM后使用授权环境重试。
- `npm run check`：本地基线407 Node/219 Vitest；加入回归后409 Node/219 Vitest，lint0错误/33警告，类型与生产构建退出0。见[本轮完整日志](qa/kanata-local-20261028/check-final.txt)。后续若变更测试工具，最终复测记录追加，不沿用历史结果冒充重跑。
- `node --test tests/kanataRepository.test.js`：修复后23/23；`node --test tests/kanataDeviceGuard.test.js`：1/1，包含多项非法身份负向断言。
- `npx cap sync android`、`gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest`：本地退出0；JVM仍仅算术样例，不能替代业务验证。
- `npm run dev -- --host 127.0.0.1 --port 4173` + 指定全新Chromium context的Web驱动：PASS；取消/白名单/精确计数/冷重载/窄屏减少动效/1k与10k，pageErrors为空。见[Web摘要](qa/kanata-local-20261028/web-results.json)。
- `npm run build:qa:kanata` + `npx cap copy android` + `:app:assembleDebug` + `npm run test:e2e:kanata:android`：实际Android测试过程与最终状态见[设备摘要](qa/kanata-local-20261028/native-results.json)、[调试完整链已通过记录](qa/kanata-local-20261028/native-debug-pass.json)。新增第二轮专项及instrumentation仍以接下来的最终结果判定。

## 当前放行状态

**P2：PASS / Go。允许进入P3。** 新仓库与原生目录错误修复、受控旧资料清理、五人初始化幂等、主密码/会话释放、产品实际协调器、新旧备份、Android/Web增长的强制项均已实际验证。P1维持PASS；P3–P7尚待按序开发。

最终Android专用摘要为 **25项PASS、0项失败、pageErrors=[]**。本轮新空档首次连接WebView113关闭，重试发生在业务夹具准备之前；之后全部业务检查完整执行，未跳过断言。详见[最终设备摘要](qa/kanata-local-20261028/native-results.json)和[终端记录](qa/kanata-local-20261028/native-final-resume.txt)。两种解锁模式、取消保护验证、后台实际HOME导致过期、非空派生实体/授权/卡扩展/头像字节完整恢复均通过。

原生 `:app:connectedDebugAndroidTest` **退出1**：UTP宿主依赖缺失（opencensus-proto/atomicfu等），不是设备断言失败。未修改依赖版本或关闭测试；随后将同一构建的androidTest APK安装到任务AVD，执行 `adb -s emulator-5580 shell am instrument -w com.yubin.formyself.test/androidx.test.runner.AndroidJUnitRunner`，**退出0，runner报告OK(9 tests)**。其中 `TodoWidgetHarness.launcherFixture` 需要显式todoQaAction，源码Assume跳过；实际执行8项（包上下文1、ArchitectureContract3、TodoNative4），全部成功；不将夹具跳过计为业务通过。见[Gradle失败](qa/kanata-local-20261028/instrumentation.txt)、[直接runner结果](qa/kanata-local-20261028/instrumentation-direct.txt)。安全关键JS/Java共享规则、恢复门禁与真实接收器均执行。

最后重新执行 `npm run check`：**退出0；Node409/409、Vitest219/219（23文件）、lint0错误/33警告、Vue及strict契约、生产构建成功**。普通生产构建中测试入口已确认不存在；重新cap copy并执行JVM/debug/test APK构建退出0。`scripts/verify-kanata-apk.ps1`逐一核对 **55个dist资源SHA256与APK一致**，并拒绝任何kanataQA入口。见[构建核验](qa/kanata-local-20261028/production-build-verification.json)。

普通生产APK SHA256：`e322edd37bb0b57f27278a67daabde92378bc980d46ca9a1cb27e17cb35af128`。仅在本任务合成AVD覆盖安装，强停后使用新密码解锁，五实例、2条测试消息、1条合成记忆、1条合成事件、三项授权及全局假Key仍保留；[生产包重载摘要](qa/kanata-local-20261028/production-native-results.json)。该2/1/1为验收运行中明确加入的合成夹具，不是初始化伪历史。首轮生产冒烟读取全局Key早于设置加载，增加真实settings就绪等待后通过，未改产品读取语义。

### 本地容量样本

|平台|消息数|JSON字节/密文字节|保存ms|冷读ms|单项构建ms|
|---|---:|---:|---:|---:|---:|
|Web Chrome隔离context|1000|908571 / 1211456|141.7|80.2|7.9|
|Web Chrome隔离context|10000|8819572 / 11759468|1184.8|1113.4|108.5|
|Android14/WHPX/WebView113|1000|906434 / 1208620|834.4|297.2|20.3|
|Android14/WHPX/WebView113|10000|8799427 / 11732608|4210.2|2361.2|197.7|

Android样本保留两条来源消息及非空派生实体，和Web数据组成略有差别，不作平台性能优劣结论。Android测后App PSS约161788KB、RSS266968KB；JS performance.memory受WebView精度限制。全部为单次测量点而非峰值/p95/实体手机阈值。P7真分页、索引、归档、100k及峰值容量门禁继续保留，不能以本阶段通过消除它们。

源码/API未改签名；新增命令、错误码兼容及工具入口已同步README/架构规范。当前普通检查点提交仅写Kanata，不推送。

始终未覆盖：实体手机、生物识别、厂商通知、签名覆盖升级；真实个人资料的清理/导入未操作。100k与真分页属后续必须门禁，IP公开分发许可尚未提供，不等同本地文本开发或测试授权。
