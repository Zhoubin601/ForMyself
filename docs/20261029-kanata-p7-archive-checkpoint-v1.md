# P7 历史分页增量检查点（阶段未放行）

分支 Kanata，工作树 `.worktrees/kanata`；HEAD 62a2b75（已完成 P6），远端 P5 be9ebc3。P7 的修改尚未提交或推送；main 的用户改动、删除项和未跟踪资料均保留。用户明确允许使用 raw 快捷方式指向的隔离模拟器，不以没有真机作为阻塞理由。

## 实际实现

实现[加密历史格式](20261029-kanata-p7-archive-format-v1.md)：真实不可变加密页、头内索引、按磁盘页检索/分页、世界和会话校验、过期游标拒绝、引用连通组件保留、历史原文重新激活后使用原修订/审计规则、页面释放。每页最多50条，整理默认保留最近200条及外部引用来源。超过1000条的可移植恢复直接写验证后的页再提交头，避免先生成巨型单体文件；仍走实际恢复协调器，旧主和备不提前删除。

完整备份异步准备正文后继续输出自包含 v13 / 单项 v1，不能导出裸磁盘引用；同步 capture 仍在实际协调器中进行。逐页改密先验证新页和新主/备，再清理严格限定的本功能旧页与中断遗留页；清理失败不得成功，原主密码事务可逆序补偿。普通恢复不删除旧页，较多反复恢复的磁盘回收仍需继续核对。

大字符串 AES/SHA 采用分块内存处理，盐/派生/AES-CBC/PKCS7/OpenSSL Base64 密文字节协议不变。固定合成盐逐字节比对旧 CryptoJS、互读、UTF8边界、错密/坏填充等已测试。恢复日志仍原 AES-GCM/PBKDF2 协议，只替换相同 SHA256 的增量计算；没有降级或绕过日志。

## 已执行的证据

目录 `docs/qa/kanata-continuous/p7/`；旧失败日志均保留，不将未执行项写为通过。

- `check-archive-packed-candidate.txt`：完整 `npm run check` 退出0，Node **518/518**、组件/集成 **335/335（39文件）**，strict/build通过。此后又优化了相同索引的分配和相同 AES 编码的 Base64 内存；最新这两处已分别跑 `archive-index-allocation.txt`（11/11）及 `aes-native-base64.txt`（4/4），**需要最终再次完整check和重建**。
- `android-build-archive.txt`：JDK21/API34，实际 JVM单测、debug、androidTest构建成功；不是原生 instrumentation 已执行的声明。
- APK **7adb72acd4863808a04bcd375c7b48c22fa976c13b2fef6d24b19d3a702e83c2**，79个资源 SHA匹配、无 QA入口。它包含恢复直接分片，但尚不含随后两处等价性能优化。
- `web-archive-results.json`：生产 preview4174，新隔离Chrome context，7项真实场景、6组屏幕/字号布局通过；归档、实际磁盘页/字节、检索、跨世界拒绝、过期游标、历史修订/审计、真实完整恢复协调器、冷重开；600条合成消息，无模型请求/页面错误。
- `native-validation-upgrade-results.json`：上述生产APK覆盖升级本任务合成安装，原P6两世界/八消息/七用量保留；非法来源版本原子拒绝、真实保存/flush、后台释放通过。第一次 ADB 驱动失败；发现任务模拟器/ADB已停止，严格核对原 isolation marker 后重启**同一个磁盘**，没有wipe/clear/uninstall，等待冷启动稳定后实际重跑通过。
- `native-archive-results.json`：同一APK真实Android **8项通过**。在原P6合成图上新增600条测试消息及1条有源L3，分页/检索/历史修订/实际全备恢复、后台卸载、force-stop后冷读608消息与审计通过；0模型请求/0pageErrors。完整恢复后图为未分片v1，因此**还需专门验证分片v2冷载与Android实际改密**，不能用这个结果冒充。

## 容量：仍是 No-Go

