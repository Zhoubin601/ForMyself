# Kanata M5-06 五项专项整改记录 v1

- 日期：2026-11-19
- 分支：`m5/json-archive-migration`
- 任务书基线：`c1caec5e6fa040502e9de85df0478e66b8fe02b4`
- 实现提交：`97718ee6a4067a479e4ebe285778876d835c95fa`
- 依据：[专项任务书](../../20261118-kanata-sqlite-m5-06-remediation-task-v1.md)、[独立复核](m5-06-independent-review-v1.md)与本轮合成执行回执。
- 机器证据：[m5-06-remediation-evidence-v1.json](m5-06-remediation-evidence-v1.json)，仓库 UTF-8/LF 内容 SHA-256 `3d71751978ba0228b99ae2dda6a7c531c3b889952e4f70d879c72d185ed61dc0`。

## 分项结果

| 项目 | 结果 | 修改与验收依据 |
|---|---|---|
| B-01 严格同 SHA Web CI | **BLOCKED** | 现有 Quality workflow 原样保留，未创建临时分支。本地实现 SHA 已固定；未获授权，因此没有推送或本轮远端 CI。授权后先将实现 SHA 单独普通快进推送到现有 M5 分支，确认 Actions `head_sha` 完全一致及 Web `npm run check` 成功。后续证据文档提交不能替代该运行。 |
| H-01 AVD 实例绑定 | **PASS** | M2 启动器新增仅供 M5 的 `-M5Identity`；runner 对照 nonce、启动进程与起始时间、QEMU 子进程、实际数据目录参数和 AVD 配置、ADB serial/transport、API、开机状态和未过期 manifest。包、候选库和转发变更前重新核验。宿主旧 manifest 同名/同 serial/同白名单包模型在 install、clear、kill、force-stop 前均拒绝，变更调用 0 次，前后候选库摘要相等且模拟设备状态不变。真实 AVD 在线时，上一轮旧格式 manifest 也被拒绝。证据见 `staleManifest` 和 `runs[].instance`。 |
| M-01 event_causes | **PASS** | `catalog.mjs` 显式登记固定分页 SQL；`fixture.mjs` 只加一条指向已存事件的因果边。`device.mjs` 从包内固定目录读回边并核对精确字段摘要。宿主和原生均为 1 行，逐表摘要及外键、integrity 验证通过。证据见 `smoke.tableProof`、`smoke.causalFieldsSha256` 与 `catalog.causalQuerySha256`。 |
| M-02 逐表及恢复收据 | **PASS** | `evidence.mjs` 经实际固定 SQL 重读原生目标。记录 50 张表逐表计数、空表标记和 SHA-256，保留四个故障点、PID 与远端 CDP 消失、同候选库 inode、重启前状态、重启后目标校验和源前后 SHA/调用计数。独立验证器在 Node 使用独立散列实现，复算 8 份 50 表聚合；缺少、重复、未知表或摘要修改的负例被拒绝。 |
| L-01 force-stop | **PASS** | `runner-guard.mjs` 要求 ADB 命令退出码为 0 并确认包 PID 消失。运行与清理同时失败时保留两项异常。宿主四项测试覆盖正常、命令非零、PID 仍在、PID 查询失败；三次实际 runner 收尾均确认 exit 0 与 PID 消失。证据见 `runs[].cleanup`。 |

## 实际命令

```powershell
node --test tests/kanataM506Remediation.test.js tests/kanataSqliteDataMigration.test.js tests/kanataSqliteMigration.test.js tests/kanataSqliteEncryptedLegacySource.test.js
npm run check
$manifest = & docs/qa/kanata-sqlite-m2/start-windows-synthetic-avd.ps1 -M5Identity
# 等待该 manifest 对应 AVD 报告 sys.boot_completed=1。
Copy-Item -LiteralPath docs/qa/kanata-sqlite-m2/candidate-assets/public/index.html -Destination dist/index.html
node node_modules/@capacitor/cli/bin/capacitor sync android
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true -PkanataM5Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
node docs/qa/kanata-sqlite-m5/run-android.mjs $manifest smoke
node docs/qa/kanata-sqlite-m5/run-android.mjs $manifest full
node docs/qa/kanata-sqlite-m5/run-android.mjs $manifest 100k
node docs/qa/kanata-sqlite-m5/verify-remediation-evidence.mjs docs/qa/kanata-sqlite-m5/m5-06-remediation-evidence-v1.json
```

