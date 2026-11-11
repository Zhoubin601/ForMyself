# Kanata SQLite M4-R · ER1 验收 v4（BLOCKED）

日期：2026-11-11（北京时间）。执行依据：[ER1 任务书](20261111-kanata-sqlite-mr2-g4-event-compat-closure-task-v1.md)。接管 M/origin/M 均为 7b6884965051d0d0da154618d2231b429ab12b11；先 fetch、检查所有 worktree，再在干净的既有 M worktree 普通快进。main 的修改/删除/未跟踪项与 Kanata 均保留。

**ER1 BLOCKED；G4 BLOCKED；MR2 BLOCKED；M4 BLOCKED；M5 NO。没有切换 canonical 或开启普通 APK SQLite。**

## 本轮实际完成

- ER1-0：全仓调用矩阵、materializer 调用点、产品/测试/设备 QA 区分和旧语义清单，在生产源码改动前完成。
- ER1-1 安全部分：删除无真实消费者的 World Runtime.legacyEvents，补实际 API surface 行为测试及 strict 类型负例。Repository Facade 与其真实 action 回退未删。
- 测试独立 Oracle：tests/helpers/kanataEventCompatibilityOracle.js 不导入生产完整 materializer；通过当前旧输出与 golden 检查；新测试进入 npm test。
- 生命周期：Ledger 的四个子面板采用 scope/request sequence guard；关闭后旧 guard 失效、迟到结果不发布；成功撤销清空隐藏 Audit/Effect Audit 局部状态。
- 实测：主机兼容和原始顺序探针保留非零退出；Android API 34/SQLCipher 4.17.0 的 UTF-16 原生可行性 Spike 和现有完整候选回归实际执行。详细命令/最终计数/指纹见 [ER1 QA](qa/kanata-sqlite-m4/m4-r/event-compat/README.md)。

## 用户确认的产品权威与阻塞

用户本轮明确：**纯领域契约是撤销唯一权威**。revokeIds 包含已 revoked 后代，沿 descendants() Set 插入顺序；uncertainIds 按 data.events 顺序；签名必须增量覆盖同世界完整 Events、Effects、EffectBaselines；世界相关变化使旧预览失效；已 revoked 事件不得重复 revision/audit。旧 SQLite Oracle 只作历史对照。

顺序探针复现两个不同的领域事件数组产生不同后代顺序。001–004 中三张相关实体表未记录显式领域数组 ordinal；隐式 rowid 不是 Schema 保证的不变序号。未建立覆盖所有生产者/历史导入/重建的原始数组顺序恢复证明；这不等于断言所有受控插入必然丢序。**按用户第 8 条停止相关撤销改动，ER1-3 BLOCKED。** 不用 ID/rowid 排序替代领域顺序，不新增 005。

独立兼容探针保留 12 项失败，含 compact 漏已 revoked 后代、无关事件不 stale，以及 10 种 action 撤销快照与历史 UTF-16/类型/覆盖语义不同。未删断言、缩小集合或改旧语义来取得 PASS。

## 未完成项

| 阶段 | 当前状态与明确缺口 |
| --- | --- |
| ER1-0 | 完成调用审计；不代表后续语义通过 |
| ER1-1 | PARTIAL：Runtime 包装已移除，Repository 完整 Facade/测试与设备 QA 消费者迁移未完成 |
| ER1-2 | BLOCKED：仅完成可行性 Spike；commit/correction/message revision/status/revoke 字段级业务路径未实现，完整 Event 回退仍在；未新增 action 长度限制 |
| ER1-3 | BLOCKED：原始领域数组顺序恢复未证明；完整世界增量签名与纯领域执行等价尚未实现 |
| ER1-4 | PARTIAL/BLOCKED：组件关页反例已修；Android 专用生命周期矩阵、Heap snapshot/GC retained 分类、Pinia/局部状态峰值 NOT RUN；逐项 Effect Audit 长 value 仍可完整跨桥 |
| ER1-5 | 主机与现有设备回归、两轮源码独立审查各有实跑证据；完整 ER1 新设备矩阵及最终验收不满足 |

两轮审查中的服务中断、探针夹具错误、组件失败均保留并说明修复/复测。设备原生 Spike 的 OK 不等于 action 业务矩阵 PASS；现有综合回归通过也不覆盖新 ER1 全矩阵。

## 来源与安全边界

来源：任务书、AGENTS、根架构规范、M4-R 总合同、事件读取任务书、[验收 v3](20261111-kanata-sqlite-mr2-g4-acceptance-v3.md)、当前源码和 raw/完整需求清单.txt、raw/彼方 · Kanata 技术设计.txt。raw 只读；未使用外部研究资料或真实模型 API。

生产 canonical 保持 legacy。普通 APK 默认 false、无 synthetic 页面/seed、Schema 001–004 checksum 的最终复核见 QA。仅核验并操作既有合成 AVD emulator-5582/kanata_m2_api34；不读取真实资料、备份或旧加密归档。

用户复核事项：确认上述纯领域权威已准确记录；原始数组顺序恢复和 action 字段级方案仍需后续证明。当前范围内不以修改 frozen Schema、启用 M5 或回退旧 SQLite 契约解决阻塞。
