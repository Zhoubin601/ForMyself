# Kanata P2 运行时开发与验收检查点 v1

**当前判定：P2 BLOCKED（No-Go / Android设备启动失败）。P1已通过；P3–P7未开始。**

这是实际开发证据，不是新计划，也不是P1–P7完成声明。基线HEAD `dd9c912`、分支 `Kanata`；所有P2代码仍在工作区，保留已有工作，没有reset/clean/删除文件/合并main/发布。用户后续授权每个P2起完成阶段提交和推送；P2尚未验收，不将此状态伪装为完成阶段推送。

## 实现与实际文件

| 职责 | 文件/行为 |
| --- | --- |
| 新加密仓库 | `src/features/chat/storage/kanataRepository.js`、`kanataRepositoryTypes.d.ts`：新文件与恢复键、只读安全加载、错误分类、密文串行队列/读回/重试、备份与改密。 |
| Store | `src/features/chat/kanataStore.js`：ready/restore/改密门禁、只读快照、同步草稿校验、失败保留/重试、过期清明文。`domain/initializationGate.js`：应用内部首启能力。 |
| 清理与首启 | `src/features/chat/legacy/legacyChatCleanup.js`、`src/application/kanataRuntime.js`：每次受保护确认、停旧写、通知白名单、主/tmp/bak及恢复键白名单、非秘密中断点、清理后幂等seed。`chatStore.js`增加退休能力，无自动擦除。 |
| 备份/恢复 | `src/features/chat/backup/kanataBackup.js`、`src/application/kanataBackupRuntime.js`、`fullBackupRuntime.js`、`restoreCoordinator.js`：新单项v1/全备v13，旧全备非chat保留新图，实际协调器/加密日志、回滚精确图，validateRecovery支持旧日志分流。 |
| 注册/界面 | `moduleRegistry.js`、`protectedModules.js`、`KanataSetupView.vue`、`SettingsChat.vue`、`useBackupSettings.js`、`useAppController.js`：保留chat路由、替换新受保护Store/不缓存页、运行时确认、设置入口/预览/取消/恢复；旧通知不复活旧outbox。 |
| 类型/键 | `contracts.d.ts`、`tests/types/kanata.ts`、`keys.js`：实际接口类型与负向用例、独立键。 |
| 测试 | `tests/kanataRepository.test.js`、`kanataBackup.test.js`、`legacyChatCleanup.test.js`、`KanataStore.spec.js`、`KanataBackupRuntime.spec.js`、`KanataInitialization.spec.js`、`KanataProductRecovery.spec.js`、`KanataSetupView.spec.js`；历史受保护/页面注册测试按新产品入口或明确历史注入调整，未将旧实现测试冒充新产品验收。 |

完整工作区文件清单见 [changed-files.json](qa/kanata-continuous/p2/changed-files.json)，过程文档/架构规范的补记也在diff内。未修改raw、package.json、锁文件、Android源配置或平台加密协议；没有新增数据库或常驻服务。

## v3 P2 必须验收矩阵

| 编号 | 当前结果 | 证据及限制 |
| --- | --- | --- |
| P2-1 五种失败且不覆盖 | 自动化PASS | 仓库22项：missing、版本、解析/解密、全部副本损坏、权限读取、写队列失败、重载/重试、旧恢复指纹、改密备份与密文队列。真实Web额外发现目录重复异常后修复。Android故障/冷启动尚需设备。 |
| P2-2 明示清理、白名单、任意中断 | 合成自动化PASS | 清理28项：确认前0删除，取消/伪truthy/会话过期/恢复阻塞/读失败/中断/新运行时重新确认、仅旧文件/恢复键/通知，其他资料保留。没有触碰真实手机。 |
| P2-3 seed幂等与旧写停止 | 自动化/Web PASS，Android待测 | Store16、首启4、Setup16项；真实Web取消0seed/文件且保留3旧副本、确认1/5/5/1/零伪历史并清理白名单而保留非chat合成文件、冷重载不重复。旧Store加载退休后拒绝；旧页不挂载，控制器不再materialize旧通知。原生强停仍待设备。 |
| P2-4 v1–v12非chat恢复 | 自动化PASS | 备份纯适配器12版本、产品实际Pinia+完整协调器12版本；丢弃必须确认，旧chat不写新/旧文件；设置真实FileReader→预览→取消/确认也覆盖。其他模块兼容沿既有映射，旧备份缺Todo保留现有Todo。 |
| P2-5 新图往返、回滚、改密与会话 | 自动化PASS，Android待测 | 新图包含卡原文/安全未知扩展、消息/群聊/记忆/事件/effect/授权/任务往返；实际产品失败补偿、回滚失败密文日志门禁、错密重试、旧日志commit前后恢复、实际Kanata+vault改密、释放/解锁重载；Android改密/强停仍未完成。 |
| P2-6 Web/Android增长与总检查 | Web/自动化PASS，Android未完成 | Web真实Capacitor文件+Preferences 1k/10k样本；npm run check退出0。无Android基线，不准放行P3；当前也没有真分页或容量最终通过声明。 |

