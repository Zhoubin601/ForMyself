# ForMyself — 我的自留地

SQLite 迁移按 [彼方 SQLite 迁移计划 M v1](docs/20261103-kanata-sqlite-migration-plan-v1.md) 在 M 分支执行。M 从 Kanata 的 `73158a0` 创建。M0已通过，选型与实测见 [M0放行](docs/20261104-kanata-sqlite-m0-direct-gate-v1.md)。2026-11-06：M1 Schema、约束与事务式升级器通过主机及Android SQLCipher4.17验证，原设备磁盘阻塞已通过独立临时卷解除，M2未开始。当前入口为[M1验收v2](docs/20261106-kanata-sqlite-m1-report-v2.md)，原BLOCKED记录保留。

2026-11-07：M1-R 补充审计与加固见 [审计记录](docs/20261107-kanata-sqlite-m1-r-audit-v1.md)、[逐字段映射](docs/20261107-kanata-sqlite-m1-r-field-mapping-v1.md)、[外键删除语义](docs/20261107-kanata-sqlite-m1-r-foreign-keys-v1.md)及 [QA 命令与新证据](docs/qa/kanata-sqlite-m1-r/README.md)。Schema 追加003，001/002保持不变；原M1 v1/v2记录保留，M2未实施。

2026-11-09，M2 在 Windows/WHPX 合成 AVD 完成候选 Driver、消息/会话 Repository 和真实 UI 集成验收。生产 canonical 继续使用 legacy。M3 可开始工程实施。见 [M2 任务书](docs/20261107-kanata-sqlite-m2-task-v1.md)、[Windows 验收 v2](docs/20261109-kanata-sqlite-m2-acceptance-v2.md)、[复现与证据](docs/qa/kanata-sqlite-m2/README.md) 和 [Linux 历史阻塞](docs/20261107-kanata-sqlite-m2-acceptance-v1.md)。


2026-11-09：M4 补齐已有深层来源、事件分页及部分管理交互的实测，[验收 v2](docs/20261109-kanata-sqlite-m4-acceptance-v2.md)记录缺口。M4 BLOCKED，M5 NO。

2026-11-09：M3 隔离候选 [PASS](docs/20261109-kanata-sqlite-m3-acceptance-v1.md)。M4 已实现候选聊天、摘要工作区和自治访问切片，实测见 [阶段验收](docs/20261109-kanata-sqlite-m4-acceptance-v1.md) 与 [QA](docs/qa/kanata-sqlite-m4/README.md)。M4 总体 BLOCKED、M5 NO。接续依据 [M4 补齐任务书](docs/20261109-kanata-sqlite-m4-completion-task-v1.md) 定点关闭缺口，保留已通过切片；原 [M4 任务书](docs/20261109-kanata-sqlite-m4-task-v1.md)、[阶段验收](docs/20261109-kanata-sqlite-m4-acceptance-v1.md) 与 [QA](docs/qa/kanata-sqlite-m4/README.md) 保留为历史依据。生产使用 legacy，普通 Android SQLite 激活位 false，M5 尚未放行。

当前分支路线：Kanata（P7 No-Go 稳定基线）→ M（M0–M7 SQLite 迁移）→ M7 通过并审查后合并回 Kanata → 继续 P7。M 未完成前不在 Kanata 并行修改同一套存储模块；不自动合并 main 或发布。

P7 原始门槛仍然有效，见[连续开发计划 v3](docs/20261028-kanata-continuous-execution-plan-v3.md)与[P7 最终收口记录](docs/20261102-kanata-p7-final-closure-v1.md)。SQLite 迁移完成不等于 P7 自动通过，合并后必须重新执行相关容量、安全、备份和完整需求验收。

个人生活记录应用：省钱计划、体重、心情、每日待办、日程、密码库、月度报告与 AI 陪伴。采用 Vue 3、Pinia、Vite 和 Capacitor，支持 Web 与 Android。本机保存业务数据；启用 AI 时，聊天和选中的生活上下文会发送给用户配置的服务商。

## 开发与验证

后续 Agent / 开发者先读 [AGENTS.md](AGENTS.md) 和根目录的 [架构接口与 Agent 开发规范](架构接口与Agent开发说明书.md)。说明书包含真实接口、模块接入、存储/恢复约束及验证矩阵；稳定索引见 [开发背景](memory-bank/development-context.md)。`HANDOFF.md` 为历史档案，不作为当前架构接口依据。

```bash
npm ci
npm run dev
npm run check
```

