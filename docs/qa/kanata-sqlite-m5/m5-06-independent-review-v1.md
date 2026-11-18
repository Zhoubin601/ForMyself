# M5-06 Android SQLCipher 独立复核 v1

- 复核日期：2026-11-18
- 仓库与分支：`Zhoubin601/ForMyself`，`m5/json-archive-migration`
- 建议结论：**BLOCKED**。已有记录支持本轮固定合成数据集的 Android SQLCipher 实测结果。重新运行的环境隔离门禁有一项 High 发现，严格同 SHA 的 Web CI 门禁也未关闭。
- 问题分级：Blocker 1，High 1，Medium 2，Low 1。未发现本次实现差异引入迁移数据与 cursor 分开提交的回归。

## 范围与实际方法

| 对象 | 已核对的 SHA 和关系 |
|---|---|
| M5-06 执行基线 | `3ff66376776f46659dfc91bcbd34b9a43abfcb5e` |
| M5-06 实现 | `a781563d25e1dab66f2f18046df5b80032e09a78`，相对基线为一个实现提交，共 10 个文件 |
| M5-06 验收记录 | `3e828399887bb10931a118021a31a4a18e144a29`，直接父提交为实现 SHA；两者只差 4 份 Markdown 和 1 份证据 JSON |
| 规划与当前远端 | `3177f4a60658ee9f7c54cc014fbfb57413fd0173`，在验收记录后仅新增复核计划一份。本地工作树仍在验收记录 SHA |