## 实际命令与结果

工作目录 `/workspace/ForMyself`。日志只含合成资料。

| 命令 | 结果 |
| --- | --- |
| `git status --short --branch`、`git log -3 --oneline`、`git diff --stat`、`git diff --check` | Kanata/HEAD dd9c912；既有工作区保留；diff格式检查0。未提交P2或推送。 |
| `node --test tests/kanataRepository.test.js` | 22/22，退出0；[Web故障修复前](qa/kanata-continuous/p2/repository-web-before.txt)20过1失败，[修复后](qa/kanata-continuous/p2/repository-web-after.txt)21过。 |
| `npx vitest run tests/KanataProductRecovery.spec.js tests/FeatureBoundaries.spec.js` | 32/32，退出0；产品21+边界11（此后产品增加到23，最终总检查包含），[日志](qa/kanata-continuous/p2/product-settings-final.txt)。 |
| `npm run typecheck` | 退出0；新增5项负向P2类型案例，未关闭strict或删除原案例。 |
| `npm run check` | **退出0：lint 0错误/33警告；Node407/407；Vitest219/219（23文件）；Vue/strict类型和Vite生产构建通过**。[日志](qa/kanata-continuous/p2/check-final-security.txt)。警告非新失败；从47降到33主要来自旧设置模板替换。故障注入stderr不能解读为未通过。 |
| `npx vite --host 127.0.0.1 --port 4173` + `node docs/qa/kanata-continuous/p2/verify-web.mjs` | 隔离Chromium154，真实Web插件；最终运行PASS，pageErrors空，取消0seed、确认精确计数、冷重载及窄屏减少动效布局通过；[结果](qa/kanata-continuous/p2/web-results.json)、[截图](qa/kanata-continuous/p2/web-initialized.png)。开发服务器源码模块路径，不宣称生产APK或实体手机通过。 |
| Android `:app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest` | **最终匹配构建退出0**，JDK21/SDK36/build-tools35/36；APK内55个dist文件全部SHA256一致。JVM仅原有算术样例1项，不是Kanata业务证据。设备instrumentation/强停/容量仍BLOCKED。[报告](qa/kanata-continuous/p2/android/final-build-verification.json)。 |

环境曾短暂不可用，恢复后核实工作区与测试进程仍在，取得check最终退出0及Web冷重载结果；没有将断开时未知状态写成通过。

## 自查第1轮：架构、数据、异常、安全

1. **改密旧副本可读**：故障回归证明仅重写主文件会留下旧密码bak。增加pending reencrypt marker，主文件和bak都读回验证，重启/重试后完成。before/after日志随仓库记录保存。
2. **Store失败被吞/未补偿继续写**：新增回归先出现5失败；修复释放后待写密文重载顺序、重复seed必须flush、改密补偿前禁止restore/flush、异步mutator拒绝且消费拒绝Promise、早期保存错误保留和重试，16项通过。
3. **可选Todo错误静默遗漏**：新增null/primitive/缺data回归失败后修复；存在就严格验证，缺失才兼容省略。
4. **raw单项导入绕过任务暂停**：实际产品回归7过1失败，适配器自身执行prepareKanataBackupData后8过；不只依靠UI解析。
5. **真实Web重复写失败**：插件实际mkdir异常未匹配；新增失败回归后修复，并验证有明确EACCES码的“已存在”错误仍拒绝。21项通过。

