# Kanata SQLite M5-06 最终独立复核计划 v1

- 状态：**PLANNED — REVIEW ONLY**
- 日期：2026-11-19
- 仓库：`Zhoubin601/ForMyself`
- 分支：`m5/json-archive-migration`
- 当前远端 HEAD：`488a2e1d84d660a9d141b9502aa53ab4cd80897e`
- 实现提交：`97718ee6a4067a479e4ebe285778876d835c95fa`
- 报告与机器证据提交：`488a2e1d84d660a9d141b9502aa53ab4cd80897e`
- 精确 SHA CI：[Quality #127](https://github.com/Zhoubin601/ForMyself/actions/runs/44463304279)
- 本计划只授权对上述提交及证据进行独立只读复核，并新增一份复核报告；不授权实现修改、重新执行 Android 测试、改变验收状态或推送。

## 1. 当前基线与已知状态

1. 远端分支 HEAD 已核对为 `488a2e1d84d660a9d141b9502aa53ab4cd80897e`。
2. 实现提交为 `97718ee6a4067a479e4ebe285778876d835c95fa`。
3. 证据提交为实现提交的后续提交，包含 M5-06 整改报告及机器证据；本次独立复核必须分别固定实现 SHA 和证据 SHA。
4. Quality #127 的 `head_sha` 精确等于实现 SHA `97718ee6...`；Web Job 的 `npm run check` 成功，Android Job 按 M5 分支策略跳过。
5. 本轮整改报告记录 H-01、M-01、M-02、L-01 本地 PASS，B-01 曾在推送前 BLOCKED。推送后 B-01 的精确 SHA CI 已通过。独立复核仍未完成，因此本计划不预先宣布 M5-06 PASS。
6. 本地记录的验收证据包括：48/48 宿主定向测试、791 项 Node、420 项组件测试、类型检查与 Web 构建通过；Android API 34 模拟器 SQLCipher 4.17.0 instrumentation 2/2；1k/10k/100k 合成容量；四个强杀恢复点；50 张表逐表摘要。

## 2. 复核目标

独立判断 M5-06 五项整改是否真正关闭：

| ID | 原问题 | 独立复核目标 |
|---|---|---|
| H-01 | AVD 实例身份绑定 | 确认所有会改变 QA 包、候选库或设备状态的操作均绑定本轮 AVD；陈旧 manifest 在执行前 fail closed |
| M-01 | 固定 SQL 目录缺少 event_causes | 确认合法因果边通过真实固定目录、原生 SQLCipher 目标库和实际迁移器完成导入及读回 |
| M-02 | 原生逐表证据不足 | 确认 50 表收据、四个恢复点和源只读收据完整、一致、可复算 |
| L-01 | force-stop 清理确认不足 | 确认命令失败、PID 仍存活或查询失败均不能记录 cleanup success |
| B-01 | 严格同 SHA CI 未满足 | 确认 Quality #127 的 head SHA 与实现 SHA 完全一致，且 Web Job 成功 |

## 3. 固定检查范围

### 3.1 实现提交

审查以下实现文件的完整 diff 和最终内容：

- `docs/qa/kanata-sqlite-m2/start-windows-synthetic-avd.ps1`
- `docs/qa/kanata-sqlite-m5/runner-guard.mjs`
- `docs/qa/kanata-sqlite-m5/run-android.mjs`
- `docs/qa/kanata-sqlite-m5/catalog.mjs`
- `docs/qa/kanata-sqlite-m5/fixture.mjs`
- `docs/qa/kanata-sqlite-m5/device.mjs`
- `docs/qa/kanata-sqlite-m5/evidence.mjs`
- `docs/qa/kanata-sqlite-m5/verify-remediation-evidence.mjs`
- `tests/kanataM506Remediation.test.js`

同时核对实现提交相对 M5-06 原验收基线的 diff，确保没有夹带生产 Store、canonical、普通 APK 激活路径、Schema 001–005、application_id、依赖锁文件或 CI workflow 变更。

### 3.2 验收与证据提交

只读检查：

- `docs/qa/kanata-sqlite-m5/m5-06-remediation-v1.md`
- `docs/qa/kanata-sqlite-m5/m5-06-remediation-evidence-v1.json`
- `docs/qa/kanata-sqlite-m5/m5-06-independent-review-v1.md`
- `docs/20261118-kanata-sqlite-m5-06-remediation-task-v1.md`
- 本计划引用的 Quality #127 运行和 jobs。

不得覆盖旧版 M5-06 报告或旧机器证据。

## 4. 逐项复核方法

### H-01：AVD 实例身份与破坏性操作门禁

直接检查代码，不仅复述报告：

1. 启动器是否为每轮创建唯一 instanceId、独立 AVD 名称、数据目录和 manifest。
2. manifest 是否绑定启动器 PID、启动时间、QEMU 子进程、实际 `-datadir`、AVD 配置路径、ADB serial、transport ID、API 和有效期。
3. `createRunnerGuard().command()` 是否在每次设备变更前重新验证身份。
4. 检查所有 ADB 调用点，逐一分类只读调用和破坏性调用；确认 install、pm clear、kill、force-stop、instrumentation、forward 变更等受保护。
5. 检查 transport ID 固定与变化检测，确认设备断开重连或 transport 替换时 fail closed。
6. 检查陈旧 manifest 负向测试及本轮真实 AVD 拒绝日志，确认拒绝发生在变更命令之前，零破坏性调用且候选库摘要、包列表、AVD 状态不变。
7. 评估 manifest 文件内容校验与启动器进程身份检查之间是否存在可利用的 TOCTOU 缺口；如有，给出可复现路径和影响，不提出无关通用安全重构。

### M-01：event_causes 固定目录

1. 确认查询是固定 SQL、固定参数、rowid 分页和 LIMIT 50，不接受运行时任意 SQL。
2. 确认 fixture 只添加一条指向已存在事件的合法因果边。
3. 确认 catalog 生成器确实将该查询写入本轮合成目录，普通 SQL 目录逐字节不变。
4. 确认 Android WebView 运行时从打包后的 catalog 执行迁移，并从原生 SQLCipher 目标库读回因果边。
5. 对照 host oracle、原生字段 SHA、event_causes 逐表摘要、外键和 integrity 结果。

### M-02：逐表机器证据与恢复收据

1. 审查 `targetReceipt` 是否从原生 SQLCipher 目标库重新读取全部 50 张表，而非仅复制导入器返回值。
2. 审查表顺序、列白名单、分页游标、行序、字段序列化、空表标记、逐表 SHA-256 和聚合 SHA-256 算法。
3. 审查独立验证器是否拒绝缺表、重复表、未知表、错误顺序、非法计数、空表摘要错误和聚合摘要错误。
4. 对 8 份收据（smoke、四个强杀点、三档容量）逐份核对 50 张表。
5. 对照四个强杀点的 hook 到达、旧 PID 消失、CDP 断开、新 PID、同一候选库 inode、重启前 cursor/manifest/行数、重启后逐表摘要、幂等复跑。
6. 核对源主密文、归档密文和 recovery journal 前后摘要；read/stat/list/write/rename/delete 调用计数应与实现语义一致，写入/重命名/删除为 0。
7. 重点判断验证器是否只验证了摘要格式和聚合值，却遗漏了任务书要求的字段级、恢复态或容量数据一致性；所有结论必须引用具体代码位置和 JSON 字段。

### L-01：force-stop 与 PID 清理

1. 确认 adb 命令非零时 `execFileSync` 或等效包装会抛错。
2. 确认成功后通过明确 PID 查询验证本轮 QA 进程消失。
3. 确认 PID 查询失败不能被当成 null/无进程。
4. 确认 scenario 与 cleanup 同时失败时两项错误均保留。
5. 检查 force-stop 目标只允许本轮 QA 包且调用前经过 AVD 身份验证。

### B-01：严格同 SHA CI

1. 读取 Quality #127 的 workflow run 元数据。
2. 确认 `head_sha = 97718ee6a4067a479e4ebe285778876d835c95fa`。
3. 确认 Web Job 的 `npm run check` 步骤 conclusion 为 success。
4. 确认 Android Job skipped 与现有 M5 分支策略一致。
5. 确认没有以证据文档提交的 SHA 冒充实现 SHA 的 CI 结果。

## 5. 证据一致性核对

必须将下列来源交叉核对：

- 实现 SHA 与证据 JSON 的 `implementation`。
- 机器证据中的 baseline、instance、manifest、transport、APK、catalog、bundle、native plugin 指纹。
- smoke / interruption / capacity 的表计数、逐表 SHA、聚合 SHA、event_causes 摘要。
- 四个强杀点的 PID、inode、cursor、manifest 状态和恢复结果。
- 三档容量的消息数、批次上限、耗时、RSS、DB bytes、fixture fingerprint。
- 整改 Markdown 中的数值与机器 JSON 中的数值。
- Quality #127 的精确 head SHA 和 job 结果。

对于只存在于本地日志但未提交的证据，明确标记“本次 GitHub 复核无法直接复核”，不得当作已独立验证。

## 6. 输出与判定

新增报告：

`docs/qa/kanata-sqlite-m5/m5-06-final-independent-review-v1.md`

报告必须包含：

1. 审查基线、实现 SHA、证据 SHA、CI URL。
2. 实际审查文件清单。
3. 五项问题逐项结论：PASS / BLOCKED / FAIL。
4. 具体代码位置（文件和行号）及证据字段。
5. Findings 分级：Blocker / High / Medium / Low。
6. 证据一致性核对表。
7. 安全边界核对。
8. 最终建议：M5-06 PASS / BLOCKED / FAIL。

只有五项均 PASS、没有未解决 Blocker/High、证据与 SHA 一致时，才可以建议 M5-06 PASS。报告不得把 M5 整体标记为 PASS。

## 7. 本轮严格限制

- 只读检查实现和证据；允许新增最终独立复核报告。
- 不修改业务实现、测试、任务书、历史报告或机器证据。
- 不运行 Android build、assemble、install、emulator 或 instrumentation。
- 不访问真实用户数据、真实设备数据库、真实备份或归档。
- 不接入生产 Store，不改变 canonical 或普通 APK 激活位。
- 不修改 Schema 001–005、application_id、checksum、依赖和 CI workflow。
- 不删除、覆盖、重命名或清理旧 JSON、backup、archive 或 recovery journal。
- 不发布 APK，不创建 Release，不合并 M/main。
- 不推送提交；完成报告后停止，等待用户决定是否更新验收状态。
- 若发现本计划范围外问题，只记录，不修改、不扩展任务。

## 8. 完成后停止点

提交独立复核报告前，先向用户汇报：
- 当前 HEAD 与工作区状态；
- 复核发现和拟写入的结论；
- 是否存在 Blocker / High；
- 报告路径与待提交差异。

允许新增报告并在本地提交（若用户的 Agent 环境已有提交授权）；**不允许 push**。最终只交付独立复核报告，不自动启动 M5 总体验收、M5-07 或 M6。
