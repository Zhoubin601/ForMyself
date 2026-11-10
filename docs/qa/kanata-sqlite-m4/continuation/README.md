
# Kanata SQLite M4 续作 QA：接管、实施和证据

任务来源：[锁定的续作任务书](../../../20261110-kanata-sqlite-m4-continuation-task-v1.md)、[验收 v2](../../../20261109-kanata-sqlite-m4-acceptance-v2.md)、[Completion QA](../completion/README.md)与 [历史自检](../completion/reviews.md)。产品依据：`raw/彼方 · Kanata 技术设计.txt` §3、§6，以及续作任务书中的已确认群聊规则。未读取真实存储资料。

本地在 `.worktrees/kanata-m0` 使用 M。接管时 clean、HEAD `e296b2c5dd082f35b95c943bd838e3fe6a506357`；`git fetch origin M` 和 `git ls-remote origin refs/heads/M` 得到 `428b7bcfeffe2722e72b4809a6d1a82b5734aeb1`。核对两个提交均只改文档和 README 后，以 `git merge --ff-only origin/M` 更新。主工作树仍在 `main` 及原有 4 个过程文档修改、1 个 APK 删除、未跟踪资料；另外的 `Kanata` 工作树未切换。未执行 reset、clean、stash 或恢复删除项。

[新基线原始日志](r0-check.txt.gz)：`npm.cmd run check` 退出 0，Node 661、Vue 392，lint、strict、构建通过。[历史 106 项定向](../completion/evidence/directed-final.txt) 是独立命令，[历史 660 Node / 392 Vue](../completion/evidence/check-final-retest.txt) 是 v2 代码树完整测试。e296b2c 在原有独立建群验证基础上增加一条隔离测试，因此此树为 661；两条 GROUP 定向测试属于 Node 子集。历史压缩的失败 check 仍保留（657 中 2 失败、660 中 1 失败），不能用作通过证据。

## 基线候选链路与缺口

| 项 | Vue / Store 局部状态 | Runtime → Repository | 权限和事务 | 既有测试、未验收范围 |
| --- | --- | --- | --- | --- |
| A | Workspace、GroupEditor；世界/角色列表分页 | SqliteWorldRuntime → worlds、conversations、managementView | 世界 owner、可写世界、CAS 和建群回执 | 独立建群、身份和归档已有；成员编辑、世界创建与完整配置缺失 |
| B | CandidateCardLibrary；单卡草稿与版本标题页 | openCards → characters | 会话 owner、不可变版本、发布 CAS | 合成卡片库部分通过；原生选择往返和实例加入/同步缺 |
| C | CandidateLoreEditor；单条编辑和角色页 | select → lorebook | 世界 owner、revision 与 scope | 有 CRUD；角色预览、legacy 排序等价与完整设备矩阵待验 |
| D | CandidateMemoryDetail；单正文和来源页 | select → memories、provenance | actor/世界/来源 revision 授权后读 | 深链已有；整理、冲突、分享和宽/混合增长未闭环 |
| E | Workspace 因果页 | select → events、dependent writes | 有作用域和 CAS；撤销兼容入口 JS 集合无界 | 因果页已有；候选确认/撤销/审计和 Effects 重放未闭环 |
| F | Workspace 任务、权限与 CandidateBindings | select、openBindings → autonomy、roleBindings | 世界与全局绑定分开；水位事务 | 权限/窗口与绑定部分验证；联系、社交、设置和生活消费者待接 |
| G | CandidateHistoryPanel；消息窗口与历史 | SqliteChatRuntime → chatView、messages | 会话 owner、作用域与精确引用 | 检索/定位/引用已有；候选整理预览和执行缺失 |

所有候选访问继续经过 SqliteCandidate 保护租约，生产 legacy 保持不变。基线矩阵只标示已定位入口，不等同完整 A–G 验收。

## 环境、命令和证据

