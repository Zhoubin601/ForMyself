# Kanata SQLite M2 Windows/WHPX 验收 v2

2026-11-09（北京时间）。**M2 PASS，范围为隔离合成环境中的生产候选。** ForMyself 生产 canonical 继续使用 legacy JSON/加密归档。普通 Android 构建的 SQLite 激活条件保持关闭。本阶段放行 M3 的工程实施，真实资料的切换仍取决于后续迁移、备份、改密和恢复验收。

依据为 [M2 任务书](20261107-kanata-sqlite-m2-task-v1.md)、[技术设计](20261107-kanata-sqlite-m2-design-v1.md)、[Windows 交接](20261109-kanata-sqlite-m2-windows-handoff-v1.md)、[M0 直接桥接协议](20261104-kanata-sqlite-m0-direct-gate-v1.md)、[M1 v2](20261106-kanata-sqlite-m1-report-v2.md) 与 [M1-R 审计](20261107-kanata-sqlite-m1-r-audit-v1.md)。接管时主工作区有既有修改、删除和未跟踪资料，实施在现有 M 工作树快进至远端 `b0be26f2f26d66abe7720625ca9afeb84d32f301` 后进行。全部测试使用仓库合成夹具，使用模型的次数为 5 次受控调用和 0 次真实 API 请求。

## 放行门禁

| 门禁 | 结果 | 本轮证据 |
| --- | --- | --- |
| Windows 环境 | PASS | 新建合成 AVD `kanata_m2_api34`，API 34 Google APIs x86_64 r14，WHPX、文件加密、SELinux Enforcing，WebView 113.0.5672.136。最小 Capacitor 8.4.1 的页面启动 nonce 与现场随机 nonce 均实际往返，APK 安装读回 SHA 一致。 |
| Driver 与加密 | PASS | Android SQLCipher 4.17.0 Community，原生随机 256-bit DEK 和直接字节密钥。M0 v1 信封由独立旧实现交叉解包，错误密钥拒绝，检查合成密码、KEK、DEK 未出现在进程日志或普通 Preferences，数据库无明文 SQLite 文件头。 |
| 受保护会话 | PASS | 真实 `protectedAccess.runOperation(['chat'], ...)` 队列在设备运行，认证状态由合成夹具提供。挑战重放、实际 30 秒过期、错误 sessionRevision、显式关闭和系统后台均拒绝旧租约。驱动晚到查询、恢复门禁和回滚失败毒化另有定向负例。 |
| Schema | PASS | 设备以 JS 执行同一 M1 升级器从空库升级、关闭重开；未来版本实测拒绝且主数据库 SHA 前后一致。Node 覆盖历史 v1/v2/v3、错误 application_id、缺失结构、错误日志及故障回滚。旧资料存在和信封缺失在设备拒绝。 |
| Repository | PASS | 消息单条、批次 1/50/256、257 拒绝、ID 幂等与冲突、会话参与者顺序和 CAS 在真实桥接执行。固定语句目录拒绝任意 SQL，执行返回实际 affectedRows。 |
| 写入和审计 | PASS | 两个写请求竞争仅一个 CAS 成功。设备用延迟外键触发实际 COMMIT 失败，回滚后可以重试。原生独立对照覆盖 WAL 中另一池连接的 FK 开关。 |
| 删除与编辑 | PASS | 消息审计精确 `json_set` 脱敏，保留扩展和审计身份。回复后代、事件、记忆双路径、效果、任务和审计与纯领域规则对照，未知因果拒绝，写入点和 COMMIT 故障均回滚。Android 实际执行派生删除。 |
| 分页 | PASS | 复合 keyset 稳定处理同时间戳，cursor 绑定世界和会话，单页最多 50。实际按 ID 定位、引用和计数，回归用可观测查询行数验证边界。 |
| UI 和 Runtime | PASS | API 34 WebView 运行真实 `KanataConversationView`，50 条首屏、100 条窗口、翻页滚动锚点、引用预览/跳转、群聊 speaker 和气泡顺序、失败重试、延迟任务持久化续接、跨世界快切和锁定清理。character 仅可按原权限访问，人工发送在界面与 Runtime 均拒绝。 |
| AI | PASS | SQL 按 speaker 和权限读取 2–40 条上下文，旧来源按 ID 只查 provenance。复核会话、角色、消息 revision 和上下文后才提交。快切时受控 provider 故意忽略取消信号，迟到结果没有入库。 |
| 进程故障 | PASS | Android `run-as … kill -9` 时消息与审计已写入、COMMIT 尚未发出。PID 9039 → 9198，重开确认原 revision 和审计完整。主机 SQLCipher 独立执行强制终止重开。 |
| 回归与证据 | PASS | 最终定向 45 项，完整 check 635 个 Node、392 个组件用例、两套 TypeScript 检查和构建。已执行两轮不同侧重的自检并复测。 |

## 命令与指纹

