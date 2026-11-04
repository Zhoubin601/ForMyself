# M0 直接密钥会话与放行核验

2026-11-04（北京时间）。在 M 工作树以 `98fd0a3` 和既有 M0 QA 改动为基线。目标设备仍为用户指定的 `raw/Android - 快捷方式.lnk` 所指 SDK 下的隔离 Android 14/WHPX AVD。合成数据复用 M0 固定夹具。前置证据为 [Windows 接续验证](20261104-kanata-sqlite-m0-windows-v1.md) 与 [三档同机对照](20261104-kanata-sqlite-m0-target-emulator-v1.md)。

## 选型与边界

- QA 使用 Capacitor 8.4.1 和 SQLCipher Community 4.17.0。后续采用窄原生桥接作为数据库 Driver 的候选实现。标准社区插件 8.1.1 保留为性能对照，其持久 secret API 不纳入候选。直接桥接复用同一 SQLCipher Android AAR，社区插件和 SQLCipher 的来源与许可调查见 [M0 主报告](20261103-kanata-sqlite-m0-report-v1.md)。
- KDF 固定为 PBKDF2-HMAC-SHA256 600,000 次、256-bit KEK、16-byte 随机盐和既有域分离。使用 WebView WebCrypto 计算，与当前应用在 WebCrypto 中处理主密码的架构一致。KEK 作为临时十六进制值经过关闭日志的桥接。数据库 DEK 由原生端生成，AES-256-GCM 信封含 12-byte 随机 nonce 和认证标签，文件通过 AtomicFile 写入 App 私有目录。
- 原生打开依赖有效的前台会话和一次性挑战。查询与写入核对当前租约，显式锁定、后台和销毁清除待处理挑战与租约，关闭连接并清零本代码持有的字节缓冲区。WebView 和 Java 运行时内部副本由各自的内存管理负责。正式接入还需绑定应用的受保护会话、完成迟到结果丢弃和持久改密/恢复协调。
- SQLite 验证参数为 WAL、FULL、2 MiB 页缓存、1000 页 checkpoint、最多 256 条写入一批和最多 50 条分页。原型消息表只用于 M0 验证。初始化在 DB 与信封只存在其一时拒绝继续，生产阶段需补可恢复的首次创建与迁移协议。

## 复现与取证

按[目标设备验证](20261104-kanata-sqlite-m0-target-emulator-v1.md)准备 QA Android 工程。运行 `bundle-target-benchmark.mjs` 后同步 Android 资源并构建 `:app:assembleDebug`，再执行以下命令。

```powershell
node docs/qa/kanata-sqlite-m0/run-direct-session.mjs work/m0/android-8.4.1-REPLACE 5
```

每轮用新合成口令导入 100k 条，校验逐批提交、重复 ID 故障回滚、同时间戳排序、近页和深页的真实 payload、数据库完整性和索引计划。显式锁定后旧租约拒绝。原生端开启有时限的未提交事务，驱动核对测试 App 的当前 PID 与事务就绪日志后使用 `am force-stop`。新进程重新输入同一合成口令，检查原始 100k 条和完整性。复测错误密钥拒绝、挑战重放拒绝、旧租约拒绝，再在同一 PID 下切到 Home 后返回并确认租约撤销。

驱动用主机信封代码独立解密设备信封，核对跨实现兼容。它只输出审计结果，不输出口令、KEK、DEK 或 logcat 内容。审计扫描 App 自有 SharedPreferences 与本轮进程日志的合成口令、KEK、DEK 文字形式。直接桥接的测试还核对社区插件没有已保存 secret。全过程只操作隔离 App。

第一轮五组生命周期和安全检查均通过，冷进程最近页 P95 为 62.5 ms，超过预定 50 ms，保留 [首轮失败证据](qa/kanata-sqlite-m0/evidence/direct/attempt-1.json)。复测将合成夹具断言移到计时之后，计时仍包含实际桥接及 payload 解析。原生解锁在租约发放前执行一次有界 schema 读取，发现打不开或结构缺失时拒绝。该读取计入解锁耗时。门槛维持原值。