`check` 包括 ESLint、Node 领域测试、Vitest 组件/故障回归、Vue 类型检查、严格契约类型检查和生产构建。`tests/types` 的负向样例必须被编译器拒绝，不能移除 `@ts-expect-error` 来掩盖接口问题。JavaScript 采用渐进检查，未宣称整个代码库已经严格类型化。

彼方 Kanata 的 P1–P6 已有阶段证据；P7正在做容量与完整需求收口。当前已实现加密历史分页、查询、归档与备份展开，但尚未通过全部容量门禁，详见[P7准确检查点](docs/20261029-kanata-p7-archive-checkpoint-v1.md)及[存储格式](docs/20261029-kanata-p7-archive-format-v1.md)。不要用构建成功或旧测试数字宣称全项目完成。

Kanata 原生专用合成验证：先以 `scripts/start-kanata-qa.ps1` 创建全新空白 AVD（SDK 默认 `E:/Android/Sdk`，可传 `-Sdk`）；确认启动完成后，执行 `npm run build:qa:kanata`、`npx cap sync android`、Android debug 构建，再运行 `npm run test:e2e:kanata:android`。驱动只接受匹配本地隔离清单的 `KanataP2Synthetic34 / emulator-5580`，拒绝未标记的已有 App，不执行清数据或卸载。再次全新测试用 `-NewRun` 正常关闭本任务旧 AVD，保留磁盘原路径并创建带时间戳的新空白目录；不使用用户日常模拟器。专用构建额外包含测试入口，**只用于隔离验收，不能发布**；正常 `npm run build` 不包含该入口。设备驱动和结果位于 `docs/qa/kanata-local-20261028/`，不以旧聊天 E2E 代替新业务验证。

```bash
npm run build
npx cap sync android
cd android
./gradlew :app:testDebugUnitTest :app:assembleDebug
# 隔离模拟器运行；不得指向真实用户设备数据
./gradlew :app:connectedDebugAndroidTest
cd ..
# 此驱动会清除专用模拟器中测试 App 的合成资料
npx playwright-core install android
adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 install -r -t android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
npm run test:e2e:android
```

Android 需要 JDK 21、匹配的 SDK/build-tools。`postinstall` 对通知、生物凭据和 Preferences 插件应用可重复的原生修补，并对 Filesystem 8.1.2 的 Web 目录列表应用有界读取补丁；遇到不支持的依赖源码/版本会明确失败，升级依赖时必须重新验证。不要将 `node_modules` 的手动修改当成可交付修复。

JS/Java Todo 规则共用 `tests/fixtures/todo-contract.json`；Java 规则与真实通知/存储检查由 instrumentation 执行。P1–P6 的验收记录位于 `docs/20261026-architecture-stage-*-verification-v1.md`，Playwright 浏览器、实际 WebView 驱动及合成证据位于 `docs/qa/architecture-20261026/`；驱动不打入正式 APK，只能指向隔离测试资料。

原生 Playwright 使用 ADB 转发连接实际 WebView，执行入口验证、API Key 冷启动、敏感会话释放、深链、强停恢复和改密回归。CI 固定 Emulator 33.1.24、Android 14 AOSP ATD 并启用 KVM；Android 触控按实际 WebView 边界定位，后台验证启动独立测试 APK 中的 Activity。仅 `qa/architecture-p6` 验证分支在全部设备检查成功后保存截图、摘要及 `output/` 验收包，其他分支通过 Actions artifact 提供报告。

## 目录与依赖边界

```text
src/application/          模块注册、导航、生命周期、备份协调、跨业务生活上下文
src/features/
  savings/ weight/ mood/  记录视图、Store、仓库与领域规则
  todo/ schedule/ chat/  规则、交互、持久化和通知适配
  vault/                 密码库视图、Store与加密保存
src/platform/
  storage/               Preferences适配、存储键、仓库接口、持久化状态、恢复日志
  security/              原生凭据适配
  ai/                    接收显式配置的AI传输客户端
src/shared/              无全局Store依赖的公共日期等规则
src/components/           应用公共控件、首页与设置分区
src/services/             通知、主题、报表等服务及历史兼容入口
src/stores/               认证、设置、受保护会话；部分历史入口转发到features
```

历史 `components/WeightView.vue`、`DebtListView.vue`、`PasswordVaultView.vue` 和相应 `stores` 路径保留为兼容入口，实现位于功能目录。新代码优先从功能目录访问相应能力；已有兼容入口不应扩充新的业务逻辑。

公共规则与 AI 传输层禁止导入 Pinia/全局业务 Store；功能 Store 通过仓库访问持久化插件。跨业务协作在应用层明确组合，避免将某个业务当作公共工具库。

