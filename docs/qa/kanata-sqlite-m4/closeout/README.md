# M4 收尾验证

**当前执行入口：** [M4-R 最终收尾任务书 v1](../../../20261110-kanata-sqlite-m4-r-closeout-task-v1.md)。接管基线 d1737e7d598a14ec3f3ef1febd0bf8be050edbe2。M4 BLOCKED，M5 NO。P0 为 Android 10k 宽事件确认超时与 G4 provenance 全链路有界性；本目录现有日志为历史 v4 证据，不得冒充 M4-R 新复测。

[接管与缺口矩阵](matrix.md) · [验收 v4](../../../20261110-kanata-sqlite-m4-acceptance-v4.md) · [本轮复核](reviews.md) · [v3 历史证据](../continuation/README.md)

| 切片 | 可复现证据 |
| --- | --- |
| G4 聊天 | [1,000 条数组红测](g4-red.txt.gz) · [主机回归与暂存采样](g4-host-retest.txt) · [兼容入口回归](memory-compat-host.txt) |
| D 分享 | [撤回接口红测](share-red.txt) · [回滚、幂等和转分享拒绝](share-host.txt) · [自定义合并及精确引用](merge-correction-host.txt) |
| E 事件 | [同目标重放和不可变逐项影响审计](event-audit-host.txt) · [宽确认、中断、重试](event-wide-host.txt) · [写入批处理复测](event-batch-host.txt) · [主机查询计划](event-query-plan-host.txt) |
| G 历史 | [预览 CAS、引用保护、写失败回滚、重复确认](history-host.txt) |
| 全量 | [原始失败](check.txt.gz) · [最终 lint、Node、Vue、strict 和构建](check-delivery.txt.gz) · [121 项定向](directed-delivery.txt) |
| Android | [初轮驱动失败](device-first-result.txt) · [首次通过的提示词和撤回复测](device-retest-result.txt) · [逐行写入时 10k 超时](device-wide-before-batching.txt) · [最终设备](device-delivery-result.txt) · [设备退出码](device-delivery-exit.txt) · [安装读回 SHA](device-delivery-apk-sha256.txt) · [Instrumentation](device-delivery-instrumentation.txt) |
| 普通 APK | [默认门禁](default-gate.json) · [构建](default-build.txt) · [种子核验](default-seeds.txt) |

[设备身份和应用白名单](device-identity.json)。Android 仅使用已经核实的 `emulator-5582`、`kanata_m2_api34`、API 34、SQLCipher 4.17.0。候选 WebView 驱动只注入合成 provider。候选 APK、测试 APK、WebView bundle、catalog 与代码树分别记指纹。[受测源码和夹具 SHA](tested-files-sha256.json) · [候选 catalog SHA](device-delivery-catalog.txt) · [普通 catalog SHA](default-catalog-sha256.txt)

```powershell
npm.cmd run check
node --test tests/kanataSqliteChatView.test.js tests/kanataSqliteDomains.test.js tests/kanataSqliteRepository.test.js tests/kanataSqliteDriver.test.js tests/kanataSqliteSchema.test.js tests/kanataConversation.test.js tests/kanataAutonomy.test.js tests/kanataExperience.test.js
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
pwsh -NoProfile -File docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory $evidence -Mode full -M4Growth -M4Completion
node node_modules/@capacitor/cli/bin/capacitor sync android
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=false :app:assembleDebug
& docs/qa/kanata-sqlite-m4/verify-default.ps1
node docs/qa/kanata-sqlite-m4/completion/verify-catalog.mjs android/app/build/generated/kanataSqlite/assets/kanata-sqlite-catalog.json
```

首次全量失败是候选事件控件用了原生 select，触发仓库表单控件门禁。改为有标签的 radio 组后复测通过。首次设备失败由合成 provider 对所有历史消息匹配同一句标记导致。修复为只匹配当前用户消息，后续设备复测通过。前次失败保留以供追溯。

最终 Android 候选轮通过聊天来源、分享撤回、事件账本、世界设置、历史整理和 1,001 条宽事件确认。后者为 6,412 ms、22 次查询、18 次写入，每批最多 128 行。10k 宽事件确认在 420 秒超时，未取得回执，驱动退出 1。10k 深链、宽来源、混合关系和 Effects 可在前次设备复测中单独核对。

主机 `heapUsed` 是分配/GC 会影响的进程采样，Android `performance.memory` 是 WebView 粗粒度采样。两者均不能代替完整堆峰值。单批 SQL 行数、每次编码对象数、Pinia 状态计数和 VM 窗口分别记录。
