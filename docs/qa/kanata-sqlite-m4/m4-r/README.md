# Kanata SQLite M4-R QA

最新 ER1 执行结果：[BLOCKED 验收 v4](../../../20261111-kanata-sqlite-mr2-g4-acceptance-v4.md) · [事件兼容证据](event-compat/README.md)。Runtime 无消费者旧包装已删；Repository 完整回退、纯领域原始数组顺序证明与 ER1 专用设备/Heap 矩阵未完成。ER1/G4/MR2/M4 BLOCKED，M5 NO。下文保留历史证据及其原范围。

[M4-R 执行任务书](../../../20261110-kanata-sqlite-m4-r-closeout-task-v1.md) · [事件来源写入任务书](../../../20261110-kanata-sqlite-mr2-event-provenance-task-v1.md) · [事件读取与兼容任务书](../../../20261110-kanata-sqlite-mr2-g4-event-read-compat-task-v1.md) · [接管矩阵](matrix.md) · [历史验收与证据](../closeout/README.md)

本目录区分历史通过切片、本轮实测、复现与待验。本轮事件写入实现提交 fbc8ee344d6e61aef85bf6296ac5cbd4148d2eeb，M 分支验收 HEAD fd9f23dd39d4f8a0ab42a94f3e3a4e46de98f6e6。候选事件提议、提交和普通修正写入定向 PASS；readFor/list/eventFromRow、effects/audits、旧命令回读与旧 preview 仍有完整对象物化。MR0、MR1 PASS；MR2/G4 BLOCKED；M4 BLOCKED，SQLite 阶段 M5 NO。下一执行切片见 [事件读取与旧兼容边界有界化任务书](../../../20261110-kanata-sqlite-mr2-g4-event-read-compat-task-v1.md)。启动时仍须重新 fetch M。本任务书从属于 M4-R 总任务书，不代表 G4/MR2/M4 已通过。测试仅连接已核对的隔离合成 AVD，所有 provider 为合成实现。

## MR1 原始超时复现

在原事件仓库 SQL 上运行完整候选驱动，保留 420,000 ms deadline。基线驱动退出 1，10k 综合样本在撤销确认阶段超时。单独的宽事件夹具通过，10,001 条确认耗时 16,689 ms，164 次查询、160 次写入、批次最多 128 行。两者的差异是综合夹具同世界同时含 10k 深链和 10k 其他 Effects。

- 10k 综合基线中，Effects 重放完成于第 103,799 ms，扇出种子完成于第 241,794 ms，之后预览耗时 9,447 ms，续页耗时 9,331 ms。
- 审计的原生查询计划显示自有 Effects 子查询使用 sqlite_autoindex_world_effects_2，仅约束 world_id。实际综合确认的慢批次中，writeAudit 桥接往返最高 10,508 ms，原生计时同量级。对照同批 selectionBatch 约 0.1–0.2 秒，statusUpdate 为数十毫秒。
- 合成边写入另有慢点。主机 SQLite 执行冻结防环触发器的等价递归，未分析时按 world_id 扫索引。临时 ANALYZE 后使用主键索引的 world_id 与 event_id 两列。主机同量 10,000 边对照 11,454 ms 与 124 ms。

修复让审计从已有 effects_by_event 索引按事件查找，再对该事件的 Effects 按 ID 排序。原有逐项快照、Effect 数量核对、CAS、回执与原子事务保留。合成夹具只在加载扇出边时临时使用 event_causes 统计，确认开始前清除该统计并重新加载 SQLite 统计，继续使用正常运行参数。DDL、索引定义、Schema 001–004 校验和、样本规模及 deadline 均保留。

## MR1 复现命令

从隔离 M 根目录执行。manifest 指向已重新核验的 M2 Windows/WHPX 合成 AVD，evidence 需要是其中的新目录。完整驱动会重置该独立合成包。

```powershell
npm.cmd run check
node --test tests/kanataSqliteDomains.test.js tests/kanataSqliteRepository.test.js tests/kanataSqliteDriver.test.js tests/kanataSqliteSchema.test.js
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
pwsh -NoProfile -File docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory $combined -Mode full -M4Growth -M4Completion
pwsh -NoProfile -File docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory $recovery -Mode mr1-verify
```

只在该 AVD 可设置 log.tag.KanataSqliteQA 为 DEBUG，采集 native cursor/写入和 COMMIT 耗时。日志包含语句指纹、计数、耗时和参数大小。CDP 提供同轮桥接往返，按阶段记录和汇总。两种计时口径分别保存。

## MR1 修复复测 · PASS

