# Kanata SQLite M5：有界迁移协调器首个实现切片

日期：2026-11-18

## 本轮基线与边界

- 唯一基线：9bfff0867b4024d8d3a2aea2787ac2493164810b
- 工作分支：m5/json-archive-migration
- 本轮只实现 M5 的通用 journal / bounded-batch 协调器，并用 Node 内存 SQLite 与合成行验收。
- 不连接生产 Store、Android SQLite activation、legacy Repository、真实文件系统或真实用户数据。
- 不切换 canonical，不改普通 APK 激活位，不删除/覆盖旧 JSON 或归档，不构建/发布 APK。

## 已实现的机制

1. 强制 syntheticOnly=true；拒绝非合成调用。
2. 目标必须是当前冻结的 SQLite Schema 005，并确认 PRAGMA foreign_keys=1。
3. 每个 collection 使用独立 data_migrations 行，记录源指纹、Schema 版本、collection、JSON cursor、已提交数量和状态。
4. 每批目标行与 journal cursor/count 在同一 SQLite 事务提交；中途失败时整批回滚。
5. 恢复时从最后一个已提交 cursor 继续；重复运行会跳过已完成 collection，并重新执行校验。
6. 以主加密文件指纹和归档描述符（含每页密文 key、范围、长度、索引和消息 ID/revision/时间）构造源指纹。
7. batch size 上限 128；cursor JSON 上限 16 KiB；不保存密码、明文、消息正文或文件路径。

## 本轮未覆盖（仍属于 M5）

- legacy 主 JSON 的读取/解密/完整领域校验适配器。
- 每个 SQLite 表及关联表的完整字段映射、未知字段 extensions_json 保真和顺序保持。
- 加密历史归档页的分批解密、消息并入与 archived marks。
- worlds/cards/instances/conversations/messages/memories/relationships/events/permissions 等全量计数、稳定 ID、revision、来源引用与字段哈希 Oracle。
- 中断/重复/回滚的真实 SQLCipher Android 合成设备验收。
- 最终独立审查与 M5 PASS 判定。

## 验收命令

node --test tests/kanataSqliteMigration.test.js

完整 npm run check 与隔离 Android SQLCipher 4.17.0 验收需在后续切片完成后运行。本文件只记录实现范围，不宣称 M5 完成。