## 新模块接入

1. 在功能目录实现领域规则、仓库、Store 和视图；仓库可注入驱动，先保证读取失败不覆盖旧数据、写入失败可见且能重试。
2. 在 `application/moduleRegistry.js` 注册 ID、标题、异步视图、设置、缓存及安全元数据。导航、菜单、标题和设置范围从注册信息派生。
3. 在 `application/ordinaryModules.js` 的组合根注册 initialize/resume/flush/subscribe/dispose。应用控制器不应增加模块专属生命周期分支。
4. 需要备份时在 `backupParticipants.js` 注册 export/ready/restore/flush；格式变化必须明确修改 `services/fullBackup.js` 的协议适配，未知参与者不可被静默遗漏。单项备份需要自己的解析与合并语义。
5. 敏感模块在 `protectedModules.js` 注册加载适配，并提供 release/reencrypt/flush/suspendPersistence；新增模块必须通过加载、会话释放、操作租约、改密失败回滚和备份往返测试。

设置页按分区投影字段和动作。字段缺失或同名字段来自不同引用时明确报错，防止大对象展开静默覆盖。聊天消息列表、编辑框及操作面板分别维护展示接口；副作用仍由聊天视图协调。

## 数据安全与恢复

首次使用配置主密码。可开启全屏入口验证，也可直达普通页面、首次访问密码库或聊天时按需验证。会话失效后释放敏感明文；密码库查看/复制仍遵守独立验证规则。

Android API Key 使用安全凭据适配器。配置有加载、保存、失败和重试状态；保存未成功时不能保证进程强杀后保留输入。Web 的安全能力与 Android 不同，不应将浏览器存储描述为 Android Keystore。

完整备份包含全部业务和设置，继续支持 v1–v12 导入。主密码和设备生物识别凭据不作为备份项导出；备份中的 AI 配置随文件一起加密。

完整恢复前持久化 AES-GCM 加密恢复记录。提交前中断则恢复旧快照；提交后中断保留目标数据。恢复未完成时阻止普通写入和 Todo 桌面修改，验证身份后可重试。介质持续失败、记录损坏或密钥不可用时保持保护状态，不能承诺自动修复任意损坏。存在恢复记录时必须先完成恢复，再降级到不支持该记录的旧版本。

阶段计划和实际验收记录位于 `docs/20261026-architecture-*.md`，对应合成测试证据位于 `docs/qa/architecture-20261026/`；P1–P6 曾按当时授权逐阶段提交并推送。后续任务的提交、推送和发布遵循用户当前授权。

Kanata 的 P1–P6 已有阶段验收，P7继续开发，尚未通过最终门禁。已实现全局角色卡、PNG/JSON导入、独立世界/实例、世界书、私聊/群聊/@、日常/RP、长期记忆/因果修正、生活授权、有限自主活动与通知。无Key时不伪造回复。历史证据见 [P2](docs/20261028-kanata-stage-p2-local-verification-v1.md)、[P3](docs/20261028-kanata-stage-p3-verification-v1.md)、[P4](docs/20261028-kanata-stage-p4-verification-v1.md)、[P5](docs/20261028-kanata-stage-p5-verification-v1.md) 和 [P6](docs/20261029-kanata-stage-p6-verification-v1.md)。当前用户要求继续开发；不自动发布。全备v13与旧v1–v12非聊天安全恢复策略仍按架构规范执行。

Kanata P5已通过（2026-10-29最终复测）：分层记忆、来源修订、因果事件撤销、独立生活授权和精确角色绑定。见[实际验收](docs/20261028-kanata-stage-p5-verification-v1.md)、[需求增量](docs/20261028-kanata-requirements-through-p5-v1.md)及架构规范第19节。此记录覆盖上方P4暂停/后续未开发的历史状态；当前继续P6，未自动推送或发布。

P6首批时间规则与受保护持久化已实现，完整check为500 Node/278组件通过；P6整体未验收，社交/通知/双视角及设备流程尚未实现。后续开发从[P6准确检查点](docs/20261029-kanata-p6-checkpoint-v1.md)接续，不能用P5 APK证据覆盖新代码。

最新状态（2026-10-29）：P6已PASS，覆盖上述首批未完成状态；完整check501 Node/317组件、Web12流程/6布局、最终生产Android17流程及原生8通过/1夹具跳过。角色社交、现群联动、主动/通知、持久化延迟和双视角证据见[P6验收](docs/20261029-kanata-stage-p6-verification-v1.md)、[完整需求P6增量](docs/20261029-kanata-requirements-through-p6-v1.md)。P7尚未验收；按用户最新决定使用raw指向的本地隔离模拟器，容量/真分页/需求收口仍须实际完成。


