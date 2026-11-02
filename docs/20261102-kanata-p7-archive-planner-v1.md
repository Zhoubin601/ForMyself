# P7 归档规划器接续（2026-11-02）

最新授权覆盖：用户随后明确要求“你先推送吧”，本轮按该授权保存并普通推送P7 WIP。此前“未提交/未推送/未获新授权”是开发结束时快照，详见[云端交接v2](20261102-kanata-cloud-handoff-v2.md)。不改变任何测试结论或P7 No-Go状态。

基线 Kanata `ddd3f10e2daf1c3675dbd05bac3425157d1a2ef4`；fetch 后远端一致，目标工作区干净。main 既有修改/删除/未跟踪资料保留。用户本轮“继续开发”解除本地交接停止；继续 P7，不据此自动推送或发布。

## 来源与切片

依照连续执行计划 v3、阿拜多斯规格/clean-start v2、raw/完整需求清单.txt（只读）、云端交接及架构 v1.4。现有 P7 仍 No-Go：941 候选 Web100k 峰值834.9141MiB、Android100k反向改密148.0577s未达冻结门槛。历史结果不是本轮测试。

实际源码 `messageArchiveCore.planMessageArchive` 为每条消息分配邻接数组，并持有逐组件数组和归档ID集合。100k恢复期间与调用方输入、私有目标及回滚材料发生重叠；这是可独立优化的分配来源，是否足以通过容量门禁尚待实际测量，不能提前宣称根因已解决。

本切片只替换纯规划内部算法：按已排序消息的索引用并查集合并同会话回复连通分量，以定长数组保存父节点/大小/组件首尾/链接和保留标记；保持组件最早消息优先、组件内部排序、50条页上限、完整回复组件、近期消息、所有非消息实体（含未知扩展）的精确原文引用保留。返回字段/对象所有权、磁盘格式、加密、恢复协调器、4页I/O及阈值均不变。

## 验证与两轮审查（执行后填写）

- 定向：新旧算法多图对照、分支/循环/超50组件/边界、未知来源/跨会话保护、输入不变；现有归档/真实Store/完整恢复回归。
- 必须：`npm run check`；同候选实际生产Web容量，之后按变更影响执行Android实际检查。
- 第一轮：数据/引用闭包/越界/失败/不改变恢复写序。
- 第二轮：世界隔离/来源/分页顺序/完整原文与需求覆盖。
- 未实际执行的项保持 NOT RUN；P7不因本切片编译通过而放行。

## 首批实际结果与继续定位

569 Node/382组件40文件完整check退出0；24归档领域/新旧算法对照测试通过。独立Node100k诊断：旧241844KiB/164.05ms，新118940KiB/57.32ms，1996页/99780归档/220保留一致；只作诊断。

生产冻结`p7-planner-20261102`的Web1k/10k通过，100k实际全部流程完成、0AI/页面错误、逐条原文及20来源校验通过，时间门禁通过，但峰值891.4258MiB超过768，仍FAIL。不能用Node结果取代失败。

随后同冻结构建的Web100k allocation-diagnostic只作定位：恢复期间采样分配中`next`约5312MiB、`from`约2835MiB；这些是累计采样分配，不是同时驻留内存或门禁证据，汇总未保留父调用栈，不能将全部next分配精确归于某一个调用点。结合实际源码，业务页encodeBytes和journal Base64的spread及页/日志解密字符串转换是可减少逐字节临时对象的路径。第二切片改为有界8190/8192参数的apply与定长数组索引复制，不改变字节、协议、验证、随机源、错误语义或恢复顺序。必须重跑兼容/故障/check并冻结另一候选实际复测。

第三切片设计：本地已安装的`@capacitor/filesystem@8.1.2/dist/esm/web.js:356`的readdir不是只读元数据；getAllKeys之后Promise.all并发读取每个包含完整content的IndexedDB条目，再投影成元数据。大目录因此瞬间加载所有加密页。通过scripts/postinstall可复现补丁将这段改为4条一批allSettled，所有条目仍逐项读取/顺序投影；失败整批settle后拒绝，不返回空列表、不启动后批。ESM/CJS/browser三构建同时处理，未知版本/源码拒绝，原DB/键/文件/格式/原生Java不变。新增真实包Web类行为测试覆盖并发、元数据、失败、空目录、斜杠兼容、幂等和不兼容拒绝。实现及测试在前一冻结APK进行独立设备容量期间准备；不要将设备二切片证据算成三切片的新候选证据。

