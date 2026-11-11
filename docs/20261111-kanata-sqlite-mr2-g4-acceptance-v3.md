# Kanata SQLite M4-R · MR2-G4 验收 v3

**候选普通读取的定向验证通过。事件读取与兼容切片仍 BLOCKED，G4 / MR2 / M4 BLOCKED，M5 NO。**

本轮从远端 M 的 `6497d28f2d18e37884d3d6aa90d1cfb153d50e9a` 接管，仅处理事件读取与旧兼容边界。调用审计先以 `5216f47` 提交，最终实现为 `daf4e31a8e599dffbae484069db70b96e1800cc1`，类型负例与最终证据代码点为 `1ee65765e3942722750c3ff0a35cd9e4369c3915`。完整旧输出的显式物化和事件页面全生命周期/堆对象分类缺口保留，不能据此宣布 G4 或 MR2 PASS。

[读取任务书](20261110-kanata-sqlite-mr2-g4-event-read-compat-task-v1.md) · [M4-R 总合同](20261110-kanata-sqlite-m4-r-closeout-task-v1.md) · [上轮验收 v2](20261110-kanata-sqlite-mr2-g4-acceptance-v2.md) · [QA](qa/kanata-sqlite-m4/m4-r/README.md)

## 实际改动与契约

| 入口 | 本轮结果 |
| --- | --- |
| list / readFor | 普通列表最多 50 条标量摘要，角色详情先复核权限与历史提示，再返回一个 header。四类完整关系不进入普通 Event DTO。header 保留权威标量、action 类型与权威 action 列，超长摘要明确标记并分块，完整 action/未知扩展从 JSON 块读取。 |
| relations / jsonChunk | 参与者、causes、消息 refs、生活标签保留旧顺序。SQL 验证全体规范化集合，超长成员明确标记并按同一 ordinal 取原 JSON。每页最多 50，最多另有一个 sentinel；每块最多 4096 code points，额外一个 lookahead。 |
| effects / audits | Effect 独立分页，长 value/path 分块；普通 Audit 只返回 header，previous/next 按指定 side、snapshot revision 读原文或关系字段块。普通路径不解析完整快照。 |
| 游标与完整性 | 绑定 world/event/revision/scope/关系或 audit side。World Runtime 另绑定 owner。完整性临时证明最多一行，只有 total_changes、data_version 与事件 revision 均相同才复用；权限每页重验。写入、其他连接提交及回滚均有失效测试。 |
| 旧命令与读取 | 明确置于 events.legacy / World Runtime.legacyEvents。只需 ID 的已知调用迁至 acknowledgement；确实对照完整字段的 QA 显式使用 legacy。旧命令指纹、回执及完整字段契约保留。 |
| 旧预览、撤销、修正 | 普通页面保持 compact plan。旧签名和用户数组逐页精确比较，执行用事务内 SQL 临时选择集，stale memories 与 Effect 重放不再发送整个 JSON ID 集。原执行顺序与 uncertain 决策保留。 |
| relationship | 普通关系标量读取不附带 sourceEventIds，反向来源页绑定关系 revision。旧完整关系输出置于 legacy.relationship。 |

关系、小成员及兼容输出与旧 oracle 对照。未知扩展的 64 层深度限制与非有限数拒绝保留，普通成员的 -0 归一化沿用旧 JSON clone。历史字符串 action 的空串、ASCII、BMP、代理对、孤立 surrogate、混合串以及 null、数组、对象、缺失均有主机对照，UTF-16 spread 回退保留。

[调用图](qa/kanata-sqlite-m4/m4-r/g4-call-map.md) · [实际消费者及迁移审计](qa/kanata-sqlite-m4/m4-r/event-provenance-audit.md) · [源码与夹具指纹](qa/kanata-sqlite-m4/m4-r/event-read-run/fingerprints.json)

## Android 实测

使用原隔离 emulator-5582 / kanata_m2_api34，API 34 / SQLCipher 4.17.0 community，设备只装合成包。每档分页样本包含 N 个不同来源标签、N＋1 个 Effect 和 N＋1 个 Audit。图样本为完整 N 条边、N＋1 个事件，分别覆盖深链、宽扇出及混合图，并用两个参与角色读取。

| 数据档 / 形状 | 查询数 | 读取耗时 ms | 各阶段观测到的 JS heap 峰值 B | 各阶段 PSS / RSS 采样峰值 KiB |
| --- | ---: | ---: | ---: | ---: |
| 1000 / pages | 312 | 11639 | 17983624 | 109511 / 235008 |
| 1000 / deep | 103 | 3592 | 12018312 | 109082 / 230792 |
| 1000 / wide | 103 | 2183 | 13179084 | 109143 / 230848 |
| 1000 / mixed | 103 | 1443 | 13943736 | 110266 / 231984 |
| 10000 / pages | 2404 | 78961 | 18835412 | 209059 / 331116 |
| 10000 / deep | 823 | 34357 | 17047800 | 115481 / 237612 |
| 10000 / wide | 823 | 38915 | 17696944 | 116693 / 238836 |
| 10000 / mixed | 823 | 43197 | 11759400 | 116070 / 238220 |

