# Kanata SQLite M6-02 一致性导出与 A/C 对照实验任务书 v1

- 任务编号：KANATA-M6-02-CONSISTENT-EXPORT-2026-11-23
- 日期：2026-11-23（北京时间）
- 仓库：Zhoubin601/ForMyself
- 执行分支：m6/encrypted-backup-recovery
- 独立工作树：.worktrees/kanata-m5（执行前必须核对实际路径、分支和状态）
- 代码基线：43b26d6ec41929a59844bb62a882bdf578391192
- 前置阶段：M6-00 CLOSED / PASS；M6-01 CLOSED / PASS
- 当前授权：用户已明确授权启动 M6-02，并制定本任务书
- 本任务状态：AUTHORIZED_TO_START；本文件只定义任务，不代表实现已完成或阶段已 PASS

## 1. 阶段目标

M6-02 的目标是在隔离合成 Android SQLCipher 环境中，证明 Kanata 数据能够从一致的数据库快照生成有界、加密、可跨设备验证的备份，并以同一逻辑数据集对照两条路线：

- **实验 A：SQLCipher 物理一致性快照。** 验证当前实际 SQLCipher Android 4.17.0 AAR / Native wrapper 是否提供可用、可证明一致的物理快照或备份原语，并验证独立密钥下的加密副本及跨设备打开能力。
- **实验 C：逻辑快照与 KPB1 分块导出。** 从 Native SQLCipher 固定只读视图读取 M6-01 冻结的 45 个业务表段和 5 个派生摘要，经 kanata-logical-v1 与 KPB1 容器生成分块认证密文 spool。

本阶段必须交付：
1. SQLCipher API、WAL、只读事务、低 API 密码学和 Native 资源边界的实测证据。
2. C 路线 Native 有界导出实现及与 M6-01 Node/WebCrypto 参考实现的字节级互操作证据。
3. A 路线可行性结论；若实际库或平台不支持，提供可复核的 NOT_SUPPORTED 证据，不得用未经验证的替代路径冒充成功。
4. 1k / 10k / 100k 合成数据的 A/C 对照测量、跨设备隔离目标验证及故障注入报告。
5. 精确提交 SHA、测试证据、CI 结果、未覆盖项和阶段关账材料。

M6-00 已建议 Scheme C 作为架构路线，但 A/C 实验不得预设性能胜者。实验数据可支持后续决策，不能自行改变冻结合同或直接启用生产路径。

## 2. 冻结合同与必须继承的前置证据

以下内容在本阶段视为冻结输入：

- M6-00 最终设计收口：docs/qa/kanata-sqlite-m6/m6-00-final-closeout-v1.md。
- M6-00 GPT-6 独立最终复核：docs/qa/kanata-sqlite-m6/m6-00-final-independent-review-v1.md。
- M6-01 格式任务书：docs/20261120-kanata-sqlite-m6-01-portable-backup-format-task-v1.md。
- M6-01 交付报告：docs/qa/kanata-sqlite-m6/m6-01-portable-codec-report-v1.md。
- M6-01 最终独立复核对应代码提交：43b26d6ec41929a59844bb62a882bdf578391192。
- Schema 001–005 指纹：8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a。
- Schema application_id：0x4b4e5441；当前 user_version：5。
- M6-01 KPB1 固定格式、Manifest、DATA、Footer、transcript、表目录、kanata-logical-v1、错误码和 KAT 向量均不得因本阶段实验而静默修改。
- 合成 profile 0xff01 仍为测试用途；600000 次 PBKDF2 仍是候选测试参数。发行 profile 0x0001 的迭代数、资源参数和发布准入不得在本阶段擅自冻结。
- 53 表目录分类固定为 45 个业务表、5 个派生表、3 个运行表；KPB1 DATA 包含 45 个业务表段，Footer 包含 50 项业务/派生表 verifier，3 个运行表不导出。
- Schema 005 的三张 ordinal 顺序旁表必须保留原始 ordinal 和排序语义。缺失、空洞或非法顺序必须拒绝，禁止猜序或自动修复后宣称成功。
- Web 在 M 阶段继续使用现有加密文件存储适配器；不得强制引入 SQLite WASM/OPFS。