先按远端 SHA 读取[独立复核计划](https://github.com/Zhoubin601/ForMyself/blob/3177f4a60658ee9f7c54cc014fbfb57413fd0173/docs/20261118-kanata-sqlite-m5-independent-review-and-closeout-plan-v1.md)，再核对任务书、QA Markdown、机器 JSON 和 M5-05 关账记录。用 `git diff` 和文件正文审查实现，并复算宿主 SQLite 对照、固定 SQL 目录、WebView bundle、保留的本地 QA APK 及其包内目录。运行了以下宿主测试，退出 0，**42 通过、0 失败、0 跳过**。

```text
node --test tests/kanataSqliteDataMigration.test.js tests/kanataSqliteMigration.test.js tests/kanataSqliteEncryptedLegacySource.test.js
```

此外，用 Node 内存 SQLite 对一份额外合成图进行固定目录拒绝路径验证。使用的是实际加密源接口和导入器，目录门禁由宿主按原生桥的 SQL 哈希、阶段和模式规则模拟。本轮原生结论来自对既有源码、合成运行日志及本地 QA 构建产物的交叉复核，未重跑 Android 构建、模拟器或 instrumentation。

实际审查文件如下。路径均相对仓库。

| 类别 | 文件 |
|---|---|
| 实现差异（10 文件） | `src/features/chat/storage/sqlite/kanataDataMigrator.js`；`android/app/build.gradle`；`scripts/build-kanata-sqlite-catalog.mjs`；`tests/helpers/kanataSqliteEncryptedLegacySource.js`；`tests/kanataSqliteDataMigration.test.js`；`docs/qa/kanata-sqlite-m5/` 下的 `catalog.mjs`、`device.mjs`、`fixture.mjs`、`run-android.mjs`、`androidTest/com/yubin/formyself/KanataM5CipherTest.java` |
| 相关运行契约 | `src/features/chat/storage/sqlite/kanataDataMigrationRows.js`、`kanataSchema.js`、`kanataSchemaMigrator.js`；`src/platform/storage/androidKanataSqliteDriver.js`；`android/app/src/main/java/com/yubin/formyself/KanataSqlitePlugin.java`；`android/app/src/androidTest/java/com/yubin/formyself/KanataSqliteTransactionTest.java`；`docs/qa/kanata-sqlite-m2/start-windows-synthetic-avd.ps1`；`.github/workflows/quality.yml` |
| 证据及规则 | 复核计划、[M5-06 任务书](../../20261118-kanata-sqlite-m5-06-android-sqlcipher-synthetic-acceptance-task-v1.md)、[QA 报告](m5-06-android-v1.md)、[机器证据](m5-06-evidence-v1.json)、[M5 QA](README.md)、[M5-05 关账记录](../../20261118-kanata-sqlite-m5-05-closeout-v1.md)及验收记录提交的架构说明更新 |

## Findings

### B-01 · Blocker · 严格同 SHA 的 Web CI 仍缺

[Quality #123](https://github.com/Zhoubin601/ForMyself/actions/runs/44300628326) 实际运行在 `3e828399…`，Web Job `134789105080` 的 `npm run check` 成功，Android Job `134789107715` 为 skipped。独立检查 `git rev-parse 3e828399^` 与完整差异文件清单，证明其有效源码与 `a781563d…` 等价。按实现 SHA 查询 Actions 无匹配运行。历史 [M5-05 Quality 运行](https://github.com/Zhoubin601/ForMyself/actions/runs/44279607211) 的 SHA 确为 `838635ac…`，不能替代本阶段证据。

**位置与建议。** 独立复核计划第 4 节，`.github/workflows/quality.yml:3` 与 `:21`。记录 #123 为代码树等价证据，保留严格同 SHA 未满足的状态。只有用户明确接受例外，或另行授权合规的同 SHA 方案，才可关闭此项。现有工作流无手动 dispatch，临时分支反而会进入 Android Job。

### H-01 · High · Runner 未将清空操作绑定到本轮 AVD 实例

`docs/qa/kanata-sqlite-m5/run-android.mjs:14–35` 校验 manifest 字段、根目录命名、固定 AVD 名和 serial、API、开机状态及包名白名单。启动器始终复用 `kanata_m2_api34` / `emulator-5582`，并在 manifest 写入 `launcherPid`（`docs/qa/kanata-sqlite-m2/start-windows-synthetic-avd.ps1:20–24,64–79`）。runner 未验证 launcher 对应的进程实例与实际 AVD 路径，也未检查本轮独有标识。若另一轮同名 AVD 启动，旧 manifest 与只安装白名单包的实例可以同时满足当前检查。此时 `run-android.mjs:48` 的覆盖安装和 `:169` 的 `pm clear` 会作用到另一轮的 QA 包及候选库。

这是**从源码推导的隔离门禁缺口**，本轮保留的合成启动 manifest 与日志相符，未发现 #123 或本轮原生记录实际使用了另一轮实例，也未对任何设备执行该反例。建议为每轮创建唯一 AVD 身份或启动 nonce，校验进程、实际 AVD 路径和本轮标识，并在 install、clear、kill、force-stop 前失败关闭。增加陈旧 manifest 拒绝负例，断言发生拒绝时无状态改变。问题关闭前不建议把此 runner 当作可安全重复运行的验收入口。

### M-01 · Medium · 固定目录实际只覆盖当前 QA 数据图

`docs/qa/kanata-sqlite-m5/catalog.mjs:9–53` 从 55 条固定数据的实际导入记录查询和写入 SQL。三档容量只扩大同一种历史消息形状。这使目录可用性取决于固定图有哪些非空关系表。审核时，在同一合法合成图加入一个指向现有事件的因果边。启用所归档的业务阶段目录时，导入在最终校验因缺少以下固定查询被拒绝。继续使用同一内存目标和同一密文源解除模拟目录限制后，导入返回 `complete`，`event_causes=1`。

```sql
SELECT rowid AS __rowid,world_id,event_id,cause_event_id FROM event_causes WHERE rowid>? ORDER BY rowid LIMIT 50
```

**位置与建议。** `catalog.mjs:42–53`、`fixture.mjs:27–45`、`src/features/chat/storage/sqlite/kanataDataMigrator.js:339–360`。当前结果可支持固定 fixture 的 Android 验收，不能据此说任意合法图都可在该 QA 目录导入。55 条样本中 `memory_links`、`relationship_events`、`event_causes`、`task_social_participants`、`domain_command_receipts` 均为零行，零行验证有意义，但不等同于非空载荷哈希。建议明确适用图，按验收需求补齐可导入的关系形态与语句覆盖，保留应为空的表的零行断言。继续以固定目录限制 SQL。

### M-02 · Medium · 提交内的机器证据无法单独复算全部原生断言

`docs/qa/kanata-sqlite-m5/run-android.mjs:178–192` 实际逐表比较目标 manifest 和宿主对照，`:237–239` 只输出 50 表行数与一个聚合摘要，`:219–222` 的容量收据只保留验证表数。强杀收据保留旧新 PID、关键游标和计数，但未输出独立的进程消失、CDP 断开、重启后完整表校验回执。变化源指纹的前后状态相等和零写入有运行断言，`:280–301` 只保留了其错误码。当前可用的临时日志与 JSON 一致，但这些日志同样未保留独立原生逐表摘要或每次源读写审计。宿主重新生成聚合值证明对照可复现，不能凭这一个值独立重算 Android 实例中读取的每行。

建议在新版本证据中按场景输出 50 表计数、实际 SHA-256、空表显式标识、fault hook、旧 PID 消失、冷打开模式、源前后密文摘要以及写调用计数。记录实际执行命令、退出码和脱敏原始收据 SHA。保留现有机器证据，不写入密钥、源正文、设备数据库或 APK。

### L-01 · Low · Runner 收尾的 force-stop 退出码未校验

`docs/qa/kanata-sqlite-m5/run-android.mjs:305–310` 等待子进程 `exit`，但任何退出码都会完成 Promise。若 adb force-stop 返回非零，runner 仍可能以成功退出。机器记录的 `cleanup.qaAppStopped` 不能由此段代码单独证明。建议检查退出码并核对本轮 QA PID 已消失，同时保留原始测试失败以免被清理异常覆盖。本次没有重跑清理流程。

## 迁移事务与测试可信度

- **提交和重试。** `kanataDataMigrator.js:293–331` 在同一目标事务读取并核对当前 cursor，写数据行，以当前数据库中的 `imported_count + batch.items.length` 计算累计数，然后更新带 CAS 条件的 collection journal 和 manifest。末批要求累计数精确等于预计值，提交前再次校验操作是否仍有效。失败状态记录在独立事务更新 state 和安全错误码，未修改已提交计数或 cursor（`:257–269`）。最终校验（`:364–411`）重新核对各集合计数、精确列值摘要、空表、替代事件关系、外键与完整性。实现差异通过 `:253,451–456` 把 `already-complete` 约束为 manifest 原已完成且所有集合无需再导入。新增回归在最终校验失败时确认数据保留、首次重试返回 `complete`，随后才是 `already-complete`（`tests/kanataSqliteDataMigration.test.js:207–218`）。
- **原生加密。** Gradle 固定 `net.zetetic:sqlcipher-android:4.17.0@aar`。原生 instrumentation 在 `.m2qa` 包 cache 新建独立库，实际写入 sentinel，查询 `PRAGMA cipher_version`，检查密文不含明文文件头或 sentinel。普通 Android SQLite 和错误 SQLCipher 密钥都要尝试打开并触发游标读取，正确密钥要读回原值（`KanataM5CipherTest.java:33–94`）。保留日志中两项指定 instrumentation 都有独立开始和成功状态，随后 `OK (2 tests)`。导入路径另通过真实 Capacitor bridge 检查报告为 `4.17.0 community`，释放后旧操作 lease 拒绝，错误候选解锁另返回 `KANATA_SQLITE_UNLOCK_FAILED`。宿主没有替换原生目标。模拟的是旧源文件 I/O 和故障时间点，源仍经实际加密、解密、归档检验和领域校验。
- **四个强杀点。** `device.mjs:25–62` 等待真实操作完成到达指定点后挂起，首批测试已在事务内写 dataset、cursor、manifest，批次中测试已写消息和标记，批次后测试等待事务返回，最终验证测试在 journal 终核查询发出前挂起。runner 确认收到该点、源只读检查通过，向 QA 包的旧 PID 发送 `kill -9`，等待 PID 消失并断言旧 CDP 关闭，再用新 PID、同一包私有路径、同一加密源和原密钥执行 `create:false`（`run-android.mjs:241–275`）。恢复段没有 `pm clear`、重装或替换库路径。实际记录的恢复前状态如下，四种均重试完成并再次幂等。

| 故障点 | 旧 PID → 新 PID | dataset / 消息 / 标记 / 来源行 | archive cursor / 已导入数 / manifest |
|---|---|---|---|
| 首批提交前 | 9084 → 9205 | 0 / 0 / 0 / 0 | 0/0，0，pending |
| 归档批次中 | 9336 → 9456 | 1 / 0 / 0 / 0 | 0/0，0，running |
| 归档批次提交后 | 9594 → 9715 | 1 / 50 / 50 / 3 | 1/0，50，running |
| 最终验证前 | 9848 → 9968 | 1 / 55 / 53 / 4 | 2/0，53，running |

## 安全边界与证据一致性

| 项目 | 独立复核结果 |
|---|---|
| 构建开关、Schema、生产路径 | M5 Gradle 参数要求 M2 合成开关，且该参数下禁用 release variant，instrumentation 源只在该开关下加入（`android/app/build.gradle:3–8,30–34,59–86`）。目录脚本也独立要求 `--synthetic`（`scripts/build-kanata-sqlite-catalog.mjs:116–122`）。重新生成普通目录与基线字节相同，723 条，SHA-256 为 `1886d13e6baff8a2431637ee76fcf44b7d846fcf3a3ec1f3d10bdd19ea870714`。M2 合成为 823 条，M5 合成为 953 条，普通条目逐条保持。Schema 001–005、校验和、application ID 及原生插件源码保持一致。差异无生产 Store、canonical、普通激活位、CI workflow 或锁文件变更。未构建普通 APK。 |
| 指纹绑定 | 实际复算两个本机保留的 QA APK SHA-256，与 runner 安装读回结果一致。从候选 APK 的 ZIP 读取 catalog，SHA-256 为 `f8c4c1b519c6c9889e58b9a421f641e63cb8253a46a386005b760c87c9246b7d`，与重生成结果及三轮日志相同。包中有 x86_64 的 `libsqlcipher.so`。重新打包的 QA WebView bundle SHA-256 为 `927d01ec080f267c7d679e511a6cb1e01aee369545a9f9c09a5197282af8ae4d`，本地原生插件源码哈希也与记录一致。未重新安装或上传 APK。 |
| 逐表与完整性 | 从宿主 SQLite 重新生成 50 表计数和 45 个非空表摘要，整体 SHA-256 为 `70ddaf1ef944fbdac0da75a11a64550570b49a53b0a2c89ef2cb5ad4b618b626`，与 smoke 记录相同。宿主与设备共用导入映射，跨后端对照可以发现存储或读取差异，不能排除两边共享的映射错误。设备另单独断言 Unicode 正文、扩展 seed、翻页不重叠，三档收据均为 50 表、外键 0、integrity `ok`。 |
| 源不变及秘密处理 | `tests/helpers/kanataSqliteEncryptedLegacySource.js:13–77` 显式注入内存 filesystem 和 journal，封口后允许读、stat、限定目录列表和 journal get，检查 ASCII 密文及日志值逐项相等。强杀前和重启导入后均检查；随机 salt 使密文指纹逐轮变化，恢复仍使用同一对象序列化后的密文与 journal。测试密钥只在进程间测试调用及内存中传递。源码与所查验收日志中未看到持久化明文口令或真实用户资料。runner 隔离风险单列 H-01。 |
| 1k、10k、100k | 将保留的 `full` 与 `100k` JSON 行逐项比对，复算 Markdown 中的时间、字节换算及消息批次数。分别为 9.00 / 42.13 / 373.36 秒，21 / 201 / 2001 个消息批次，最大均为 50。采样 RSS 为 403.6 / 411.0 / 568.3 MiB，库体积为 2.01 / 11.72 / 109.91 MiB。记录含 seed、每轮 fixture 指纹和分页时长。RSS 是约一秒采样的 App 与 renderer 加总峰值，动作是模拟器上的目标 SQL 查询。不能外推为无采样误差的上界、实体设备指标或生产数据表现。 |
| 保留日志和 CI | 本地保留的 `m506-a781563-smoke.log`、`-full.log`、`-100k.log` 中的场景收据与提交 JSON 一致，instrumentation 原始条目、构建成功和宿主日志也可对照。上轮宿主完整检查为 785 Node / 420 Vitest；本轮只重新执行上述 42 项定向。#123 Web 通过、Android skipped，与本地 Android 实测为不同证据。严格同 SHA 状态见 B-01。 |

## 最终建议

**BLOCKED。** 固定合成样本的本地 Android 实测可进入 M5 账本作为有效证据，保留适用范围。关账前先修复或限制 H-01 所涉运行入口，并在得到授权后验证旧 manifest 确会拒绝；同时按原计划解决 B-01 的 CI SHA 门禁。M-01、M-02 与 L-01 分别记录覆盖、证据可复算性和清理回执的限制。此复核不修改 M5-06 或 M5 整体状态。未移动分支、未提交或推送，未接触真实用户数据或设备数据库。