`benchmark-archive.mjs` 使用真实 Store/仓库/原密码协议、独立任务临时目录及分阶段新 Node 进程，未强制GC，不碰真实资料。`node-archive-before-memory.json`、`node-archive-before-packed-import.json`保留早期测量。最新 `node-archive-results.json` 的真实样本（Node，不是Android/Web）如下；不以这一表通过设备门禁：

| 数量 | 冷Store读ms | 真磁盘50条ms | 索引查询ms | 逐页改密ms | 可移植导入全过程峰值MiB | 备份展开/Store恢复全过程峰值MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1k | 197.9 | 43.0 | 12.3 | 1584.2 | 116.3 | 147.3 |
| 10k | 994.0 | 64.3 | 95.4 | 12845.1 | 260.0 | 279.2 |
| 100k | 5071.6 | 56.3 | 126.4 | 124784.2 | 736.0 | 638.9 |

100k冷读/保存阶段全过程峰值395.0MiB，逐页改密全过程459.2MiB。100k备份展开32708.8ms，Store恢复72940.3ms，但这仍**不是完整恢复协调器/加密日志的大图测量**。100k导入及恢复峰值偏高、Node改密超过预先冻结120秒参考值；必须继续优化/实测，不能改阈值掩盖。磁盘分页已实现，不再沿用旧检查点“完全没有分页”的状态；但P7整体仍未通过。

## 两轮增量自查与修复

第一轮：路径拒绝被IO catch误报，改为I/O前验证；归档未来版本不能从旧备降级，补明确拒绝及零写测试；可选坏行被前置归档校验抛TypeError，改为保留原领域校验；清理中断遗留旧密页，改为主/备验证后限定命名空间回收并补改密补偿；未展开的备份/恢复日志输入必须拒绝，避免遗漏正文。真实跨参与者失败测试使用实际存储键注入，验证journal与其他模块补偿，未绕过协调器。

第二轮：发现备份展开把旧消息接在末尾会污染最近上下文，改为稳定时间/ID排序；临时备份快照导出消费后清理；查询改变时清结果/游标，卸载与后台丢弃迟到正文；历史源先整页激活再修订，保持稳定ID/revision并停用派生回复；已归档世界的整理权限补Store层校验；备份页面旧温馨小家描述更新为彼方及旧全备丢弃聊天规则。真实Web字体/横竖屏及Android截图已核对。

## 接续顺序

1. 保留当前工作区。读取本检查点、格式设计、实际源码与最新日志，不重新P0。
2. 最终完整check、生产重建/资源校验；在任务合成安装继续 v2 头冷读、实际主密码事务、原生instrumentation（历史为8通过+1明确跳过）验证。设备为 emulator-5580 / KanataP2Synthetic34，marker在`.kanata-device.local/isolation.json`；本轮已重启原磁盘，不用NewRun覆盖它。启动工具必须 Hidden，禁止clear/wipe或删除AVD锁文件凑通过。
3. 做生产Web/Android的1k/10k/100k实际完整导出/协调器恢复/改密与内存测量，特别核对恢复日志全图峰值。Node不能替代。preview4174当前使用dist，测量期间重建会使旧chunk失效，宜固定任务专用dist副本再测。
4. 继续关闭[原始需求覆盖P6](20261029-kanata-requirements-through-p6-v1.md)保留的群聊人数/条数配置、逐气泡/立即全部、活动驱动等待、更丰富自主情绪关系、生活模块新角色接入和全局用量页面/趋势等差距；不能以P1–P6阶段通过声称这些全部完成。
5. 最终两轮综合自查、15场景逐项覆盖、旧备份/权限/版权/真实Key零泄漏扫描和文件清单；全部强制门禁通过才做P7检查点提交。没有推送/PR/发布授权，不自行扩展。

本文件是可接续开发检查点，不是最终成品或P7通过报告。


## 后续覆盖更新：压缩日志与大图实测（2026-10-29）

上文“只实现页、尚待Android改密”已由本节覆盖，阶段仍No-Go。