## 3. 开工前置检查与 Git 约束

执行 Agent 必须先阅读并遵守：
1. 仓库根目录 AGENTS.md。
2. 架构接口与Agent开发说明书.md。
3. memory-bank/development-context.md。
4. 本任务书及上述 M6-00 / M6-01 冻结材料。
5. 本轮实际涉及的 Java、JS、SQLCipher、Gradle、Native 插件与测试源码。

开始前执行并记录：
- git status --short --branch
- git rev-parse HEAD
- git diff --stat
- git branch --show-current
- git ls-remote origin refs/heads/m6/encrypted-backup-recovery

要求：
- 代码基线必须是 43b26d6ec41929a59844bb62a882bdf578391192，或该基线之后仅增加本任务书/路线文档的文档提交；若发现任何未归属代码差异、远端意外前进、工作树脏状态或分支不一致，停止并报告。
- 在独立工作树 .worktrees/kanata-m5 中执行；主 main 工作树保持不动。不得覆盖、清理或恢复其他 worktree 的既有修改。
- 不得使用 reset、clean、force checkout、force-push 或 force-with-lease 以外的强制覆盖手段。普通 push 只允许 fast-forward。
- 本任务开始时确认 M6-01 代码相对其最终签核提交没有变化；若文档提交使 HEAD 前进，必须用 git diff 核对 src、android、package.json、package-lock.json 等实现范围仍与基线一致。
- 发现需要修改 Schema 001–005、M6-01 固定向量、生产 Store、普通 APK 激活位、全局恢复协调器或真实数据路径时，立即停止，提交范围外问题报告，等待单独授权。

## 4. 范围与禁止事项

### 4.1 本阶段允许

- 仅使用一次性合成账户、合成世界/会话/消息、合成归档和隔离 SQLCipher 候选库。
- 在显式 synthetic-only QA 构建和隔离 Native 探针中验证 API 24、API 25 及较新受支持 API。
- 新增 Native 有界只读快照/流式读取能力、C 路线导出适配、A 路线实验探针、测试夹具、测试脚本及 QA 文档。
- 为实验 A 建立明确标记为 test-only 的密钥封装/实验产物描述，以独立随机测试 DEK 验证跨设备打开；不得把它包装成新的生产格式。
- 为 C 路线复用 M6-01 固定 KPB1 / kanata-logical-v1 合同，新增 Native 数据面与有界 spool 适配。
- 在独立隔离目标中打开/验证 A 产物或恢复 C 逻辑包；该验证不接入产品 RestoreCoordinator。

### 4.2 明确禁止

- 读取、扫描、复制、导入、迁移或覆盖任何真实用户数据、真实设备数据库、真实备份或真实归档。
- 将 M5 synthetic-only migrator 接入生产 Store、生命周期或 canonical。
- 修改普通 APK 的 SQLite 激活位，或把 SQLCipher 改为生产 canonical。
- 接入 Settings UI、正式分享入口、产品备份注册器、protectedModules 或 RestoreCoordinator。
- 修改 Schema 001–005、application_id、历史 checksum、KPB1 字节合同、M6-00 冻结合同或旧 v1–v12 / v13 读取语义。
- 导出、记录或复用源数据库 DEK、Keystore 密钥、主密码、生物凭据或真实 API Key。
- 在 C 路线源库执行 checkpoint、DDL、rekey 或其他维护写；不得复制 WAL 活跃状态下的主数据库文件。
- 因实验结果擅自更改 KDF 发行参数、生产 profile、数据库密钥策略或 rekey 策略。
- 发布/分发 APK、创建 Release、合并 M6 分支到 main/Kanata、修改其他业务模块或升级无关依赖。

## 5. 统一合成数据集与公平对照

