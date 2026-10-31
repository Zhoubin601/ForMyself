# Kanata P7 性能与恢复检查点（2026-10-31）

P7 IN PROGRESS / No-Go。Kanata HEAD62a2b755，远端fetch仍be9ebc3；保留全部此前P7修改、main既有文档修改/删除及未跟踪资料。无提交/推送/发布/真实用户数据清理。原环境用户允许任务隔离模拟器，恢复同一已标记AVD磁盘，不创建/擦除新盘或操作其他设备。

## 已实现

归档页改密旧页完整校验后原样换密、新密文字节+解密正文读回，避免重复索引/JSON/mkdir；普通批次只准备一次目录，失败重新核验；新增字节兼容的原生AES计算（不是新协议）；Kanata恢复协调器在完整加密日志持久并绑定准备digest后释放内存回滚图，失败重开同一日志完整验证后补偿。源码和接口详见根架构21.6及实际git差异。

## 实际自动化

- rekey-domain-20261031：23 Node PASS；rekey-product：41真实Store/协调器 PASS。
- check-rekey-reviewed-20261031：554 Node、377组件40文件、lint/strict/build退出0。
- rekey-native-aes-domain：28 Node PASS；rekey-native-aes-product：43真实Store/协调器 PASS。
- journal-release-product：68真实Store/协调器 PASS；初次1条spy计数错误（journal.prepare使用词法inspect而非对象spy）已保留原失败并校正，业务校验未放宽。
- check-journal-release-20261031：557 Node、382组件40文件、lint/strict/build退出0；lint0错误42既有警告。
- 新旧CryptoJS固定盐字节相同、严格BOM/UTF8、缺能力回退、平台错误不降级、读回写坏保留主备/旧页、会话释放、GCM坏记录/替换/无准备摘要不写入、实际补偿与恢复均自动回归。新增contract负向例，不关闭strict。

## 第一候选62d的真实Android容量（保留失败）

APK62d626875ed96238804aa2e290896f4d18d53b329fca216fa06418ceaa007339，只包含首批改密/目录复用，不含后续原生AES与日志释放。78资源匹配/无QA入口。三档均跑完，0AI/0页面错误；每条原文/20来源及改回原合成凭据核对完成。

| 消息 | 结果 | 完整恢复ms | 改密ms | 改回ms | 各进程最大峰值MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| 1000 | PASS | 2398.2 | 23616.7 | 2659.7 | 219.27 |
| 10000 | PASS | 14922.6 | 22044.2 | 17692.6 | 247.44 |
| 100000 | FAIL_CAPACITY_GATE | 153322.5 | 228473.3 | 187840.8 | 595.78 |

日志与不可变副本为native-capacity-rekey-reviewed-20261031-*.txt/.json。样本期间主机还执行过后续Node/组件检查，存在CPU竞争，不能据此断言相对旧98性能回退的幅度；结果仍按冻结阈值记录FAIL，不删失败或放宽门槛。首档还清理此前已保留的旧合成孤页，未删其他模块。下一完整候选先结束构建/测试后再串行运行容量，避免再次并发重测试量。

本批已用实际协调器归还原608合成全备，原文/审计精确验证，saveError/pending均无。native-capacity-baseline-restored.json当前记录此事实；后续独立逐模块+真实后台释放验证另列，不能提前算通过。

## 未采用的诊断

独立Node100k：手动clone268452KiB峰值/512ms，strict检查后structuredClone371136KiB/425ms，后者内存更高，未采用。AES-CBC内核探针100次27KiB约54.6ms，而同步完整encrypt/decrypt426.7ms；原生探针未计Base64和第二次KDF，因此不是最终倍率或设备验收。

## 当前后续验证

最终原生AES+日志释放源码完整check已通过，冻结p7-journal-release-20261031/4188；APK构建/逐资源校验及生产Web/Android13项回归、两端三档容量仍需读取实际结果后填写。现阶段全部标NOT RUN/RUNNING，不用第一候选结果充当新候选证据。未完成P7，不签阶段提交。

两轮自查：第一轮已修复目录失败缓存、异步密文结果的owner重验和准备日志被替换的摘要绑定竞态，负向/补偿重测通过；第二轮保持原群聊/活动/跨世界/原文/备份语义，等待最终生产回归与容量，不写“检查通过”掩盖尚未实测。密集来源、旧生活角色链、全应用统计及完整十五场景仍未收口。

