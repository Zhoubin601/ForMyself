# Kanata SQLite M4-R · MR2-G4 验收 v2

**候选事件写入定向验证通过。G4、MR2、M4 仍 BLOCKED，M5 NO。**

本次仅执行事件来源切片。从远端 M 的 `b199154a3c413f37dfcea901e7de55889e653c2c` 接管，较审查基线 `271936dd4aa5a5421b0a71a8dda2b4848c15ea71` 多两笔文档提交。实施提交为 `fbc8ee344d6e61aef85bf6296ac5cbd4148d2eeb`。原 main 工作区及独立 Kanata 工作树保留原状态。

[事件任务书](20261110-kanata-sqlite-mr2-event-provenance-task-v1.md) · [总验收合同](20261110-kanata-sqlite-m4-r-closeout-task-v1.md) · [前序验收 v1](20261110-kanata-sqlite-mr2-g4-acceptance-v1.md) · [QA 证据索引](qa/kanata-sqlite-m4/m4-r/README.md)

## 路径和限制

| 入口 | 当前结论 |
| --- | --- |
| 候选事件台提议、提交 | World Runtime 向页面返回 ID。按页复核消息精确 revision、因果事件状态及各角色 read/remember/share。SQLite 临时工作表按旧 Map 去重，保留首位置、末值、规范化关系及扩展顺序提示。普通提交的审计 JSON 留在 SQLite，Effect 按规范化成员关系及原规则计算。CAS、事务与持久回执保留。 |
| 候选普通修正 | 沿用冻结签名和 uncertain 决策。逐页读取原顺序的来源，复制规范化关系并保留 replacesEventId。撤销、原审计、Effect 重放、替代事件和回执共用事务。 |
| 消息修订引起事件失效、兼容逐事件撤销 | 普通事件的 before/after 快照留在 SQLite，先按原 revision CAS。消息失效按 50 条读取事件身份。兼容撤销仍持有完整 ID 确认集合。 |
| 候选事件摘要、因果图、撤销审计页 | 沿用单条摘要、绑定 world/event/revision/direction 的图页、审计头及 Effect 子页。没有新增完整事件 Store 状态。 |
| 兼容事件读取 | `readFor` 和 `list` 仍物化完整 Event。旧提议、提交、修正回读，旧 `effects` 和 `audits` 仍返回完整 DTO 或嵌套快照。旧 `preview` 仍汇总 ID 集合。非常规历史字符串 action 仍回退 JS 快照以保留旧 UTF-16 展开。 |
| 其余 G4 边界 | 普通调用不聚合继承来源。直接命令自带的全部关系仍由输入 DTO 和收据指纹路径持有。旧 JSON 边界、显式流式导出、独立的消息及任务兼容图仍需闭环。 |

[当前调用图](qa/kanata-sqlite-m4/m4-r/g4-call-map.md) · [接管审计](qa/kanata-sqlite-m4/m4-r/event-provenance-audit.md) · [源码与夹具指纹](qa/kanata-sqlite-m4/m4-r/event-provenance-run/fingerprints.json)

## 1k / 10k 实测

设备是现有隔离 `emulator-5582` / `kanata_m2_api34`，API 34 / SQLCipher 4.17.0 community。宽样本把消息来源与一个因果来源合并，保留 1k/10k 个不同角色的标签。主机另用两个事件参与角色、旧顺序与重复身份键测试末值覆盖和扩展保留。测试中的显式兼容读取单独用于逐条 oracle，表内完整 DTO 数仅计实际候选命令。

| 指标 | 1k | 10k |
| --- | ---: | ---: |
| 主机定向查询数，含回滚和重放 | 234 | 1,670 |
| AVD 提议/提交阶段查询 / 执行桥接，含故障与重放 | 233 / 193 | 1,669 / 1,631 |
| AVD 提议/提交阶段耗时 | 3,389 ms | 63,130 ms |
| AVD 修正阶段查询 / 执行桥接，含重放 | 87 / 74 | 627 / 614 |
| 最大 SQL 返回页 / 标签暂存批次 | 50 / 50 | 50 / 50 |
| 候选提议、提交与修正回读完整事件或审计 | 0 | 0 |
| 落库审计标签计数 / 撤权后正文读取 | 1,000 / 0 | 10,000 / 0 |
| WebView 堆报告起始 / 采样高值 | 24,500,000 / 24,500,000 B | 24,500,000 / 24,500,000 B |

