# M4 最终收口 · E 顺序阻断取证

当前唯一执行索引仍为 [最终收口清单](../../../../../20261111-kanata-sqlite-m4-final-closeout-ledger-v1.md)；本目录不是新任务书/新阶段。接管取证提交 `0a5e0b3` 从远端 `1042110` 接续，只提供了当时的阻断证据，没有新增产品能力。**后续用户已明确批准 Schema 005 的隔离候选实施与测试**，见末节；历史结果保留各自范围。M4 仍 BLOCKED、M5 NO。

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

## 2026-11-11 批准后的 Schema 005 实施（现有 E 条目）

用户已明确批准仅在 M 的隔离候选追加三张顺序旁表和测试；旧“待批准/未实施”段落为接管取证历史，不再是当前授权状态。当前实际实现：

- 001–004 checksum 不变；追加 005 `kanata-domain-array-order`，最终 checksum `10db9e4533df23fd0b82cd054e19703601001292a147c0ef38187a2c420840be`。
- 每个源实体的 BEFORE INSERT 在同一个 BEGIN IMMEDIATE 中先记录 deferred-FK 绑定的 ordinal；源实体/序号/回执原子提交。普通/历史 action 提交、两类修正、自治事件、Effects、Baseline 都由共同数据库触发器覆盖。
- 旁表 UPDATE/DELETE 显式拒绝，现存实体补序、重复、OR IGNORE/REPLACE 不可绕过；没有旧行回填。索引 keyset 页最多 50，不新增完整对象 gather。
- Repository 入口保留完整 count 覆盖校验；部分映射损坏也在读取/写入前拒绝。逐行触发器仅用索引存在性检查识别 v4 遗留的空映射；在新实体必经触发器、序号不可改删和复合 FK 的写闭包内，不反复扫描整个世界。

| 当前检查 | 真实结果 / 原始证据 |
| --- | --- |
| 005 结构/约束/写入覆盖/缺序号/1k10k | 7 项通过；schema005-guard-retest.txt / -exit.txt；新常规测试位于 tests/kanataSqliteArrayOrder.test.js |
| 全项目主机 | 最终 `npm run check` 退出 0：700 Node、402 Vue/44 文件、strict 正负类型、生产 build；schema005-final-check.txt / -exit.txt。7 项定向是这 700 项的子集，不相加 |
| 最终候选构建 | 退出 0；schema005-final-candidate-build.txt / -exit.txt；APK/catalog/journal 见 schema005-final-candidate-fingerprint.json |
| 最终 Android 专项 | 退出 0；schema005-device-final-driver.txt / -exit.txt；同一隔离 API34 / SQLCipher 4.17.0，真实合成 v4 APK 建库→v5 APK 原地升级、DDL/真实 COMMIT 失败、迁移写入后 SIGKILL、重开 v4 回滚、升级重试、Effects/Baselines/ordinal 强停回滚、幂等和冷启动缺序号拒绝 |
| Android 综合候选 | 最终退出 0；schema005-regression-final-driver.txt / -exit.txt；1k/10k 完整候选，10k 耗时 156,693ms，确认 10,001，批次≤128；原生 1/1 OK |
| 普通 APK | schema005-default-build.txt / -exit.txt、schema005-default-gate.json、schema005-default-catalog.txt：构建及门禁通过，activation=false、无合成页面/语句、Schema5；普通 APK 未安装/发布，生产 canonical legacy |
| E/ER1/G4/M4 | 不自动 PASS；已知 12 项兼容差异、完整世界增量签名/纯领域执行、历史 action 和其他门禁仍需继续关闭；最终 MR8 两轮独立审查尚未启动 |

失败与修复：首次定向 90/93，通过部分不计作全套通过；3 项为新增迁移版本导致的时间数组/FK 清单期望，已补第五项时间及精确三组 FK，最终全 check 700/700 通过。初版计数触发器在 Android 综合 10k 的 replay seed 阶段触发原 420 秒 deadline；schema005-regression-retry-* 保留失败。修复逐行扫描后，主机同一 10k 追加/分页从 2476ms 变为 268ms，最终 Android 原规模/原 420 秒 deadline 在 156,693ms 完成并取得回执，没有减少样本或放宽门槛。另一次 schema005-regression-* 在强停重开时出现 ADB `/proc/net/unix` 15 秒读取超时；不计业务 PASS。

最终专项回读：旧世界 4 Events / 3 Effects / 2 Baselines，三张顺序表仍全为 0；缺序号读取拒绝。独立新世界成功产生 2 Events / 3 Effects / 3 Baselines，对应序号数量完全相等。强停恢复后同命令不重复增加 Effects/Baselines 或序号。测试和模型调用均为合成，真实模型请求 0。

复现命令仍使用既有 runner，不新增工作包：

