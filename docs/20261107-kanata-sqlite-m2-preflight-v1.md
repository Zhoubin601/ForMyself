# Kanata SQLite M2 Preflight v1

执行日期：2026-11-09（Asia/Shanghai）。依据：[完整任务书](20261107-kanata-sqlite-m2-task-v1.md)。本页是预检记录，不是实现验收。

## Git 与来源

初始本地分支 `work`，HEAD `41cbb66053bd5b9995b358c0c4846669e626bcc0`，无修改/删除/未跟踪文件。远端只配置 main 的 fetch refspec，`git fetch origin M` 仅写 FETCH_HEAD，不能据此误认为 origin/M 已更新。补执行 `git fetch origin refs/heads/M:refs/remotes/origin/M`，并用 `git ls-remote origin refs/heads/M` 独立核对远端 HEAD `de3164b8de569f57a250d0592eae5a21345e5264`。以该提交创建 M，未改 main/Kanata/work，未 reset/clean。

已阅读根 AGENTS、开发说明、总计划、M0 direct gate、M1 v2、M1-R 审计与 QA README/机器汇总及 M2 全文；已核对任务书列明源码、Android 注册、Gradle、根 package/lock。来源文件 SHA 见 [sources](qa/kanata-sqlite-m2/evidence/preflight-sources.json)。本轮没有读取 raw 私人资料、旧聊天文件或真实备份；合成测试沿用仓库公开夹具。

## 依赖差异与环境

| 项 | 根项目实际 | M0 QA 冻结 | 决策 |
|---|---|---|---|
| Capacitor core/android/cli | lock 均 8.4.1（package range 为 ^8.3.1） | 8.4.1 | 不升级根依赖 |
| SQLCipher | 生产未接入 | Android Community 4.17.0 | Driver 阶段显式增加 4.17.0 原生依赖，禁止社区 secret API |
| AGP / Gradle | 8.13.0 / 8.14.3-all | QA 工程另行核验 | 不升级；JDK21 |
| SDK | compile/target36、min24 | 验收设备 API34 | 保留根配置 |
| Node/Java Runtime | 24.19.0 / OpenJDK21.0.12.1，后实证初始只有JRE、缺javac | M0 Temurin21.0.9+10 | 官方SHA验证后在work/m2补Temurin21.0.9+10 JDK；不升级根配置 |
| Android 运行条件 | 初始无 SDK/ADB/AVD，无 /dev/kvm | 历史 Windows WHPX 与 Linux TCG | 官方下载到 work/m2；全新 API34 合成 AVD，先核验 WebView 能运行 |
| 主机 SQLCipher | 初始未安装 | 历史4.12.0 | 隔离 venv 后实测，不能冒充 Android4.17 |

`npm ci` 已启动，postinstall 必须真实成功才允许后续构建。无 KVM 不直接判阻塞；历史 M1 原生可用 TCG，但 M0 Linux WebView 曾崩溃，必须本轮实测，不把旧失败当本轮证据。网络仅沿环境既有 proxy/CA，官方 SDK/镜像校验和核对后使用。没有修改环境安全配置。

## 当前调用链与全量消息依赖

完整搜索证据见 [call sites](qa/kanata-sqlite-m2/evidence/message-call-sites.txt)。

| 调用点 | 当前行为 | M2 注入路径/后续责任 |
|---|---|---|
| protectedModules chat → KanataStore.load | 从加密 JSON/恢复副本读整图，检查归档描述，成功后才 ready | 保留生产路径；SQLite 候选通过显式组合根注入及 chat operation lease |
| ConversationView | snapshot.messages filter + slice(-100)，bubble reveal 消费窗口 | Repository 最近页/更早页；上限100；代际取消、滚动锚点、按 ID 引用 |
| HistoryPanel → readHistory/activateHistoryMessage | 加密页检索；修订前激活整页 | SQLite 分支按 scope keyset/get，legacy 保持；禁止导入/清理旧页 |
| ChatTimeline | 是旧小家组件，未被 KanataConversationView 使用 | 不为 M2 改旧小家业务，不将其误当 Kanata 当前列表 |
| ChatRuntime.send | 全图找 retry/最新 user/已完成 speaker；update push 用户与整批气泡 | 有界目标消息/回复查询、单条/批次持久化；保留每 speaker 原子批次 |
| decideSpeakers / buildContext | 从 data.messages 选最近发言；知识权限通过消息来源回查 | 目标会话有界窗口 + 按 ID 的 provenance 校验，不缺失即放宽权限 |
| ExperienceRuntime / reviseKanataMessage | 全图编辑/删除，事件/记忆/任务联动 | M2 内部定向失效事务；不做 M3 通用 CRUD |
| DeferredRuntime | 基于任务源消息执行重试与延时；使用 ChatRuntime | 保留任务所有者及源 revision 检查；不能建立第二 canonical 消息数组 |
| Social/Contact/World/LifeCompanion/Management | 全图校验、消息/来源、任务/事件/统计更新 | 生产继续 legacy；候选仅注入支持的消息切片，不宣称这些 M3/M4 路径完成 |
| BackupRuntime/Store hydrateSnapshot/reencrypt | JSON+归档完整备份与改密 | M5/M6 实现前禁止生产 SQLite 激活，禁止双写或自动回退 |

## 安全与领域差异

1. 原 SchemaConnection.execute 返回 void；M2 业务接口必须独立返回 affectedRows，不能改变 M1 语义。001/002/003 原 DDL/checksum 不动。
2. 删除纯函数同时取消 pending/running 且源消息受影响的 background task（leaseUntil=0、SOURCE_REVISED）；任务书“至少包括”的清单不能被理解为可遗漏该行为。
3. 记忆可因 event 与 message 两条路径各增加一次 revision，必须与纯函数一致；不能合并 UPDATE 后假称语义相同。revoked event 本身不变，但 closure 中 effects 仍参与重算与实体 revision。
4. rebuildEffects 由 durable baseline 重新 fold 所有仍 committed 的同路径 effects，按 effectiveAt/recordedAt/eventID/effectID 原顺序；不能简单取反。
5. 审计精确 json_set 脱敏必须在当前 tombstone CAS 后、同事务完成；不得 JS stringify 历史快照。扩展字段保留。
6. 现有 protectedAccess.runOperation 全局串行，禁止嵌套租约死锁。sessionRevision 变化同步撤销新请求，已有事务完成/回滚后释放；每次原生调用仍检查前台与 lease。
7. 未加载、未知版本、错密、连接关闭失败均不能转为空库。M2 仅合成注入，不实现生产迁移、全局改密和恢复协议。

下一门禁：[技术设计](20261107-kanata-sqlite-m2-design-v1.md)。设计自审后才开始生产实现。Android 基础能力若实测失败，保留证据和阻塞，不用 JUnit/编译代替 JS-to-native。

补充调用链差异：当前 KanataConversationView 模板没有旧小家 ChatTimeline 的 quote 气泡/跳转控件；消息模型已有 replyToMessageId/replyToRevision。M2 应在候选 Kanata 窗口接入按ID查询与安全预览，不能通过修改旧小家来冒充当前切片。当前 kanataConversation 对手动发送明确拒绝 character 会话；M2 查询仍支持 character，不应顺带开放其手动发送权限。

原生环境补充：首次最小Capacitor探针构建真实失败为JRE缺JAVA_COMPILER，非源码缺陷；本轮已从Adoptium官方GitHub下载M0同版本Temurin21.0.9+10，核对官方SHA256后本地解包重试。原失败日志保留，不把java -version误当完整JDK存在的证据。