| 合成 Android API 34 / SQLCipher 4.17.0 | 1k | 10k |
| --- | ---: | ---: |
| 综合样本全阶段 | 8,382 ms | 152,744 ms |
| 综合样本确认阶段 | 995 ms | 22,169 ms |
| 首批状态和审计写入后强停，重开后确认 | 2,354 ms | 55,449 ms |
| 重开确认查询 / 写入 | 38 / 20 | 329 / 162 |
| 确认和逐项核验成功的独立审计 | 1,001 | 10,001 |
| 桥接业务批次最高行数 | 128 | 128 |

10k 综合确认执行了 79 批审计写入，单批桥接最大 52 ms，COMMIT 往返 200 ms。两档均在实际写入第一批审计后 SIGKILL。重开前后进程 ID 不同。重开读取确认原事件、审计和回执整批回滚。同一个冻结计划重试后，按事件与 Effect 精确对照目标、路径、操作、版本和值。最终状态回到独立事件的保留位置。重放返回同一结果，持久回执和审计计数一致。普通 APK 的激活位为 false，无合成页面、种子或 MR1 查询探针。

最终 MR1 的 npm check 退出 0，676 项 Node、397 项 Vue，lint、strict 正负类型、生产构建通过。两项增强定向用例是 Node 子集。完整设备轮和强停轮退出 0。GROUP-01～05 在综合轮随共享入口回归。

- [综合基线结果](mr1-combined-baseline-result.txt.gz) · [原生计时](mr1-combined-baseline-native.txt.gz) · [基线退出码](mr1-combined-baseline-exit.txt)
- [修复后综合结果](mr1-combined-result.txt.gz) · [原生计时](mr1-combined-native.txt.gz) · [退出码](mr1-combined-exit.txt)
- [强停复测](mr1-recovery-result.txt.gz) · [原生计时](mr1-recovery-native.txt.gz) · [退出码](mr1-recovery-exit.txt)
- [汇总](mr1-metrics.json) · [主机 check](mr1-check.txt.gz) · [主机定向](mr1-directed-host.txt) · [普通 APK 门禁](mr1-default-gate.json) · [源码与数据指纹](mr1-tested-files-sha256.json) · [候选 catalog SHA](mr1-fixed-catalog-sha256.txt)
- [Android 进程 RSS/PSS 采样](mr1-device-memory-samples.txt)。这是 App 进程的间隔采样，保留 WebView 整链堆峰值和 G2 验证为待验。
- [MR2 G4 入口审计](g4-call-map.md)。

## MR2 已验证切片 · G4 仍 BLOCKED

记忆详情、兼容 readFor、精确来源解析和有角色后台任务对规范化回复链在 SQLite 内验证生活授权。无角色任务在 SQL 内只检查是否存在生活标签。传入单项来源时使用相同的授权谓词，来源与接收者的读、记、分享范围独立。正文读取沿用先验 scope 和精确消息 revision 的顺序。现有公开 Repository 契约沿用。

| Android 不同来源角色及授权 | 1,000 | 10,000 |
| --- | ---: | ---: |
| 详情及精确来源成功读取总查询数 | 25 | 25 |
| 最高 SQL 返回行数 | 1 | 1 |
| 跨桥生活标签 | 0 | 0 |
| 撤销其中一项授权后的正文读取数 | 0 | 0 |

仍有风险的真实入口和旧兼容链路见 [G4 调用审计](g4-call-map.md)。详细反例及复测状态见 [两轮检查点复核](reviews.md)。两轮仍缺完整产品、生命周期和故障证据。

```powershell
node --test --test-name-pattern 'MR2 memory detail|remember, read and share|candidate share|task' tests/kanataSqliteDomains.test.js
pwsh -NoProfile -File docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory $grants -Mode mr2-grants
```

[两档设备结果](mr2-grants-result.txt) · [设备退出码](mr2-grants-exit.txt) · [综合回归](mr2-regression-result.txt.gz) · [综合退出码](mr2-regression-exit.txt) · [主机定向](mr2-directed-host.txt) · [全量 check](mr2-check.txt.gz) · [候选 catalog](mr2-catalog-sha256.txt) · [源码与夹具指纹](mr2-tested-files-sha256.json) · [普通 APK](mr2-default-gate.json)。

主机独立权限对照通过 1,024 种同角色与跨角色权限组合，另覆盖 5 种身份、revision 和世界不匹配。运行 node docs/qa/kanata-sqlite-m4/m4-r/verify-grant-predicate.mjs。[权限对照日志](mr2-host-permission-equivalence.txt)

## MR2-G4 继续验证

