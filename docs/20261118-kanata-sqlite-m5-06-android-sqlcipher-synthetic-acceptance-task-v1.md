# Kanata SQLite M5-06：Android SQLCipher 合成验收任务书 v1

- 状态：**BLOCKED — 同 SHA 的 Web CI 与独立复核待完成**
- 日期：2026-11-18
- 授权基线：M5 用户授权基线 `9bfff0867b4024d8d3a2aea2787ac2493164810b`
- 当前工作分支：`m5/json-archive-migration`
- M5-05 已验收提交：`838635ac6084ecd7e9a02b383c5e79789a8eb472`
- 前置证据：[M5-05 closeout](20261118-kanata-sqlite-m5-05-closeout-v1.md)、[M5 QA](qa/kanata-sqlite-m5/README.md)

## 1. 目标

在隔离 Android QA 环境中，以**合成数据**验证 M5 迁移器目标端在真实 Android SQLCipher 运行时的行为，补齐 Node 内存 SQLite 验收无法覆盖的原生数据库差异。

本阶段只验证候选数据库和迁移器，不接入生产 Store，不改变 canonical，不迁移真实用户数据。

## 2. 前置核查

开始前必须：

1. 核对当前分支 HEAD、工作区状态和 M5-05 PASS 证据。
2. 复核 M0/M2 已冻结的 SQLCipher 插件版本、原生桥接方式、密钥生命周期和 Android 测试环境；不得自行升级依赖。
3. 复核 Schema 005、application_id、外键配置和 migration journal 契约；不得修改已冻结 Schema 或历史 checksum。
4. 读取项目 Android QA / instrumentation 规范和既有隔离模拟器脚本。
5. 明确测试数据库、密钥、fixture、临时目录全部由测试创建，结束后只清理本次测试生成的临时资源。

任何一项需要修改生产数据格式、Schema 001–005、密钥产品语义或生产接线时，停止并请求单独授权。

## 3. 合成验收范围

### A. SQLCipher 加密与密钥拒绝

- 创建独立临时 SQLCipher 数据库，写入可识别的合成 sentinel。
- 证明普通 SQLite 无法以明文方式读取该数据库。
- 正确测试密钥可打开；错误密钥必须拒绝。
- 密钥不得写入普通 Preferences、日志、测试报告或持久化明文文件。
- 验证数据库关闭后连接不可继续使用，锁定/释放路径不保留可访问连接。

### B. 迁移器端到端导入

- 将 M5-05 的合成加密主 JSON / 归档 fixture 作为只读源。
- 导入目标仅为本次测试创建的空 Schema 005 SQLCipher 数据库。
- 覆盖活动消息、归档页、归档标记、未知扩展字段和来源关系。
- 验证每批最多 50 条；目标行和 journal cursor 同事务提交。
- 完成后检查 50 张迁移目标表的计数与可复核哈希、外键和 integrity。
- 源 fixture 在迁移前后逐字节一致；禁止源写入、rename、delete。

### C. 中断与恢复

通过测试注入在以下时点终止进程或关闭数据库：

- 首批提交前；
- 一批写入事务中；
- 一批成功提交后、下一批开始前；
- 导入完成后、最终验证前。

重启后验证：

- 未提交批次完全回滚；
- cursor 只指向最后一个完整提交批次；
- 重试可续接且不重复；
- 源指纹变化、错误密钥、损坏归档和非空目标均 fail closed；
- 不得把损坏/恢复态源当作空数据。

### D. 容量与有界性

使用确定性合成数据集，至少覆盖 1k、10k；若环境允许再覆盖 100k 消息。记录：

- 设备/模拟器 API 级别、Android 版本、SQLCipher 与插件准确版本；
- 数据集规模、生成 seed、fixture 指纹；
- 导入总耗时、分批耗时、峰值内存/RSS、数据库体积；
- 最近消息查询与历史分页耗时；
- 失败/重试和数据库完整性结果。

不得把模拟器数字描述为实体设备实测。若 100k 在合理资源内无法完成，记录实际阻塞与证据，不得伪造或降低验收标准。

## 4. 验收门禁

M5-06 只有全部满足才可 PASS：

1. 原生 SQLCipher 加密、错误密钥拒绝和密钥生命周期验证通过。
2. 合成端到端迁移在 Android SQLCipher 目标库成功。
3. 中断/重启/续传场景无重复、无半批提交，journal 与目标数据一致。
4. 所有目标表计数/哈希、外键与完整性检查通过。
5. 源 fixture 字节级不变，测试期间无真实用户数据访问。
6. 容量结果含设备、版本、数据集指纹和可复现命令；缺少的规模明确标记 BLOCKED。
7. Web `npm run check` 通过；Android QA/instrumentation 证据与提交 SHA 对齐。
8. 独立复核未发现绕过测试、弱化断言或安全边界回归。

M5-06 PASS 仍不自动代表 M5 整体 PASS；M5 总体验收还需对 M5-01～M5-06 证据进行独立汇总审查。

## 5. 明确禁止

- 不读取、复制、扫描或迁移任何真实用户数据、真实设备数据库、真实备份或真实归档。
- 不连接生产 Store，不修改 canonical，不改变普通 APK SQLite 激活位。
- 不删除、覆盖、重命名、压缩或清理任何旧 JSON、备份、归档或 recovery journal。
- 不修改 Schema 001–005、application_id、历史 checksum 或生产数据格式。
- 不修改全局主密码、密钥封装或其他受保护模块的产品语义。
- 不发布、分发或上传 APK，不创建 Release，不合并 M/main。
- 未经单独授权，不执行 Android build、assemble、install、emulator 或 instrumentation 命令。

## 6. 授权状态

2026-11-18 用户明确授权按本任务书执行，包括必要修改、隔离构建、模拟器、instrumentation 和验收提交。其他范围仍需单独授权。

## 7. 执行记录（2026-11-18）

- 执行基线 `3ff66376776f46659dfc91bcbd34b9a43abfcb5e`。本地实现与原生验收 SHA 为 `a781563d25e1dab66f2f18046df5b80032e09a78`。
- Windows 新建的 API 34 Android 14 模拟器执行实际 SQLCipher 4.17.0。独立 QA 包通过实际 WebView、固定语句目录、原生事务和 M5 导入器组合。合成数据由内存 Repository 用现有格式加密。
- 原生加密和释放、55 条端到端导入、四个强杀恢复点、1k/10k/100k 容量均通过。测试仅使用合成数据，同一 fixture 的文件和 recovery journal 值在导入前后保持不变。见 [M5-06 QA 记录](qa/kanata-sqlite-m5/m5-06-android-v1.md)。
- 本轮完整本地 `npm run check` 已通过。最新远端 Web CI 对应规划提交，尚无实现 SHA 的远端运行，也未进行独立人员复核。M5-06 暂列 **BLOCKED**，M5 整体仍待最终审查。