A/C 必须使用相同的确定性种子、逻辑数据内容、表覆盖、世界/会话/归档比例和长字段分布。每个数据集均生成可复核的 dataset identity、行数清单、逐表逻辑摘要和生成器版本。

固定规模：
- 1k messages
- 10k messages
- 100k messages

数据集至少覆盖：
- Schema 005 的 45 个业务表、5 个派生摘要涉及的行和 3 个运行表排除行为。
- worlds、conversations、messages、archives、metadata、events、effects、baselines 等跨表关联。
- 同一事务内跨表写入的关联标记，用于检测快照混合版本。
- 三张 ordinal 顺序表的连续 ordinal、跨 world 顺序和重复 ID 负向情形。
- 中文、补充平面字符、组合字符、NUL、BOM、长 JSON、嵌入 Base64、最大合法卡片/审计文本等。
- 长字段边界：262144 / 262145 UTF-16 code units、2 MiB 上下边界、64 KiB DATA 帧跨界和复合大行。

A/C 每轮开始前核对同一逻辑 dataset fingerprint。A 和 C 如需使用独立数据库副本，必须由同一固定种子和同一已提交事务序列生成，并验证逻辑摘要完全一致；不得用两个内容近似但未经对拍的数据集进行性能比较。

## 6. Native 前置探针 N-01～N-04

### N-01：密码学与低 API 兼容

在 API 24、API 25 和可用的较新受支持版本上记录：
- Android API、ABI、设备/模拟器型号、WebView 版本、实际 JCA / Provider 名称与版本。
- PBKDF2-HMAC-SHA256、HKDF-SHA256、AES-256-GCM、AAD、nonce 和 tag 的实际字节输入输出。
- 与 M6-01 固定 KAT 逐字节互操作；至少覆盖 UTF-8 中文、补充平面字符、组合/分解形式、空格、NUL、BOM、非法代理项拒绝。
- 600000 次候选 PBKDF2 的耗时、峰值 RSS/heap、取消响应与错误路径清理；可增加候选值对照，但只记录数据，不冻结发行 profile。
- Native 结果与 Node/WebCrypto oracle 的完整密文/标签/摘要一致性，不以“能成功解密”代替字节一致。

API 24/25 环境无法建立时，标记 NOT_RUN / BLOCKED 并说明原因；不得用 API 34 结果替代低 API 证据，不得宣称 API 24/25 通过。

### N-02：SQLCipher 只读快照与物理原语

必须基于当前实际 Gradle 解析的 SQLCipher Android 4.17.0 AAR 和实际 Native wrapper：
- 记录 AAR 精确坐标、版本、ABI、SQLite/SQLCipher 版本、可调用公开 API、rawKey 入口与 key 参数语义。
- 通过真实合成库探测 Online Backup API、SQLCipher export、VACUUM INTO 或其他公开且受支持的物理快照原语；逐项记录是否存在、调用方式、加密目标行为、错误语义和实际测试结果。
- 验证 DEFERRED 只读事务是否能在同一 connection pin 住真实快照；同一事务读取 schema、counts、rows、digests 时必须来自同一视图。
- 覆盖已有 WAL/SHM、已提交但尚未 checkpoint 的事务、未提交 writer、并发 reader、控制 writer、close、cancel、BUSY 与重开。
- 验证只读连接确实只读；不得仅凭 API 名称、反射存在或 health 中的配置字段宣称快照一致。
- 若 AAR 无可用 Online Backup API，必须记录最小复现、公开 API 检索和失败证据。可在一次性 disposable synthetic clone 上评估 freeze → 完成 checkpoint → 关闭所有连接 → 证明无活动 WAL/SHM 引用 → 复制稳定文件的候选流程；该流程只作为 A 的隔离实验，不得用于 C 路线或任何非 disposable 源库。若不能证明新独立 DEK 下的加密副本及跨设备打开，A 结论为 NOT_SUPPORTED。

### N-03：长行、桥接与有界内存

