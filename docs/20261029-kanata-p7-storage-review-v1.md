# P7 容量检查点与分页兼容设计评审

2026-10-29；前置P1–P6已通过，最新本地P6 62a2b755a622a181f6d530525e15ad070dd33b9f，远端P5 be9ebc3。用户允许raw所指模拟器验收，缺少真机不作为本轮阻塞。本文件是实际容量诊断后的源码评审，不是重新做P0或已迁移存储的声明。

## 已执行的代码与测量

已新增并实际运行`docs/qa/kanata-continuous/p7/benchmark-repository.mjs`。按预先冻结的[容量口径](20261029-kanata-p7-capacity-contract-v1.md)，独立Node进程/任务临时目录，真实生产createKanataRepository、原CryptoJS AES协议、真实磁盘主/tmp/bak与合成恢复journal；20条有来源L3、交替user/assistant且保留回复引用，无AI、真实Key或私人资料。

对每档测保存、冷仓库读、内存slice（明确不是分页）、线性查询（明确不是索引）、备份适配器构建/读取（不是产品恢复协调器）、改密/新密码读和旧密码拒绝。OS资源高水位为进程RSS，不冒充Android或JS堆。真实结果为`qa/kanata-continuous/p7/node-capacity-results.json`和node-capacity-run.txt；不能把运行中缺失样本写成通过。合成密文与journal保留在每档唯一临时目录，不覆盖其他资料。

## 实际源码缺口

1. `kanataRepository.read/write/reencrypt`只接受/返回整张KanataData；读取、校验、JSON字符串、AES WordArray/密文和主/备读回产生多份全图。
2. `kanataStore.load`将完整图放shallowRef，update先clone/validate全图再mutator，之后再clone/validate、commitDraft、repository.write又校验。UI `.slice(-100)`仅限制显示，不能降低入内存历史或磁盘读取。
3. `KanataMemoryPanel.sourceText`同步从snapshot.messages/messageAudits查来源正文；事件/记忆/任务/回复校验依赖稳定源ID/revision。直接只加载50条会制造孤儿引用或误认空历史，禁止这样“分页”。
4. `buildKanataChatBackupSnapshot`、fullBackupRuntime及恢复协调器基于完整图；单独增加外部历史文件而不改导出、回滚和改密会漏数据。不得把外部文件留给用户自行找回，或绕过协调器apply。

因此当前P7容量/真分页为 **IN PROGRESS / No-Go**，不是编译错误、设备缺失或等待用户再授权。尚未迁移任何数据库、数据格式、加密协议或真实资料。

## 下一批实现的安全约束

分页方案必须与现有源码一起审查/测试，不能直接把新的“历史Store”当第二份独立真值：

- 保留现有加密协议和protected chat主密码/操作租约。可评估按会话的不可变加密页与加密索引，优先使用现有Filesystem；先设计并测试，不凭旧文档假定已有SQLite/分页接口。
- 显式归档只移动不再被外部活跃记忆/事件/任务/审计/回复引用的完整对话组件；保留来源稳定ID/revision，不能用空正文伪装删除。保留的当前上下文、记忆来源与待发任务必须照常验证。正文的分页/检索应走异步受保护门面，页缓存过期/后台必须释放。
- 分片写入先写新页、读回校验，再提交唯一索引/主图引用；中断前旧主/备保留，没有验证前不得删除旧副本。失败保留pending并阻断新写，补偿失败进既有恢复门禁。所有新增文件/key/format必须进入架构说明和异常测试。
- 归档页必须进入完整备份/恢复/回滚捕获和主密码重加密；v1–v13现有文件继续兼容，若新增文件格式需同时更新participant/设置解析认证映射/DTO/负向样例，不能简单增加版本号交给旧normalizer。完整恢复仍用产品实际协调器。
- 真分页的验收须记录每次实际磁盘页/字节，只返回所请求页面，未请求正文不进入前端；独立统计索引查询与线性扫描。归档跨世界拒绝、坏页/错密钥/未知版本/丢页/索引冲突/取消/恢复/改密故障均不可空覆盖。
- 先Node可注入仓库故障测试，再真实Store与UI、完整check、生产Web及隔离Android同尺寸测量。原始单体JSON继续读，未经成功转换与验证不切换；不使用永久删除或手改node_modules。

目前以上为下一批约束和可评估方案，**未实现分页适配器或启用归档**。不能用本文件证明已满足原始5.3或P7门禁2。

## 本轮实际修复及重测结果

首轮100k工作进程在240秒技术超时内未完成，保留node-capacity-before-index.json/txt。源码自查定位`validateKanataExperience`逐条replyToRevision都在messages数组find源消息，造成平方级扫描。已在真实源码建立一次消息ID索引，复用原始未来版本/不存在来源拒绝条件，没有省略校验或放宽类型。

新增`tests/kanataCapacityValidation.test.js`：5000条来源证明的有界线性元素读取预算（非易抖动墙钟测试），以及未知/未来源版本仍拒绝。与P5领域用例合跑35通过；完整`npm run check`退出0，Node503/503、组件317/317（37文件）、strict/build通过，lint0错误42警告。源代码只有索引优化，数据格式/数据库/加密不变。

优化后重新实际运行三档独立进程，均完成；以下是Node真实磁盘诊断，不是Android/Web验收：

| 消息数 | 保存ms | 冷仓库读ms | 改密ms | 全过程进程峰值RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| 1k | 105.3 | 79.1 | 103.0 | 182.6 |
| 10k | 759.2 | 649.7 | 787.8 | 896.7 |
| 100k | 15268.8 | 16139.8 | 19976.6 | 4092.0 |

三档改密后新密码可读取且旧密码拒绝。100k密文94858924字节。峰值包含本基准完整备份适配器和恢复图等同时持有的对象，不能当作单独一次冷读JS堆峰值；它确实显示整图复制开销，不能用切最后50条掩盖。100k计时有改善，但内存风险和无真正分页并未解决，结果明确MEASURED_NOT_ACCEPTED、P7 No-Go。

修改后的生产APK重新构建/逐资源SHA校验，并覆盖升级本任务合成安装；`verify-validation-upgrade.mjs`实际验证P6两个世界/八消息/七次用量保留、未来源revision原子拒绝且图不变、真实保存/flush、后台释放，0模型请求/0pageErrors。新包SHA `6bc8f5f1a9a489acf95b9411e122b798400e245ced224e214c60d5d1b8b7022f`。这是小图安全回归，不冒称Android100k或整个P7通过。

原生/Node证据在同一p7目录。P7当前仍IN PROGRESS/No-Go，不因已修复一个瓶颈标完成；本次设备目标已由用户明确接受模拟器，不能再以“没有真机”代替解释尚未实现的分页/归档。

## 其余原始需求收口

除容量之外，[P6增量](20261029-kanata-requirements-through-p6-v1.md)已明确保留：可配置群聊参与/条数、逐气泡展示/立即全部、更丰富的活动驱动延迟、旧通用生活提醒的新角色集成、全应用AI统计等尚有限。P7必须逐条实现或如实记录未完成；不得把P1–P6阶段放行等同全部原始需求完成。当前没有最终发布、合并main或真实数据清理。