本轮接管 8d3b8f768617143312fd800ab05decaa53d6114d。普通聊天用轻量消息投影与 SQL 权限。回复事务在 SQLite 内存工作表按原顺序保存标签。记忆和事件提示词不返回完整标签数组。历史归档在 SQL 内保护嵌套扩展中的精确引用。自治 claim/finish 的来源检查改为分页校验。

```powershell
npm.cmd run check
node --test --test-name-pattern 'MR2 wide chat|candidate history archive' tests/kanataSqliteChatView.test.js
node docs/qa/kanata-sqlite-m4/m4-r/verify-grant-predicate.mjs
node docs/qa/kanata-sqlite-m4/m4-r/verify-archive-extensions.mjs
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
pwsh -NoProfile -File docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory $wide -Mode mr2-chat-provenance
pwsh -NoProfile -File docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory $regression -Mode full -M4Growth -M4Completion
```

[M4-R MR2-G4 验收](../../../20261110-kanata-sqlite-mr2-g4-acceptance-v1.md) · [当前调用图](g4-call-map.md) · [增长与缺口矩阵](matrix.md) · [两轮复核](reviews.md)

| 同轮证据 | 原始结果 |
| --- | --- |
| 原始 420 秒 QA 超时 | [驱动](g4-run/01-qa-timeout.txt.gz) · [原生 SQL](g4-run/01-qa-timeout-native.txt.gz) |
| 撤权正文反例 | [复测失败](g4-run/02-revoked-body-red.txt.gz) |
| SQL 优化前 | [设备回执](g4-run/03-wide-before-sql-plan.txt.gz) · [原生计时](g4-run/03-wide-before-sql-plan-native.txt.gz) |
| 最终设备综合回归 | [驱动](g4-run/04-combined.txt.gz) · [APK 指纹](g4-run/04-combined-apk-sha256.txt) |
| 最终设备宽授权及故障 | [provider JSON 和回执](g4-run/05-wide.txt.gz) · [原生 SQL](g4-run/05-wide-native.txt.gz) · [APK 指纹](g4-run/05-wide-apk-sha256.txt) · [汇总](g4-run/summary.json) |
| 主机 | [全量 check](g4-run/check.txt.gz) · [宽标签定向](g4-run/wide-host.txt) · [权限对照](g4-run/grant-predicate.txt) · [旧归档对照](g4-run/archive-oracle.txt) |
| 指纹与边界 | [源文件与夹具](g4-run/fingerprints.json) · [候选 catalog](g4-run/catalog-sha256.txt) · [普通 APK](g4-run/default-gate.json) · [PSS/RSS 采样](g4-run/memory-samples.txt) |

## MR2-G4 事件来源 · 当前检查点

实施提交 `fbc8ee344d6e61aef85bf6296ac5cbd4148d2eeb`。候选写入定向通过，G4、MR2、M4 仍 BLOCKED，M5 NO。

```powershell
npm.cmd run check
node --experimental-sqlite --test --test-name-pattern 'correcting|M3 revoke|write acknowledgements|duplicate or damaged' tests/kanataSqliteDomains.test.js
npx.cmd cap sync android
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
pwsh -NoProfile -File docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory $event -Mode mr2-event-provenance
pwsh -NoProfile -File docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory $regression -Mode full -M4Growth -M4Completion
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=false :app:assembleDebug
pwsh -NoProfile -File docs/qa/kanata-sqlite-m4/verify-default.ps1
node docs/qa/kanata-sqlite-m4/completion/verify-catalog.mjs android/app/build/generated/kanataSqlite/assets/kanata-sqlite-catalog.json
```

| 证据 | 文件 |
| --- | --- |
| 旧观察分类失败 | [第一轮](event-provenance-run/01-bounds-result.txt) · [第二轮](event-provenance-run/02-bounds-result.txt) · [第三轮明细](event-provenance-run/03-counter-result.txt) · 各轮原始 logcat 和 APK 指纹保留于同目录 |
| 定向通过 | [原始设备回执](event-provenance-run/04-event-device.txt.gz) · [原始 logcat](event-provenance-run/04-event-native.txt.gz) · [Java instrumentation](event-provenance-run/04-instrumentation.txt) · [APK 指纹](event-provenance-run/04-apk-sha256.txt) |
| Android 综合通过 | [原始设备回执](event-provenance-run/05-full-device.txt.gz) · [原始 logcat](event-provenance-run/05-full-native.txt.gz) · [APK 指纹](event-provenance-run/05-apk-sha256.txt) |
| 取证与边界 | [数据指纹、WebView 堆与进程快照](event-provenance-run/device-summary.json) · [源码指纹](event-provenance-run/fingerprints.json) · [候选 catalog](event-provenance-run/candidate-catalog-sha256.txt) · [普通 APK](event-provenance-run/default-gate.json) |
| 主机 | [定向](event-provenance-run/host-directed.txt) · [严格类型](event-provenance-run/strict.txt) · [全量 check](event-provenance-run/check.txt.gz) |
| 验收 | [验收 v2](../../../20261110-kanata-sqlite-mr2-g4-acceptance-v2.md) · [当前调用图](g4-call-map.md) · [增长与缺口矩阵](matrix.md) · [两轮复核](reviews.md) |


