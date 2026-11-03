# P7 最终收口执行记录（2026-11-02）

状态：IN PROGRESS / No-Go。基线及远端实际核对均为 `9ebf3484cdd3ae67e68af05a6e55a27e0b2cef0f`，Kanata 工作树初始干净。main 的既有修改、删除和未跟踪资料保持。

## 来源与执行顺序

已依次读取本工作树 AGENTS、根架构规范、云端交接 v2、归档规划器记录、latest 验证摘要、连续执行计划 v3；补读 raw/完整需求清单.txt、冻结容量契约、旧交接环境说明、长期入口及实际容量驱动。仅本仓库资料，无外部产品研究；raw 只读。P0–P6 不重做。

1. 核对最新源码与生产冻结资源、APK、隔离 AVD 标记，运行同一候选 Web/Android 1k、10k、100k 完整容量；历史失败不得改写或移作本轮证据。
2. 按阶段 RSS / 完整改密（含反向）真实测量归因，再进行有界优化与故障/兼容回归。不得强制 GC、改变阈值、减损来源或安全验证。
3. 性能门禁通过后继续密集来源归档、旧生活 AI/提醒角色绑定、全应用统计、情绪关系及最终十五场景。门禁不通过则后续保持依赖阻断。
4. 每个实施切片记录两轮实质自查、发现和修复、真实复测。最后交付完整矩阵和原始证据索引；未运行明确 NOT RUN，不以 check 代替验收。

## 当前环境核对

本机存在用户此前授权的任务 AVD emulator-5580、隔离清单及生产冻结目录。未发现正在运行的容量驱动，仅有历史 preview 服务。04e4 候选最新三档容量尚未执行，先重新 build 并核对所有资源与冻结目录一致；不清理、卸载或擦除设备数据。

## 实际命令、两轮审查及结果

基线正常 build 退出0；重新生成的78个资源与04e4 APK、p7-pending-recovery-20261102冻结目录逐项SHA256一致，远端实际仍9ebf3484。Web三档原始结果见 `web-capacity-closure-baseline-20261102-{1000,10000,100000}.json/.txt`。1k/10k PASS；100k完整恢复30.0343秒、改密31.3945秒，峰值1047.6797MiB首次出现于完整恢复，时间PASS/内存FAIL。0AI/页面错误、全量原文及20来源证明通过。不覆盖历史883MiB失败。

Android同APK三档顺序运行中；1k已PASS，首向改密90.095秒、反向10.497秒。不能把差异直接归因为退休I/O，仍需固定标签的实际I/O聚合诊断。新的可选诊断只保留方法/类别/耗时，不记录参数或响应；诊断样本单列不作门禁PASS。已有一次真实诊断父调用栈缺失，本轮补保留分配栈以进一步确认具体调用者。

### 有界计算切片设计

原始profile中同步SHA累计分配约3879MiB（旧候选，仅为线索），最新100k导入598MiB、完整恢复1048MiB是本轮真实阶段证据。源码确认每页密文散列仍经CryptoJS同步WordArray转换，归档原生AES编码也先UTF8→WordArray→bytes重复转换。计划只为归档页散列采用平台SHA256异步计算，缺能力才使用既有分块同步实现；UTF8严格代理项校验抽为共用bytes编码，原生AES直接使用其结果。保持字节/散列/随机盐/派生/填充/密文、原读回验证和失败/owner门禁。不改主头/GCM日志算法、不缓存凭据、不迁移存储。不提前宣称能通过RSS或改密门禁；以新冻结候选重测判定。

### 两轮源码与需求审查（计算切片）

第一轮：新散列await引入owner撤销窗口，已在write的散列完成后、mkdir/新写入之前补assertCurrent；reencrypt已有下一步assertCurrent，read在readCipher返回后已有复核。新增迟到digest期间释放的真实仓库测试，验证0文件/0I/O；增加平台散列失败时旧页逐字保全、无降级/无重写。平台异常使用固定代码，不泄漏原错误；URI非法代理项保持拒绝。尚待本轮新增用例及完整check复测，不据此写PASS。

第一轮继续核对实际Store发现：新SHA256_PLATFORM_FAILED如果只传播而未加入noteArchiveFailure，历史读取失败后普通写门禁不会保持。已补入原归档错误白名单，并新增真实Store故障→普通动作零写入→恢复能力→release/重新认证load→原文查询成功的回归。没有靠UI禁用按钮代替Store门禁。

