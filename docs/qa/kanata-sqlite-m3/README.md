# Kanata SQLite M3 QA

[任务书](../../20261109-kanata-sqlite-m3-task-v1.md) · [设计](../../20261109-kanata-sqlite-m3-design-v1.md) · [验收](../../20261109-kanata-sqlite-m3-acceptance-v1.md)

测试在 Windows / Node 24.14.1、JDK 21 和新建 WHPX API 34 合成 AVD 执行。设备包使用 `com.yubin.formyself.m2qa`，复用 M2 的专用启动、包名验证、安装读回及 WebView 驱动。M3 场景定义在 [device-scenario.mjs](device-scenario.mjs)。原生 SQLCipher 为 4.17.0 Community。实际操作仅限合成 AVD，模型为受控调用。

## 复现

```powershell
node --test tests/kanataSqliteDomains.test.js
npm.cmd run check
$manifest = & docs/qa/kanata-sqlite-m2/start-windows-synthetic-avd.ps1
$run = Split-Path -Parent $manifest
# 等待 manifest 所指设备的 sys.boot_completed=1，再继续。
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
& docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory (Join-Path $run 'm3-full') -Mode full
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=false :app:assembleDebug
```

普通构建取证比较生成的 BuildConfig、实际 APK applicationId 与打包 SQL 目录。设备全量模式还执行 M2 现有的会话、消息、删除派生、群聊、延迟回复、错误密钥、挑战、后台租约和未来 Schema 回归。

## 证据

- [汇总与文件指纹](evidence/summary.json)、[完整 npm check](evidence/npm-check.txt.gz)和 [M3 定向结果](evidence/directed.txt)。
- [Android JS→SQLCipher 结果](evidence/android-result.txt)、[Instrumentation](evidence/instrumentation.txt)、[设备](evidence/device.json)及[安装读回 SHA](evidence/apk-sha256.txt)。
- [候选构建](evidence/candidate-build.txt.gz)、[普通构建](evidence/default-build.txt.gz)与[默认关闭门禁](evidence/default-gate.json)。
- [冷启动 CDP 超时](evidence/android-cold-timeout.txt)、[冷启动日志](evidence/android-cold-logcat.txt.gz)和[复测日志](evidence/android-logcat.txt.gz)。同一候选重试通过。
- [初次 npm check 失败保留](evidence/npm-check-first.txt.gz)。三个旧断言受新 Schema 影响，分别修正为比较新增归档外键、验证第 004 版已应用，以及通过版本插入检查原始卡片 payload 保真，同时单独验证旧版不可更新。

设备 APK、密钥和 AVD 文件存留于本机 QA 目录。测试输出只记录合成内容或固定状态，不写入口令或密钥。
