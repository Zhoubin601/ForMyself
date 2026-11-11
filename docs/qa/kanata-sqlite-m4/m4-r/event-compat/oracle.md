# ER1 Oracle 与当前失败

## 三种边界

1. **产品撤销唯一权威**：用户本轮明确指定 experience/kanataEvents.js 中 previewKanataEventRevoke / revokeKanataEvent / correctKanataEvent。descendants 的多轮 data.events 扫描和 Set 插入顺序、uncertain 数组顺序、完整世界 Events/Effects/Baselines 的签名及 revoked no-op 必须保留；生产实现必须增量计算，不能物化完整世界。
2. **历史 SQLite adapter 对照**：tests/helpers/kanataEventCompatibilityOracle.js 独立实现 action spread、完整合成 Event 和旧集合读取。无生产 materializer 导入。仅测试可读取完整合成行。它不再裁决产品撤销语义。
3. **异常历史 action**：纯领域校验拒绝 string/null/array，历史 SQLite 明确支持它们的 object-spread。按任务书保留 UTF-16，不把两种 Oracle 混用。

Oracle 正常与异常 JSON 测试进入 npm test；包含 64 层、非有限数、-0、__proto__ 数据属性、scalar 覆盖/删除、字段出现性、属性顺序和 11 种 action。四条业务路径中的独立完整覆盖尚未完成。

## 实际失败与修复

| 证据 | 结果与修复 |
| --- | --- |
| 01-lifecycle-failure.txt | 关闭 preview/choices 后 guard 仍有效，2 项失败；增加 request sequence 和 scope 后 02 复测通过 |
| 03-oracle-host.txt | 新 Oracle 测试把 object.location 当作保留字段，忽略了 null scalar 列应删除它；修正测试预期，未改变产品行为，04 通过 |
| 05-compatibility-probe.txt | 首次纯领域探针替换 fixture.events 导致旧 task.resultEvents 孤儿引用；保留 fixture 原事件后 06 复测消除此夹具错误 |
| 06-compatibility-probe-retest.txt | 实际退出 1；12 项兼容失败：已 revoked 后代漏出、无关世界事件变化未 stale、10 种 action 撤销快照不等价；missing case 相等。未删断言或调整产品结果 |
| 13-order-proof.txt | 实际退出 1/BLOCKED；两个领域数组产生不同 Set 后代顺序；三张表无显式领域数组序；声明列相同而隐式 rowid 可变 |
| 14-authority-host.txt | 纯领域权威 golden 验证顺序、完整签名变化和已 revoked 不再审计/加 revision。它证明要求，不证明候选已达标 |
| 16-lifecycle-review-retest.txt | 审查发现的撤销成功后隐藏 effectAudit 留存已清理；检查真实组件局部状态，7 项通过 |

rowid 实验只在 :memory: 合成 DB 中进行。它证明 Schema 不是原数组顺序保证，**不证明每个受控插入都会丢序**。已有 fixture 按数组插入及候选逐条追加可以形成可用线索，但尚无覆盖所有来源、修正、恢复、重建及原始领域数组的冻结恢复映射证明。按用户第 8 条，ER1-3 必须 BLOCKED，未使用 ORDER BY id 或 rowid 冒充证明。

## UTF-16 Spike

06 日志记录主机 SQLite 3.51.2：json_extract 经 Node string 解码损坏孤立 surrogate；原始 JSON `->` 保留转义。Android 原生类 KanataEventActionCompatibilityTest 在 SQLCipher 4.17.0 community/API 34 的新随机 cache 加密库中运行，11 类及 1k/10k 混合串重复均记录原始 JSON 保留；Java cursor 解码在本次样本也保留 UTF-16。

这是可行性证据，不能推断所有 JS/native 桥接和字段级 object-spread 已完成。不存在已证明可信的 action 长度上限；未增加 4096 action 限制。尚未实现不物化完整 Event 的四条业务路径，不宣称 ER1-2 PASS；也不能根据主机桥接损坏就声称 SQLCipher 本身无法保存 surrogate。
