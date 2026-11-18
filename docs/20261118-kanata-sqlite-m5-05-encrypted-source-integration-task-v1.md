# Kanata SQLite M5-05：加密旧源读取链路合成集成验收任务书 v1

- 状态：**PLANNED；尚未开始**
- 日期：2026-11-18
- M 阶段授权基线：`9bfff0867b4024d8d3a2aea2787ac2493164810b`
- 本任务接管基线：`6a858948ce95c6e9de938c0e19e7eaa2e5bef307`
- 工作分支：`m5/json-archive-migration`
- 目标：先修复当前 M5 合成导入回归，再用完全合成的加密文件验证现有 legacy Repository → M5 source contract → SQLite importer 的真实代码链路。

## 1. 当前事实与阻塞

当前分支已经有：

- `kanataDataMigrator.js`：端到端合成 JSON → SQLite 导入器，source 通过依赖注入。
- `kanataDataMigrationRows.js`：实体、关联表和扩展字段映射。
- `kanataMigrationCoordinator.js`：独立的通用 journal / transaction coordinator；不要与端到端导入器的 manifest-aware journal 混用。
- `tests/kanataSqliteDataMigration.test.js`：M5-01～M5-04 合成导入验收。
- `tests/helpers/kanataSqliteFixture.js`：合成领域数据。
- `tests/helpers/kanataArchiveFixture.js`：内存文件系统与注入式 Kanata Repository fixture。

目前端到端迁移测试的 source 直接返回已解密的合成对象；真实加密主文件读取、解密、领域校验和加密归档页读取尚未串入 M5 importer。