2026-10-30 接续状态：P7仍在开发，新增加密历史页、原文查询/修订、完整备份正文展开、分页改密和恢复内存优化、分次气泡/立即全部。完整check536 Node/348组件通过，当前生产候选98a1e79的Android1k/10k容量全流程通过；Web/Android三档已跑完：100k内存均超限，Android改密耗时亦超限，P7仍No-Go；已恢复原608条隔离合成资料并核对各模块，最终综合验收尚未完成。不得据此称P7完成或发布。准确续作入口见[P7检查点末节](docs/20261029-kanata-p7-archive-checkpoint-v1.md)。

2026-10-30最新功能增量：自定义世界可从本世界选择成员创建空群聊，支持单群每轮角色/AI条数限制和活动等待/立即回复。最终check548 Node/375组件，Web/隔离Android各13项生产检查通过；详情见[需求增量与两轮自查](docs/20261030-kanata-requirements-p7-increment-v1.md)。P7仍No-Go：100k容量失败与其余原需求差距继续开发，当前功能APK未重测三档；不据此发布/宣称完成。

2026-10-31：已按用户要求准备推送P7 WIP并转云端，唯一新交接入口见文首。最终check565/382与生产子集已验证，P7因100k Web内存/Android反向改密及余项仍No-Go；所有测量和合成基线恢复已结束。请用本日交接及结构化结果覆盖前述旧进度，不将WIP当最终完成。

## 2026-11-10 M4 收尾检查点

M4 仍为 BLOCKED，M5 不放行。本轮关闭普通聊天的完整记忆引用数组路径，增加分享撤回、自定义合并、事件逐项 Effects 审计、历史整理和世界设置。范围、证据和其余门禁见 [验收 v4](docs/20261110-kanata-sqlite-m4-acceptance-v4.md)。

## 2026-11-10：M4 剩余缺口续作入口

M 分支本轮接管的远端基线为 428b7bcfeffe2722e72b4809a6d1a82b5734aeb1。M4 仍 BLOCKED、M5 NO。[续作验收 v3](docs/20261110-kanata-sqlite-m4-acceptance-v3.md) 记录 GROUP-01～05、事件 Effects、记忆关系增长与其他增量的实测和剩余门禁。当前执行入口改为 [M4 剩余缺口续作任务书](docs/20261110-kanata-sqlite-m4-continuation-task-v1.md)；原 M4 completion task v1、acceptance v1/v2 和 QA 作为历史证据保留。

本轮重点：实际完成 GROUP-01–05 成员编辑端到端；有界化事件撤销与 Effects 重放；补齐记忆整理/冲突/分享和宽关系增长；完成 A–G 剩余管理流程、跨模块消费者、生命周期与两轮全范围自检。生产 canonical 保持 legacy，普通 Android SQLite 激活位 false；不迁移真实数据、不实施 M5/M6/M7。


## 2026-11-10 M4-R 最终收尾入口

当前 M 分支基线为 d1737e7d598a14ec3f3ef1febd0bf8be050edbe2。**M4 仍 BLOCKED，M5 不放行。** 本轮首要阻塞是 Android API 34 / SQLCipher 4.17.0 的 10k 宽事件确认在现有 420 秒驱动 deadline 超时；主机 10k 已通过，Android 1k 已通过，但不能替代 Android 10k。G4 的普通聊天记忆来源 DTO 路径已关闭，授权标签及事件/消息 provenance、旧兼容导出仍需全链路有界证据。当前执行入口为 [M4-R 最终收尾任务书 v1](docs/20261110-kanata-sqlite-m4-r-closeout-task-v1.md)，逐项事实见 [验收 v4](docs/20261110-kanata-sqlite-m4-acceptance-v4.md) 和 [closeout QA](docs/qa/kanata-sqlite-m4/closeout/README.md)。GROUP-01～05 与 G10 已有通过证据，避免重复施工。生产 canonical 保持 legacy，普通 Android SQLite 激活位 false，Schema 001–004 checksum 冻结；不触碰真实数据，不实施 M5/M6/M7。

M4-R 接管与 MR1 验收见 [M4-R QA](qa/kanata-sqlite-m4/m4-r/README.md)。Android 综合 10k 宽事件及强停重开后的逐项审计和回执通过。M4 仍 BLOCKED，M5 NO。

[M4-R 验收 v5 检查点](docs/20261110-kanata-sqlite-m4-r-acceptance-v5.md)记录 10k 宽事件修复、G4 授权切片和剩余阻塞。
