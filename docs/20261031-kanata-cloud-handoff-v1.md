# 彼方 Kanata 云端开发交接（2026-10-31）

**从 Kanata 分支继续 P7。P1–P6 已有阶段验收；P7 仍 IN PROGRESS / No-Go。** 本次按用户“推送远端，附上交接文档，我在云端开发”的明确要求保存并推送未完成的工程检查点，不是 P7 放行或安装包发布。本地业务开发在交接后停止，由云端接续。

## 1. Git 与阅读入口

- 仓库：`https://github.com/Zhoubin601/ForMyself`，目标分支大小写为 `Kanata`。
- 开始本轮前本地 HEAD：`62a2b755a622a181f6d530525e15ad070dd33b9f`（P6 已完成）；原远端：`be9ebc3dbe1a08e14575e044875426f0648c0179`（P5）。本次普通推送包含 P6 及本交接的 P7 WIP 提交；用包含本文件的提交和 `git log` 确定实际新 HEAD，不使用历史 SHA 当最新版本。
- 本地改动仅在 `.worktrees/kanata` 的 Kanata 分支。main 上原有四份过程文档修改、旧 output APK 删除及其他未跟踪资料均保留，没有合并 main、reset、clean、强推或恢复用户删除项。
- **先读**根目录 `AGENTS.md`、`架构接口与Agent开发说明书.md`（当前 v1.4，重点第15–21.6节），再读本文件和下列当前材料。不要把历史 `HANDOFF.md` 或计划开头的“P1–P7尚未实现”当当前进度。

按原任务继续阅读：

1. `docs/20261028-kanata-continuous-execution-plan-v3.md`（阶段门禁）。
2. `docs/20261028-kanata-abydos-preset-spec-v1.md`、`docs/20261028-kanata-clean-start-and-abydos-preset-v2.md`。
3. `raw/完整需求清单.txt`、`docs/questions.md`、`docs/source-notes.md`、`docs/analysis-notes.md`、`docs/plan.md`。
4. [本日性能检查点](20261031-kanata-p7-performance-checkpoint-v1.md)、[原始需求P7增量](20261030-kanata-requirements-p7-increment-v1.md)、[结构化最终结果](qa/kanata-continuous/p7/verification-summary-latest.json)。较早检查点中的 RUNNING、旧 APK 和测试数字由本文件及最新结果覆盖。
5. 对照实际源码、类型和行为测试；[待交接文件清单](qa/kanata-continuous/p7/pending-file-manifest.json)列出本次相对 P6 的全部文件及 Git 索引规范化字节的 SHA256，包含此前多轮 P7 工作，不全是本日新写。

## 2. 产品与安全边界

旧温馨小家聊天、记忆、关系、事件不迁入彼方，不强制创建小暖。保留其他生活模块、全局 DeepSeek 配置、主密码、加密存储、备份恢复和现有模块化 Vue3/Pinia/Vite/Capacitor 架构。五人预设仍为独立文字数据；首次初始化不种虚假历史，不新增官方图片或完整台词。

原文/来源和世界隔离必须保全。所有普通修改走可注入仓库和 Store 加载/保存/恢复门禁；完整恢复走实际协调器和加密日志。不得删日志、用空数据掩盖失败、绕过协调器或跳过安全测试。真实旧数据清理仅能在真实应用流程当次明确确认后执行；本次只操作合成环境。

没有新数据库、常驻 Python 服务或关机 AI 承诺。手机关闭后只在下次打开时有限续接。真实凭据不在仓库；原 Windows 桌面测试 Key 文件未上传，云端需要真实模型验证时应由用户通过私密配置提供，不发聊天或写日志。当前新增验证均为受控响应或零 AI，不冒充新的真实模型质量结论。

## 3. 已实现的 P7 工作