第二轮：SHA输入仍为同一完整密文，输出小写64十六进制，未改变页键/页上限/索引/来源revision；密文写后hash、同字节和解密原文读回均保留。新旧CryptoJS固定盐互读、BOM/多字节/边界/空串/错密/坏padding/无subtle回退覆盖继续沿用并补严格bytes及SHA兼容；普通Store、权限、完整恢复协调器和主密码补偿未改。增加实际导入的strict类型正负样例与contracts入口，未放宽现有类型。生产功能、双端完整容量及中断恢复仍必须在新冻结候选实际执行。

### 最终十五场景的放行清单

本轮完整设备综合回放尚未开始，以下为待执行清单，不能将历史P1–P6或check中的自动化覆盖写成最终PASS。性能前置未通过时保持NOT RUN。

| 编号 | 原始第十五节场景 | 本轮最终综合状态 | 主要核查入口 |
| --- | --- | --- | --- |
| 01 | 同卡双世界、记忆关系独立 | NOT RUN | domain / management / knowledge |
| 02 | 酒馆导入及未知扩展保留 | NOT RUN | cards / management / backup |
| 03 | 私聊群聊@智能发言 | NOT RUN | chatRuntime / groupLimits / production UI |
| 04 | 无用户自主互动与事件 | NOT RUN | socialRuntime / activityLifecycle |
| 05 | 每日0场只有规则事件 | NOT RUN | autonomy / socialRuntime |
| 06 | 关闭后安全补算 | NOT RUN | worldRuntime / deferredRuntime / Android冷启 |
| 07 | 压缩失败保留原文与有效记忆 | NOT RUN | memory / productRecovery |
| 08 | 历史修正与关系记忆后继处理 | NOT RUN | experience / audits / recovery |
| 09 | 普通/上帝视角权限 | NOT RUN | knowledge / social / activity UI |
| 10 | read/remember/share独立与撤权 | NOT RUN | lifeCompanion / knowledge / async失效 |
| 11 | 不同生活模块精确角色绑定 | NOT RUN；旧入口未收口 | lifeCompanion及旧AI/提醒链 |
| 12 | Token真实/估算和费用标注 | NOT RUN；全应用聚合未收口 | completion / usage / 旧AI入口 |
| 13 | 主动/自治/通知独立 | NOT RUN | contact / autonomy / notifications |
| 14 | 关闭期间不追补 | NOT RUN | autonomy水位 / lifecycle |
| 15 | 原生活数据、备份恢复不受损 | 部分容量往返已执行；最终NOT RUN | 七模块/设置/metadata/CAS/旧备份矩阵 |

额外强制项：五人精确seed与人格/预设、旧v1–v12非聊天恢复/旧聊天拒绝与合成清理、密集来源分页、两种认证入口/释放/回滚失败/中断恢复、布局与减少动效、原生实际instrumentation，均须在最终候选分别记录，不与十五场景或容量合并计数。

## Android超时、安全收尾与有界原生I/O设计

04e4同候选Android1k/10k PASS；100k导入299.4451秒、完整导出117.7047秒、完整恢复约390秒，原文证明通过；首向改密观察600秒超时，记录FAIL而非提高120秒门槛。驱动结束不会取消App事务；父序列按运行时失败停止，未强停/安装或直接apply。通过仅attach的受控守卫等待真实UI结算，确认下一测试凭据、100k消息、pending=false/saveError空后，从实际设置页改回原测试凭据；此后才可实际协调器恢复608基线并独立核对。

I/O观察在**已失败样本**的首向改密中途开始，文件`native-io-partial-closure-baseline-20261102.json`明确partialFirstDirection/acceptanceEvidence=false；原导入/恢复失败时间在诊断前完成。到600秒时观察到归档read596次、write300次、delete4136次（部分，不是整轮总计）；删除累计往返623.5秒、平均约150.8ms，4并发，累计值不是墙钟耗时/纯磁盘I/O。逐文件跨桥往返为显著成本，不将其当所有阶段唯一根因。

新增`archiveFileBatch`与Android`ArchiveFileBatchPlugin/Store`，仅生产Native原Filesystem/Data启用，注入仓库/Web/无插件保留旧驱动。每批最多4个read/write/delete且最多一批在途，整批原生处理结算再分发结果及下一批；失败不回退/不伪造空内容。固定64位hash键和内部目录，整批先校验路径/操作/密文、拒绝symlink和目录才写删；写入核对SHA256和fsync。JS仍hash/解密/原文/索引/新密文精确读回，主备提交与退休顺序不变。超过256KiB写预先走原驱动；原生读取先检查长度，过大只返回oversized，JS在同批内等待旧驱动读取结算，不无界启动后批。