| 实际命令 | 结果 |
| --- | --- |
| 隔离副本 `npm ci --cache <run>/npm-cache --prefer-offline --no-audit --no-fund --fetch-retries=1` | exit 0，692 包和四项 postinstall 补丁。根锁及隔离锁 SHA 相同。 |
| `node --test tests/kanataSqliteDriver.test.js tests/kanataSqliteRepository.test.js tests/kanataSqliteSchema.test.js tests/kanataSqliteRemediation.test.js tests/kanataSqliteMapping.test.js` | exit 0，45/45。 |
| `npm run check` | exit 0，635/635 Node、392/392 组件（42 文件）、strict 和负向类型、Vite 构建。lint 0 错误、42 既有警告。 |
| `node docs/qa/kanata-sqlite-m2/verify-host.mjs <python>` | exit 0，Windows SQLCipher 4.20.0 Community / SQLite 3.54.1，执行实际 Repository、错密、明文读拒绝、COMMIT 失败及强制终止。 |
| `android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest` | exit 0。设备安装与读回 SHA 相同，原生 instrumentation 1/1。 |
| `run-windows-candidate.ps1 -Mode full` | exit 0，执行设备 JS → Native → JS、Repository、密钥/租约、UI 及故障闭环。 |
| `android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=false :app:assembleDebug` | exit 0，默认包 `com.yubin.formyself` 的激活位为 false。默认目录 299 条，合成目录 347 条，默认包无合成故障语句。 |

- 001/002/003 仍为原 161/36/19 条，未增 migration。联合 SHA-256 为 `1cf50ef2944831ea6d3b66a871ba59944e03d48b889171588b550b9b4eedea45`。三版独立 checksum 见[冻结指纹](qa/kanata-sqlite-m2/evidence/schema-fingerprints.json)。
- 合成领域夹具 SHA-256 为 `2417814bb2ee508ab059dceae4cf30dfa0def8561d4fc9f0d596f188a644a07f`。
- Android 候选 App SHA-256 为 `a1915b8b81d09365df3231f59c08b7b7c0d2df8067e49ef26c8b7b996f4deb51`，Test APK 为 `1f92e96ffba6df63b4662e6febdba6b99d4c9a93c6d2c31aa12843f4db0bc03e`。最小 nonce 探针 APK 为 `f23fb62f4f9bfe3d3ad40b22d18e07050292f3b788885c6471d46cf450511c82`。
- [机器汇总](qa/kanata-sqlite-m2/evidence/windows-20261109/verification-summary.json)、[源码指纹与文件清单](qa/kanata-sqlite-m2/evidence/windows-20261109/code-sha256.json)、[设备原始结果](qa/kanata-sqlite-m2/evidence/windows-20261109/android-result.txt)与[无损日志指纹](qa/kanata-sqlite-m2/evidence/windows-20261109/archive-sha256.json)。

## 两轮独立自检

| 轮次 | 反例、修复及复测 |
| --- | --- |
| 1，安全、存储与并发 | 检查 SQLCipher 4.17 字节码发现失败的 COMMIT 会先退出 Java 事务并归还连接。使用单 executor 上的主写连接显式 ROLLBACK，失败则毒化。设备触发真实延迟外键 COMMIT 故障，随后重试成功。构造查库中撤销、捕获语句失败后继续、回滚失败、后台旧租约、挑战过期、未提交 SIGKILL、未来版本与单边信封反例。已对现存库添加只读目录、迁移日志与完整性预检，并以最终 APK 重跑。 |
| 2，产品语义、兼容与证据 | 首轮页面实测群聊重试失败。删除联动已递增角色 revision，注入的静态元数据仍旧。为 AI 增加按需读取实际角色状态、事件/记忆状态和关系 revision，保留 CAS 安全检查。重跑群聊、气泡、重试、引用、延迟续接、快切与 character 拒绝。补充旧页和引用迟到反例、lifeSources 扩展往返与 Windows M1 临时连接关闭顺序。核对设备 APK 与 QA bundle、SQL 目录、夹具和 Schema 指纹。 |

## 历史失败、未运行与范围

- **FAIL，已修复**。Windows 依赖首次离线缓存缺包，Sharp 缓存写入又遇到 EFS 与临时归档问题。以锁定归档在隔离缓存完成安装。Windows 基线曾因测试先删除仍打开的 SQLite 临时文件报 EPERM。Android 第一次群聊 UI 重试失败。以上原始结果和复测均保留。
- **BLOCKED，历史**。Linux renderer code 5 / SIGTRAP 保留在[验收 v1](20261107-kanata-sqlite-m2-acceptance-v1.md)。Windows 系统 HTMLViewer 的 data/file URI 对照未读到预期静态正文。最小 Capacitor 的实际页面与两次 nonce 往返构成 Windows WebView/桥接放行证据。
- **NOT RUN，范围外**。实体 Android 设备、M3–M7、P7 容量、真实用户迁移、全局改密/备份恢复和真实模型 API。本轮 Android 验证从空库逐版升级与现有 v3 重开，旧 v1/v2 的具体文件升级由 Node 和主机基线覆盖。默认 Debug 只核验构建、包名和关闭门禁。
- 密钥缓冲区在可控边界清零。Java String、WebCrypto、WebView 和 SQLCipher 内部复制的物理清零无法证明。脱敏验收覆盖活动记录与存储审计，不延伸至旧备份或已退休物理页的擦除。
- 复核重点为任务书的 M2/M3 边界、[Windows 复现命令](qa/kanata-sqlite-m2/README.md#windowswhpx-实施与复现)和两轮自检。现有生产资料仍走原 legacy 路径。设备已停止，隔离目录留作复核，APK 仅保留在本地 QA 输出。
