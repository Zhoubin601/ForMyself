# M4 最终收口 · E 顺序阻断取证

当前唯一执行索引仍为 [最终收口清单](../../../../../20261111-kanata-sqlite-m4-final-closeout-ledger-v1.md)，最小待批准方案直接记录在其 E 条目；本目录不是新任务书/新阶段。接管 M/origin/M 为 `10421105b745fa4bb9b2107379c39786fac68b96`。本轮没有新增实际产品能力，M4 BLOCKED、M5 NO。

来源：raw/完整需求清单.txt §6.7–6.8、raw/彼方 · Kanata 技术设计.txt §3.3、当前用户决策、最终清单 E/§8–9、M4-R/ER1 合同和当前源码。引用日期：2026-11-11；raw 只读，无外部研究、真实用户数据或真实模型 API。

## 本轮重新执行

| 命令（仓库根） | 退出码及证据 | 实际含义 |
| --- | --- | --- |
| `node docs/qa/kanata-sqlite-m4/m4-r/event-compat/verify-order.mjs` | 1；order-existing.txt / order-existing-exit.txt | 复现 Set 顺序差异和 rowid 非不变领域序号 |
| `node docs/qa/kanata-sqlite-m4/m4-r/event-compat/verify-compatibility.mjs` | 1；compatibility-existing.txt / compatibility-existing-exit.txt | 12 项既有语义差异仍未修复；不计 PASS |
| `node docs/qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/verify-order-storage.mjs` | 1；order-storage-final.txt / order-storage-final-exit.txt | 实验断言 PASS；M4 仍 BLOCKED。两个合法数组写成相同 v4 逻辑行而领域结果不同；附加旁表仅在新临时合成库验证往返/回滚/强杀/拒绝语义 |
| `node --test tests/kanataEventCompatibility.test.js` | 0；authority-host.txt / authority-host-exit.txt | 5/5 常规 Oracle 回归通过；是原 Node 套件子集，未重复累计 |
| `pwsh -NoProfile -File docs/qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/verify-evidence-reuse.ps1 -ManifestPath <既有隔离 manifest>` | 0；evidence-reuse-final.txt / evidence-reuse-final-exit.txt | 只读源码/历史证据/设备/APK/catalog 比对；没有安装、清数据、读取应用数据库或调用模型 |

顺序实验使用 Node 24.14.1 / SQLite 3.51.2。首次 order-storage.txt 因合成 fixture 按乱序插入立即外键失败，保留退出 1；改为事务内 `defer_foreign_keys=ON`、COMMIT 时完整检查后，order-storage-retest.txt 成功复现；最终追加独立进程在 DDL+行写入后 `SIGKILL`、热日志回滚验证。未关闭 FK，未修改产品触发器或测试 Oracle。

evidence-reuse.txt 首次审计失败是新脚本将历史 PowerShell JSON 的 `Hash` 错读为 `sha256`，不是实际 catalog 变化；改用真实 `Hash` 后 evidence-reuse-retest.txt 退出 0，最终增加历史设备 fingerprint/path 比对，结果见 evidence-reuse-final.txt。失败日志均保留。

## 复用范围和局限

- 473 个已有指纹文件逐 SHA256 一致，src/tests/scripts/全部 Android/package.json/package-lock.json 相对源码 `6118e9c` 无差异；8 个历史压缩证据 checksum 一致。旧主机 check（693 Node、402 Vue/44 文件、strict 正负类型和生产 build）仅按此源码复用，不称为本轮重新执行。
- 同一 manifest/AVD 路径、历史设备 fingerprint、API 34/x86_64/WHPX 和第三方包白名单核验；设备只含 `com.yubin.formyself.m2qa` 与其 test 包。设备上两份 APK 的 SHA 与历史实测 SHA 精确一致，归档候选 APK 的 catalog 同样一致。
- 候选 APK SHA `0dacf543a3318fa8d049d2e046f12f33fe02a45448a23f24cf2585995c4da612`；test APK `db7f4d2142b82575d5d846f47d9f11e42799e0a4ab020f1a20d55054e4cb203e`；候选 catalog `907476face94a439ad1f4fae77221e9df97d34f73fae18f443bbf384aafb1950`。
- 普通 APK `53865d9eb5cb9e987fc64ef8f73aecebcdd9d395d9043071bfa5808a42bd953a` 与 catalog `eee80856bccbfbbcaf3f8870b2fed67d18f414701ba23d486873108d6cd7e43c` 一致；历史 gate 为 SQLite=false、无合成页面/语句、Schema 4。001–004 源文件未变；生产 canonical legacy。
- 复用的是 [既有 ER1 QA](../README.md) 列出的现有 Android 综合候选切片（含 MR1 10k 宽确认、强停、幂等）及原生 action 可行性 Spike。SQLCipher 4.17.0 来自该历史实测；本轮没有重新执行 SQLCipher 业务，也没有以 Spike 代替四条 action 业务路径。
- **不复用成最终 M4 PASS**：A–G 全业务、ER1 专用生命周期/retained Heap、完整新迁移/增长和两轮最终全范围独立审查仍未完成。现有两轮检查点审查继续作为历史证据；本轮不是最终集成候选，未启动 MR8。
- 若批准并实施方案，事件/Effects/审计/签名/fixture/catalog 将变化，必须按最终清单重跑受影响主机与 Android 矩阵，不能继续套用这里的旧 PASS。

## 当前状态与用户决策

| 范围 | 状态 |
| --- | --- |
| A / B / C / D / G | PARTIAL，未因本轮审计提升 |
| E / G4 / MR2 | BLOCKED，纯领域顺序与旧 action 等尚未闭环 |
| F | NOT RUN / PARTIAL，真实消费者与后台任务缺口仍在 |
| MR0 | 本轮轻量复核完成；既有工作区文件完整保留 |
| MR1 | 历史性能切片 PASS，按指纹复用 |
| MR3 / MR4 / MR5 | 原 NOT RUN/PARTIAL 保持 |
| MR6 / MR7 / MR8 | BLOCKED；本轮未执行最终矩阵和最终两轮独立审查 |
| G1–G9、G11 | BLOCKED |
| G10 | PASS（当前不变树的源码/同 APK/catalog/设备只读复核） |
| M4 / SQLite M5 | BLOCKED / NO；不能申请 M5 放行 |

建议仅批准最终清单 E 内附加 Schema 005 的最小顺序元数据方案；它不能恢复已经丢失的历史顺序。批准前没有注册/实施 005，相关结构变更停止。本轮未修改产品代码，不把该决策扩展成真实迁移或 SQLite M5 授权。

所有工作区的原修改、APK 删除和未跟踪文件保留。只提交本次证据和对应索引；无 Kanata/main 合并、APK 发布、reset/clean/force push。用户需要复核的是上述附加顺序元数据方案及历史缺序号时 fail closed 的边界。