PSS/RSS 是独立进程快照。强停前为 109,749 / 250,296 KiB，重启后为 117,084 / 258,832 KiB。WebView 堆计数为粗粒度采样。本轮未取得每档独立进程峰值、逐阶段 JS 对象峰值或 Pinia 堆快照。事件命令未调用模型。

[设备原始回执](qa/kanata-sqlite-m4/m4-r/event-provenance-run/04-event-device.txt.gz) · [设备汇总及数据指纹](qa/kanata-sqlite-m4/m4-r/event-provenance-run/device-summary.json) · [主机定向](qa/kanata-sqlite-m4/m4-r/event-provenance-run/host-directed.txt) · [完整标签顺序 oracle](qa/kanata-sqlite-m4/m4-r/event-provenance-run/device-order-oracle.json)

主机 `npm run check` 完整通过，含 680 项 Node、397 项 Vue、严格类型和生产 Web 构建。设备 `full -M4Growth -M4Completion` 通过。10k 综合阶段耗时 147,193 ms，覆盖 10,000 条事件图关系、10,000 条 Effect 重放和 10,001 条扇出确认，Effect 确认批次最多 128 行。该回归覆盖通用锁屏、后台旧租约、迟到完成和合成群聊。普通 APK 单独构建检查为 false，合成入口及种子均不在包中。

[主机全量检查](qa/kanata-sqlite-m4/m4-r/event-provenance-run/check.txt.gz) · [Android 综合回归](qa/kanata-sqlite-m4/m4-r/event-provenance-run/05-full-device.txt.gz) · [普通 APK 验证](qa/kanata-sqlite-m4/m4-r/event-provenance-run/default-gate.json)

## 故障矩阵

| 场景 | 已验证结果 |
| --- | --- |
| 撤权与消息 revision 失效 | 两档 AVD 拒绝并保持正文读取 0。主机另验跨世界引用拒绝及双角色权限。 |
| CAS、真实 COMMIT 失败、幂等 | 两档设备注入延迟外键失败到真实 COMMIT，恢复候选 revision；重试提交后仅一份审计，重复提议、提交和修正重放同一回执。陈旧 CAS 被拒绝。 |
| 批次取消与恢复 | 1k 的第一批 50 条暂存发出后关闭请求，新增查询和执行为 0。相同命令随后恢复成功。 |
| 强停与重开 | 单事件提交已写未提交时强停。新进程打开后 revision 为 1，审计和 Effect 均为 0；重试及重放后 revision 为 2，各一条。 |
| 顺序与损坏提示 | 主机对照完整旧 DTO 的顺序、重复标签键、未知 JSON，验证重复、缺失、多余、null 提示拒绝。设备对照实际审计标签数、未知字段、Effect owner 和替代事件关系。离线按合成夹具生成完整旧顺序，两档 SHA-256 与设备实测完全一致。 |
| 尚缺的组合 | 事件写入的 1k/10k 深链、宽扇出和混合角色交叉组合；事件锁屏、角色解绑、查询失败与页面卸载的专用宽规模复合矩阵；旧全量导出流式等价与全部历史 JSON 形状。上一轮迟到 provider 证据属于聊天场景。 |

生产 canonical 保持 legacy，普通 APK SQLite 开关保持 false，Schema 001–004 checksum 冻结。没有使用真实用户数据或真实备份，也未进入后续工作包。

[两轮检查](qa/kanata-sqlite-m4/m4-r/reviews.md) · [矩阵](qa/kanata-sqlite-m4/m4-r/matrix.md)
