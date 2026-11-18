# Kanata SQLite M5-06 整改任务书 v1

- 状态：**PLANNED — 范围冻结；等待启动**
- 日期：2026-11-18
- 仓库：`Zhoubin601/ForMyself`
- 工作分支：`m5/json-archive-migration`
- 制定时远端 HEAD：`1742dc7faeef43fcd7d24fc6f107d72a98331727`
- M5-06 实现基线：`a781563d25e1dab66f2f18046df5b80032e09a78`
- M5-06 验收证据基线：`3e828399887bb10931a118021a31a4a18e144a29`
- 独立复核报告：[`m5-06-independent-review-v1.md`](qa/kanata-sqlite-m5/m5-06-independent-review-v1.md)
- 目标：**只处理独立复核报告中的 B-01、H-01、M-01、M-02、L-01 五项发现。不得扩大到其他 M5 阶段或生产迁移。**

## 1. 冻结范围

本任务只允许以下五项整改：

| ID | 级别 | 本次唯一目标 |
|---|---|---|
| B-01 | Blocker | 为本次整改实现提交取得严格同 SHA 的 GitHub Web CI 证据 |
| H-01 | High | 将 QA runner 的破坏性操作绑定到本轮唯一 AVD 实例，并拒绝陈旧/错配 manifest |
| M-01 | Medium | 补齐本次合法合成因果边 `event_causes` 所需的固定 SQL 目录查询和正向回归 |
| M-02 | Medium | 将现有 50 张目标表的逐表计数/摘要及恢复收据写入机器证据，使本轮原生结果可复算 |
| L-01 | Low | 检查 force-stop 命令退出码，并验证本轮 QA 进程确已退出 |

除上述五项外，不得顺手重构、升级依赖、改变架构、增加数据模型、扩大关系图覆盖面或处理其他历史问题。发现额外问题只记录并报告，不在本任务中修改。

## 2. B-01：严格同 SHA Web CI

### 要求

1. 保持现有 `.github/workflows/quality.yml` 和分支策略不变。
2. 不创建临时分支，不使用 workflow_dispatch，不移动/回退/强推分支。
3. 本次实现修复形成一个明确的代码实现提交 SHA。
4. 在获得用户明确推送授权后，将该提交推送到 `m5/json-archive-migration`。
5. 核对 GitHub Actions 的 `head_sha` 与实现提交 SHA **逐字符完全一致**，且 Web Job 的 `npm run check` 成功。
6. Android Job 继续按当前 M5 分支策略跳过；不得为了触发 Android Job 改变 workflow。

### 验收

- 同 SHA Web CI 成功：B-01 PASS。
- 仅有实现提交后代文档提交的 CI：仍不满足严格同 SHA 门禁。
- 未获推送授权：保持 BLOCKED，不得声称 CI 已通过。

## 3. H-01：AVD 本轮实例身份绑定

### 目标

修复 `docs/qa/kanata-sqlite-m5/run-android.mjs` 与现有启动器之间的身份校验缺口。所有会改变 QA 包或候选库状态的操作，必须确认目标是本轮创建并启动的 AVD 实例。

### 允许修改范围

- `docs/qa/kanata-sqlite-m5/run-android.mjs`
- `docs/qa/kanata-sqlite-m5/device.mjs`
- `docs/qa/kanata-sqlite-m2/start-windows-synthetic-avd.ps1`（仅在实现唯一实例身份所必需时）
- 对应的 M5 QA runner 单元/集成测试和任务所需证据字段。

### 必须实现

1. 为每轮 QA 创建不可复用的实例身份/nonce，并与启动器进程身份、实际 AVD 数据目录/路径、ADB serial、API level 和本轮 manifest 绑定。
2. runner 在执行 install、`pm clear`、kill、force-stop 或其他会改变本轮 QA 包/候选库状态的动作前，重新验证身份绑定。
3. 身份字段缺失、重复、过期、PID 不匹配、AVD 路径不匹配、serial 不匹配或无法确认时，必须 fail closed；禁止执行任何破坏性命令。
4. 不允许仅凭固定 AVD 名称、固定 serial、包名白名单或旧 manifest 判断实例属于本轮。
5. manifest 记录本轮唯一身份及必要的可复核字段；不得写入密码、密钥、明文消息或用户数据。