- [设备 manifest](device-manifest.json) 与 [最终设备包清单](delivery-device-identity.json)：全新隔离 AVD，`emulator-5582` / `kanata_m2_api34`，WHPX，API 34，x86_64，系统指纹 `google/sdk_gphone64_x86_64/emu64xa:14/UE1A.230829.050/12077443:userdebug/dev-keys`。基线仅用户 0、无第三方应用；仅安装 `com.yubin.formyself.m2qa` 与 instrumentation 包。使用 SQLCipher 4.17.0 community。
- R0 接管前本地生成物 SHA-256：候选目录中原 APK `EBE44DB76898E784789C6E2662A012C259A33C0526CF006C8576C59D5A5E7042`，instrumentation `1F92E96FFBA6DF63B4662E6FEBDBA6B99D4C9A93C6D2C31AA12843F4DB0BC03E`，原生成 catalog `E2F36365FFB03B6ACCB1A25823580A5B8B8DF45A8CDAC106E5D2F02DA87CFA2C`。这些只是磁盘基线指纹。
- [受测源码树与文件 SHA](tested-files-sha256.json)、[候选原生构建](delivery-candidate-build.txt)、[候选 catalog](delivery-candidate-catalog.txt)、[安装读回 APK SHA](delivery-device-apk-sha256.txt)、[instrumentation](delivery-device-instrumentation.txt)、[最终设备输出](delivery-device-result.txt) 与 [退出码](delivery-device-exit.txt)。设备输出首部记录经 CDP 加载的候选 JS bundle SHA，区分原生 APK 和 WebView 受测代码。
- R1–R3：[GROUP 红测](r1-group-red.txt)、[GROUP 定向复测](r2-group-node-retest.txt)、[GROUP Vue](r2-group-vue.txt)、[Effects 红测](r3-replay-red.txt.gz)、[Effects 主机](r3-replay-host.txt)、[撤销确认红测](r3-confirm-red.txt)、[首次 Effects 夹具失败](r3-replay-result.txt)、[真实 COMMIT 失败与重试](r3-confirm-result.txt)。
- R4–R6：[分享红测](r4-share-red.txt)、[冲突红测](r4-conflicts-red.txt)、[首轮设备超时](r4-device-result.txt)、[分档设备复测](checkpoint-retest-result.txt)、[宽来源、混合来源与尾部 revision 主机](r4-growth-host.txt)、[角色世界书和空白世界](r5-final-node.txt)、[管理页面生命周期](r6-management-vue.txt.gz)。
- R7：[完整 check](check-delivery.txt.gz)、[115 项定向](directed-delivery.txt)、[普通 APK](default-gate.json)、[普通 catalog SHA](default-catalog-sha256.txt)、[普通 catalog 合成种子核验](default-seeds.txt)、[普通 APK 构建](default-build.txt)。
- R8：[两轮反例复核](reviews.md)、[验收 v3 检查点](../../../20261110-kanata-sqlite-m4-acceptance-v3.md)。原始失败不覆盖。记录中的 shell 失败（Windows PowerShell 5 将 esbuild 警告当成异常）由 PowerShell 7 重跑排除。

命令从 M 工作树运行，设备路径使用本次启动返回的 manifest，不使用日常设备：

```powershell
npm.cmd run check
node --test tests/kanataSqliteDomains.test.js tests/kanataSqliteChatView.test.js tests/kanataSqliteDriver.test.js tests/kanataSqliteRepository.test.js tests/kanataSqliteSchema.test.js tests/kanataConversation.test.js tests/kanataAutonomy.test.js tests/kanataExperience.test.js
$manifest = & docs/qa/kanata-sqlite-m2/start-windows-synthetic-avd.ps1
$run = Split-Path -Parent $manifest
# 核对指定 AVD 启动、API、包清单以后继续。
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
pwsh -NoProfile -File docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory (Join-Path $run 'delivery-device') -Mode full -M4Growth -M4Completion
node node_modules/@capacitor/cli/bin/capacitor sync android
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=false :app:assembleDebug
& docs/qa/kanata-sqlite-m4/verify-default.ps1
node docs/qa/kanata-sqlite-m4/completion/verify-catalog.mjs android/app/build/generated/kanataSqlite/assets/kanata-sqlite-catalog.json
```