覆盖：
- 262144 / 262145 UTF-16、2 MiB 上下边界、NUL、跨 UTF-8/64 KiB 帧边界、最大合法 JSON/卡片/审计文本、复合大行。
- Native SQLite Cursor / CursorWindow、Java String、JNI、Capacitor Bridge、JS TypedArray、加密缓冲和 spool 的隐藏分配。
- 明确区分 SQLCipher page cache、Native heap、Java heap、JS heap、WebView RSS 和 app 总 RSS。
- 桥只传控制命令、进度、句柄或有界元数据；禁止把大行、全量 JSON 或整库 Base64 作为 Bridge 消息。
- 证明读取和输出的缓冲上限、在途块数量、行缓冲上限、背压与超限拒绝行为。不能仅以 DATA 帧 64 KiB 推导 SQLite/JNI 内存有界。

### N-04：SAF / Share / Activity 生命周期

仅使用隔离合成文件和测试凭据，覆盖：
- 真实隔离 picker / Share 流程的权限授予、权限撤回、短读、零进展、provider 半写和回读。
- Credential prompt、Activity pause/resume、锁屏、旋转、快速切换前后台、用户切换和过期 epoch。
- 导出取消、provider 失败、进程强杀、重启和重复冷启动。
- 过期回调不得继续读取/写入；数据库连接和事务必须在外部 Activity/Share 之前按合同关闭。
- 部分 provider 文件不得被标记为成功；成功文件必须完成关闭和可重读验证。
- 只清理由本次任务创建且能证明无引用的临时密文；不得清理历史或未知材料。

N-01～N-04 的结果分别记录 PASS / FAIL / BLOCKED / NOT_RUN；不得将 API 34 既有 Android CI 冒烟测试当作这些探针的替代证据。

## 7. 实验 A：SQLCipher 物理一致性快照

1. 首先验证当前 AAR 是否存在受支持的 Online Backup API 或其他可证明一致的物理快照能力。必须实测，不能仅凭 SQLite 文档推断 SQLCipher wrapper 一定暴露该能力。
2. 优先使用受支持的 Online Backup / 等价 API，在源逻辑快照上生成独立目标数据库；记录 page 级复制、事务可见性、BUSY、取消、重试和目标关闭语义。
3. 目标数据库必须使用独立随机实验 DEK。若需要跨设备打开，使用明确标记 test-only 的独立封装材料；不得携带源数据库 DEK、源 envelope、Keystore 材料或主密码。
4. 禁止在 WAL 活跃时直接复制主库文件。若评估 checkpoint + close + copy，只能在 disposable synthetic clone 上进行，并完整记录 checkpoint 完成、所有连接关闭、sidecar 状态、重开与源逻辑摘要。该候选不得自动升级为产品路线。
5. 对 A 产物执行跨设备/跨 API/ABI 打开、cipher 参数兼容、Schema 004/005 行为、integrity_check、foreign_key_check、application_id、user_version、逐表逻辑摘要和 dataset identity 校验。
6. 若实际 API 不支持、目标密钥无法独立、加密副本无法可靠跨设备打开，明确结论 NOT_SUPPORTED，并附可复现证据。不得以裸文件复制或源 DEK 搬运制造“PASS”。

## 8. 实验 C：Native 逻辑快照与 KPB1 分块导出