### 必须新增的负向验收

- 使用上一轮/陈旧 manifest 指向当前同名 AVD。
- 使用同名、同 serial、安装相同白名单包但实例 nonce 或 AVD 路径不匹配的模拟场景。
- 断言 runner 在 install、clear、kill 等任何破坏性操作之前拒绝。
- 断言拒绝前后 QA 包状态、候选库字节和目标 AVD 状态均未改变。
- 保留拒绝原因和零破坏性调用的脱敏收据。

不要求更改 M2 通用启动器的既有产品行为；如确需修改，只限于提供本轮唯一身份并供 M5 runner 校验。

## 4. M-01：固定 SQL 目录的 event_causes 覆盖

### 目标

仅补齐独立复核报告指出的合法合成因果边查询，不将本任务扩展为任意关系图或全部领域表的普遍覆盖改造。

### 必须实现

- 在 `docs/qa/kanata-sqlite-m5/catalog.mjs` 中补齐 `event_causes` 的固定分页查询，字段和排序语义与迁移器要求一致。
- 保持固定 SQL 目录白名单机制；禁止动态拼接任意 SQL。
- 在合成 fixture 中增加至少一条指向已存在事件的合法因果边。
- 通过实际固定目录和现有导入器完成该 fixture 的端到端导入。
- 验证 `event_causes` 行数、精确字段值摘要、外键与 integrity。
- 保留其他本次 fixture 预期为空的表的零行断言。

参考缺失查询：

```sql
SELECT rowid AS __rowid,world_id,event_id,cause_event_id
FROM event_causes
WHERE rowid>?
ORDER BY rowid
LIMIT 50
```

不得以宿主模拟目录放宽、绕过原生固定目录或跳过 catalog 校验的方式通过测试。

## 5. M-02：逐表机器证据与恢复收据

### 目标

使机器证据能够独立复算本轮已有的 50 张目标表原生验收结果；只补齐本轮现有断言的证据输出，不建设通用遥测或新 QA 平台。

### 必须记录

1. 50 张表逐表记录：
   - 表名；
   - 行数；
   - 是否为空；
   - 与现有宿主验收算法一致的确定性逐表 SHA-256（空表也要有明确、可复算的表示）。
2. 记录聚合摘要的算法/版本和输入顺序，确保从逐表记录可以复算聚合值。
3. 对每个强杀点记录：
   - fault hook 名称和到达确认；
   - 旧 PID 与新 PID；
   - 旧 PID 消失确认；
   - 旧 CDP 连接断开确认；
   - 冷启动使用的同一候选库路径/身份；
   - 重启前的 cursor、计数、manifest 状态；
   - 重启后的完整表校验结果。
4. 对源只读性记录：
   - 主密文与归档密文的迁移前后摘要；
   - recovery journal 迁移前后摘要；
   - source read 调用数；
   - source write、rename、delete 调用数（均应为 0）。
5. 证据只包含合成数据摘要、计数、状态、哈希和脱敏收据。禁止记录密钥、明文正文、完整数据库、APK 二进制或真实用户资料。

### 验收

- QA Markdown 与机器 JSON 中的计数、摘要、PID、cursor 和 fixture/build 指纹一致。
- 独立脚本可以仅凭机器 JSON 复算逐表聚合摘要。
- 对任何缺失字段、重复表、未知表或摘要不匹配，验证器必须失败。
- 不得以单个聚合摘要代替 50 张逐表摘要。

## 6. L-01：force-stop 退出确认

### 必须实现