第一轮原生自查：生产minSdk24不能依赖API26的java.nio.file，已改为受限FileInputStream/ByteArrayOutputStream和canonical路径校验；symlink测试仅在本轮API34测试APK缓存运行，不触碰目标App。无密码/明文进入桥接，无新数据源/存储格式。MainActivity注册新桥；依赖未升级或手改。

第一轮check因Proxy闭合括号语法错误在lint拒绝，`check-closure-first-20261102.txt`保留，已修正。定向`closure-domain-second-20261102.txt`40项PASS，包含队列上限/整批结算/错误无降级/超长回退/诊断不存私密参数/旧密文互读/owner失效。新增原生4项实际文件测试尚待构建/instrumentation，不能写PASS。完整check、新候选Web/Android三档尚待执行。

质量检查在已失败样本的凭据收尾期间运行，收尾计时只作诊断，不作为独立无干扰容量PASS。最终新候选容量与本任务其他构建/测试顺序执行。

## 新候选、原生驱动失误及实际复测

最终计算/有界I/O源码完整check `check-closure-reviewed-20261102.txt`退出0：586 Node、391组件/42文件，lint0错42既有警告，strict/build通过。前一类型失败保留；已把原文件契约逐字段不变地提升为平台ArchiveFilesystemDriver，feature KanataFilesystem继承原同一签名，没有关闭strict或删除负向例。真实Store三文件46项及诊断隐私复测通过。

生产APK `8e67b74a192fd89e340cd4829b4137dc67ae6e43e65611b9551d987847473f35`，78资源精确匹配，无QA入口，冻结`p7-batch-closure-20261102`/4187。源码清单见frozen-source-closure-20261102.json，生产源码当前逐文件一致；随后只有Android测试夹具目录修正，单独记录`frozen-source-test-fix-closure-20261102.json`和测试APK hash，不把测试修正冒称原冻结源码未变。

`connectedDebugAndroidTest`实际失败：新增4例均卡在测试Context cache无写权限（instrumentation实际运行在target UID）；旧8例通过、1 Assume跳过。**更严重的测试流程问题：AGP驱动结束后自动卸载主/测试包，隔离合成App的驻留状态因此丢失。** 当时没有App写事务/恢复日志，先前已独立核对608基线，原始加密合成备份仍完整保留；没有真实用户数据。此为本轮操作失误，不隐藏成环境缺失或产品性能通过。

修复：原生测试仅使用target App cache的新UUID合成子树，绝不使用其files/formyself。停止使用会自动卸载的connected驱动；只正常`adb install -r -t`和`am instrument -w -r`。在AVD/安装缺失/加密合成文件hash/608条/已核对生产APK守卫全部通过后，安装新App并走真实空档准备、受保护操作租约及完整恢复协调器归还备份。首次bootstrap QA断言预期启动前就存在心情自动补记而失败，材料保留；实际协调器已经成功提交原始资料。独立冷启动后按原moodStore规则精确核对三个空白autoFilled占位，七模块/设置/metadata/原文/审计全部通过，0AI/页面错误，真实Home释放通过。

新安装意味着Todo仓库的CAS是**新世代**，原fixture revision3、本次新安装恢复后revision1，不能声称从原设备63连续增加。只对任务数据逐字段比对相同，明确continuityPreserved=false。QA仅在已记录的AGP bootstrap和固定加密合成文件hash匹配时允许新世代核查；普通原生CAS断言未放宽。原备份没有被覆盖，未伪造counter或直接写共享键。

直接原生第一轮只有旧通知用例失败：新安装清除了原测试通知授权。恢复本任务隔离包的POST_NOTIFICATIONS测试权限后，`instrumentation-direct-reviewed-closure-20261102.txt`为**12 PASS、1原有Assume(-4) SKIP、0 FAIL**（不是13通过）。新增4例全PASS；主包仍安装，之后七模块/设置/metadata/原文/审计及真实Home释放再次PASS。`adb am instrument`即使用例失败也可能进程exit0，本轮额外检查实际OK/失败内容，保留首次失败日志。

新候选三档容量串行复测正在运行，无Profiler/强制GC/其他本任务构建并行。Web1k/10k PASS；100k恢复22.3875秒、改密24.0446秒，峰值884.9570MiB，仍FAIL。Android1k/10k PASS，确认archiveFileBatchAvailable=true；100k尚未完成，不能提前套用结果。平台批次与SHA/UTF8是组合改动，且1k首次样本的历史孤页数量不同，不用它们宣称各自独立倍率。

