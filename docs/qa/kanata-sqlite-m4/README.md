# Kanata SQLite M4 QA

[任务书](../../20261109-kanata-sqlite-m4-task-v1.md) · [Preflight](../../20261109-kanata-sqlite-m4-preflight-v1.md) · [设计](../../20261109-kanata-sqlite-m4-design-v1.md) · [验收](../../20261109-kanata-sqlite-m4-acceptance-v1.md) · [两轮自检](reviews.md)

## 复现

使用 Windows、Node 24.14.1、JDK 21、Android SDK 和 API 34 x86_64 镜像。运行目录为 M 工作树。设备命令使用全新 WHPX AVD 和合成包，按 manifest 核验序列号、API、三方应用及安装后 APK 的 SHA-256。启动脚本及测试脚本拒绝非合成目标。测试密钥和 AVD 留在本机。

```powershell
npm.cmd run check
node --test tests/kanataSqliteChatView.test.js tests/kanataSqliteDriver.test.js tests/kanataSqliteRepository.test.js tests/kanataSqliteDomains.test.js tests/kanataSqliteSchema.test.js tests/kanataConversation.test.js tests/kanataAutonomy.test.js tests/kanataExperience.test.js
$manifest = & docs/qa/kanata-sqlite-m2/start-windows-synthetic-avd.ps1
$run = Split-Path -Parent $manifest
# 等待 manifest 所指设备的 sys.boot_completed=1，再核对设备及三方应用。
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
& docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory (Join-Path $run 'm4-final') -Mode full -M4Growth
node node_modules/@capacitor/cli/bin/capacitor sync android
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=false :app:assembleDebug
& docs/qa/kanata-sqlite-m4/verify-default.ps1
```

## 证据

- [机器汇总](evidence/verification-summary.json)、[受测文件 SHA](evidence/tested-files-sha256.json)、[数据种子](fixture.mjs)、[Schema 001–004 基线校验和](../kanata-sqlite-m3/evidence/schema-fingerprints.json)。
- [基线 check](evidence/baseline-check.txt)、[基线定向](evidence/baseline-directed.txt)、[最终定向](evidence/directed-final.txt)、[最终全项目 check](evidence/check-final.txt)。
- [Android 原始结果](evidence/android-final-result.txt)、[原生日志](evidence/android-final-logcat.txt.gz)、[Instrumentation](evidence/android-final-instrumentation.txt)、[设备和停止状态](evidence/android-final-device.json)、[APK 安装读回 SHA](evidence/android-final-apk-sha256.txt)、[候选 SQL catalog SHA](evidence/candidate-catalog-sha256.txt)。
- [候选构建](evidence/candidate-final-build.txt)、[普通 Debug 构建](evidence/default-build.txt)、[默认关闭和历史 Schema 校验](evidence/default-gate.json)。
- 过程失败保留 [初始探针](evidence/probe-before.txt)、[设备退出](evidence/android-scoped.txt)、[TS 局部绑定失败](evidence/type-permission-prefilter.txt)及[早期工作区设备通过](evidence/android-workspace.txt)。最终结果以 `m4-final` 实跑为准。工作区中间并行 check 曾读到正在编辑的代码并失败，最终 check 在代码固定后退出 0。