- APK `4323e736a927b706555da878c8aaed7e69bb35f63e386e0dc04d09058fd4ba29` 实跑v2分片冷载、主密码真实设置UI事务、新密码读取/旧密码拒绝、旧/孤儿页只保留当前引用、恢复原合成凭据，共5项通过。native-archive-security-before-codec.json保留该结果。
- 原生instrumentation实际 `android-instrumentation.txt`：8个 STATUS_CODE 0，1个 TodoWidgetHarness Assume 跳过，无失败；不能把 OK(9 tests) 写9通过。
- 新增[大型日志设计](20261029-kanata-p7-restore-payload-codec-v1.md)、restorePayloadCodec.js/types：仅加密内部JSON载荷使用gzip包装version2，外层仍原AES-GCM/PBKDF2/version1。256KiB以下保持原载荷，解压后256MiB上限；流式JSON/UTF8、认证后解压、长度/坏gzip/未知格式/错密/篡改/真实编码超限均有测试。没有改变密码协议、协调器、完整备份v13或旧日志读取，也没有明文降级。
- 完整check最新两次：`check-restore-payload-candidate.txt` 与 `check-bulk-validation.txt` 均退出0，**526 Node/340组件（39文件）**，strict/build通过。新增能力缺失的真实设置导入测试确认不误报密码错误、不覆盖原数据；历史坏页现在在管理页显示并禁用编辑。
- 已减少私有备份图重复复制：assertKanataJson/assertKanataData仅用于校验，未知外部输入与Store写入仍用detached clone；备份快照消费后移交独立所有权；participant.detachedExport只在真实chat导出中启用并有别名/默认JSON行为测试。protectedAccess的串行尾只保留settlement，不持有完整导出的明文结果。
- 实际生产APK `8526a836ae969705c9c32d0cb5070d23fff26f0576deddf0b48f443726ffc641`，79资源SHA一致/无QA。`native-archive-security-results.json` 已在它上面通过**6项**，含上述5项及真实完整备份/恢复中压缩载荷的608条原文与审计无损；可移植JSON 357124字节，确实超过压缩阈值，0模型/0pageError。环境能力探测 `native-codec-capabilities.json` 为真实 CompressionStream/DecompressionStream/ReadableStream 可用，不用模拟zip冒充。
- **8526这份APK尚不含后续bulk descriptors及两个void校验改assert的最新性能改动**；这些已完整check526/340，但需再sync/build/资源核对。当前dist是更新后的版本，不要用它的chunk文件名去驱动旧APK。

### Web真正全流程结果与失败保留

`verify-capacity-web.mjs` 使用不可变生产dist、新Chrome私有context、实际受保护操作租约/完整恢复协调器/真实密码设置UI，记录Windows renderer PeakWorkingSet64（进程RSS对应指标）、JS堆点值和每次实际磁盘页/字节，不强制GC。先前驱动把恢复和再次导出校验算在同一项且缺租约，已修正为分开计时并180秒明确超时；旧失败保存before-lease/before-owned/before-codec文件，绝不冒充通过。

最新不可变生产Web是 `.kanata-web-dist.local/p7-archive-codec`，preview4177，和APK8526资源一致。结果 `web-capacity-1000.json /10000.json /100000.json` 及 `web-capacity-codec-*.txt`：

| 数量 | 冷重开含认证ms | 真磁盘50条ms | 索引ms | 实际全导出ms | 实际全恢复ms | 真正主密码UI事务ms | 全过程renderer峰值MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1k | 412 | 9 | 7 | 116 | 524 | 945 | 257 |
| 10k | 717 | 17 | 21 | 1275 | 5451 | 5299 | 358 |
| 100k | 2566 | 24 | 46 | 12357 | 51718 | 52618 | 1140 |

100k时间已完成，所有原文逐项与恢复前比较，L3来源/新密码可读及旧密码拒绝通过；**内存1140MiB高于768MiB，整体FAIL_MEMORY_GATE，P7不能放行**。压缩前100k导入约2033MiB且恢复超180秒，并非把旧失败删除了。新方案初次导入峰值约650MiB，冷重开累计峰值816MiB，完整恢复累计1043MiB、随后原文核对累计1140MiB；不能把初次导入的较低值冒充整个流程峰值。

### 当前下一步