## 8e67完整结果与下一切片

覆盖上节RUNNING：8e67两端三档均完成。Android100k导入106735.8ms、完整导出40272.3ms、完整恢复76553.4ms、首向改密122677.9ms（FAIL，不能取整）、反向97892.4ms（PASS）、峰值503.5273MiB（PASS）。两端1k/10k均PASS，Web100k884.9570MiB FAIL。全部原文和20来源证明、0AI/页面错误均执行；`native-restore-closure-reviewed-20261102.json`及`native-integrity-closure-reviewed-20261102.json`确认608/审计/七模块/设置/metadata/后台释放已归还，无待写/恢复事务。新世代CAS的背景仍按上节单列。

随后在同冻结8e67的独立浏览器运行allocation diagnostic，不作门禁PASS。`web-allocation-closure-reviewed-20261102.json`保留父栈：restoreJsonChunks/pull累计分配约635.6MiB、IDB request onsuccess约438.5MiB、页Base64转换约312.6MiB；多个属性描述符遍历路径各约128–136MiB。已按冻结bundle的行列位置核对源码函数，不仅按压缩函数名推断。累计分配不是RSS，也不确定某一项单独造成峰值。

有界后续实现：

- 页读/写保持4，只有纯退休键可64，所有键先验、每批allSettled，失败不启动后批。原生同样限制64且>4只能delete，不能在大批里传正文。没有扩大页大小或解密并发。
- 修复Capacitor Proxy会为未知方法造函数的问题：只有适配器显式own capability可触发批量退休；原Filesystem/Web路径继续4条，不把方法truthy当能力。适配器为独立继承对象，原方法绑定回原driver，覆盖class私有字段receiver。整批预检路径后再删，不影响主备验证与门禁。
- 恢复日志JSON以fragment数组合并替代每标点反复拼接rope，仍8Ki字符/代理项边界及完整顺序/UTF8/BOM、不调用getter/toJSON、取消释放临时容器、256MiB实际字节预算不变。
- 复用**既有私有不可变图**的验证身份。工厂仍先全JSON/全图验证，递归冻结，再全JSON/全图验证，才登记模块闭包WeakSet；只有该身份可避免重复全图遍历。公有restore每次先detach和完整校验；未知/浅冻结/trusted标记仍完整检查，普通validateKanataData始终复制。WeakSet无强明文引用、无权限/凭据缓存。message索引逐项set替代临时二元数组，引用/顺序/错误不变。

第一轮自查修复：原生大批不得混入读写；Capacitor未知方法假能力；Proxy receiver必须保留原driver；旧/新页内容键重合时不能退休当前引用。新增确定性同密码补偿验证当前页仍完整，不依赖随机盐不重合的假设。

第二轮自查：普通可变图经assert后仍不得缓存；浅冻结和伪标记无权跳过；复制后的图仍可修改并必须重新校验，工厂不改变外部恢复的detachment。JSON取消不求值后续getter，长正文/Unicode/多字段/边界与原JSON字节一致；所有旧格式和真实协调器/失败补偿测试继续执行，不替换成纯函数或只验构建。定向41项PASS；新增同键补偿用例及本轮完整check/原生/新冻结三档尚待最终复测。

## 中断后的证据核对（2026-11-03）

当前 Kanata HEAD 仍为 9ebf3484，优化留在本地。冻结候选 2d363af5 的 `npm run check`：590 项 Node、392 项组件测试通过；Android 单元测试及构建通过；直接 instrumentation 为 12 通过、1 跳过、0 失败。78 项生产资源与冻结 Web 匹配。

容量结果：Web 1k/10k 通过；100k 失败，峰值 916.7305 MiB（上限 768 MiB），峰首次出现于完整恢复；导入 11.804 秒、完整恢复 11.466 秒、改密 11.629 秒。Android 1k/10k 通过；100k 记录停在完整导出，原驱动会话已不可用，ADB 未列出设备；完整恢复、双向改密、全程峰值和本轮 608 基线归还均无最终证据。保留 RUNNING 原始记录，按中断判定，不用上一候选补齐。未重启、重装或改写设备。上一候选 8e67 的 608 基线归还证明只适用于上一轮。

P7 No-Go：Web 内存仍超限，Android 10 万档和合成设备最终状态待核实。后续四组功能和最终 15 场景未进入验收，逐项范围见上文。续作先复核原隔离 AVD、包、冻结 APK 和事务状态，再通过产品协调器核对或归还 608，最后重测。不得使用中断结果判定 Android 性能通过或失败。
