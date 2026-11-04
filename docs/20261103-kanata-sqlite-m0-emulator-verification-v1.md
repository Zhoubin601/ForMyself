# Kanata M0 Android 模拟器补测 v1

本记录接续 [M0 主报告](20261103-kanata-sqlite-m0-report-v1.md)。用户要求在当前环境安装模拟器后，本轮完成了实际安装、系统启动及原生测试。主报告先前“没有模拟器、Android 未运行”的状态是当时记录；新增设备证据以本记录为准。

**当前结论：模拟器已安装并成功启动；SQLCipher 4.17.0 原生功能检查通过；Capacitor WebView 桥接仍 BLOCKED；M0 总结论仍为 BLOCKED，不进入 M1。**

## 1. 实际环境

| 项目 | 事实 |
|---|---|
| Emulator | 37.2.13.0，build 16740729 |
| 系统镜像 | AOSP ATD Android 14 / API 34，x86_64，revision 2 |
| AVD / serial | `kanata_m0_api34` / `emulator-5580`，新建隔离设备 |
| CPU / RAM | 2 虚拟核，2560 MiB；内核报告 MemTotal 2534548 KiB |
| 加速 / 图形 | 无 `/dev/kvm`，`-accel-check` 明确报告无 vmx/svm；TCG 软件模拟；SwiftShader，Vulkan 关闭 |
| 显示 / 数据盘 | 320×640，160 dpi；2 GiB 稀疏 ext4 数据盘，有 journal/encrypt 功能 |
| WebView | 系统 `com.android.webview` 113.0.5672.136，targetSdk 34 |
| 启动及安全状态 | `sys.boot_completed=1`；`ro.crypto.state=encrypted`；`ro.crypto.type=file`；SELinux `Enforcing` |
| 系统指纹 | `Android/sdk_slim_x86_64/emulator64_x86_64:14/UE1A.230829.036.A1/11228894:userdebug/test-keys` |

这是云环境里的模拟器，不是手机。虚拟电量/温度、TCG 延迟和模拟磁盘均不能替代真实目标手机参数或性能成绩。没有使用用户真实聊天或备份，没有安装/覆盖生产包。

## 2. 安装过程和实际修正

通过官方 SDK 安装 emulator 后，常规安装系统镜像因磁盘空间不足失败。官方镜像 URL 为：

`https://dl.google.com/android/repository/sys-img/aosp_atd/x86_64-34_r02.zip`

来自官方 `aosp_atd/sys-img2-4.xml` 元数据，压缩大小 **614898904 bytes**，SHA1 **9ce4068934b26fa99ca104ffe6d10dec22abb317**。完整解压逻辑大小 **8743920093 bytes**，超过当前 7.9 GiB 文件系统容量。

使用 [稀疏安装脚本](qa/kanata-sqlite-m0/install-emulator-image.py)，先核对完整压缩包大小/官方 checksum，再逐项完整解压并校验 ZIP CRC；全零块以 sparse hole 保留。每文件保留逻辑大小与 SHA256，没有裁剪或修改系统镜像。实际分配 **1281261568 bytes**。SDK 工具随后正常识别该已安装镜像。

默认 AVD 要求至少约 7.37 GB 空闲来建立 6 GiB 数据盘，仍超出当前空间。为此仅对这个新建合成 AVD 使用 2 GiB 稀疏数据盘。首次空盘尝试因没有 ext4 superblock 导致 `/data` 挂载失败、重启；打开内核日志后定位并修正。SDK 自带旧 mkfs 不支持 encrypt，改用从 Debian 官方包提取的 e2fsprogs **1.47.2**，保留 ext4 journal 和 encrypt，去除旧内核不支持的 orphan_file 特性。没有关闭文件加密、SELinux、WebView sandbox 或数据库加密。

修正后内核记录 `/data` 挂载成功、`cryptfs enablefilecrypto` 与 `init_user0` 成功，最终系统报告启动完成。首次软件启动约七分钟，**只是环境启动观察，不是数据库或产品冷启动基准**。

证据：[安装参数](qa/kanata-sqlite-m0/evidence/emulator/installation.json)、[稀疏镜像逐文件收据](qa/kanata-sqlite-m0/evidence/emulator/sparse-image-install.json)、[启动与命令记录](qa/kanata-sqlite-m0/evidence/emulator/commands.md)。

## 3. 真正执行过的 Android 原生测试

测试代码：[SqlCipherM0Test.java](qa/kanata-sqlite-m0/prototype/SqlCipherM0Test.java)。只在目标 QA App 的新随机 cache 子目录创建合成数据库，使用随机 32-byte 密钥材料，不持久化密码或密钥。

| 组合 | 实际 instrumentation | 结果 |
|---|---|---|
| Capacitor 8.3.1 QA 包 + SQLCipher 4.17.0 | `OK (1 test)`，测试内部包含五次重开 | PASS（模拟器原生检查） |
| Capacitor 8.4.1 QA 包 + SQLCipher 4.17.0 | `OK (1 test)`，测试内部包含五次重开 | PASS（模拟器原生检查） |

两次测试分别实际校验：