1. 再测最新bulk/void校验改动，或继续减少恢复镜像不必要副本；不改阈值。两个只校验的参与者旧代码曾创建并丢弃全图副本，现改为同样完整校验但不复制，Store真正接收时仍私有复制。
2. **Android 1k/10k/100k容量驱动尚未实现/执行**。现有6项只有608消息的安全与兼容验证，不能替代容量。现有任务AVD为warm、原隔离marker有效、原合成凭据已恢复；不要clear/wipe用户数据。可使用实际恢复协调器替换合成容量图，先保留608合成快照；或者受控创建新任务AVD并保留现有磁盘。峰值必须同时识别应用主进程与WebView renderer，不能只测Java层；有缺失须如实记录，不将采样PSS当峰值。
3. 引用保留仍为保守第一版：所有外部来源的完整对话组件继续留在活跃图。如果长期L2来源覆盖全部历史，不能据20条L3稀疏来源的容量样本声称所有场景都不会全量入内存；需继续审视元数据来源证明/异步原文溯源设计，不能删除记忆或伪造空原文来凑容量。
4. 群聊人数/条数配置、气泡队列/立即全部、活动驱动等待、更丰富自主情绪关系、旧生活模块新角色接入/全应用用量等原始需求差距仍未在本轮补完。
5. 正式P7总矩阵、最终两轮综合自查/文件清单/凭据扫描、最终原生/大图与完整check仍需完成；P7无提交/推送。

当前后台工具仅preview服务：4173开发、4174当前dist、4175旧冻结archive-optimized、4176旧冻结archive-owned、4177冻结archive-codec。容量工作进程均已退出；一次超时只停止了严格核对父子关系的本任务Node/隔离Chrome，没有停止其他Chrome或模拟器。继续改源码不会影响冻结4177，但重建dist后不要把新chunk名字用于未升级APK。


## 2026-10-30 接续：实际Android容量与canonical复用

基线HEAD仍62a2b75，业务只在Kanata，未提交/推送P7。用户继续授权开发，设备范围沿用已确认隔离模拟器。raw和main既有修改未改动。

1. 最新bulk/void校验生产Web100k完整结束，恢复/改密/原文与20来源均核对，峰值1083.84MiB，仍超768MiB。P7继续No-Go；没有提高阈值。
2. 新增native-capacity-support.mjs/verify-capacity-native.mjs，通过真实产品协调器、原生Files/Preferences、安全凭据和设置改密UI运行样本。先核验已有608条合成图并把其完整备份加密保存为native-before-capacity.enc，读回校验后才替换；不wipe、不重建AVD、不卸载、不删真实旧数据。启动未完成时run-as失败和初版过严ID前缀检查失败均在任何写入前停止，证据保留在before-fixture-guard.json；修正为检查原608图、600个p7-history ID及26号revision2，或严格capacity ID。
3. f530916f00e123175000ee67fa574f77e41e8d939279aa024ed9b9625c5f2fb8（bulk候选）实际Android1k结束：导入5591ms，完整App冷启动/解锁11112ms，50条磁盘页113ms，索引33ms，保存780ms，全导出761ms，完整恢复4861ms，原文/20来源核对199ms，实际改密15269ms，改回合成原凭据11192ms。逐进程最高222.38MiB，小于512MiB，0AI/0pageerror。此轮同时有主机自动测试负载，时间仅实测；没有单独protected冷读计数，不能拿完整App时间代替仓库指标。已补真实performance measure，下轮重测。
4. 减少实际恢复流程的重复canonical拷贝：私有已校验工厂输出深冻结，闭包WeakSet限定身份；所有外部/恢复输入继续全校验、公开调用每次重新parse，Store修改继续独立clone；通用协调器及日志协议保持。新增2项负向行为测试：等待prepare时修改公开输入不改变目标，参与者不能改冻结图；再次公开调用篡改过的同一个对象仍在零写入前拒绝。
5. 定向实际协调器/产品故障测试33/33通过；npm run check退出0：526 Node、342 Vitest/39文件、lint/strict/build通过，日志check-immutable-canonical.txt。新Android构建成功且79生产资源逐一匹配，QA入口不存在，APK c0ea0cecd5590e9ef58bf0cff56c243becdca8e0a68daa120115c0c64099c2a9。生产Web不可变候选p7-archive-immutable/4179开始重新测100k，结果未定，不提前标通过。