## 自查第2轮：需求、交互、隔离、旧内容复活

1. **页面误报已准备**：内存seed成功/保存失败仍不能展示ready。以loaded+worlds+无saveError/无pending判定，离开页面取消仍悬挂的确认，避免迟到同意。
2. **清理状态误读**：实际协调器phase为done、pending只代表中断，不能当有旧文件；用hasLegacy提示与pending分别展示。两个新增失败回归修复后16项通过。
3. **设置挂载字段冲突**：产品FeatureBoundaries失败揭示新旧chatStore投影重名。备份provider改独立字段，真实SettingsView挂载与AI编辑11项通过。
4. **取消预览触发写入**：实际FileReader用例发现取消前ensureOrdinaryDataReady仍flush日程和widget。预览只检查ready，确认后的完整恢复才由实际协调器flush；最终设置取消0写与确认恢复通过。
5. **版本/知识/扩展边界**：产品12版本、旧日志commit前后、卡安全扩展及全部新实体往返、新旧taskPolicy/版本/模式混淆拒绝；旧单项不询问覆盖、拒绝导入，取消新单项不转merge。旧chat自动任务从控制器/路由切断；新世界仍无伪历史。
6. **质量测试证据不混淆**：旧受保护测试显式注入历史registry并标注历史；新产品另用真实默认protectedModules/实际Store和协调器。P2不声称五人AI对话风格、记忆提取或授权传播已实现（属P4–P6）。

失败复现、修复和复测日志见 [证据目录](qa/kanata-continuous/p2/)。未通过删断言、关闭strict或绕过恢复日志取得通过。

## 容量事实与后续门禁

实测环境见 [execution-environment.json](qa/kanata-continuous/p2/execution-environment.json)。多次隔离浏览器运行受并行测试/模拟器负载影响明显，不是重复样本p95：

| 样本 | JSON / 密文字节 | 最后一次保存 / 冷读 / 单项构建 |
| --- | --- | --- |
| 1k消息 | 908561 / 1211456 | 808ms / 304ms / 58ms |
| 10k消息 | 8819562 / 11759448 | 4002ms / 4512ms / 529ms |

最后一次heapAfter约67MB/120MB，仅测量点JS堆，**不是峰值内存**。前一次较空闲时10k保存2386ms/冷读1769ms，进一步表明不能以单次采样设性能保证。没有100k、真实索引/磁盘分页、Android基线或目标实体机阈值。

**后续必要设计门禁**：P7容量/分页不能沿当前整包方案直接标PASS。必须独立设计分片/索引或经论证的存储方案、历史校验/回滚/改密/完整恢复，预先确定目标设备与阈值，再量测1k/10k/100k及峰值内存。此处没有擅自迁数据库或改加密协议，也没有将容量需求删除。

## 剩余问题与安全接续

1. Android匹配构建已通过；隔离模拟器boot_completed/package manager、真实新仓库增长、强停冷启动/恢复日志/改密测试尚未完成；TCG无KVM并发生系统启动问题，不能仅因ADB出现或APK编译算通过。
2. P3预设官方事实/原创摘要与可分发授权审查未完成；不打包官方素材。P4–P6各实际功能未开始；全部20项最终产品目标不能因新存储完成就算覆盖。
3. 实体手机、生物识别、通知厂商行为、签名升级、100k与峰值内存/真分页均未测。
4. 全部私人数据清理仍只允许应用运行时当次确认；本开发仅清理合成环境。未读取用户真实设备或调用真实AI。

接续先核对HEAD/工作区、此记录、最新Android结果与源码，不重做P0/P1，不覆盖未提交P2。补齐P2强制设备门禁并更新准确结果后才可判Go，按授权普通commit/push Kanata，再继续P3。若设备无法准备，记录BLOCKED并停在P2，不绕过它开发依赖阶段。