最新 CI：  
[Run 44266119902](https://github.com/Zhoubin601/ForMyself/actions/runs/44266119902)

该运行的 Web job 在 `npm run check` 失败，Android job 按 M5 分支策略跳过。日志显示以下问题，必须先复现和修复：

1. M5-01 首次导入在 `migrateCollection` 完成计数处报 `KANATA_MIGRATION_COUNT_MISMATCH`。
2. M5-02 故障批次恢复后也报同一计数错误，续传验收未通过。
3. M5-04 归档页校验失败后，journal 实际仍为 `pending`，测试要求其进入 `failed`。
4. `tests/kanataSqliteMigration.test.js` 仍从 `kanataDataMigrator.js` 导入 `createKanataMigrationCoordinator`；该实现已迁至 `kanataMigrationCoordinator.js`，导致测试模块加载失败。

不得通过跳过测试、放宽断言、删除测试或把预期值改成当前错误结果来消除阻塞。应先定位实际根因，修复后重跑完整测试。

## 2. M5-05 的目标

在不读取真实用户数据的前提下，使用仓库现有的真实加密、解密、Repository 和归档校验代码，建立一个**仅供测试使用的加密源桥接 fixture**，将它接入现有 `createKanataDataMigrator` 的 source 接口。

重点验证：

1. 主 JSON 使用当前 Kanata 加密 envelope，实际调用 `decryptKanataData` 和 `assertKanataData`。
2. 主 JSON v1（无归档）与 v2（含归档 descriptor）均按现有格式读取。
3. 历史归档页使用真实 `createMessageArchiveRepository` 读取链路，验证密文长度、SHA-256 key、密码、world/conversation scope、页版本、消息顺序、descriptor 元数据和 Bloom index。
4. M5 importer 能直接消费 Repository 返回的 source snapshot，并保留现有 `status=ready`、`recovered=false`、`hasPendingSave=false`、`saveError=''` 门禁。
5. 整个迁移过程对 source 只读；所有文件字节在迁移前后完全一致。
6. 任何错误、恢复态或取消都 fail closed，不能创建部分目标数据或把错误源当作空数据。

## 3. 实施步骤

### Step A：修复当前 CI 阻塞

- 核对 `tests/kanataSqliteMigration.test.js` 的 coordinator 导入路径和对应类型声明。
- 复现 M5-01 / M5-02 的 imported_count、cursor 与 expectedCount 不一致问题；修复累计计数或状态更新的真实缺陷。
- 复现 M5-04 在 archive read/validation 失败后 journal 未进入 `failed` 的路径；确保失败记录本身可安全提交，且不能推进 cursor。
- 验证失败批次数据与 cursor 原子回滚；重试从最后一个已提交 cursor 恢复。
- 保持 M5-01～M5-04 的原始测试意图，不通过修改预期结果掩盖缺陷。

定向命令：

```bash
node --test tests/kanataSqliteDataMigration.test.js tests/kanataSqliteMigration.test.js
```

随后执行：

```bash
npm run check
```

### Step B：增加 test-only encrypted source bridge

建议新增：

- `tests/helpers/kanataSqliteEncryptedLegacySource.js`

可以复用：

- `tests/helpers/kanataArchiveFixture.js` 的内存文件系统、journal 和注入式 Repository。
- `encryptKanataData` / `decryptKanataData`。
- `createKanataRepository`。
- `repository.archives.write / inspectAll / read`。
- `KANATA_DATA_PATH` 和现有归档目录常量。
- `kanataSqliteFixture` 或 `archiveData` 生成合成 KanataData。

fixture 组装建议：

1. 创建内存文件系统和显式注入的 Repository；禁止使用默认 Capacitor Filesystem 或真实 Preferences。
2. 用合成消息调用 `repository.archives.write` 生成真实格式的加密归档页和 descriptor。
3. 构造合法 v2 KanataData header（活动消息与归档 descriptor 分离），使用 `encryptKanataData` 生成主密文并写入内存文件系统的 Kanata 主数据路径。
4. source 的 `read(password)` 调用注入 Repository 的 `read(password)`，并从 `getState()` 补齐 `hasPendingSave` / `saveError`。
5. source 的 `inspectArchives(descriptors)` 委托 `repository.archives.inspectAll`。
6. source 的 `readArchive(descriptor,password,assertCurrent)` 委托 `repository.archives.read`，scope 必须来自 descriptor，保留取消检查。
7. 提供显式 `release()` 清理 Repository 生命周期；不得缓存密码或在 helper 闭包中长期保存解密后的图。

此 helper 必须放在 `tests/helpers/`，不新增可被生产组合根调用的 source adapter，不修改 Store、Driver、canonical 或激活开关。

### Step C：接入真实代码链路的集成测试

建议新增：

- `tests/kanataSqliteEncryptedLegacySource.test.js`

至少覆盖：

| 场景 | 预期 |
|---|---|
| v1 主 JSON，无归档 | 真实解密、领域校验成功，可被 importer 消费 |
| v2 主 JSON + 真实加密归档页 | 主 header 和归档页都通过现有 Repository 解密/校验，归档消息及 archived marks 正确导入 |
| 错误密码 / 损坏密文 | 在创建目标 journal 前失败 |
| 合法密文但 JSON 损坏 | 返回明确损坏错误，不初始化空数据 |
| 未知未来 data version / archive version | fail closed，不回退旧副本覆盖源 |
| 领域图引用非法、重复 ID、跨 world/conversation | 完整领域校验拒绝 |
| 归档缺失、字节数变化、key/hash 不匹配 | 该页不写入任何目标消息 |
| descriptor 消息 ID/revision/time、scope、index 与页正文不一致 | 拒绝导入 |
| primary 缺失或损坏但 backup/temp 可读 | Repository 返回 recovered；M5 importer 必须拒绝 recovered source |
| pending recovery / pending save / saveError | 创建目标 journal 前拒绝 |
| 迁移期间取消 | 不启动后续归档页读取，不推进未提交 cursor |
| 只读性 | 迁移后主密文、归档密文、journal 原始值逐字节不变；迁移阶段无 write/rename/delete 调用 |

至少执行一次完整 `createKanataDataMigrator` 端到端导入，而不是只单测解密函数。

## 4. 强制安全边界

本任务仅处理合成 fixture：

- 不访问真实设备、真实用户文件或真实 Preferences。
- 不读取生产 `formyself/kanata-v1.enc`、真实备份、真实 recovery journal 或真实归档目录。
- 不扫描真实文件目录；source 只能访问测试 helper 显式创建的内存文件。
- 不连接生产 Store，不改变 `canonical=legacy`，普通 APK SQLite 激活位保持 `false`。
- 不删除、重命名、覆盖、压缩或清理任何旧 JSON / backup / archive。
- 不运行 Android 构建、assemble、install、instrumentation；本分支继续跳过 Android job。
- 不发布 APK，不创建 Release，不合并 M / main。
- 不改变 Schema 001–005、application_id 或历史 checksum。
- 不调用真实模型 API，不引入真实密码、密钥或用户资料。
- 不将主密码、解密明文、消息正文写入日志、journal、QA 报告或提交。

主 JSON 是单个加密 envelope，现有协议要求整体解密并进行完整领域校验；不得宣称支持文件内部随机访问或流式 JSON 解密。历史正文按最多 50 条的加密页逐页读取；当前 importer 的批次大小仍不得超过 50。

## 5. 验收门禁

M5-05 只有满足以下全部条件才可标记 PASS：

1. M5-01～M5-04 全部通过，M5-05 新增测试全部通过。
2. `node --test tests/kanataSqliteDataMigration.test.js tests/kanataSqliteMigration.test.js tests/kanataSqliteEncryptedLegacySource.test.js` 退出 0。
3. `npm run check` 退出 0。
4. 所有失败场景均证明目标 journal / 数据写入符合预期；失败批次不推进 cursor。
5. 成功迁移后，所有目标表行数、精确值哈希、实体 ID、归档标记、FK 和 `integrity_check` 复核通过。
6. source 的文件字节和 recovery journal 在迁移前后完全一致；迁移阶段只发生读取调用。
7. 测试使用的 filesystem、journal、password 和数据全部为合成值，并能从 fixture 生成代码复现。
8. CI 运行 SHA 与报告记录 SHA 一致。

M5-05 PASS 只表示**加密旧源格式在合成环境中与 importer 完成集成验证**。它不代表 M5 整体 PASS，不代表真实用户数据已迁移，也不授权生产 Repository 接线、生产切换、旧文件清理或 APK 发布。

## 6. 交付物

- 当前 M5 CI 回归修复。
- test-only encrypted legacy source helper。
- 加密主 JSON + 归档页端到端集成测试。
- 更新后的 [M5 QA 记录](qa/kanata-sqlite-m5/README.md)，包含命令、结果、提交 SHA、source 不变性证据和未覆盖项。
- 本任务书的最终执行记录：PASS / FAIL / BLOCKED，不能只写“已完成”。

## 7. 停止条件

遇到以下任一情况立即停止并报告，不得自行扩大授权：

- 需要访问真实文件系统、真实设备或真实用户数据才能继续。
- 需要接入生产 Repository、Store、lifecycle 或 canonical。
- 需要修改 Schema 001–005 或现有生产数据格式。
- 需要构建/安装 APK、启动 Android Emulator 或运行原生 instrumentation。
- 需要删除、重命名或清理旧文件。
- 无法在不降低现有测试门槛的情况下修复当前回归。