仍需：最新候选Web及Android1k/10k/100k完整容量、最终原生安全/生命周期回归；保留全来源会使归档有限、原需求剩余PARTIAL、十五场景/总矩阵和最终两轮验收仍未全部完成。不将以上小样本或编译成功等同于P7完成。


## 2026-10-30 后续覆盖：批次I/O、气泡、UTF8及最新候选

### 已执行结果与失败保全

- `check-owned-metadata-bubbles.txt`退出0：529 Node/347 Vitest（39文件）；`check-batched-io.txt`退出0：532/347。新函数mapInBatches实际验证最大4并发、顺序、同步失败、当前批次全部settled后才抛错且不启动后批次。目录检查新增缺页/大小/类型/重复条目/拒绝读取/无size严格stat测试，Store冷读不载正文且只列目录一次。
- APK df5dda5f2282cad4548cf0a63eea91649adeea5acde43348b09c69c370407ead，79资源，正常生产无QA入口。真实Android10k全流程PASS：protected冷读3484.5ms、保存1999.1ms、50条磁盘页138.7ms、检索167ms、全导出7038.4ms、实际完整恢复26129.8ms、原文来源证明6759.6ms、实际改密39095.1ms、改回原合成凭据29220.5ms，最高单进程278.80MiB，0AI/0pageerror。完整App冷启动10202.7ms单列，不拿它替代Store冷读。此前c0候选10k冷读17900.8ms失败与其最终结果保存在按时间/status命名的history JSON；默认latest文件会更新，驱动现自动保留旧结果和每次最终结果。
- df候选生产Web100k所有时间门槛PASS，完整恢复56281ms/实际改密51273ms，但峰值1054.18MiB>768，结果FAIL_CAPACITY_GATE。时间通过不等于P7或内存通过。
- df候选Android100k诊断真实导入179947.8ms（active220/archive99780，saved），导入逐进程峰值485.82MiB；冷启动14700ms，其中protected冷读8292.1ms，冷启后逐进程最高355.59MiB。**仅这两阶段完成**：采样驱动在force-stop后的新进程停止旧Profiler时报错，后续项目NOT RUN。保留FAIL及CPU采样，不写成100k完成；已修复为冷启动不做跨进程Profiler。诊断选项扩大的是观察超时至600秒，120秒/512MiB验收门槛没有修改；带Profiler的通过也只能标诊断，仍须无采样完整复测。
- CPU诊断显示UTF8 parse、CryptoJS计算及GC占主要时间。新共享utf8Words使用TextEncoder+私有WordArray，保留EVP/MD5、盐、IV、AES-CBC/PKCS7和原SHA256字节；孤代理项仍与旧encoder一样抛URIError。自查发现旧增量解码器会丢开头BOM，现显式保留，加入固定盐逐字节及新旧双向测试。
- JSONclone改用逐项描述符检查和Object.fromEntries数据属性构造；仍不调用getter、toJSON或继承setter，__proto__作为普通字段。恢复载荷用显式有界容器栈替代每字段委托generator，原JSON顺序/转义/Unicode/深度/大小/压缩协议均不变。严格类型首轮entries推断never导致失败保留before-type-fix日志，补精确元组类型后重新完整check退出0（`check-iterative-utf8.txt`）：533 Node/347 Vitest、lint/strict/build通过。
- 最新APK **cf213dfbf15a689122e7431359956f29111456ac6d7466b055053e0a344972f7**，原生unit/build成功，79资源比对PASS，production QA入口不存在。Web冻结p7-archive-iterative/4181。最新大容量尚待实测，不能沿用df/c0的性能PASS。

### 两轮实质自查增量