## 实际命令与自查

- `node --test tests/kanataArchivePlanner.test.js tests/kanataMessageArchive.test.js`：24通过，60组确定性图对照包含在4项新测试内，不能写成60个独立测试。
- 第一候选`npm run check`：569 Node/382组件40文件、0错误42既有lint警告、类型/构建退出0。
- 第二候选长正文固定盐新旧互读后完整check：570/382，退出0。Web1k/10k通过；100k全流程时间通过，峰值899.0352MiB失败。Android实际APK`3f39b1944692dafa1d6412d1c1dab2d6f1fd54c1c0831b026a358543c6196683`/78资源无QA入口，三档1k/10k通过，100k峰值496.6016MiB通过，恢复103710.2ms通过，但首次改密207900ms失败、改回101679.9ms通过；不能只挑较快方向。0真实AI/页面错误。
- Android首次误用未限定项目的`gradlew testDebugUnitTest assembleDebug assembleDebugAndroidTest`，会额外构建Cordova子项目的测试APK并触发其Kotlin旧JDK依赖重复；原失败日志保留。按架构既定命令修正为`:app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest`成功（部分缓存），未修改依赖、忽略生产测试或绕过app门禁。原生8通过/1 TodoWidgetHarness Assume跳过，不能写成9通过。
- 第二候选实际协调器已归还608原文/审计，七模块/设置/metadata与真实Home后台释放复核通过；Todo CAS按既定契约3→51，原心情保留，10月30/31日和11月1日三个规则生成的空白autoFilled占位按严格日期/字段/时间规则核对，不删除或泛化忽略。
- `npm run postinstall`：全部四项受控补丁验证退出0；`node --test tests/filesystemWebPatch.test.js`：5通过；第三候选完整`npm run check`：575 Node/382组件40文件、0错误42既有lint警告、strict/build退出0。
- 第三候选`:app:`构建成功（21执行/216缓存），APK`27894fe1181fce3c713224c9a40d74297caeca23df96c704a239e4781dda6a8b`/78资源无QA入口。最新生产Web三档进行中；Android大容量结果属于上述第二候选，不将其套在本候选上。

第一轮自查：并查集索引0不能按真假判定，使用undefined边界并以首条外部来源及跨近期边界回复验证；大组件不得拆散，源对象不变，scope/版本/读回/失败补偿仍由原流程严格检查。Web补丁初稿若只看entries.length会把异常对象当空目录，已补Array.isArray与负向用例；allSettled后才抛错，杜绝失败后启动后批；不适用的上游sourceMappingURL注释去除，map文件保留。测试适配器只替换外部驱动，不伪造readdir返回；修正所有IDBKeyRange替换后再实际执行，5项通过。

第二轮自查：旧/新算法的页面分组、页内顺序、reply完整性、世界/会话范围、外部未知扩展和所有原文对象一致；密集来源仍保守保留，没有用优化解除权限/来源闭包。生产完整原文与20来源已逐项对照。独立Node收益未转化为生产RSS门禁时如实保留失败，转查实际底层。自建群/活动等待等最新候选的交互回归仍需后续实际执行；不以纯算法测试代替。

## 最新生产回归发现的冷启动恢复故障（继续修复）

第三候选Web三档完成，1k/10k通过；100k最终峰值883.0039MiB仍失败（不是中间恢复824MiB），恢复22848.1ms/改密16362.1ms通过，0AI/页面错误。Web13项交互回归通过。Android回归在消息仍保存时force-stop，冷启后locator等待manager超时，原结果及cleanup失败保留为`directory-20261102-native-before-recovery-fix.json`。

守卫连接只读诊断确认：屏幕Awake/stayOn、应用前台；chat已加载620条合成消息，但saveError=KANATA_PENDING_RECOVERY/hasPendingSave=true，故KanataView停在setup。不是手机缺失、屏幕睡眠或已成功续接。失败脚本尚未重新attach的__groupTest不存在，原finally无法归还基线。随后通过独立守卫工具核对原608条全部仍在、额外原文均为合成、AI配置也为合成，沿实际完整协调器恢复该次加密基线；所有模块/设置/metadata精确比较通过，0阻断请求，没有删恢复日志或直接apply。