本轮在 Windows/WHPX 的新建 API 34（Android 14）模拟器运行，运行时 SQLCipher `4.17.0 community`。隔离 APK 安装读回、QA WebView bundle、原生插件及目录指纹见机器证据。50 表非空摘要沿用 `kanata-m5-table-v1`。空表 SHA-256 输入为 UTF-8 的 `kanata-m5-empty-v1:<表名>`。聚合 `m5-table-receipt-v1` 在冻结的迁移表顺序中依次取 `[表名, 行数, 空表布尔值, 小写十六进制 SHA-256]`，对整个数组的紧凑 JSON UTF-8 计算 SHA-256。机器证据仅保留摘要、计数、状态与脱敏收据。

- 宿主定向退出 0，48 通过、0 失败、0 跳过。完整 `npm run check` 退出 0，791 项 Node 测试、420 项组件测试（45 文件）、两套类型检查和 Web 构建通过。ESLint 0 错误、61 警告。
- Android 隔离构建退出 0。两项 instrumentation 通过，分别验证 SQLCipher 明文读取与错密钥拒绝、正确密钥读回及关闭失效，以及延迟外键导致的 COMMIT 失败可回滚。候选导入另验证错密钥、源指纹变更、篡改归档、恢复态源及非空目标拒绝。先跑短档定位并补上 CDP 导入前的身份复查，再以最终 runner 完成 100k 与短档复跑，正式证据只采用最终 runner 的日志。

四个强杀点均从同一实例中的原候选库冷打开（`create:false`），切换前后 inode 一致。首批提交前与归档批次中均回滚未提交内容；归档批次提交后从 50 条、游标 1/0 续传；最终验证前保留 55 条消息及 running manifest，由重试完成验证。四次复跑均为 `already-complete`，无写入。源主密文、归档密文和 journal 前后 SHA 相等，写入、重命名和删除调用均为 0。

| 强杀故障点 | 旧 PID → 新 PID | 前后一致的数据库 inode | 结果 |
|---|---|---:|---|
| `before-first-commit` | 12863 → 13010 | 329226 | PASS |
| `during-batch` | 13169 → 13316 | 328763 | PASS |
| `after-batch-commit` | 13499 → 13667 | 329226 | PASS |
| `before-verification` | 13857 → 14001 | 329226 | PASS |

| 合成消息数 | 导入器执行（秒） | 批次 / 最大项数 | 批次均值（ms） | 峰值 RSS（MiB） | 库体积（MiB） | 最近 / 历史页（ms） | 结果 |
|---:|---:|---:|---:|---:|---:|---:|---|
| 1,000 | 16.79 | 21 / 50 | 506.3 | 424.6 | 2.01 | 7.4 / 8.9 | PASS |
| 10,000 | 109.92 | 201 / 50 | 472.3 | 421.6 | 11.72 | 6.0 / 5.3 | PASS |
| 100,000 | 912.31 | 2001 / 50 | 410.1 | 561.5 | 109.91 | 4.1 / 3.8 | PASS |

三档均核对 50 张表、外键 0 行、integrity `ok`。导入器执行时间包含导入器自身的终核，后续从原生库另行读取逐表收据。RSS 为 App 和 WebView renderer 约一秒间隔的加总采样峰值，不去重共享页；以上为本轮模拟器实测。本轮 AVD 结束后校验启动器 PID 已退出，并移除了同步生成的 QA 入口副本。

`event_causes` 精确字段行摘要为 `051c1e0f03d8bef2cf81053ecdf87a981ebeed180c9edb5cf56484a3c38a246e`，目标表摘要为 `92a27afe321f6a307e25e4f5e4cdd425abc0aef63d1c6d70b1e0e00f61f74981`，均与宿主独立公式一致。独立验证器退出 0，复算目标收据 8 份，每份 50 张唯一表。

## 范围与停止点

普通目录 723 条与基线逐字节相同，合成目录 954 条且仅新增本轮需要的 `event_causes` 分页查询。Schema 版本、001–005 校验和及 application_id `1263424577` 一致。未构建普通 APK，未接入生产 Store，未访问真实用户数据，未发布 APK。原报告与机器证据均保留。

目前只具备 H-01、M-01、M-02、L-01 的本地证据。B-01 仍等待明确推送授权，M5-06 与 M5 整体状态未改变。本轮不进入其他阶段。
