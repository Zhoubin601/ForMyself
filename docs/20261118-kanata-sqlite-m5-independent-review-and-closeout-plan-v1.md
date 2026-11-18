# Kanata SQLite M5-06 独立复核与 M5 总体验收计划 v1

- 状态：**PLANNED — REVIEW ONLY**
- 日期：2026-11-18
- 工作分支：`m5/json-archive-migration`
- 当前远端 HEAD：`3e828399887bb10931a118021a31a4a18e144a29`
- M5-06 实现提交：`a781563d25e1dab66f2f18046df5b80032e09a78`
- M5-06 验收记录提交：`3e828399887bb10931a118021a31a4a18e144a29`
- 本计划只授权规划与只读复核，不授权生产接线、真实数据操作、Android 构建或发布。

## 1. 当前已核实状态

1. 远端分支 `m5/json-archive-migration` 的 HEAD 为 `3e828399...`，其直接父提交为实现提交 `a781563d...`。
2. `a781563d...` 相对 M5-06 执行基线 `3ff66376776f46659dfc91bcbd34b9a43abfcb5e` 有 1 个实现提交，涉及 10 个文件。
3. `3e828399...` 相对 `a781563d...` 的后续差异为文档和验收证据；没有新增应用源代码改动。
4. Quality run [44300628326](https://github.com/Zhoubin601/ForMyself/actions/runs/44300628326) 的 head SHA 是 `3e828399...`，结论为 success：Web Job 的 `npm run check` 通过，Android Job 按分支策略 skipped。
5. 因该运行 SHA 与实现 SHA 不同，当前只能记作**包含同一实现代码树的后代提交 CI 证据**。M5-06 任务书原有的“同 SHA CI”条件尚未严格满足；未经明确决定，不得自行把它改写为同 SHA PASS。
6. M5-06 本地 Android SQLCipher 合成实测、四个进程强杀恢复点和 1k/10k/100k 容量记录已提交，详见：
   - [M5-06 Android QA 报告](qa/kanata-sqlite-m5/m5-06-android-v1.md)
   - [M5-06 机器证据](qa/kanata-sqlite-m5/m5-06-evidence-v1.json)
   - [M5-06 执行任务书](20261118-kanata-sqlite-m5-06-android-sqlcipher-synthetic-acceptance-task-v1.md)
7. 上述 QA 报告和机器证据仍将 M5-06 标记为 BLOCKED，独立复核尚未完成。

## 2. 阶段目标

先完成 M5-06 的独立实现与证据复核，再汇总 M5-01～M5-06 的验收账本。M5 整体 PASS 必须建立在各阶段证据可追溯、相互一致且没有未解决阻塞的基础上。

本计划不启动 M5-07，也不把生产迁移或存储切换混入当前验收。

## 3. Step A：M5-06 独立只读复核

复核基线固定为：

- 实现基线：`3ff66376776f46659dfc91bcbd34b9a43abfcb5e`
- 实现提交：`a781563d25e1dab66f2f18046df5b80032e09a78`
- 验收证据提交：`3e828399887bb10931a118021a31a4a18e144a29`

必须直接检查 Git diff 和文件内容，不能只根据已有 QA 报告复述结论。

### A1. 迁移器与构建隔离

- 审查 `kanataDataMigrator.js` 的 manifest、累计计数、批次游标、事务边界、失败状态、冷启动恢复和 `already-complete` 判定。
- 检查数据行、journal cursor 与 manifest 是否在同一事务提交；检查回滚后是否可能出现数据与游标不一致。
- 检查 `android/app/build.gradle` 与 catalog 构建脚本：M5 语句目录是否只在显式 synthetic Debug 参数下加入，普通 SQL 目录和 Schema 001–005 是否保持不变。
- 检查生产 Store、应用生命周期、canonical 和普通 APK 激活路径没有被接线或改变。

### A2. 原生 QA 与测试可信度

逐项审查以下新增 QA 资产：

- `docs/qa/kanata-sqlite-m5/KanataM5CipherTest.java`
- `catalog.mjs`
- `device.mjs`
- `fixture.mjs`
- `run-android.mjs`
- 对应 Node 测试及 encrypted legacy source helper。

重点核实：

- 普通 SQLite 无法读取密文、正确密钥可读、错误密钥拒绝和连接释放断言确实执行了目标行为。
- 四个强杀点确实杀死旧进程，恢复使用新 PID 和保留的候选库；runner 不会在恢复前清空数据库。
- 断言没有通过 mock、固定返回值、宽松匹配或跳过路径制造假阳性。
- QA 包、测试包、AVD、manifest、APK 读回哈希与 bundle/catalog 指纹相互绑定。
- 密码、密钥、明文正文和真实用户文件不会进入日志、持久化文件或提交。
- 清理动作只影响本轮创建的 QA 资源。

### A3. 证据一致性

- 将 QA Markdown、机器 JSON、提交 SHA、Actions run、测试命令和报告中的计数逐项交叉核对。
- 核对 50 张表的计数/哈希、外键检查、integrity_check、源不变性、重复导入零写入、批次上限 50 和容量数据。
- 明确模拟器结果与实体设备结果的边界；不得把模拟器数据写成实体设备实测。
- 对所有不一致或无法由现有证据支持的结论列出文件、行号、影响和建议。

### A4. 复核输出

输出一份独立复核记录，至少包含：

- 复核基线与实际检查的 commit SHA；
- 检查过的文件清单；
- Findings（按 Blocker / High / Medium / Low 分级，包含文件和行号）；
- 证据一致性表；
- 安全边界检查结果；
- 结论：PASS / BLOCKED / FAIL。

只读复核期间不修复发现的问题，不改生产代码，不删除或弱化测试。

## 4. Step B：CI SHA 门禁处理

当前 Quality workflow 对所有分支 push 触发 Web Job；Android Job 仅在 ref **不是** `refs/heads/m5/json-archive-migration` 时运行，当前 workflow 没有 `workflow_dispatch` 入口。

因此：

- 不得为了追求 `a781563d...` 的精确 SHA CI 而临时创建其他分支；按当前 workflow，这会触发 Android Job。
- 不得回退、强推或临时移动现有分支 ref。
- 当前 run #123 可以作为代码树等价证据：它运行在实现提交的直接后代，且两提交之间只有文档差异。
- 但“接受后代提交的代码树等价 CI”属于对原同 SHA 门禁的例外。需要用户明确接受后，才能在验收记录中按例外关闭该项。
- 如果用户不接受该例外，保持 BLOCKED，并另行提出不触发 Android Job 的 CI 方案；未经授权不得修改 workflow 或分支策略。

## 5. Step C：M5-06 关账

只有同时满足以下条件才可把 M5-06 改为 PASS：

1. Step A 独立复核没有未解决的 Blocker / High finding。
2. Step B 的 CI SHA 门禁已按原规则满足，或用户明确接受代码树等价例外。
3. QA 报告、机器证据、任务书和复核记录使用一致的状态与 SHA。
4. 所有未覆盖项继续明确列出，不把模拟器结果扩展为实体设备或生产数据证据。

关账时只更新文档和验收记录，保留原始机器证据，不改写历史失败记录。

## 6. Step D：M5-01～M5-06 总体验收账本

M5-06 关账后，逐阶段建立验收矩阵：

| 阶段 | 必须核对的证据 |
|---|---|
| M5-01 | 原始任务书、实现 SHA、定向测试、计数/哈希、失败关闭证据 |
| M5-02 | 中断、事务回滚、cursor 续传、源指纹变化拒绝 |
| M5-03 | recovery / missing source / occupied target / wrong application_id 等拒绝路径 |
| M5-04 | 归档页损坏、descriptor/index 不一致和写入前拒绝 |
| M5-05 | 真实加密 Repository 链路、只读性、取消、错误密码和同 SHA CI |
| M5-06 | Android SQLCipher、密钥释放、四个强杀点、容量、证据指纹和独立复核 |

总体验收账本应记录每阶段状态、实现 SHA、证据 SHA、CI URL、测试结果、未覆盖项和复核结论。任何阶段缺证、SHA 对不上或仍有阻塞，M5 整体保持 OPEN / NOT ACCEPTED。

## 7. 后续阶段边界

M5 总体验收完成后，再单独编写生产准备阶段计划（候选 M6），明确设计与验收：

- 生产 Repository / Store 接线；
- 真实数据迁移前的备份、预检、容量与恢复策略；
- canonical 切换条件与回滚策略；
- 旧 JSON / backup / archive / recovery journal 的保留和清理策略；
- 普通 APK、升级路径和发布验证。

以上内容目前都不在授权范围内。真实数据访问、生产 Store 接线、canonical 切换、旧文件清理、APK 发布和合并主分支均需新的明确授权。

## 8. 本轮禁止事项

- 不访问、复制、扫描、导入或迁移真实用户数据、真实设备数据库或真实备份。
- 不接入生产 Store / lifecycle，不改变 canonical 或普通 APK SQLite 激活位。
- 不修改 Schema 001–005、application_id、历史 checksum 或生产数据格式。
- 不执行 Android build / assemble / install / emulator / instrumentation。
- 不删除、覆盖、重命名、压缩或清理任何旧 JSON、backup、archive 或 recovery journal。
- 不发布或分发 APK，不创建 Release，不合并 M / main。
- 不 force-push、不回退现有分支、不创建临时 CI 分支。
- 未经单独授权，不修改实现代码、CI workflow 或分支策略。

## 9. 交付物

1. M5-06 独立复核报告。
2. M5-06 PASS / BLOCKED / FAIL 关账记录及 SHA/CI 说明。
3. M5-01～M5-06 总体验收账本。
4. 后续 M6 生产准备阶段的独立规划草案（仅规划，不执行）。

本计划本身不代表 M5-06 或 M5 整体已经验收。