第四切片：Store.load在成功解析/全图验证/归档metadata检查之后、发布ready之前，完成已授权的有效pending密文；缺文件/未来版本/校验失败不触发写入，失败保留旧主与加密恢复材料并维持未加载，可重新认证重试。完整恢复blocked/busy期间不自动flush，由原协调器持有原flush能力；会话失效不发布晚到结果。没有新接口/格式/凭据缓存/新世界种子/旧聊天清理。新增真实仓库故障、全局恢复门禁、缺页/未来版本和会话释放回归，必须完整check和新生产候选复测后再填写结果。

## 本轮最终检查点（非P7放行）

最新完整check `check-pending-recovery-20261102.txt`退出0：**575 Node、388组件/41文件**，lint0错误42既有警告、strict/build通过。定向`pending-recovery-product-20261102.txt`为50组件/3文件通过（含6项新增真实仓库冷启动故障回归）。无新增接口，因此没有放宽contracts或负向样例。

最新生产候选 **04e427d7cce23ecdb2d69f732f3f3cb232507b6477aa5250ec1cd1365a58c220**，78资源精确匹配，无QA入口；冻结`p7-pending-recovery-20261102`，端口4185。`:app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest`退出0；实际instrumentation **8通过、1 Assume跳过(-4)、0失败**。

Web/Android最新候选**各13项生产交互回归通过**，每端7受控HTTP尝试（含1次故意500）、0真实模型、0页面错误。Android之前失败的冷启动任务场景本次40.143s完成，明确`recoveredFromBackup=true/pending=false/saveError=""`，由真实前台生命周期只执行一次；没有手动调用执行器、改时钟或假回复冒充模型质量。每端实际协调器归还其测试前基线。

最新Android独立基线核对通过：原608条消息及审计、七模块、设置、metadata保全，Todo CAS3→56、原心情及三个既有规则autoFilled占位保持。Home后台明文释放通过、autoLock=0、未人工expireSession，0AI/页面错误；设备在Home后台，没有待接续恢复/改密/测试事务。证据`native-baseline-pending-recovery-20261102.json`。

**容量边界必须按候选区分：** 三档完整容量测量不是最新04e4。3f39（第二候选）Android1k/10k通过，100k内存496.6016MiB通过、首次改密207900ms失败/改回101679.9ms通过。2789（第三候选）Web1k/10k通过、100k时间通过但最终峰值883.0039MiB失败；首批规划候选891、字节候选899和allocation诊断899.8亦保留。最新04e4修复了中断冷启动，未再重跑三档容量，状态**NOT RUN**，不能套用旧测量或提前标容量通过。

两轮自查后续修复：第一轮的真实读回/错误/全局恢复门禁与owner撤销以6项新故障例及原完整恢复补偿矩阵复测；第二轮在真实Android发现pending恢复材料已读而UI仍停在setup，已修复并真实复现`recoveredFromBackup=true`通过。同时修复QA finally在cold()已换WebView而unlock等待失败时仍用旧页面的缺陷：使用当前native.page并重新attach门面；仍走原协调器，不绕过全局恢复门禁。首次失败及手工守卫恢复证据保留，不改成通过。

**P7仍 IN PROGRESS / No-Go。** 下一步继续定位原生改密/退休I/O和Web完整恢复/导出生命周期的峰值，先做可分阶段归因的诊断，再设计有界平台I/O；不能只挑更快改密方向、强制GC或提高阈值。密集来源分页、旧生活AI/提醒角色链、全应用统计/日期趋势、高级情绪关系决策和最终十五场景/五人/旧备份清理综合回放仍未收口。没有新增真实模型质量验收，没有Android真机结果（本任务允许隔离模拟器）。

本轮文件清单、结构化摘要和凭据扫描随QA检查点提供；`raw/`、main既有修改/删除与用户文件保持。业务变更仅在Kanata，HEAD仍ddd3f10，尚未普通提交、推送或发布；本轮没有获得新的远端推送授权，旧云端交接推送已完成。

入口：[结构化本轮摘要](qa/kanata-continuous/p7/verification-summary-20261102.json)、[完整变更文件清单及业务源SHA256](qa/kanata-continuous/p7/changed-files-20261102.json)、[凭据扫描](qa/kanata-continuous/p7/credential-scan-20261102.json)。扫描仅在内存比对用户此前授权的外部Key（UTF8/UTF16LE）及有边界的token模式，未打印或保存Key；本轮0匹配，全部新增模型调用均为受控provider，不是新真实模型质量验收。实际命令为`node docs/qa/kanata-continuous/p7/summarize-20261102.mjs`，可选外部文件路径由进程环境传入，不保存于配置或源码。