- 创建加密库，`cipher_version` 必须为 4.17.x。
- 正确密钥能读取；错误密钥拒绝。
- Android 系统普通 SQLite 只读打开/查询拒绝；拒读探针使用不删除数据库的 corruption handler，以保留加密源供后续验证。
- 数据库文件中不含合成正文标记。
- WAL API 成功、读回 journal_mode 为 wal；synchronous 读回 FULL（2）。
- 插入事务提交及未提交事务回滚，精确核对条数。
- 五次关闭/正确密钥重开，条数与数据库完整性检查通过。

这里的 PASS **不是完整 Android CRUD/并发/强停/备份恢复/改密/密钥生命周期验收**，也不是 Capacitor JS 桥接通过。此原生测试没有覆盖每种异常，更没有 1k/10k/100k 的 Android 性能结果。

首次真实运行发现 QA 测试误用 `execSQL("PRAGMA journal_mode=WAL")`：Android 拒绝用无结果执行接口执行有返回值的语句。改为 `enableWriteAheadLogging()` 并读回状态，保留 FULL、版本、加密和回滚要求后重建两套 Test APK，实际复测通过。原失败日志保留，没有删除断言或降低要求。

## 4. WebView 桥接阻塞及独立对照

两套 QA App 启动后，系统 WebView 的 `CrRendererMain` 出现 SIGTRAP，随后 App 因 renderer 崩溃而退出。最初两次控制器在取得页面目标之前退出，未点击数据库测试按钮。修正轮询后的桥接单独重试也遇到 renderer 崩溃，没有得到完整测试结果；不能证明插件 create/open/CRUD/事务/reopen 全部执行完成，不能标记通过。

独立对照：启动系统自带 `com.android.htmlviewer/.HTMLViewerActivity`，只加载一份 `data:text/html,...` 的静态 M0 文本，**没有 Capacitor 或 SQLite 插件**。该页面也重现 WebView renderer SIGTRAP，随后 HTML Viewer 退出；崩溃点同为 `libwebviewchromium.so + 0x191356a`。这证明故障可在无 SQLite 的页面出现；不据此断言 SQLite 插件有缺陷，也不凭相关性断言底层唯一根因。

当前环境已采用 [Android 官方建议的软件渲染及关闭 Vulkan 的排查配置](https://developer.android.com/studio/run/emulator-troubleshooting)。没有为了继续测试禁用 WebView sandbox、安全认证或数据库加密。具体 WebView/TCG 故障根因尚未闭合；需要可稳定运行 WebView 的模拟环境或真实目标设备补测。

控制器还发现 `am start` 返回时进程可能尚未建立，修正了 pidof 的轮询处理并补充 phase 记录，以避免把启动竞态直接当测试失败。首次控制器错误记录保留。

## 5. 复现入口

已安装环境保留在 `work/m0/android-sdk`，独立 AVD/数据在 `work/m0/emulator`。测试结束后已清理独立 QA 包的合成数据并正常关闭模拟器，保留安装与 AVD，避免持续占用 CPU；没有触碰生产包。恢复运行：

```sh
node docs/qa/kanata-sqlite-m0/start-emulator.mjs
# 另一个终端，确认该新建 M0 AVD 启动完成后运行
node docs/qa/kanata-sqlite-m0/verify-emulator.mjs 8.3.1
node docs/qa/kanata-sqlite-m0/verify-emulator.mjs 8.4.1
```

脚本固定检查 emulator-5580、AVD 名和完整启动状态；只安装 `com.formyself.qa.m0` 及它的测试包。不能拿上述命令测试真实用户手机。`--bridge-only` 只重试桥接，明确记录该次 native NOT RUN，不借用此前结果伪装本次全套通过。完整安装、格式化、构建、设备命令见 evidence/emulator/commands.md。

## 6. 两轮自查与剩余门禁

第一轮技术检查：保留官方镜像字节及 checksum；修正空间/空数据盘问题；实读 FBE/SELinux/启动状态；真实测试暴露 WAL API 错误后修正并重测；普通 SQLite 拒读探针保留源库。生产源码、依赖和 Android 配置未改。

第二轮需求/证据检查：分开构建通过、原生通过、桥接阻塞与真机性能阻塞；用无 SQLite 的系统页面复现 WebView 故障；保留失败记录；没有将一次 JUnit 测试中的五次重开说成五组性能样本，也没有将模拟器启动时间当产品冷启动。原有主机 30 组/360 操作样本及源码指纹检查仍通过。

仍需完成：稳定的插件桥接执行、Android 故障/并发/强停、受保护会话密钥入口与清理、Preferences/logcat 密钥取证、Keystore/跨设备恢复、Android KDF 校准、真实目标手机同环境性能与准确内存。既有 P7 Android 512 MiB / 完整改密 120 秒、Web 768 MiB 门槛全部保留。

**已消除的阻塞：没有模拟器、SQLCipher 4.17.0 原生代码从未运行。仍未消除的阻塞：稳定桥接、完整密钥架构及真实手机性能。M0 仍 BLOCKED，不开始 M1，不推送或发布 APK。**
