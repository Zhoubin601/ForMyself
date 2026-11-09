# M4 Completion QA

[任务书](../../../20261109-kanata-sqlite-m4-completion-task-v1.md) · [Preflight](../../../20261109-kanata-sqlite-m4-completion-preflight-v1.md) · [设计](../../../20261109-kanata-sqlite-m4-completion-design-v1.md) · [验收 v2](../../../20261109-kanata-sqlite-m4-acceptance-v2.md) · [两轮自检](reviews.md)

## 复现

Windows PowerShell、Node 24、JDK 21、WHPX、API 34 x86_64。仅使用新建合成 AVD、合成数据及 `com.yubin.formyself.m2qa` 测试包。等待 manifest 指定设备完成启动并核对包清单后运行。

```powershell
npm.cmd run check
node --test tests/kanataSqliteDomains.test.js tests/kanataSqliteChatView.test.js tests/kanataSqliteDriver.test.js tests/kanataSqliteRepository.test.js tests/kanataSqliteSchema.test.js tests/kanataConversation.test.js tests/kanataAutonomy.test.js tests/kanataExperience.test.js
$manifest = & docs/qa/kanata-sqlite-m2/start-windows-synthetic-avd.ps1
$run = Split-Path -Parent $manifest
# 在指定合成 AVD 完成启动后继续。
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
& docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory (Join-Path $run 'completion-qa') -Mode full -M4Growth -M4Completion
node node_modules/@capacitor/cli/bin/capacitor sync android
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=false :app:assembleDebug
& docs/qa/kanata-sqlite-m4/verify-default.ps1
node docs/qa/kanata-sqlite-m4/completion/verify-catalog.mjs android/app/build/generated/kanataSqlite/assets/kanata-sqlite-catalog.json
```

## 群聊成员变更验收用例

均使用同世界合成角色 A、B、C，另准备异世界角色 X。已有历史的原群包含 A、B，并至少有一条消息和一条引用该消息的回复。最终验收从候选成员编辑入口操作，在 SQLite 读回会话、成员与消息，并在 Android 合成 AVD 复跑。

| 编号 | 操作 | 预期 | 当前验证范围 |
| --- | --- | --- | --- |
| GROUP-01 | 将空群成员由 A、B 改为 A、C | 保留原 conversation ID，仅更新成员，仍无消息，未增加会话 | 待候选编辑入口验证 |
| GROUP-02 | 将有历史的原群成员由 A、B 改为 A、C，确认另建 | 获得独立 conversation ID，新成员名单为 A、C。原群 ID、revision、成员、消息及引用保持原样。历史仅剩归档或软删除记录时也应走此分支 | SQLite 主机覆盖独立建群和原数据保留。编辑确认、归档与软删除分支待测 |
| GROUP-03 | 在新群搜索、定位、引用原群消息并读取 C 的角色上下文。随后回到原群用 B 读取历史 | 新群初始历史为空，原群消息及引用在新群不可访问。原群的引用和 B 的历史上下文继续按现行规则可读 | SQLite 主机覆盖 Repository 作用域。候选 UI 和 Android 待测 |
| GROUP-04 | 在空群和历史群编辑分别选入 X 并提交 | 拒绝提交，原群无变化，也无新会话 | SQLite 主机覆盖独立建群拒绝。编辑分支待测 |
| GROUP-05 | 打开空群草稿后并发写入首条消息，再提交草稿。另测取消另建、提交失败和重试 | 不得原地覆盖已有历史的成员。取消或失败不建群，重试最多创建一个新群 | 待候选编辑事务与 Android 验证 |

主机回归命令为 `node --test --test-name-pattern='C3 new group' tests/kanataSqliteDomains.test.js`。本轮主机定向回归 2 项通过。`npm.cmd run check` 退出 0，661 项 Node 测试、392 项 Vue 测试、strict 类型检查与构建通过。独立建群用例覆盖现有 Repository 边界，成员编辑端到端以此表逐项验收。

## 证据

- [基线 check](evidence/baseline-check.txt)、[定向最终](evidence/directed-final.txt)、[完整 check 最终](evidence/check-final-retest.txt)。
- [逐条消息旧链反例](evidence/source-chain-before.txt)、[共享链失败后的重测](evidence/chain-retest.txt)及[原生选择控件门禁重测](evidence/ui-feedback-retest.txt)。
- [最终设备结果](evidence/android-final-result.txt)、[安装读回 SHA](evidence/android-final-apk-sha256.txt)、[设备](evidence/android-final-device.json)、[Instrumentation](evidence/android-final-instrumentation.txt)和 [logcat](evidence/android-final-logcat.txt.gz)。
- [普通 APK](evidence/default-gate.json)、[普通 APK 种子核验](evidence/default-seeds.txt)、[候选 catalog SHA](evidence/candidate-final-catalog-sha256.txt)、[合成种子](fixture.mjs)、[机器汇总](evidence/summary.json)、[受测文件指纹](evidence/tested-files-sha256.json)。
- [第一次设备结果](evidence/android-first-result.txt)及[中间复测](evidence/android-retest-result.txt)保留用于区分阶段证据。此前 M4 QA 保持原样。

完整失败日志保留 [部分索引计划失败](evidence/check.txt.gz) 和 [原生下拉门禁失败](evidence/check-final.txt.gz)。两项修复后分别复测了真实 SQLite 和全项目检查。

[最终候选构建](evidence/candidate-delivery-build.txt)、[真设备驱动](evidence/android-delivery-driver.txt)、[真设备退出码](evidence/android-delivery-exit.txt)、[普通 APK 构建](evidence/default-build.txt)。