```powershell
node --test tests/kanataSqliteArrayOrder.test.js
npm.cmd run check
npx.cmd cap sync android
./android/gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
pwsh -NoProfile -File docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory $newIsolatedEvidence -Mode array-order
pwsh -NoProfile -File docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory $anotherNewIsolatedEvidence -Mode full -M4Growth -M4Completion
```

`array-order` 仅在既有 manifest 白名单环境使用已核验的旧合成 APK，原地升级到本轮已构建的候选，不安装普通 APK。EvidenceDirectory 必须是该隔离根中的新目录；不得指向真实资料。旧源码/旧 APK 的 PASS 不套用到新 005；最终专项已重新运行。

最终指纹：候选 APK `4ac866a6d9a5039bff48c35cd2c0e0a4036267437d78e2cf2663b81924ce1bee`，候选 catalog `6dbe944eeddd68b91dc9b6a7786f55be5af20066768a5af79b0048a52e0948e6`，普通 APK `5663f155549427b8ee62d04ebe84041a3fe982d04176bc79ac1114bc88b0ea80`。583 份源码/fixture SHA 与设备/20 份压缩原始证据由 schema005-fingerprints.json 绑定；源码 aggregate `d48195cda486d9381677f273b5fceac9207aead8e46a166b4538bc64394061c1`。collect-schema005.mjs 只读已批准合成设备的身份/APK，不读取数据库、信封或 Key。

Schema 005 结构及指定验收 PASS；E/ER1/G4/MR2/M4 仍 BLOCKED，M5 NO。最终兼容探针 schema005-final-compatibility.txt 仍退出 1/12 项差异；schema005-final-order-proof.txt 仅证明新 005 存储原序，退出 0。下一步仍为唯一清单 E 内已有撤销语义/action/完整对象边界，不新开工作包。最终两轮全范围独立审查未运行，不把本次局部自查称作 MR8。

## 2026-11-12 E 消费者检查点（同一清单，非新增工作包）

已消费005原序，按纯领域Set/data.events排序预览和分两阶段执行；增量完整世界签名覆盖三类实体及规范事件关系。历史action四条写路径均改为SQL字段处理，不再完整materialize Event。字节扫描保留UTF-16代理项，未新增action长度限制，001–005全部不变。

- `event-consumer-check.txt` / `-exit.txt`：npm run check退出0，709 Node、402组件/44文件、strict正负/build通过。10k宽事件确认主机17,585ms；深/宽/混合图1k/10k原规模全部通过。
- `event-consumer-compatibility.txt` / `-exit.txt`：独立兼容探针退出0，旧12项差异清零；纯领域异常action拒绝与历史adapter兼容分开裁决。
- `event-consumer-candidate-build.txt` / `-exit.txt`：候选APK及test APK构建退出0。
- `event-consumer-device-retry-driver.txt` / `-exit.txt`及`event-semantics-20261112-retry-*.gz`：API34/SQLCipher4.17.0，15类action的commit/revoke/correction/message-revision实际路径通过；35节点乱序多父图、revoked no-op、全世界stale通过；最大query50、chunk4096、完整Event读取0；instrumentation 1/1 OK。所有密码为内存随机合成凭据，未写入报告。
- `event-consumer-device-driver.txt`及首轮`event-semantics-20261112-*.gz`为失败证据：探针把明确请求的有界extensions chunk误算为完整Event读取；修正检测为历史完整Event row投影，合法chunk上限仍独立验证。首轮各业务断言已经通过，最终bounds断言失败，不能将首轮算PASS。
- `event-order-host.txt.gz`：早期扩大回归50/51。旧测试在公共操作结束后直接查已经清空的TEMP计划，导致空集合；已改成在withEventPlan的事务生命周期内分keyset页，并用纯领域原数组Oracle对照，最终check通过。原12/10项兼容失败日志保留。
- 递归查询初版被优化器改为对ordinal范围反复扫描，10k宽确认主机约400秒；EXPLAIN定位后固定以event_causes_reverse逐父索引查找，不新增永久索引，规模和门槛不变。最终主机证据包含修复结果。

`event-consumer-fingerprints.json`逐文件绑定源树/fixture、候选APK/catalog及真实设备；八份设备原始日志压缩并双SHA保留。候选APK c7602b191cf41432a6cf4f760c3a01306010329575b3cfa8aa0155048d611fcf；test APK db7f4d2142b82575d5d846f47d9f11e42799e0a4ab020f1a20d55054e4cb203e。普通APK未在本检查点重新构建/安装，旧G10的生产legacy/激活位实现未修改；最终整合后仍须核验新普通APK/catalog。旧005结构证据仅复用不变DDL/约束结论，不复用旧APK为本轮消费者PASS。

E/G4/M4仍BLOCKED、M5 NO。未完成旧Facade/QA完整回读移除、长Effect Audit分块、专用Heap/生命周期、新树Android1k/10k综合故障/强停、A–G其他缺口和两轮最终独立审查。没有新Schema、真实数据、真实模型请求、普通APK激活或发布。
