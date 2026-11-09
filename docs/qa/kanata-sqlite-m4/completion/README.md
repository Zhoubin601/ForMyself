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

## 证据

- [基线 check](evidence/baseline-check.txt)、[定向最终](evidence/directed-final.txt)、[完整 check 最终](evidence/check-final-retest.txt)。
- [逐条消息旧链反例](evidence/source-chain-before.txt)、[共享链失败后的重测](evidence/chain-retest.txt)及[原生选择控件门禁重测](evidence/ui-feedback-retest.txt)。
- [最终设备结果](evidence/android-final-result.txt)、[安装读回 SHA](evidence/android-final-apk-sha256.txt)、[设备](evidence/android-final-device.json)、[Instrumentation](evidence/android-final-instrumentation.txt)和 [logcat](evidence/android-final-logcat.txt.gz)。
- [普通 APK](evidence/default-gate.json)、[普通 APK 种子核验](evidence/default-seeds.txt)、[候选 catalog SHA](evidence/candidate-final-catalog-sha256.txt)、[合成种子](fixture.mjs)、[机器汇总](evidence/summary.json)、[受测文件指纹](evidence/tested-files-sha256.json)。
- [第一次设备结果](evidence/android-first-result.txt)及[中间复测](evidence/android-retest-result.txt)保留用于区分阶段证据。此前 M4 QA 保持原样。

完整失败日志保留 [部分索引计划失败](evidence/check.txt.gz) 和 [原生下拉门禁失败](evidence/check-final.txt.gz)。两项修复后分别复测了真实 SQLite 和全项目检查。

[最终候选构建](evidence/candidate-delivery-build.txt)、[真设备驱动](evidence/android-delivery-driver.txt)、[真设备退出码](evidence/android-delivery-exit.txt)、[普通 APK 构建](evidence/default-build.txt)。