1. Native 取得 snapshot owner：撤销旧操作租约，冻结任务调度，禁止普通写入并排空已进入提交的 writer。快照边界以最后成功 commit 为准；已确认写必须进入快照，门禁后的普通写必须被拒绝或阻塞。
2. 在同一 Native connection pin 一次 DEFERRED 只读事务；schema、table counts、rows、derived summaries 和 digests 全部来自同一读视图。不得分批开启独立事务拼成一个逻辑快照。
3. 读取 M6-01 冻结的 45 个业务表段，按固定目录、列序、PK 和 005 ordinal 规则编码；对 5 个派生表生成 50 项 Footer verifier；排除 3 个运行表。
4. 通过有背压的流式管线完成 Native DB → 有界行/块读取 → KPB1 AEAD → app-private no-backup encrypted spool。JS/Capacitor Bridge 只传小命令、状态和句柄，不传整行大字符串或全量数据。
5. 严格继承 M6-01 的 64 KiB DATA 候选帧、最多 2 帧和 1 行的逻辑队列约束，以及长度、字段、行数、文件、EOF、认证和取消合同。N-03 若证明最大合法业务行无法在既定资源预算内支持，必须报告并停止，不得静默截断或改 Schema。
6. Native KDF/AEAD 输出必须与 Node/WebCrypto oracle 和固定 KAT 逐字节一致。测试使用 synthetic-only profile 0xff01；不得在本阶段引入或启用生产 profile 0x0001。
7. 完成后关闭 SQLite 连接、事务与敏感租约；spool 完成关闭、fsync/读回校验和精确 EOF 验证后，才可标记导出成功。
8. 使用另一个隔离 SQLCipher 目标和新生成的本机 DEK 验证逻辑数据恢复：Schema 005 正向通过；Schema 004、缺失/空洞 ordinal、未知版本/必需字段安全拒绝。该过程仅为实验 sink，不接入产品 RestoreCoordinator，不改变 active/canonical。
9. 导出期间不得对源库执行 checkpoint、DDL、rekey 或维护写；不得在导出失败时损坏源库或已存在的成功备份。

## 9. F02 故障与一致性验收矩阵

### F02-01：快照一致性、WAL 与并发写

必须覆盖：
- 有已提交但主数据库尚未 checkpoint 的 WAL 事务：快照必须包含完整已提交事务。
- 已启动但未提交的 writer：快照不得包含其未提交内容。
- 跨表同一事务标记：快照中所有相关表必须同时呈现同一事务前或事务后的完整状态，不得混合。
- snapshot gate 建立前已进入提交的 writer：必须 drain 并按成功 commit 边界纳入或明确失败退出。
- gate 建立后的普通写：不得越过 gate 写入。
- 并发只读 reader、长时间 reader、控制 writer、BUSY checkpoint 和 WAL 增长。
- 导出前后源库逻辑指纹、Schema、业务行摘要、integrity_check 和 foreign_key_check；证明导出没有改变源业务内容。
- A/C 两路线使用相同 dataset identity；若使用不同副本，副本在实验前逐表对拍。

### F02-02：取消、撤权、Activity 与连接生命周期

在读取、快照 pin、编码、加密、spool 写入、关闭、分享等阶段分别注入：
- AbortSignal / Native cancel。
- Activity pause、锁屏、旋转、快速 resume、用户切换和 epoch 撤销。
- SAF 权限撤回、provider 短读、零进展、写入失败、回读失败。
- 进程强杀、重启、迟到回调、重复完成通知。

通过条件：无过期写入；已进入 I/O 先结算再释放；未完成产物不标成功；源库和既有成功备份保持可用；仅清理本次拥有且无引用的临时材料。

### F02-03：长字段、跨块与桥接上限

必须覆盖 N-03 的边界值、复合大行、跨 UTF-8 字节边界、跨 64 KiB DATA 帧、长 JSON、NUL、Base64 和合法最大业务值。证明 Native 读取不截断、Codec 字节不变、桥接消息有界、内存峰值可解释；超限在分配前拒绝。

### F02-04：A/C 语义等价与异常安全

对同一逻辑数据集比较：
- 45 个业务表逐表行数与逻辑摘要。
- 5 个派生表摘要、Schema fingerprint、application_id、user_version、dataset identity。
- 005 ordinal 原序、归档状态、任务 pause-sending-v1 投影、跨表外键与领域关系。
- 目标重开后的数据与源快照逐表一致。

异常注入：
- short read、zero-progress、I/O error、spool 写失败、ENOSPC、WAL BUSY、checkpoint BUSY、取消、权限撤回、目标 close/fsync/readback 失败。
- 在每个关键阶段强杀并重启。
- 错误包、认证失败、截断、尾随字节和目标损坏。
- A/C 任一失败不得覆盖之前成功产物，不得更改源库逻辑数据，不得留下被误判为成功的半成品。