1. 架构/安全/一致性：原生逐页stat导致10k冷读失败，改一次目录核验并保留逐页hash/解密/索引验证；并发失败不得有晚到任务，所有批次allSettled并新增负向测试；内部canonical深冻结+闭包身份与外部重新parse测试；UTF8兼容BOM/孤代理项缺陷修复，固定盐测试与真实产品补偿/恢复重新执行。没有删日志、改密码协议、放宽跨世界或绕过协调器。
2. 需求/UX/隔离：补原始4.3分次气泡、正在输入、立即全部；完整批次先保存，计时仅展示，不新增请求或修改revision。初次打开历史/激活旧页直接展示，来源变化停用、后台、减少动效及卸载清timer，单元4项新增通过。`verify-bubble-web.mjs`在375x812实际生产Chrome通过4项：原子保存4行但先展示2行、立即全部无额外请求、减少动效第二轮直接展示、重开历史直接展示、过期清空受保护View。仅2次受控provider请求、0真实模型、0pageerror；截图web-bubble-queue.png已实际目视核对，无新增横向溢出。首次E2E因达到8条触发自动记忆请求，保留失败；改测试的正常记忆策略为disabled来隔离UX场景，未修改产品自动整理行为。

### 后续接续约束

P7仍No-Go。当前模拟器由失败诊断留下100k合成归档，新增restore-native-capacity-baseline.mjs通过实际协调器读取此前加密608全备恢复（并核对全部原文/审计），不清数据、不删日志、不卸载。待其真实完成后，最新候选再依次测Android1k/10k/100k、Web100k及其余P7验收。原需求群配置、活动延迟、旧生活模块新角色/全应用统计等PARTIAL仍未全部实现，不能因本轮气泡或10k PASS宣称P7完成。


## 最新覆盖：2026-10-30 11:50（不得沿用上段候选状态）

最终当前业务候选APK **98a1e79afd40e33f3f3a2b850793315a0c26757d11538217357f7ac9b52788af**，79生产资源精确匹配/无QA入口。基线HEAD仍62a2b75，P7没有提交或推送；git fetch origin Kanata成功，远端仍be9ebc3，无新增远端提交，main既有17/16/10/21行文档修改和APK删除保持不变。

- `check-immutable-image.txt`及`check-reused-descriptor.txt`完整退出0：536 Node、348 Vitest/39文件，lint/strict/build通过；Android unit/build成功（未改Java，Gradle部分任务缓存），尚需最终实际instrumentation重跑。冻结Web **p7-archive-descriptor/4183**，前一冻结p7-archive-image/4182保留。
- 新增内部不可变图工厂和Store结构复用，仅复用递归冻结、全部引用验证过并登记私有身份的后代。未知外部、浅冻结或伪造trusted字段仍clone；后续普通编辑保持可用且不能改回滚目标。3项领域+1项真实Store回归通过。fromEntries组合候选未显示内存收益，已撤回；最终clone只复用私有输出描述符，保持所有输入描述符/JSON/原型安全检查。
- 修正测量驱动：fixture生成不和长寿命租约闭包共享完整图；实际完整恢复后释放不再需要的导入备份，通过已保存小型身份/时间模板逐行重建全部原文并核对20条记忆来源。不是省略原文证明或强制GC。Web每个样本用独立标记profile，冷启真正重启Chrome进程并从同一加密存储加载；旧page.reload结果仍保留，不混作冷启动。
- e13前一候选Android1k全流程PASS，逐进程峰值251.30MiB；从原100k资料通过最新产品协调器恢复608基线PASS，全部原文/审计保留、0AI/0错误、保存无pending，见native-capacity-baseline-restored.json。
- **98当前候选Android1k PASS**：导入2215ms，protected冷读见原JSON（完整App冷启5563ms单列），磁盘页49ms、检索21.6ms、保存381.8ms、全导出387.4ms、完整恢复1862.5ms、原文来源72.9ms、实际改密3237.6ms，峰值251.85MiB，改回合成凭据及旧密码拒绝验证通过。
- **98当前候选Android10k PASS**：导入9844.8ms，完整App冷启4873.2ms，页87.1ms/检索88.4ms/保存1233.8ms，全导出3441.7ms，恢复12778.4ms，原文来源3325.2ms，实际改密17770.1ms，峰值247.79MiB。精确protected冷读、所有时间门槛和分进程HWM在native-capacity-10000.json；全程0AI/0pageerror。
- **98当前Web100k FAIL_CAPACITY_GATE**：导入23702ms、完整恢复31421ms，全部时间门槛PASS、每条原文/20记忆来源和实际改密核对通过，但峰值1135.34MiB>768MiB。前一e13候选1055.82MiB也失败，不能以耗时改善替代内存。
- **98当前Android100k RUNNING**，无Profiler。正在本轮exec session81569的顺序三档驱动最后一档，单操作观察超时600s，判定仍120s/512MiB。当前手机数据可能是导入/恢复中；不得直接清数据、删恢复记录、重装空盘或并行驱动UI。先看native-capacity-100000.json.activeOperation与native-capacity-descriptor-100000.txt，等真实结果，再进行instrumentation/下一步。未完成阶段写NOT RUN，不能把早前诊断的179.9s导入/冷读8.3s当整套完成。

