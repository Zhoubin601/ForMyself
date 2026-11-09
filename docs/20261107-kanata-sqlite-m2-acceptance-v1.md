# Kanata SQLite M2 正式阶段报告 v1：Preflight / 设计检查点，Windows 接续待执行

执行日期：2026-11-09（Asia/Shanghai）。目标分支：M。依据：[完整M2任务书](20261107-kanata-sqlite-m2-task-v1.md)，未减少任何门禁。

**M2：BLOCKED，不能进入 M3。** 已完成源码/依赖/安全Preflight、技术设计与编码前自审；当前云环境的系统HTMLViewer和最小Capacitor App均实测WebView renderer崩溃，未取得基础JS→Native nonce返回。**生产Driver、Repository与Runtime/UI尚未开始实现**，不是“实现完成只差补测”，更不是M2 PASS。

用户已选择改用此前验证过的Windows/WHPX合成AVD。当前会话只连接Linux执行器，没有可调用的Windows/Powershell/远程执行通道；下一步是在所选Windows环境接续本检查点。[Windows交接](20261109-kanata-sqlite-m2-windows-handoff-v1.md)列明继续入口与约束。这是当前唯一需要外部提供的运行条件；其余M2实现与验收仍全部待执行。

[QA入口](qa/kanata-sqlite-m2/README.md) · [机器汇总](qa/kanata-sqlite-m2/evidence/verification-summary.json) · [Preflight](20261107-kanata-sqlite-m2-preflight-v1.md) · [设计](20261107-kanata-sqlite-m2-design-v1.md)。本报告是正式BLOCKED阶段记录，不冒充最终通过验收。

## Git、范围与材料保护

- 初始本地work分支、HEAD `41cbb66053bd5b9995b358c0c4846669e626bcc0`，无既有修改/删除/未跟踪文件。未reset/clean/恢复删除或覆盖用户文件。
- fetch并独立ls-remote核对M最新基线：`de3164b8de569f57a250d0592eae5a21345e5264`。在该提交建立本地M，此后仅M开发；初始remote refspec只跟踪main，故显式fetch M到origin/M，不把FETCH_HEAD误当已更新的tracking ref。
- 测试使用上述基线的生产源码、package/lock与Schema；本轮只增改文档和隔离QA工具。源码/DDL/夹具/工具/APK及日志SHA见机器汇总和指纹清单。报告所属Git提交及推送记录见[发布回执](qa/kanata-sqlite-m2/evidence/publication.json)、Git历史及最终交付回复；不把基线SHA冒称最终检查点SHA。
- `src/`、生产`android/`、package.json、package-lock.json、AGENTS和raw均未改动；没有M3–M7代码、旧JSON/归档导入、数据清理、双写、生产SQLite启用、全局改密或恢复切换。未改Kanata/main、未强推/合并/发布。
- 全部资料为任务新建合成数据；0真实模型API请求。没有读取真实聊天/备份/主密码。主机随机测试DEK仅内存/stdin；Android最小探针没有数据库或应用DEK。标准debug签名与CA truststore只在work，不提交APK/私钥/SDK/磁盘镜像。

## 已完成的前置工作

Preflight逐一核对AGENTS、根开发说明、迁移总计划、M0 direct gate、M1 v2、M1-R审计/QA/机器证据、M2全文及要求的实际源码。已留下完整消息调用点搜索、根/QA版本差异、真实路径与状态矩阵。

设计冻结Driver/业务事务affectedRows契约、M1 adapter、challenge/lease状态机、M0兼容信封/AAD、首次创建中断拒绝、CAS/审计事务、删除派生closure、keyset cursor、100条消息窗口、AI按需/迟到结果处理、固定错误和完整测试矩阵。它们均为待实施设计，未声称有对应生产实现。

编码前自审主动补正：

1. 编辑也必须失效派生；删除还要取消源消息相关pending/running任务。memory因event和message两条路径可按原函数增加两次revision，不能简化合并。
2. effects必须从durable baseline重新fold，保留独立committed事件，而非简单反向加减。
3. M1 execute:void不能直接用于M2 CAS；历史审计脱敏必须SQL json_set，不重排JSON。
4. 当前restoreJournal.inspect在无主日志时会清理commit/tmp，SQLite只读inventory不能复用它。
5. ChatTimeline是旧小家组件；当前KanataView没有其quote控件。character会话当前禁止手动send，候选查询不能顺带扩大权限。
6. M1结构夹具写入器未写全可选字段，不可冒充M2与纯函数对照所需的完整投影或M5无损导入器。

## 真实测试结果