## 10. 性能测量规范

每个数据规模至少：
- 1 次独立冷测。
- 5 次有记录的重复测量。
- A/C 交错执行，轮换先后顺序，避免单边持续享受热缓存。
- 同一设备、API、ABI、AAR、数据种子和初始条件下比较。冷测与热测分开报告。

每次记录：
- 从授权/操作开始到加密 spool 关闭并完成读回校验的总耗时。
- 快照建立、锁等待/drain、数据库读取、逻辑编码、KDF、AEAD、文件写入、fsync、readback 和外部传输各阶段耗时。
- 最终携带文件字节数、加密开销、spool 峰值占用、WAL/SHM 峰值和剩余空间。
- App 与 WebView 同时峰值 RSS、Native heap、Java heap、JS heap（可测时）、SQLite page cache、CursorWindow/Bridge 最大消息和最大在途帧数。
- snapshot 生命周期、业务写阻塞时间、BUSY/重试次数、取消响应时间和失败分类。
- CPU 时间/利用率可作为补充项，需记录测量来源。

统计口径：
- 至少报告每轮原始值、中位数、最小值和最大值。
- 样本量不足以支持可靠 P95 时明确写“样本不足，不报告可靠 P95”，不得用 5 个样本制造稳定性结论。
- A 或 C 未运行、被跳过或不支持时必须明确标注，禁止补造数据。
- Android 512 MiB RSS 红线保持不变；不得通过提高门槛取得 PASS。超线必须阻断对应性能验收并调查峰值来源。
- 本阶段不擅自设定新的导出时延门槛，不修改 P7 完整改密 120 秒和 Web 768 MiB 原门槛；报告实际数据并说明设备与测试条件。

## 11. 阶段退出条件

M6-02 只有在以下项目均有真实、可追溯证据时才能申请 PASS：

1. **C 路线实现**：Native 从 SQLCipher 一致只读视图生成符合冻结 KPB1 / kanata-logical-v1 合同的加密 spool。
2. **字节互操作**：API 24/25/较新 API 的实际可用环境完成 KAT 和 Native ↔ Node/WebCrypto 逐字节互操作；未运行的 API 明确阻断，不得宣称兼容。
3. **A 路线结论**：物理快照路线已实际通过，或有充分证据证明当前 AAR/平台不支持可满足安全条件的方案并登记 NOT_SUPPORTED。不得把 NOT_SUPPORTED 写成 A PASS。
4. **数据正确性**：1k/10k/100k 数据的源快照、C 包、A 产物（若支持）及隔离目标逐表语义对拍；Schema 005 正向通过，004/缺序/未知版本安全拒绝。
5. **一致性与故障**：F02-01～F02-04 全部完成；源库逻辑零变化、WAL/并发事务边界、强杀、撤权、取消、ENOSPC、短读和重开均有证据。
6. **资源预算**：N-03 有界内存、长字段、桥接和磁盘水位有实测；Android 512 MiB 红线未被突破。
7. **生命周期**：N-04 的实际 Native/SAF 生命周期证据齐全；未执行场景如实标注。
8. **质量回归**：定向 Node/Native 测试、npm run check、Gradle unit test、Android instrumentation、必要的 Playwright WebView QA 均通过。
9. **远端 CI**：最终实现 SHA 的 Web 与 Android Job 均成功；必须核对真实 job 结论和日志，不能只看 workflow 总状态。
10. **边界核验**：生产 Store、canonical、Schema 001–005、普通 APK SQLite 激活位、v1–v12/v13 既有读取路径、M6-00/M6-01 冻结合同和依赖清单无未授权差异。
11. **交付完整**：实现 SHA、证据 SHA、CI run、工作树状态、测试原始结果、设备/API/ABI、A/C 测量、未覆盖项和残留风险全部登记。