P7仍No-Go，当前新增复制路径改善耗时但未解决Web内存，尚有密集来源无法充分归档及P6覆盖表列出的原需求PARTIAL。气泡Web4项已实跑，通过受控2请求，不是假装真实模型评估。原始全需求十五场景最新完整E2E、最终设备原生回归、全应用统计/生活模块新角色/群配置等继续待收口。用户持续要求继续，检查点不代表用户请求暂停。


## 2026-10-30 最终本轮覆盖（100k不再是RUNNING）

98a1e79候选三档Android和Web全部执行结束，汇总与十五场景边界见[本轮进度报告](20261030-kanata-p7-verification-progress-v1.md)、[结构化结果](qa/kanata-continuous/p7/verification-summary-latest.json)。Node536/组件348，最新原生8PASS/1Assume跳过/0FAIL；生产气泡4项亦在同一新Web冻结候选再跑PASS。

- Web1k和10k PASS；100k功能/原文/来源/改密全完成、时间全部PASS、峰值1135.34MiB FAIL。
- Android1k/10k PASS；100k导入85.66s、protected冷载6.13s、50页198.8ms、查询298ms、保存7.36s、全导出34.08s、完整协调器恢复113.48s、全部原文与20记忆来源校验34.25s；实际改密175.68s、改回原合成凭据149.81s，峰值624.60MiB。两个容量门槛FAIL，0模型/0页面错误，无OOM，但不能据此当512MiB/120s通过。
- foreach批驱动退出0表示记录了三档结果，**不代表100k通过**；100k独立驱动报告FAIL_CAPACITY_GATE且非零。未通过项目仍No-Go，没有提交/推送P7。
- 当前模拟器已用实际协调器恢复原608合成全备，重新全量比较七数据模块、全局设置及备份metadata；唯Todo全局CAS信封revision按既有规范3→20，内容完全一致。原合成凭据已冷载验证，真实进入后台明文清空PASS。不存在仍在执行的测试/恢复任务，设备在后台。native-before-capacity.enc只含原隔离合成资料，未读真实用户备份。
- 最新小样本CLI、Web/Android完整容量、基线归还、原生instrumentation及辅助脚本都已真正执行；没有跳过关键测试宣称P7完成。旧Profiler错误/类型失败/测试隔离及Todo信封错误均保留原始失败文件，修正后相关测试已重新跑。

下一步仍是实际开发：Web/Android100k内存、Android改密性能、密集记忆来源归档、群限额/活动驱动延迟/旧生活模块角色链/全应用统计及完整十五场景最新产品重演。多轮对象复制小优化未达内存门槛，不应继续只调阈值或隐藏失败。若评估分段备份/恢复、移出整图canonical等方案，必须先重新明确持久化/恢复版本、旧页生命周期/保全与故障矩阵；当前规范仍禁止把裸页引用当自包含备份/恢复日志，不能直接绕过协调器或删旧回滚材料。未实施这类新设计。