- 检查 `adb shell am force-stop` 的实际退出码；非零立即记录失败。
- 命令成功后，查询并确认本轮 QA 应用 PID 已消失。
- PID 仍存在、查询失败或身份不匹配时，清理状态不得记录为成功。
- 清理失败不能覆盖或吞掉之前的测试失败；需要同时保留原始测试错误与清理错误。
- 不对非本轮 AVD 或非本轮包执行 force-stop。

### 验收

增加命令非零、PID 仍存活、PID 查询失败、正常退出四类测试；只有最后一种可以报告 cleanup success。

## 7. 本轮重新验收

本次修改涉及 runner、固定 SQL catalog 和原生 QA 收据，因此在隔离环境重新执行 M5-06 原有合成验收范围：

1. 宿主定向测试覆盖上述五项修复及既有 M5-06 相关测试。
2. 使用全新、唯一身份的隔离 API 34 AVD。
3. 重跑 SQLCipher 正确密钥/错误密钥/普通 SQLite 拒绝与连接释放测试。
4. 重跑含合法 `event_causes` 因果边的合成端到端导入。
5. 重跑四个既有强杀点和冷启动续传。
6. 重跑既有 1k、10k、100k 三档合成容量测试；记录本轮实际结果，不与旧轮数据混写。
7. 复核普通 SQL 目录、Schema 001–005、checksum、application_id、生产 Store、canonical 和普通 APK 激活路径保持不变。
8. 重新生成 QA Markdown 与机器 JSON；保留旧证据，不覆盖旧轮记录。

本任务不增加新的容量档位、新设备矩阵或额外业务场景。

## 8. CI 与提交顺序

1. 本地完成实现、宿主测试、隔离 Android 合成验收和证据生成。
2. 形成一个清晰的实现提交 SHA；验收文档/机器证据可另有后续文档提交。
3. 在推送前报告实现 SHA、工作区状态、测试结果和待推送提交列表。
4. **推送需要用户明确授权。** 未获授权不得 push。
5. 获得授权后，推送实现提交本身，等待该精确 SHA 的 Quality Web Job 完成。
6. 只有 `head_sha` 与实现 SHA 完全相同且 Web `npm run check` 成功，B-01 才能关闭。
7. 不修改 workflow，不创建临时分支，不触发 Android CI。

## 9. 明确不在本任务范围

以下内容一律禁止，发现需要时停止并另行报告：

- M5-01～M5-05 的重新设计或无关重构。
- M5 整体验收账本、M5-07 或 M6 生产准备。
- 生产 Repository / Store / lifecycle 接线。
- 读取、复制、扫描、迁移真实用户数据、真实设备数据库、真实备份或真实归档。
- canonical 切换或普通 APK SQLite 激活位变更。
- 删除、覆盖、重命名、压缩或清理旧 JSON、backup、archive 或 recovery journal。
- 修改 Schema 001–005、application_id、历史 checksum、生产数据格式或全局密钥语义。
- 升级 SQLCipher、Capacitor、Gradle、Android 插件或其他依赖。
- 新增容量档位、新设备矩阵、无关领域关系覆盖或通用 QA 平台。
- 发布/分发 APK、创建 Release、合并 M/main。
- 未经用户明确授权推送任何提交。

## 10. 完成定义

本任务五项发现分别记录 PASS / BLOCKED / FAIL，并附代码位置、测试结果和证据：

- H-01：实例身份绑定与陈旧 manifest 零破坏性拒绝测试通过。
- M-01：固定 SQL catalog 可导入至少一条合法合成 `event_causes` 因果边。
- M-02：50 表逐表摘要和四个强杀点机器收据可独立复算。
- L-01：force-stop 退出码与 PID 消失均被验证，清理失败正确报告。
- B-01：实现提交精确 SHA 的 Web CI 通过；未推送授权时保持 BLOCKED。

只有五项全部满足，才可提出 M5-06 重新独立复核。**本任务本身不自动将 M5-06 或 M5 整体标记为 PASS。**