- 真正的50条加密历史页、Bloom候选索引、原文查询/激活修订、可控归档；稳定消息ID/revision与整批回复关联不变。
- 完整备份展开全部正文，外部完整 v13/单项 v1 自包含；旧 v1–v12 只安全恢复非聊天模块，旧聊天不得进入彼方。Kanata 主数据 v1/v2 和历史页 v1 均有完整校验。
- 分页重加密、主/备读回、旧副本保全和受控退休；内部大恢复载荷在原 AES-GCM 信封内 gzip 编码，256MiB解压预算和失败门禁保留。
- 私有、完整校验且递归冻结的恢复图工厂；普通调用者/JSON信任标记不能获取免校验能力。普通 Store.update 仍用可修改的分离草稿。
- 自然气泡原子保存后650ms逐条展示、正在输入、立即全部、减少动效/历史即时展示、后台和卸载清理。
- 自建群聊只能选择本世界至少两名角色，不复制聊天/记忆/生活授权。单群可配置1–8角色、1–32条AI回复；段落预算不足时合并而不截断，部分失败重试不重付已保存角色；多词/空格姓名 @ 和多群自主选择已修复。
- 会话活动等待默认关闭，保存1000–30000ms配置；同世界虚拟日程/低能量且自主开关允许时持久化一次等待；立即回复取消同源 pending，真实冷启动前台续接不重复发言，不捏造忙碌历史。前台检查间隔最长30秒，不保证毫秒发送或关闭执行。
- 本日改密复用已验证的原始页正文，精确读回新密文及解密正文；目录准备只做一次且失败可重试。归档页可用平台 AES-CBC 计算，固定盐与旧 CryptoJS 完全相同，原协议、派生、盐、填充、Base64/BOM/严格UTF8均不变；缺能力才回退，平台错误不降级。
- 本日 Kanata 实际恢复协调器启用 `journalRollback:true`。完整回滚图写入原认证日志、取得 prepare 实际验证的 digest 并确认未提交后，释放内存回滚副本。失败时只从同一 digest 的未提交日志认证解密、验证并补偿；坏记录/替换/缺 digest/补偿失败保留门禁。不是裸页日志或另建恢复引擎。

重点源码：`src/features/chat/{kanataStore.js,storage/,domain/,autonomy/,backup/}`、`src/shared/{crypto/,async/}`、`src/application/{kanataBackupRuntime.js,restoreCoordinator.js,fullBackupRuntime.js,kanataChatRuntime.js,kanataManagement.js}`、`src/platform/storage/{restoreJournal.js,restorePayloadCodec.js}`。接口与负向样例在 `contracts.d.ts`、实际类型入口和 `tests/types/`。

## 4. 最新实测与未通过门禁

当前生产 APK 的 SHA256 为 **9411037b9993622e6816dc4915bb535633f7a7e75edfbda18c5a5034eb17be6c**；78资源逐项匹配，无QA入口。APK/SDK/AVD本身未作为本次发布物上传。

| 检查 | 实际结果 |
| --- | --- |
| `npm run check` | 最终565 Node、382组件/40文件，lint/strict/build退出0；lint0错误、42既有警告 |
| Android Java unit/APK/androidTest构建 | 成功；Java未改，部分Gradle任务为缓存结果 |
| 生产Web/隔离Android群聊及活动回归 | 各13检查PASS；每端7次受控尝试含1次故意500，0真实模型/0页面错误 |
| Android instrumentation | 8 PASS、1 TodoWidgetHarness Assume SKIP、0 FAIL；不能把日志OK(9 tests)写成9通过 |
| 两端1k/10k容量 | PASS，全部原文/来源/实际协调器和改密核对执行 |
| Android100k | **FAIL_CAPACITY_GATE**；峰值501.7148MiB通过512MiB，完整恢复97.3313s、首向改密116.7794s通过，但改回凭据148.0577s超过120s |
| Web100k | **FAIL_CAPACITY_GATE**；所有时间通过，峰值834.9141MiB超过768MiB |
| 原608合成基线/其他模块/设置 | 已归还；独立检查PASS，原记录/设置/metadata保留。Todo仅按既有CAS契约递增；跨日新增一条10月30日空白自动补记，按原moodStore规则严格核对并单列，没有删除或当成手工记录忽略 |
| 真实Home后台明文释放 | PASS，未用人工expireSession替代，0真实AI/页面错误 |

**验收脚本修复必须保留：** `capacity-evidence.mjs` 最初漏算“改回合成凭据”的第二次真实改密，曾把941的Android100k错误写为PASS。现已补4项门禁回归，按同一120秒阈值从实际148057.7ms重算为FAIL；没有重测或改动原始测量值。`*-before-gate-fix.json`和原CLI记录保留，最新摘要/校正文件才是结论。原容量序列stdout中的native100k PASS不是放行证据。

最终证据在 `docs/qa/kanata-continuous/p7/`：