保留当前冻结预览p7-archive-descriptor/4183；本轮4179–4182旧预览进程已核实工作树路径后关闭，冻结目录仍保留。需要重放其他候选时自行按其目录/端口启动，无需重建或清数据。无子Agent、无新增常驻Python服务，无真实设备清理。用户持续要求继续；本记录用于安全接续，不构成阶段验收或用户暂停请求。

## 2026-10-30 最新功能候选覆盖（群聊/活动等待）

最新cc8af561e549278f3c0af97831188538b47d6e5ed819d1d6df57862209274009 / 78匹配资源，无QA入口；HEAD62a2b75、P7未提交/推送。新增世界内选成员建群、单群角色/AI条数限制、活动等待/立即回复，详见[原始需求增量](20261030-kanata-requirements-p7-increment-v1.md)。前一3afedbb仅群聊9项/f1ed92仅群限6项，都保留，当前最终13项包括回归群聊9项+活动4项。

最终完整check-activity-timing.txt退出0：548 Node/375组件40文件、lint/strict/build；Java unit/APK/androidTest构建成功，最新instrumentation实际8通过1 TodoWidgetHarness Assume跳过0失败（解析status，非9通过）。生产Web冻结p7-activity-timing/4186及任务API34模拟器各13检查PASS，7次受控provider尝试含一次故意500，0真实模型/0pageerror。自然到期+冷启动任务由实际前台组合根续接，没有改时钟/直接执行器或强制GC；实际完整协调器还原任务暂停和完整正文/配置。独立verify-native-baseline最新PASS：608原合成消息/七模块/设置/metadata归还，唯Todo全局CAS按契约递增，实际Home清除受保护明文。当前无未完成测试/恢复，设备在后台。

第一轮修复：自主路径绕过group限制、失败待写群重复创建、旧配置返回保存、活动重复排队/立即回复旧pending未取消；真实协调器补偿/负向输入/保存门禁测试通过。第二轮修复：空格别名@、已删除回复显式重试、多群中首个限制1阻断另群、成本提示遗漏自动调用；新组成员只列当前世界，表单错误定位/取消/卸载、原文段落预算合并、前台轮询边界准确说明。Web375及Android截图目视核对。

中间失败原始日志保留：group-creation-domain-before-archived-fixture、check-custom-groups-before-cost-copy-assertion、activity-timing-domain-before-backup-shape、check-activity-timing-before-message-fixture，以及此前group限制夹具/key/同步异常/类型失败。不删除失败/放宽strict来验收。详细变更文件由pending-file-manifest列出并SHA核对。

P7继续No-Go：98容量候选100k Web1135.34MiB、Android624.60MiB和改密175.68s超冻结门槛；新cc功能候选尚未重跑三档，不能使用旧1k/10k作其当前证据。密集来源活跃图、旧生活提醒新角色链、全应用统计/趋势、高级自主情绪关系及最新十五场景综合仍待开发/验收。下一步优先实际处理这些剩余项，而非再补重复计划或因无真机/Key停工。原用户持续要求继续，本检查点不是请求暂停。

预览p7-archive-descriptor/4183、group-limits/4184、custom-groups/4185、activity-timing/4186为隔离冻结构建；不代表发布包。原main文档修改/旧APK删除及其余未跟踪用户资料保持，不改raw/真实设备、无常驻Python。未发布、未合并main；仅完成并验收阶段才作普通检查点提交。

## 2026-10-31 用户要求推送并转云端：最终覆盖

本地已结束测试/恢复，交接见[云端交接](20261031-kanata-cloud-handoff-v1.md)与[当日最终记录](20261031-kanata-p7-performance-checkpoint-v1.md)。P7 WIP，用户明确授权本次普通提交/推送，未放行P7。当前941/78资源，完整check565/382，原生8PASS/1SKIP，生产两端各13PASS。两端1k/10k PASS；Android100k内存501.7MiB通过但第二次真实改密148.1s失败，Web100k内存834.9MiB失败。初版漏判PASS已保留并校正；完整结果在verification-summary-latest.json，不沿用上段旧98或30日计数。原608及模块数据已归还/严格跨日自动补记另列/后台明文清空。后续在云端继续余项，不在本地并行开发。
