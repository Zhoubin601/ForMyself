# Kanata SQLite M6-00 GPT-6 独立最终复核 v1

- 任务 KANATA-M6-00-CLOSEOUT-2026-11-20。日期 2026-11-20（北京时间）。
- 复核模型 GPT-6（Astra），独立只读会话。执行基线 `m6/encrypted-backup-recovery@a301436259663999bd1cd6424e6e04ecb4662dc7`。
- **最终结论 PASS。M6-00 可关账，按用户授权启动 M6-01 纯 Node/JS 合成 Codec。** Native 接入、发行 KDF 与资源参数、生产路由和 APK 发布仍分别受其准入门禁约束。

| 冻结文件 | SHA-256 |
| --- | --- |
| [M6-00 最终设计收口](m6-00-final-closeout-v1.md) | `f1f953a02c56805418f2da0cd166ed11fb763cadd5065ac127f495cab30d4012` |
| [M6-01 实施任务书](../../20261120-kanata-sqlite-m6-01-portable-backup-format-task-v1.md) | `54284914d5e3ab3b952639f6d7d14b625cf0763729e99763bc402802e7ace930` |

独立复核认定两处初审问题已解决。DATA 表段按业务 tableId 严格升序，使用有效 AEAD 的乱序反例验收。不可变控制记录由独立权威 head 引用，后者耐久安装为线性化点。记录回放检测以当前 head 仍可信为条件，有效旧 head 被替换的边界已明确，H-04 与 N-05 的测试范围一致。

复核了 G-01～07、B-01～09、H-01～06 的源证据、责任和验收门禁，以及外键回填、Schema 005 原序、派生摘要、旧日志兼容、改密双槽、降级隔离和 A/C 规格。在合成 M6-01 范围内未发现还需补证的前置阻断点。

## 独立核验结果

- `git status --short`、`git rev-parse HEAD`、`git branch --show-current` 确认分支、工作区与基线，`git diff --exit-code a301436 -- src android/app/src/main` 退出 0。 `git diff --check` 退出 0，现有换行提示不影响检查。
- `Get-FileHash -Algorithm SHA256` 确认两份正文。47 条本地链接逐项核对，目标均存在。
- `node --input-type=module` 导入原 DDL，在 Node v24.14.1 / SQLite 3.51.2 `:memory:` 独立核验。DDL 数 161/36/19/7/21，53 表、149 触发器、全表有主键、ID 匹配、`integrity_check=ok`、`foreign_key_check` 无行。Schema SHA-256 为 `8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a`。
- 独立复算 P 64 B、Footer 2152 B、最大包附加 2361684 B，与任务书一致。
- 独立复核未执行真实数据、设备操作、Native 探针、A/C 或全量业务回归。实际能力证据按 C01 与 N-01～06 验收。

此记录由执行者根据独立复核回执登记。复核者未编辑文件或执行 Git 写操作，实际签核限定上表文件哈希。表中哈希按冻结的 UTF-8 无 BOM、LF 字节计算。Git 检出改成 CRLF 时，以 Git blob 字节或转换回 LF 的副本复核。