- `check-cloud-handoff-20261031.txt`、`production-build-cloud-handoff-20261031.json`。
- `journal-release-20261031-{web,native}-results.json`与PNG、对应驱动日志。
- `{native,web}-capacity-journal-release-20261031-{1000,10000,100000}.json/.txt`。
- `instrumentation-cloud-handoff-20261031.txt`、`native-baseline-integrity-results.json`。
- `capacity-gate-regression-20261031.txt`、`baseline-rollover-regression-20261031.txt`；跨日补记核查允许的只有精确缺失日期/默认心情/空正文空标签/autoFilled及合理时间，原始改动、额外手工记录和未来日期均拒绝。
- 历史98、62d等候选及失败均单独保留；不得套用到新源码。最新565/382与字节一致的941业务构建对应，新增测试/文档不改变生产bundle。

## 5. 云端下一步

1. 拉取 Kanata，先核对HEAD/status并保留任何云端既有改动；读上述规范和实际源码。当前没有在跑的本地测试/恢复事务，设备已在后台。按用户最新要求交接，不继续假定本地Agent同时开发。
2. 先处理剩余硬门禁：Web100k峰值、Android第二次改密耗时。不要只测较快方向、强制GC、提高阈值或用Node/JS堆替代设备进程RSS。记录两个方向的实际事务及来源/旧密码拒绝。
3. 密集长期记忆/事件/审计外部来源仍保守把原文留在活跃图；不能直接移走造成孤儿来源。进一步分页需先设计跨引用/权限/修订/恢复与故障矩阵，保留全部原文，不造空源或裸页备份。
4. 原生活模块的旧通用AI/提醒链仍未全部接入新角色；全应用统计页面/跨模块聚合与日期趋势尚未完成，目前主要是Kanata按attempt记录。自主情绪/关系的高级决策仍有限。继续按完整需求逐条补实现，不用已有独立生活回应组件冒充整个旧入口已替换。
5. 在最终同一候选上重新完成第十五节15场景、五人专项、旧备份/清理、权限/异常矩阵；本次新增13项只是子集。P7仍No-Go，不创建“P7已验收”提交或发布物。

## 6. 云端复现注意事项

```text
npm ci
npm run check
node --test tests/passphraseAes.test.js tests/kanataMessageArchive.test.js tests/kanataCapacityAssessment.test.js tests/kanataBaselineComparison.test.js
npx vitest run tests/RestoreCoordinator.spec.js tests/KanataProductRecovery.spec.js tests/KanataArchiveStore.spec.js
```

以上默认只用合成数据。保留项目postinstall依赖补丁，不手改node_modules。只有新变更/故障需要才扩大测试；不能把本地报告当云端新执行结果。

生产Web容量驱动示例：`node docs/qa/kanata-continuous/p7/verify-capacity-web.mjs 100000 <冻结tag> <端口>`。先正常build并复制不可变dist、建立`qa-build.json`标记，再用对应Vite preview；参数和内存门槛见实际驱动/容量契约。功能驱动支持 `verify-activity-timing.mjs web <tag> <端口> <独立证据前缀>`，避免覆盖旧报告。

**驱动目前包含Windows本地路径。** `web-capacity-support.mjs`使用本机Chrome和Windows峰值工作集；云端要适配Chrome路径及Linux `/proc`等真实逐进程高水位读取，不能改成JS heap。原生驱动使用本地SDK/ADB/JDK与已标记API34、4核、2GiB任务AVD。raw里的Android快捷方式仅指向本机 `E:\Android`，不是仓库内可下载的模拟器镜像；AVD/SDK/设备密文主存储和冻结dist均在忽略目录，不在远端。

云端有KVM/SDK时可创建新的空白隔离合成环境，保留目录边界、manifest和安装标记校验，改造路径须测试；不能为连接真实设备而关guard、擦除原AVD或复制用户资料。没有设备/虚拟化时明确该项NOT RUN/BLOCKED，仍可继续独立的代码和Node/Web工作；用户已允许模拟器，缺真机不再作为整体停工理由。

`.enc` QA文件仅是已明确隔离的608条消息合成基线，测试口令由已有QA脚本提供；不是用户备份或真实凭据。正式代码不能依赖这些测试路径/口令。

## 7. Git 收尾规则

本次用户已明确授权普通提交并推送 Kanata，包括未完成P7检查点。Git清单与最终摘要随本文件一起提交；具体交接提交SHA由当前提交/远端分支确定。未推送main、未强推、未建PR、未发安装包。云端继续遵循用户原本“阶段验收后检查点”的规则，新的远端推送或发布按后续明确授权执行，不将本次交接推送解释为无限自动发布授权。