| 命令/范围 | 实际结果 | 证据与限制 |
|---|---|---|
| 根原始npm ci | registry.npmmirror.com被当前策略403拒绝，终止该任务的安装进程 | 保留初始日志；不是源码缺陷 |
| 官方源隔离准备→根原锁npm ci --offline | PASS，693包，四个postinstall补丁全部成功 | 不改根锁字节；临时副本只替换794个URL，版本/integrity不变 |
| 首次定向测试（依赖未就绪） | exit1，ERR_MODULE_NOT_FOUND | 保留失败，不当作业务缺陷或通过 |
| 最终Schema/M1-R定向 | **34/34 PASS，exit0** | 既有Schema/映射/故障基线，不是M2 Repository测试 |
| 主机SQLCipher4.12.0 | **9组PASS，exit0**；两个真实SIGKILL后重开场景 | 原JS升级器/M1-R；不是Android4.17或M2 Driver |
| npm run check（两次，第二次在根原锁离线安装后） | **PASS，exit0**：Node624、组件392/42文件、两类类型、build；lint0错误/42警告 | 完整原始日志分别保存；没有新增生产代码 |
| 新API34合成AVD启动 | PASS：boot_completed=1、文件加密、SELinux Enforcing | emulator-5582 / kanata_m2_api34；TCG，无/dev/kvm；首次启动含系统包优化，不是数据库性能 |
| 系统HTMLViewer独立data:页面 | **故障复现**：renderer1486 code5，libwebviewchromium.so，随后HTMLViewer1307 SIGTRAP | 无Capacitor/SQLCipher/产品代码；初始观察窗口未捕获，之后追加late日志，未改写初始结果 |
| 追加静态观察、开启界面绘制 | 观察完成，但未取得可用于证明JS桥接的结果 | ATD drawing=0→1是正常测试图形配置，未禁用安全；不能把未见新崩溃当PASS |
| 最小Capacitor8.4.1 QA构建 | 初次缺javac；再缺AGP默认BuildTools35；补齐后**BUILD SUCCESSFUL，exit0** | 官方Temurin21.0.9+10/SHA及BuildTools35；保留两次失败；只构建环境探针 |
| 最小QA安装/实际JS→Native ping | **BLOCKED，exit2**：renderer3707 code5，同一库/PC，App3663 SIGTRAP；未返回nonce | APK安装成功且设备读回SHA一致；不是M2 Driver实现失败，也不算Android集成通过 |
| M2 Android SQLCipher4.17/instrumentation/JS升级器/Repository | **NOT RUN / BLOCKED** | 未实现，不能以探针构建或历史M1 JUnit代替 |

命令退出码与原始结果见[baseline-command-results](qa/kanata-sqlite-m2/evidence/baseline-command-results.json)、[最小桥接结果](qa/kanata-sqlite-m2/evidence/capacitor-probe/result.json)、[最小桥接崩溃](qa/kanata-sqlite-m2/evidence/capacitor-probe/crash-extract.txt)、[系统对照晚到崩溃](qa/kanata-sqlite-m2/evidence/webview-probe-1/late-crash-extract.txt)。

APK SHA256：`6978be559e6baf990deaf2a7c3175b77ee48fc40f26af4c62ba1cc9dc4d53654`。包名`com.formyself.qa.m2probe`，不是生产包，也不是M2候选Driver APK。设备base.apk读回相同SHA。[设备最终核验](qa/kanata-sqlite-m2/evidence/device-final-checks.json)。WebView113.0.5672.136，renderer库BuildId `f91274aba2c3932b2c24b5323fd164aceb07dba8`、PC `0x191356a`在两种上下文一致。根因尚未确定，不能仅据此断言唯一原因是无KVM。

已尝试正常图形绘制及关闭反复崩溃的合成蓝牙服务；没有关闭SELinux、WebView sandbox或加密，也没有更换生产数据源。用户随后选择Windows/WHPX接续，当前Linux诊断在此保存检查点，不继续无边界替换测试平台。

## M2强制验收矩阵

| 门禁 | 状态 | 当前边界 |
|---|---|---|
| Driver与加密 | NOT RUN | 仅设计；生产Native桥、DEK/信封实现待做 |
| 受保护会话 | NOT RUN | chat operation lease/撤销/迟到丢弃未实施 |
| Schema | PASS（仅既有基线复核） | 001/002/003 checksum不变；本轮34项和主机升级器实跑，不代表M2设备JS升级 |
| Repository | NOT RUN | 消息/会话接口、参数化SQL、affectedRows/CAS未实施 |
| 写入/审计 | NOT RUN | M2单条/批量/原子审计未实施 |
| 删除隐私 | NOT RUN | 派生失效/历史精确脱敏待按设计完整实现 |
| 分页 | NOT RUN | M2稳定cursor/有界payload待实施 |
| UI/Store | NOT RUN | M2窗口/翻页/quote/快切未实施；生产仍legacy |
| AI | NOT RUN | M2按需上下文/迟到写拒绝未实施；本轮0真实API |
| 故障 | NOT RUN（M2） | 仅M1-R主机故障基线，不能替代M2 COMMIT/强停/lease故障 |
| 回归 | BLOCKED | 根完整check PASS；M2设备JS-to-native前置失败，SQLCipher集成未跑 |
| 证据 | BLOCKED | 本轮证据齐全；没有M2候选APK、产品故障矩阵和实现后两轮自检 |

任务书§8两轮实现后独立自检均为 **NOT RUN**，原因是尚未进入生产实现。前述编码前设计自审、工具链修复、两个运行上下文对照都不冒充这两轮，也没有声称调用外部Agent。后续实现完成后必须从安全/存储/并发和产品/兼容/证据两个角度分别主动构造反例、修复与重测，再执行最终完整回归。

## 阶段推进与下一步

1. Preflight文档与技术设计：已完成；设备基础运行条件BLOCKED。
2. 最小生产Native Driver：NOT STARTED，待Windows环境就绪后按任务书§11第3步开始。
3. Repository、删除派生事务、Runtime/UI注入、Android真实集成、两轮自检、最终回归：均待执行，未跳过或取消。
4. 用户已选Windows/WHPX；需要在该本地执行环境打开此任务/仓库，先保护其既有修改、fetch并核对M最新HEAD，再验证AVD/包/syntheticOnly，才能运行隔离测试。当前会话没有Windows连接能力，不会把Linux工具输出冒充Windows实测。
5. 首次继续仍须核对设计与最新源码差异；若Windows工作区出现已有M2修改，先保留并审阅，不覆盖本轮或用户工作。

**不建议进入M3。** 真实旧数据与生产canonical保持legacy；SQLite未启用。M3/M4/M5/M6、备份恢复/改密闭环和M7/P7均未由本轮放行，原容量/安全门槛不变。收尾只停止本轮两个合成App并正常关闭AVD、回收本轮ADB转发；保留任务合成磁盘与manifest便于排查，没有清理旧用户材料。
