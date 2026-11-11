# ER1 事件兼容边界收口

执行依据：[ER1 任务书](../../../../20261111-kanata-sqlite-mr2-g4-event-compat-closure-task-v1.md)。接管基线 7b6884965051d0d0da154618d2231b429ab12b11；仅 M。

本轮检查点交付：**ER1 / G4 / MR2 / M4 BLOCKED，M5 NO。** 用户已指定纯领域为撤销唯一权威；原始领域数组顺序恢复未得到证明，按要求停止相关撤销改动。历史证据不冒充本轮复测。

- [ER1-0 调用矩阵](call-map.md)
- [旧契约与差异](compatibility-contract.md)

ER1-0 在修改生产源码前完成。相关调用原始输出见 inventory.txt；Git 状态见 git-preflight.txt。
后续先以 test-only Oracle 复现实例，再修改独立安全部分。不得删除字符串回退或改变撤销集合来消除测试失败。

## 实际结果

源码提交：6118e9cd9721fa51fe7571f17fc22cf1c2e6c305。后续证据提交仅改 docs/根规范/长期入口，不改该源码树。[指纹](fingerprints.json)固定 src/tests/scripts/Android test 的 Git tree 和逐文件 SHA-256、APK、catalog、夹具与日志。main/Kanata 原状态保留。

| 检查 | 实际结果 / 原始证据 |
| --- | --- |
| 完整主机 check | 最终 693 Node、402 Vue（44 文件），strict 正负类型、lint、Web build 全通过；15-final-check.txt，退出 0 |
| 独立 Oracle / 产品权威 | 5 项进入 npm test；旧读取 action/字段顺序、JSON 限制和纯领域要求通过。这不是候选撤销验收 PASS |
| 面板关闭 / 局部释放 | 01 失败保留，02/16 复测；最终 7 组件测试通过；不等于完整 Android UI/Heap 矩阵 |
| 撤销与 action 兼容验收 | 06 probe 退出 1，12 项失败保留；13 顺序恢复 probe 退出 1/BLOCKED |
| Android UTF-16 Spike | 两次原生 1/1 OK；最终 android-action-spike-final/，11 类 JSON + 混合串重复 1k/10k；rawEqual 与本次 Java decodedEqual 全 true。只证明探针和可行性，不代表业务写路径通过 |
| 现有 Android 完整候选回归 | 初轮及最终轮退出 0；最终包含 10k 深链、宽确认等，确认 10,001 条、批次最多 128，10k completion 97,658 ms；final-device-*.gz。未提高原 420 秒 deadline |
| Android transaction instrumentation | 最终完整驱动原生 1/1 OK；final-device-instrumentation.txt.gz |
| 普通 APK | 23-ordinary-gate.json：包 com.yubin.formyself，activation false，无 synthetic 页面/语句，Schema 4；24-ordinary-catalog.txt checksum/seed 门禁通过 |
| 两轮审查 | [reviews.md](reviews.md)含两位独立审查者及修复后增量复核；结论均 BLOCKED |
| 专用生命周期 / Heap | [lifecycle-matrix.md](lifecycle-matrix.md)、[memory-summary.json](memory-summary.json)：缺失项 NOT RUN/null，未虚报 0/PASS |

设备为既有隔离 emulator-5582 / kanata_m2_api34 / API 34 / x86_64 / WHPX / SQLCipher 4.17.0 community。通过 manifest、`emu avd path`、版本/ABI、包白名单与已安装 APK 读回 SHA 复核。只运行合成包，没有接触真实资料、备份或真实模型 API。

## 复现命令

从仓库 M worktree 执行，先完成既有 QA manifest/设备核验。manifest 为现有隔离根中的 device-manifest.json；完整驱动 EvidenceDirectory 必须是该根中新的、不存在的目录。普通 APK 仅构建复核，不安装到设备。

```powershell
npm.cmd run check
node docs/qa/kanata-sqlite-m4/m4-r/event-compat/verify-compatibility.mjs
node docs/qa/kanata-sqlite-m4/m4-r/event-compat/verify-order.mjs
npx.cmd cap sync android
./android/gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
pwsh -NoProfile -File docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory $newEvidence -Mode full -M4Growth -M4Completion
pwsh -NoProfile -File docs/qa/kanata-sqlite-m4/m4-r/event-compat/run-action-spike.ps1 -ManifestPath $manifest -EvidenceName android-action-spike-new
./android/gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=false :app:assembleDebug
pwsh -NoProfile -File docs/qa/kanata-sqlite-m4/verify-default.ps1
node docs/qa/kanata-sqlite-m4/completion/verify-catalog.mjs android/app/build/generated/kanataSqlite/assets/kanata-sqlite-catalog.json
```

两个兼容 probe 当前退出 1 是如实验收结果，不应跳过、删断言或计入成功测试。所有失败、探针夹具修复及复测见 [oracle.md](oracle.md)。剩余完整物化、字段级 action、原始数组恢复与增量签名、宽 Effect Audit 及专用设备/内存矩阵见 [BLOCKED 验收 v4](../../../../20261111-kanata-sqlite-mr2-g4-acceptance-v4.md)。本轮没有 M5 放行或实现。