补充实际安全回归：`npx vitest run tests/KanataProductRecovery.spec.js` 23/23退出0，新增密码库与Kanata两个实际改密参与者写失败后补偿、旧密码冷重载成功；见 [日志](qa/kanata-continuous/p2/password-compensation.txt)。最终总检查已据此重跑退出0（Node407、Vitest219）；之前406/217是同一业务代码的候选检查。完整需求第十五节15场景当前覆盖见 [矩阵](qa/kanata-continuous/p2/requirements-coverage.json)，P3–P7功能均未用存储测试冒充通过。

原生设备阻塞已确认：两种API34镜像在无KVM的2核TCG环境无法达到boot_completed/package manager可用。ATD第二次虽ART启动成功，另15个关键APEX的dm设备仍超时；尝试timeout property被模拟器映射/SELinux拒绝，不算已生效。只正常关闭任务AVD释放CPU，保留其合成磁盘与完整日志；不降低镜像安全策略，不在真实设备上尝试。此环境不能完成P2强制设备门禁，P3禁止进入。Android编译正在补完整JDK21后重试，成功编译也不能解除设备BLOCKED。

最终安全追加自查：仓库串行链直接保留readTask会使已完成Promise长期持有明文结果，`wait()`还可返回该结果。新增回归先失败（21过1失败），改为只保留void settlement，调用者仍获得read结果；修复后22/22通过、strict明确wait为Promise<void>，最终总检查Node407/Vitest219退出0。见 [修复前](qa/kanata-continuous/p2/repository-plaintext-tail-before.txt)、[修复后](qa/kanata-continuous/p2/repository-plaintext-tail-after.txt)、[最终总检查](qa/kanata-continuous/p2/check-final-security.txt)。最终dist/index.html SHA256为8a82423d74bfb93b932dbda31bcc66f5308e75e29dc9135169bafe4ded04de27，原生构建须刷新此版本。

安全修复后的真实Web复测（UTC 2026-10-28T03:02:47.344Z，北京时间11:02起）仍PASS：取消保留旧副本、确认白名单清理、非chat保留、1/5/5/1与零伪历史、冷重载及1k/10k增长，pageErrors为空；上表采用此轮数据。见 [日志](qa/kanata-continuous/p2/web-final-security.txt)。

## 最终 Android 编译检查点（不解除设备阻塞）

完整JDK21、SDK、依赖与CA准备后，最终执行 `:app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest` 退出0。构建在任务目录独立副本完成，未改仓库Android配置。安全修复后的dist刷新后再增量构建，55个dist文件与APK内assets/public逐一SHA256全部一致；额外只有生成的cordova.js/cordova_plugins.js。

- debug APK SHA256：`9f904c5b9d393a09e06771455ea0f61cdb6d03d3b977c496f0e16509eea78f33`。
- androidTest APK SHA256：`1688ce3142e43bb61c2d84297548b4214cd94efcc525cb31069f2ca029419c9b`。
- JVM测试只有现有 `addition_isCorrect` 1项；没有将它计为Kanata功能通过。
- APK仅位于任务work构建目录，未发布、未安装用户手机；没有产生可用设备，因此connected instrumentation、原生WebView、强停恢复/改密及Android增长仍NOT RUN/BLOCKED。
- 完整命令/退出码/失败修正/工具链/启动故障证据见 [Android证据](qa/kanata-continuous/p2/android/README.md)。其中HANDOFF是环境Agent在最终构建前的历史快照，当前编译结果以final-build-verification.json为准。

**最终P2判定仍为BLOCKED/No-Go，不进入P3。** P2工作区完整保留，尚未作为验收通过阶段提交或推送。后续必须在具备KVM或明确隔离设备的环境补齐P2设备门禁，之后按当前授权普通commit/push Kanata再继续；不需要重复P0/P1或重新制定普通计划。

## 用户授权的远端接续检查点

2026-10-28用户明确要求“推送远端，我转到本地开发”。本次因此提交并推送当前P2工作，覆盖上文尚待验收才推送的等待条件；提交明确标记Android验收BLOCKED，不将其冒充P2 PASS。P3–P7仍未开始，main不合并。接续见 [本地开发交接](20261028-kanata-local-handoff-v1.md)；云SDK/JDK/AVD/APK不纳入Git。
