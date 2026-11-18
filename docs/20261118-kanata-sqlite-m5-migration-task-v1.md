# Kanata SQLite M5：JSON → SQLite 迁移器开发任务单

- 状态：**开发中；尚未验收**
- 授权日期：2026-11-18
- 唯一基线：`9bfff0867b4024d8d3a2aea2787ac2493164810b`
- 隔离分支：`m5/json-archive-migration`
- 本轮范围：迁移器开发、合成数据验收。

## 1. 授权边界

本轮只允许开发迁移器并用仓库合成 fixture 验收。以下事项明确禁止：

1. 不读取、复制、改写或验证真实用户数据。
2. 不将 SQLite 接入生产 Store，不改变 `canonical=legacy`。
3. 不改变普通 APK 的 SQLite 激活位（继续为 `false`）。
4. 不删除、重命名、压缩或清理旧 JSON、备份、归档文件。
5. 不发布、分发或安装新的 APK；不合并到 main。
6. 不调用真实模型 API，不把真实密钥写入候选数据、日志或测试产物。

迁移目标只能是独立注入的、Schema 005 已初始化且为空的候选 SQLite operation，并须通过 application_id 与 foreign_keys=ON 门禁。通用协调器与端到端导入器使用不同 journal ID 方案，当前阶段不要在同一候选库混用两者。为遵守“不发布 APK”，本分支的 Quality workflow 只运行 web/npm check job，并通过 branch-only 条件跳过 Android APK 构建 job。迁移器没有生产 Store 接线、生产开关、源文件写入或清理接口。

## 2. 当前实现

- `kanataDataMigrationRows.js`：按依赖顺序把 KanataData 和关系行映射为固定 SQL + bind parameters；未知实体字段保存在 `extensions_json`。
- `kanataMigrationCoordinator.js`：保留先前提交的 synthetic-only 通用 journal/事务协调器及其独立测试。
- `kanataDataMigrator.js`：端到端合成数据迁移器；只接受注入的 synthetic source snapshot，工厂和运行请求都要求 synthetic-only 授权；本阶段不提供真实 Repository 适配器，也不接入生产 Store。它负责源指纹、空目标门禁、逐 collection journal、原子批次提交、失败游标恢复和目标逐表哈希复核。
- 归档消息按已验证页读取；迁入 `messages` 并写入 `archived_message_marks`，保持历史消息与当前聊天窗口语义。
- 目标复核包含所有迁移表的行数与精确列值链式 SHA-256、实体 ID 注册表、触发器生成的 participants / array-order 行、事件替代关系、外键检查和 SQLite integrity check。
- 单批上限 50。批次写入和 journal 游标在同一事务提交；中断后从最后一个已提交 cursor 继续。
- 注入的 synthetic source snapshot 必须声明 `status=ready`、`recovered=false`、`hasPendingSave=false`、`saveError=''`。missing、backup recovery、pending/failed snapshot、源指纹变化、非空目标、Schema 版本或 application_id 不符均 fail closed。真实 Repository 读取适配器留待另行授权后开发。

### 旧 JSON 格式的有界性说明

主 Kanata JSON 是单个加密 envelope，现有 Repository 只能整体解密并进行一次完整领域校验；迁移器不会伪称它能从单个 JSON 文件随机读取部分对象。历史消息正文已拆为独立加密归档页，迁移器逐页解密、校验，并将 SQLite 写入限制为最多 50 条记录/批次。当前实现最多缓存一个归档页；主 envelope 仍需一次性形成已验证的 KanataData 图。

## 3. 数据顺序与约束

- dataset metadata → worlds/identities → cards/current versions/remaining versions → instances → conversations/participants。
- life grants 在消息及其 life-source links 之前导入。
- 归档消息页按 world / conversation / 时间顺序导入，之后导入 active messages；因此历史回复目标先于较新的回复消息。
- lorebook、memory、relationship、event、effect、task、policy、schedule、usage、preset、role binding、audit 及各自关系表按外键依赖排序。
- 事件的 `replaces_event_id` 在所有事件存在后补写；原因关系、来源引用、life-source、memory link 与任务结果关系在其两端记录存在后导入。
- schema trigger 生成的 `entity_ids`、`participants`、事件/效果/基线数组序号也纳入目标哈希复核。

## 4. Journal 契约

每个逻辑 source collection 一条 `data_migrations` 记录，另有 `__manifest__`：

- `source_fingerprint`：主加密 JSON 指纹 + 归档 descriptor / page key 元数据的组合指纹。
- `target_schema_version`：必须等于当前冻结的 Schema 005。
- `collection`：逻辑迁移集合名。
- `extensions_json.targetTables`：本集合写入的目标表清单（含触发器副作用）。
- `cursor_json`：数组 offset 或归档页 index / message offset。
- `imported_count`：已原子提交的 source item 数。
- `state`：pending / running / failed / complete。
- `__manifest__` 保存每个目标表的列顺序、行数、逐行链式哈希及数组序号游标。

目标 journal 与数据批次同事务更新。失败批次回滚后只记录安全错误码；不会把未提交批次推进到 cursor。重试要求源指纹、计划版本和目标 Schema 完全一致。

## 5. 验收门禁

合成测试至少覆盖：

- 首次迁移、归档分页、归档标记、未知扩展字段、所有目标表哈希及外键/完整性复核。
- 批次中途故障：整批回滚、cursor 不前进、重试可续接且不重复。
- 源指纹变化、recovered/missing source、非空目标全部拒绝。
- 归档正文与 descriptor index 不一致时，拒绝导入该页。
- 完成后重复执行为幂等验证，不重复写入。

只有自动化检查与上述合成验收全部通过，才可将 M5 迁移器开发标为本阶段 PASS。即使 M5 PASS，也不自动授权生产切换、真实数据迁移、旧文件清理或 APK 发布；这些必须另行审批。

## 6. 本轮交付

- 迁移器与 row mapper 源码。
- 合成测试：`tests/kanataSqliteDataMigration.test.js`。
- QA 记录：[M5 synthetic acceptance](qa/kanata-sqlite-m5/README.md)。
- 本文档作为 M5 工作边界；M4 最终验收与历史失败证据保持不变。


## 7. 下一步任务入口（2026-11-18）

当前端到端导入器仍使用注入式合成 source，尚未经过真实 Kanata 加密主文件和加密归档 Repository 读取链路。下一步任务为 [M5-05：加密旧源读取链路合成集成验收](20261118-kanata-sqlite-m5-05-encrypted-source-integration-task-v1.md)。

M5-05 接管时先修复最新 CI 回归，再通过内存文件系统 fixture 调用现有 `createKanataRepository` / archive repository / 加解密函数；不创建生产 source adapter，不访问真实用户数据或真实文件系统。

实现基线检查点：`6a858948ce95c6e9de938c0e19e7eaa2e5bef307`。该检查点的最新 Web CI 运行 `44266119902` 失败，具体失败项和验收要求以 M5-05 任务书为准。M5 仍为开发中，不能标记 PASS。

本地执行已修复上述回归并串起加密读取链路，证据及对应实现 SHA 见 [M5 QA](qa/kanata-sqlite-m5/README.md)。M5-05 仍待同实现的 Web CI 证据，生产适配和切换仍需另行授权。