若 A 被证实不支持，但 C 与其他硬门禁全部通过，可申请“C 路线通过、A 路线 NOT_SUPPORTED”的 M6-02 结论；报告不得声称 A/C 双路线均成功。若 C、N-01 低 API 兼容、快照一致性或资源硬门禁失败，阶段保持 BLOCKED，先提交最小复现与风险报告，不得进入 M6-03。

## 12. 交付物

必须新增或更新以下过程证据（实际文件名可在不改变含义的前提下调整，但须在报告中列明）：

- docs/qa/kanata-sqlite-m6/m6-02-native-probes-v1.md：N-01～N-04 设备、API、ABI、Provider、SQLCipher API、原始测量和状态。
- docs/qa/kanata-sqlite-m6/m6-02-ac-export-report-v1.md：A/C 数据集、实验方法、原始结果、逐表对拍、性能统计、A 不支持证据（如适用）。
- docs/qa/kanata-sqlite-m6/m6-02-final-report-v1.md：F02-01～F02-04、实现清单、测试、CI、边界 diff、未覆盖项和阶段结论。
- 对应 Native / JS / 测试代码与可复现合成数据生成器。
- 只保留不含秘密、不含真实数据的证据；大体积测试产物按 QA 目录约定处理，不提交临时数据库或含敏感内容的 spool。

## 13. 建议实施顺序

1. **Preflight**：确认分支、工作树、M6-01 冻结合同、SQLCipher AAR 与现有 Native API。
2. **N-01 / N-02 最小探针**：先证明低 API KDF 字节能力、SQLCipher 只读快照与物理原语可用性；发现硬阻断立即报告。
3. **N-03 / N-04 探针**：验证长行、桥接、内存、SAF 和 Activity 生命周期。
4. **C 路线 Native 读取与导出**：先建立 snapshot owner/read-only view，再接冻结 KPB1 Codec 和 private spool。
5. **A 路线实验**：仅在 N-02 证实有受支持路径后实现物理实验；不可行则完成 NOT_SUPPORTED 证据。
6. **F02-01～F02-04**：并发/WAL、长字段、取消撤权、强杀和 A/C 逐表对拍。
7. **1k/10k/100k 性能测量**：按交错冷/热轮次运行，保存原始结果。
8. **全量质量回归与边界核验**：npm run check、Gradle、Native instrumentation、WebView QA、生产隔离 diff。
9. **提交与远端 CI**：普通 commit + fast-forward push，核对最终 SHA 的 Web/Android jobs。
10. **交付与独立复审**：提交 M6-02 报告，等待 GPT-6 独立复核；未获 PASS 不得启动 M6-03。

## 14. 最终报告必须回答的问题

- 当前 SQLCipher 4.17.0 AAR 实际提供哪些物理备份 API？哪些路径被实测否定？
- 只读事务如何 pin 住 WAL 快照？并发 writer 和长 reader 的实际行为是什么？
- A 路线是否能在不携带源 DEK 的前提下生成独立加密、跨设备可打开的副本？
- C 路线是否真正做到 Native 数据面有界流式读取，Bridge 仅传控制信息？
- Native 与 M6-01 Node/WebCrypto 是否逐字节互操作？
- API 24、25 与较新 API 的 KDF/GCM 字节、延迟、取消和内存结果如何？
- 1k/10k/100k 的导出耗时、文件大小、RSS、Native/Java heap、WAL/spool 峰值和锁等待分别是多少？
- 强杀、撤权、ENOSPC、短读、BUSY、取消和 provider 半写时，源库与既有备份是否保持完整？
- 哪些能力 PASS、FAIL、BLOCKED、NOT_SUPPORTED 或 NOT_RUN？证据在哪里？
- M6-03 还需要哪些明确输入？本阶段有哪些问题必须保留为后续阻断？

**本任务书只授权 M6-02 的隔离合成实现与实验。它不授权生产接入、真实数据操作、APK 发布、分支合并或 M6-03 自动启动。**
