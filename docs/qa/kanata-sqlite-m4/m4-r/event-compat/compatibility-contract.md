# ER1 旧契约与差异

来源为 7b68849 的源码，任务书 §3–6，以及 raw/完整需求清单.txt §6.7–6.8、raw/彼方 · Kanata 技术设计.txt §3.3。raw 未修改。

| 契约 | 冻结行为 |
| --- | --- |
| Event 字段 | 未知扩展优先展开，权威 scalar 覆盖；participantIds/causedByEventIds/sourceRefs 必有；lifeSources/action 出现性依旧；causality/kind/replacesEventId 由非 null 列决定 |
| 关系提示 | hint 存在则须与规范化集合逐项身份、长度相符，保留 hint 顺序及成员未知字段；缺失则 SQL ID 排序；错误 KANATA_SQLITE_INTEGRITY_FAILED |
| action | JS {...extensions.action} 的 UTF-16 code unit 展开；三个 scalar 列非 null 时覆盖，null 时删除属性；原字段存在时空对象仍存在；缺失且无列值时不创建 |
| Effect | 单事件按 ID 排序；旧效果规则、baseline 与有效事件 replay；不做简单逆运算 |
| Audit | 旧 Facade 每页最多 50 个完整 previous/next；快照 revision 必须匹配；新 header/chunk 不等于完整对象兼容完成 |
| 创建 / 提交 | event:propose 的 command+fields 幂等，event:commit 的 world/id/revision 回执；损坏/不匹配回执拒绝，失败事务回滚；candidate+revision CAS |
| 旧 SQLite preview | root 非 revoked；descendants 含已 revoked 后代；各 disposition 按 ID 顺序；签名覆盖全世界事件 id/status/revision/effective_at/causality |
| 纯领域 preview | descendants 为根开始的 Set 插入顺序；uncertain 为 data.events 顺序；签名含全世界完整 Event、Effect、baseline |
| 旧 revoke | 必须完整匹配 plan；uncertain 必须显式决策；先 revoke 后 uncertain；已 revoked 不再改状态；旧 memory 非 deleted 即再次 stale 并 revision++；之后 replay |
| compact preview | 排除已 revoked 后代；混合 disposition 按 ID；签名主要绑定 root、selected、相关 Effect/baseline；不同于两个旧 Oracle |
| correction | 原事件 tombstone、replacement candidate、旧 sourceRefs/causes/lifeSources/扩展、撤销影响同事务；summary trim、<=2000；必须保留 CAS 和回执 |
| 错误 | EVENT_UNAVAILABLE、EVENT_CONTEXT_DENIED、KANATA_CONTEXT_SCOPE_DENIED、KANATA_SOURCE_STALE、KANATA_LIFE_PERMISSION_DENIED、EVENT_COMMIT_CONFLICT、EVENT_REVOKE_PREVIEW_STALE、EVENT_DEPENDENCY_UNCERTAIN 不可混为空结果 |

用户最终产品决策（本轮原文）：以纯领域契约为唯一权威。revokeIds 含所有后代（含 revoked），保留 descendants() Set 插入顺序；uncertainIds 保留 data.events 遍历顺序；签名须增量覆盖同世界完整 Events、Effects、EffectBaselines；世界级数据变化令旧预览失效；已 revoked 成员执行不得重复 revision/audit。必须证明 SQLite 能恢复原始领域数组顺序，不能证明则 ER1-3 BLOCKED。旧 SQLite Oracle 仅作历史对照，不再裁决产品行为。

异常 action 的纯领域校验拒绝 string/null/array；历史 SQLite materializer 接受并展开，必须分开对照。上述撤销权威决策不撤销任务书明确保护的历史 action UTF-16 兼容要求。