八个样本的跨桥完整 Event/Audit DTO 计数均为 0，SQL 页最多 51 行，API 当前 DTO 页最多 50 条。两档都实际读完全部来源、Effect 与 Audit 页；完整标签序列的链式 SHA-256 与独立夹具 oracle 一致。JSON 块按原字符位置比对长引用，审计原文实际读至末尾。统计为查询桥接数，执行、begin/commit 等控制桥接没有合并计数。

表中内存取每个样本全部阶段的最大观测值，包含 seed。逐阶段 read、faults 等采样详见 JSON。采样周期包含 400 ms 等待及 CDP/adb 调用耗时；这些是采样峰值。当前页 DTO 计数不能代表全部 V8 对象数，尚无独立 retained object 分类和 Pinia 逐类峰值。

[最终设备原始回执](qa/kanata-sqlite-m4/m4-r/event-read-run/final-device.txt.gz) · [原始 logcat](qa/kanata-sqlite-m4/m4-r/event-read-run/final-native.txt.gz) · [分阶段采样、数据指纹与查询画像](qa/kanata-sqlite-m4/m4-r/event-read-run/device-summary.json) · [APK 指纹](qa/kanata-sqlite-m4/m4-r/event-read-run/final-apk-sha256.txt)

主机 `npm run check` 完整通过，含 688 项 Node、397 项 Vue、严格类型正负检查和生产 Web 构建。最终 APK 的 `full -M4Growth -M4Completion` 综合回归通过；10k 综合阶段 178,392 ms，确认 10,001 条，最大事务批次 128。GROUP-01～05 相关实现保留，原 GROUP 测试及综合共享入口回归通过。

候选定向与综合回归 APK 指纹完全一致，安装回读的 catalog SHA-256 与生成目录相同。普通 APK 单独构建并检查为 false，合成入口与种子不在包中，Schema 001–004 checksum 冻结。生产 canonical 保持 legacy，真实用户数据、真实备份与真实模型 API 均未使用。

[主机全量检查](qa/kanata-sqlite-m4/m4-r/event-read-run/check.txt.gz) · [综合设备原始回执](qa/kanata-sqlite-m4/m4-r/event-read-run/regression-device.txt.gz) · [综合摘要](qa/kanata-sqlite-m4/m4-r/event-read-run/regression-summary.json) · [普通 APK 门禁](qa/kanata-sqlite-m4/m4-r/event-read-run/final-default-gate.json)

## 故障和兼容覆盖

| 项目 | 实际结果 |
| --- | --- |
| owner 与 cursor | 旧 owner 的模型与 cursor 均拒绝；根 revision 变化拒绝旧图 cursor；主机另覆盖类型、scope、Effect/Audit cursor 混用及反向关系 revision。 |
| 关闭与取消 | 两档分别在 header、关系、Effect、Audit、snapshot 请求中关闭；关闭后新增查询均为 0。验证对象是受保护 Runtime 的请求 guard。 |
| 撤权与锁屏恢复 | 两档撤权后角色正文及关系数据读取 0；为拒绝请求进行授权查询。锁屏失效后旧模型查询 0，重新选择 owner 后恢复。非参与者夹带 sharedMemory 请求 header 或摘要块，两档均拒绝。 |
| 查询失败 | 桥接查询故障注入后不发布半页，重试读取同一审计头。主机验证同 revision JSON 损坏、外部 SQLite 提交及读事务 COMMIT 失败不会沿用旧证明。 |
| 强停与幂等 | 已写未提交的事件强停后，新进程读到 revision=1、审计=0、Effect=0；重试及重放后 revision=2，各一条。 |
| 旧 oracle | 全部 1k/10k 图节点和旧确认集合逐项比较。未改动的 compact 签名用公开首末页复核，中间完整集合用同一 SQL 页逐项核对；既有 MR1 确认执行另有综合回归。完整旧 Event、Audit、未知字段和 action 对照保留。 |

本轮无事件读取 provider 请求。真实模型调用为 0。

## 尚未关闭

- events.legacy 的完整 Event、Effect/Audit 输出、legacy.preview 的完整 ID 确认数组及 legacy.relationship 的完整 sourceEventIds 仍显式物化。传输按页或块，返回旧完整契约仍占随规模增长的 JS 内存。
- 历史字符串 action 的提交、修正及消息失效兼容回退仍会建立完整旧 Event。它保留 UTF-16 语义，未作为有界化完成项；Android 的字符串 action 全形状专用矩阵未独立运行。
- 实际事件页面的锁屏、解绑、跨世界、撤权与各种正在执行子页的组合矩阵尚未逐项做完整 1k/10k UI 验证。Runtime guard 证据及综合 UI 回归有各自范围。
- retained heap 的 Event/Effect/Audit/全部关系对象分类峰值、Pinia 逐类对象峰值尚未取得。反向关系的设备专用宽规模矩阵也未独立运行。
- 其他 MR2 消息、自治及旧完整导出的 G4 缺口继续沿用总矩阵。

[矩阵](qa/kanata-sqlite-m4/m4-r/matrix.md) · [两轮复核](qa/kanata-sqlite-m4/m4-r/reviews.md)
