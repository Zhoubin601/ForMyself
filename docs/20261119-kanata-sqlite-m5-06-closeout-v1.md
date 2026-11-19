# Kanata SQLite M5-06 最终关账记录 — PASS

- 关账日期：2026-11-19
- 仓库与分支：`Zhoubin601/ForMyself`，`m5/json-archive-migration`
- 阶段结论：**M5-06 = PASS**（经最终独立代码审查与用户确认）
- 整体状态：**M5 整体仍保持 OPEN / NOT ACCEPTED**；本关账仅关闭 M5-06 阶段，不自动宣布 M5 整体通过，不启动 M5-07。

---

## 1. 关联证据链与 SHA

| 项目 | 提交 SHA / 链接 | 说明 |
|---|---|---|
| M5-06 原验收基线 | `3ff66376776f46659dfc91bcbd34b9a43abfcb5e` | [M5-06 原验收任务书](20261118-kanata-sqlite-m5-06-android-sqlcipher-synthetic-acceptance-task-v1.md) |
| M5-06 原实现基线 | `a781563d25e1dab66f2f18046df5b80032e09a78` | [首轮独立复核报告](qa/kanata-sqlite-m5/m5-06-independent-review-v1.md)识别 5 项整改 |
| M5-06 整改任务书基线 | `c1caec5e6fa040502e9de85df0478e66b8fe02b4` | [M5-06 整改任务书](20261118-kanata-sqlite-m5-06-remediation-task-v1.md)冻结五项整改范围 |
| **整改实现提交** | `97718ee6a4067a479e4ebe285778876d835c95fa` | 仅修改 9 个 QA/测试文件，无业务代码、Schema、依赖或 CI workflow 变更 |
| **整改验收证据提交** | `488a2e1d84d660a9d141b9502aa53ab4cd80897e` | [专项整改记录](qa/kanata-sqlite-m5/m5-06-remediation-v1.md)与[机器证据 JSON](qa/kanata-sqlite-m5/m5-06-remediation-evidence-v1.json)（SHA-256 `3d71751978ba0228b99ae2dda6a7c531c3b889952e4f70d879c72d185ed61dc0`） |
| 最终独立复核计划提交 | `f8179c97e610fc95a68d9b7d075bbc8b0638eaee` | [M5-06 最终独立复核计划](20261119-kanata-sqlite-m5-06-final-independent-review-plan-v1.md) |
| **严格同 SHA Web CI** | [GitHub Actions Quality #127](https://github.com/Zhoubin601/ForMyself/actions/runs/44463304279) | `head_sha = 97718ee6a4067a479e4ebe285778876d835c95fa`，Web Job `135355003845`（`npm run check`）`success`，Android Job `135355005580` 按 M5 分支策略 `skipped` |
| **最终独立复核报告** | 本关账提交新增 | [M5-06 最终独立代码审查报告](qa/kanata-sqlite-m5/m5-06-final-independent-review-v1.md) |

---

## 2. 五项专项整改关账状态

| 编号 | 整改项 | 最终状态 | 关账摘要 |
|---|---|---|---|
| **H-01** | AVD 实例身份绑定 | **PASS** | 每轮唯一 128-bit nonce、`kanata_m5_<id>` 与独立 `-datadir`；绑定启动器 PID/微秒级启动时间/QEMU 子进程/AVD `.ini` 与 ADB `transport_id` 固定；全部破坏性与状态变更操作经 `guard.command`/`guard.verify` 门禁保护；陈旧/错配/过期 manifest 在变更前 fail closed（0 破坏性调用）。 |
| **M-01** | `event_causes` 固定 SQL 目录 | **PASS** | `fixture.mjs` 新增 1 条合法因果边与固定分页 SQL；M5 合成目录增至 954 条（普通目录保持 723 条逐字节不变）；原生目标库实际读回并校验字段摘要（`051c1e0f...`）与表摘要（`92a27afe...`），4 张预期空表保持 0 行。 |
| **M-02** | 50 表逐表摘要与恢复机器证据 | **PASS** | `evidence.mjs` 实读原生 SQLCipher 全部 50 张表；独立验证器复算 8 份 50 表聚合收据通过；独立宿主对照证实 55 条（smoke + 4 强杀点）、1k、10k 全部 50/50 表逐字节匹配；4 强杀点 PID/CDP/inode/cursor/manifest 及源密文/journal 只读性全部一致。 |
| **L-01** | `force-stop` 退出码与 PID 消失确认 | **PASS** | `execFileSync` 检查非零退出码；`qaPid` 使用 `ps -A -o PID,NAME` 严格校验输出，查询失败抛错不视作退出；PID 仍存活抛 `M5_QA_PID_STILL_LIVE`；`withQaCleanup` 以 `AggregateError` 同时保留场景与清理错误。 |
| **B-01** | 严格同 SHA GitHub Web CI | **PASS** | [Quality #127](https://github.com/Zhoubin601/ForMyself/actions/runs/44463304279) `head_sha` 与实现提交 `97718ee6...` 逐字符一致，Web Job `npm run check` 成功，Android Job 按既有策略跳过，workflow 未修改。 |

---

## 3. 保留记录的 Low 级遗留项与证据限制

经用户明确确认，以下 3 项 Low 级发现仅保留记录、不阻塞 M5-06 关账，亦不作为本轮返工范围（详见[最终独立复核报告](qa/kanata-sqlite-m5/m5-06-final-independent-review-v1.md)第 7 节）：

1. **L-REV-01（Low · H-01 输入边界）**：`docs/qa/kanata-sqlite-m5/run-android.mjs:23` 在 `guard.verify()` 前调用 `path.join(manifest.sdk, ...)`，缺少 `sdk` 字段的畸形 JSON 会抛出 `TypeError` 而非标准化错误码 `M5_AVD_IDENTITY_UNCONFIRMED`（仍于任何 ADB 调用前 fail closed）。
2. **L-REV-02（Low · M-02 验证器覆盖缺口）**：`docs/qa/kanata-sqlite-m5/verify-remediation-evidence.mjs` 未对强杀与 smoke 的 50 表相等性、`catalog.*` 与 `runs[].artifacts.*`、`runs[].catalogSha256`、`eventCausesHostOracle`、`issues` 状态及 `messageBatchTimingMs` 序关系做交叉断言；且仅凭摘要 JSON 无法重算非空表原始行（本轮已由独立审查脚本证实实际提交 JSON 在上述全部维度均真实一致）。
3. **L-REV-03（Low · B-01 文档快照时序）**：历史证据提交 `488a2e1` 形成于推送与触发 Quality #127 之前，其内 `m5-06-remediation-v1.md` 与 `m5-06-remediation-evidence-v1.json` 原样保留推送前 `B-01: BLOCKED` / `NOT RUN` 快照，按不重写历史证据原则不修改，由 Quality #127 与本关账记录予以闭环。

证据边界保持透明：未入 Git 的 7 份本机原始日志与隔离 APK 二进制仅能按本地保留产物与哈希指纹交叉核对；100k 容量数据已核对 47 张固定表、计数与聚合复算，未在宿主重跑完整 100k 加密导入；所有 Android 指标均基于隔离 API 34 模拟器合成数据，不外推为实体设备或生产数据指标。

---

## 4. 安全边界与后续状态

- 未修改任何业务代码、测试代码、历史验收记录、Schema 001–005、依赖锁文件或 `.github/workflows/quality.yml`。
- 未接触真实用户数据、真实设备数据库、真实备份或真实归档；未接入生产 Store、未切换 canonical、未改变普通 APK 激活位、未清理旧 JSON/backup/archive/recovery journal。
- 未发布 APK，未合并至主分支，本次仅形成本地关账提交，未推送远端。
- **M5 整体仍为 OPEN**：后续须另行授权开展 M5-01～M5-06 整体独立汇总审查与关账账本编制；本关账不启动 M5-07 或 M6。