## MR2-G4 事件读取与旧兼容边界 · 下一执行切片

- [验收 v2](../../../20261110-kanata-sqlite-mr2-g4-acceptance-v2.md) 已记录候选写入切片通过及全部未关闭项。
- [事件读取与旧兼容边界有界化任务书](../../../20261110-kanata-sqlite-mr2-g4-event-read-compat-task-v1.md) 聚焦完整 Event / Effect / Audit 物化、旧 preview 确认集合、兼容命令回读和 relationship.sourceEventIds。
- 当前候选事件台的 managedEvent、graphPage、openRevocation、revocationAudits、revocationEffectAudit 为已建立的有界路径，后续不得回退。
- 每档独立峰值内存、深链/宽扇出/混合角色交叉样本、事件专用生命周期矩阵仍须补齐。
- 历史字符串 action UTF-16 兼容回退必须保留并单独验收；普通消息兼容 DTO、自治 loadTask 和旧 JSON 导出仍是 G4 剩余缺口。
- G4、MR2、M4 继续 BLOCKED，SQLite 阶段 M5 继续 NO。

## 2026-11-11 MR2-G4 事件读取与兼容边界

最终代码点 `1ee65765e3942722750c3ff0a35cd9e4369c3915`，普通读取、图形状、权限反例与强停重放有定向证据。旧完整输出和全部页面/堆对象矩阵的剩余项见 [验收 v3](../../../20261111-kanata-sqlite-mr2-g4-acceptance-v3.md)。G4、MR2、M4 仍 BLOCKED，M5 NO。

```powershell
npm.cmd run check
npx.cmd cap sync android
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
pwsh -NoProfile -File docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory $directed -Mode mr2-event-read
pwsh -NoProfile -File docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory $full -Mode full -M4Growth -M4Completion
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=false :app:assembleDebug
pwsh -NoProfile -File docs/qa/kanata-sqlite-m4/verify-default.ps1
node docs/qa/kanata-sqlite-m4/completion/verify-catalog.mjs android/app/build/generated/kanataSqlite/assets/kanata-sqlite-catalog.json
```

| 读取证据 | 文件 |
| --- | --- |
| 最终 1k/10k、八种样本、权限及强停 | [原始设备回执](event-read-run/final-device.txt.gz) · [原始 logcat](event-read-run/final-native.txt.gz) · [APK 指纹](event-read-run/final-apk-sha256.txt) · [Java instrumentation](event-read-run/final-instrumentation.txt) |
| 内存与来源 | [每档每阶段 CDP heap、PSS/RSS 和查询画像](event-read-run/device-summary.json) · [数据表](event-read-run/sample-table.md) · [源文件及安装 catalog 指纹](event-read-run/fingerprints.json) |
| 最终综合回归 | [原始回执](event-read-run/regression-device.txt.gz) · [原始 logcat](event-read-run/regression-native.txt.gz) · [摘要](event-read-run/regression-summary.json) · [APK 指纹](event-read-run/regression-apk-sha256.txt) |
| 主机与普通 APK | [最终 check](event-read-run/check.txt.gz) · [默认门禁](event-read-run/final-default-gate.json) · [默认 catalog](event-read-run/final-default-catalog.txt) |
| 失败及中止 | [420 秒超时](event-read-run/03-420-timeout.txt.gz) · [原生日志](event-read-run/03-420-native.txt.gz) · [早期控制台反例摘录](event-read-run/host-early-failures.txt) · [中止说明](event-read-run/03-obsolete-runs.txt) · [证据索引](event-read-run/evidence-index.json) |

同目录 mr2-read-* 的压缩文件保留各轮已捕获 stdout/build/native 结果。源代码已替换后的长跑按 superseded 中止记录；未完成或中止轮次均不计 PASS。最终独立验证使用完整原规模与原 420 秒截止。临时 ANALYZE 仅用于合成建边，统计清除后执行业务路径，前后计划见最终 JSON 的 seedPlans。