### 2026-10-31 当前候选与运行状态（后续实际结果覆盖本段RUNNING）

最新生产APK9411037b9993622e6816dc4915bb535633f7a7e75edfbda18c5a5034eb17be6c，78资源匹配/无QA入口，源码557 Node/382组件40文件完整check通过。verify-activity-timing.mjs新增明确冻结tag/端口/evidence参数，默认旧行为保持；本候选Web/隔离Android各13项PASS、7受控尝试（含1次故意500）/0真实模型/0页面错误，测试后原608合成图及其他模块/设置归还。结果journal-release-20261031-*-results.json，旧功能证据未覆盖。

当前exec session9921顺序驱动native1k→10k→100k→原608基线归还→web1k→10k→100k；运行期间不再编译/跑其他测试，不并行ADB驱动。941的native1k/10k已PASS，100k RUNNING（初次导入68166.5ms、protected冷载5411.8ms），后续原文/来源/改密/内存必须等最终JSON，不提前写通过。任何非容量门槛的FAIL会停止序列，不盲目进入下一档；单纯FAIL_CAPACITY_GATE仍保留全部证据并测余档，最终进程非零。不要复用62d结果充当941，两个候选分别保留不可变JSON。

全部测完后还须最终native instrumentation、独立原608/七模块/设置metadata/真实Home明文释放与凭据扫描，均NOT RUN最新941。当前模拟器可能持有100k合成容量图；不得清数据/删日志/卸载/另建AVD或并行安装其他APK，须先核对运行状态，结束后用现有受控协调器驱动归还基线。

## 2026-10-31 云端交接最终覆盖（本段覆盖此前RUNNING/原始PASS）

用户现明确要求推送远端附交接，由云端开发。本地不再继续业务实现；本检查点作为P7 WIP提交，不是阶段验收。云端入口为[20261031-kanata-cloud-handoff-v1.md](20261031-kanata-cloud-handoff-v1.md)。全部测量/恢复已结束，没有需要接续的exec测试或未完成日志事务。

941业务候选最终完整check565 Node/382组件40文件退出0（含新增门禁/跨日基线回归），生产资源仍与941 APK78项精确一致。原生实际8PASS/1Assume SKIP/0FAIL；Web/Android各13生产检查PASS。

最终两端1k/10k PASS。941 Android100k峰值501.7148MiB、完整恢复97331.3ms、首向改密116779.4ms，但改回合成凭据148057.7ms，故**FAIL_CAPACITY_GATE/TIME**；Web100k所有时间PASS，峰值834.9141MiB，故**FAIL_CAPACITY_GATE/MEMORY**。容量脚本最初漏计第二次改密而写出Native PASS，现补4项回归并按同一120s规则重算，原before-gate-fix/CLI/raw测量保留。没有改变实际数值、删失败或冒称重新测过；最新verification-summary-latest.json才是判断。第一版62d与旧98均仍是独立旧候选，不混用。

原608合成聊天/审计已由实际协调器归还；最终独立核对七模块、设置、metadata及真实Home后台明文释放PASS。Todo全局CAS按既有契约3→44；原始心情记录完全保留，新日期导致原moodStore按既有规则补了一条10月30日空正文/空标签autoFilled占位。首次严格旧日快照对比因此FAIL，未删该合法占位；新增4项正反例，显式--allow-expected-mood-autofill只允许准确缺失日期/default mood/空字段/合理时间，其余修改仍拒绝，最后实际核对PASS。QA清理曾误用不存在的Playwright.removeExposedFunction，原错误保留，改为删除测试全局并关闭连接，已重跑成功。两项都是QA问题修复，没有放宽业务安全/strict或忽略用户手工记录。

当前合成模拟器在Home后台，原合成口令已验证，0真实模型/0页面错误；Windows SDK/AVD/冻结dist/构建APK及真实Key未上传。云端需适配Chrome/逐进程RSS/SDK路径，保留隔离guard。密集来源、旧生活角色链、全应用统计/趋势、高级自治及完整十五场景仍未全部实现/验收，P7仍No-Go。