复测第五轮，WebView 的偏好文件在列出与读取之间发生变动，扫描命令失败，保留 [第二轮未完成证据](qa/kanata-sqlite-m0/evidence/direct/attempt-2.json)。修正后要求探针偏好文件可见、整组文件均可读取且首尾文件清单一致。若文件在读取时被替换，则在限定次数内重新读取全组。发现任何密钥匹配仍立即失败。随后用同一 APK 重新运行整组。

冷打开从新 App 进程的首个正确挑战开始，保留 Android 文件缓存。QA 页面就绪另计从 `am start` 到可执行桥接动作的主机时间，包含 ADB 与调试轮询开销。分页计时从 WebView 发起请求到消息解析完成。导入、KDF、冷打开和各页五次，单条写入、更新各二十五次，P95 采用最近秩。RSS 采用主进程和 renderer 中最高的 VmHWM。

## 最终门禁

**M0 技术验证 PASS，可供用户复核进入 M1。** 五轮 100k 全部完成，期间的强停、后台撤销、会话重放、错密和文本密钥取证均通过。原生回滚没有遗留未提交行，100k 数据仍通过 SQLCipher 完整性检查。完整原始证据含 APK SHA-256、每轮 PID、CPU、数据库字节数和内存，见 [五轮结果](qa/kanata-sqlite-m0/evidence/direct/results.json) 与 [门禁汇总](qa/kanata-sqlite-m0/evidence/direct/summary.json)。

| 100k 直接原生候选 | P50 | P95 | 预定门槛 |
| --- | ---: | ---: | ---: |
| 批量导入 | 12,624.1 ms | 12,728.8 ms | 记录基准 |
| 冷进程 KDF | 84.7 ms | 89.8 ms | 计入数据库冷打开 |
| 冷进程数据库打开 | 106.1 ms | 111.7 ms | 1,000 ms |
| 冷进程最近 50 | 37.2 ms | 45.5 ms | 50 ms |
| 冷进程下一页 50 | 34.6 ms | 37.2 ms | 50 ms |
| 冷进程深页 50 | 34.8 ms | 35.5 ms | 50 ms |
| 单条写入 | 2.6 ms | 3.2 ms | 100 ms |
| 单条更新 | 2.5 ms | 3.0 ms | 100 ms |

最高单进程 RSS 为 248.1 MiB。QA 页面就绪 P95 为 1,276.7 ms，单列记录。现有 JSON/归档在同一目标设备 100k 的单条写入 P95 为 9,794.4 ms、最高单进程 RSS 为 661.1 MiB。原方案的最近页 P95 为 5.7 ms，仍快于冷进程桥接路径。原 JSON/归档的导入只测了一次，批量结果按各自样本数解释。

参数以本页选型为 M0 冻结值。第一轮自查聚焦密钥边界、关闭和进程中断，验证一轮失败的最近页门槛会拒绝放行。第二轮自查聚焦文件取证、样本完整性、候选 APK 与计时定义，复跑全部五轮。最终执行 `node docs/qa/kanata-sqlite-m0/validate-direct-gate.mjs` 并比对 APK 指纹。标准插件冒烟亦复测通过。

`npm.cmd run check` 通过，Node 590 项、组件 392 项、两类类型检查及生产构建通过，lint 0 错误、42 条既有警告。历史主机证据核验、QA 脚本语法、文档链接和 `git diff --check` 通过。测试包的合成数据已清理，ADB 转发已回收，独立 AVD 已关闭。生产源码、Android 项目、依赖锁和原始资料无差异。

放行范围为 M0 的隔离技术验证。M1 尚未开始。受保护会话的产品接入、旧数据迁移、全局改密/恢复及 M7/P7 的整应用性能仍各自验收。Android 512 MiB、完整改密 120 秒及 Web 768 MiB 的原门槛继续适用。
