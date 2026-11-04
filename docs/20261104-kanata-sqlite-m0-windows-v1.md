# Kanata M0 Windows 接续验证

2026-11-04（北京时间）。基线为 `origin/M@98fd0a3`，在本地跟踪分支 M 的独立工作树执行。依据为 [迁移计划](20261103-kanata-sqlite-migration-plan-v1.md)、[M0 交接](20261104-kanata-sqlite-m0-handoff-v1.md) 和 [源码记录](source-notes.md)。此前软件模拟器的 WebView 崩溃证据仍保留。

## 环境和命令

- Windows、Node 24.14.1、Microsoft JDK 21.0.11、WHPX。专用 `kanata_m0_api34` 是全新 Google APIs x86_64 AVD，使用任务目录内的数据分区、2048 MiB、2 核和 SwiftShader，启动参数含 `-port 5580 -accel on -no-snapshot`。Android 14 镜像指纹为 `google/sdk_gphone64_x86_64/emu64xa:14/UE1A.230829.050/12077443:userdebug/dev-keys`，WebView 为 `com.google.android.webview 113.0.5672.136`。测试只使用独立包 `com.formyself.qa.m0`。
- `npm.cmd ci --registry=https://registry.npmjs.org` 通过，四项既有 postinstall 补丁成功。 `npm.cmd run check` 退出 0，590 项 Node、42 文件 392 项组件、两类类型检查与 Vite 构建通过，lint 0 错误、42 警告。
- `node --test docs/qa/kanata-sqlite-m0/key-envelope.test.mjs` 通过。 `node docs/qa/kanata-sqlite-m0/validate-results.mjs` 复核历史 30 组、360 个主机操作样本。脚本在哈希前将 CRLF 还原为证据采用的 LF，本轮未重跑主机性能。
- 用 `node docs/qa/kanata-sqlite-m0/build-android.mjs <version>` 生成隔离项目。修改后在生成目录运行 `npm.cmd run build`、`node configure-android.mjs`、`npx.cmd --no-install cap sync android` 和 `android\gradlew.bat -p android --no-daemon --max-workers=2 :app:assembleDebug :app:assembleDebugAndroidTest`。首轮 8.4.1 编译识别出 AAR 的损坏处理回调接收两个参数，按实际字节码签名修正后两版本均构建成功。
- 设备执行入口为 `node docs/qa/kanata-sqlite-m0/verify-emulator.mjs <version> --build-dir work/m0/android-<version>-<run>`。8.4.1 分次执行原生检查与 `--bridge-only`，两次使用相同构建；8.3.1 执行完整命令。APK 路径位于被忽略的工作目录。

## 两条候选路径

**社区插件 8.1.1。** Windows 模拟器的 WebView 可以显示 QA 页面。第一次驱动连接时，WebView 拒绝 Playwright 的 `Browser.setDownloadBehavior`。改用页面级 CDP 后，发现目标页会在文档和执行上下文稳定前被列出，复跑也曾遇到单次求值失败。最终驱动将就绪探测与测试动作分开，等文档完成且事件注册后调用原插件，并在完成后收回自己申请的 ADB 转发端口。本轮区分了 Windows 驱动故障和历史云环境 renderer 崩溃，历史 SIGTRAP 的底层原因仍待定位。

桥接探针断言 SQLCipher 4.17、WAL、插入与批量写入、事务回滚、更新/删除、提交后五次开关及重开数据完整性。插件的加密偏好持久化 secret 路径仍是生产选型的限制。

**直接原生 SQLCipher。** `SqlCipherM0SessionTest` 使用临时合成文件和仅在运行时生成的密码、随机 256-bit DEK。用原生 PBKDF2-SHA256 和 AES-GCM 做信封测试，以字节密钥 API 打开真实加密数据库，验证旧密码拒绝新信封、篡改密文拒绝、新信封可重开、连接关闭和探针持有的缓冲区清零。该测试没有调用社区插件的 secret API。密码重包装保留同一个 DEK，旧信封如仍存在仍可用于解锁。测试只观察原型持有的字节数组，JCA 和 SQLCipher 内部副本的清理需要另外取证。

直接原生路径避免维护社区插件内部连接与 secret 实现的分叉，但需要自行实现并测试窄桥接、线程与事务所有权、会话撤销和错误映射。修改社区插件可复用 CRUD 桥接与既有类型，同时需要持续维护 8.1.1 私有连接和持久 secret 分支的差异。两者都需要完成 Android 生命周期、备份恢复及安全门禁才能作生产选择。

## 实测结果

| Capacitor | App 与 Test APK | 原生 JUnit | 最终驱动桥接重跑 | 600,000 次 PBKDF2 封装，五样本中位数 / 最大值 |
| --- | --- | --- | --- | --- |
| 8.3.1 | 成功 | 2/2 通过 | 2/2 通过 | 7,257 / 7,546 ms |
| 8.4.1 | 成功 | 2/2 通过 | 2/2 通过 | 7,879 / 8,731 ms |

原生两项覆盖 SQLCipher 4.17.0 加密、错密和普通 SQLite 拒绝、事务回滚和重开，以及临时密钥会话。桥接证据见 [8.3.1](qa/kanata-sqlite-m0/evidence/windows/8.3.1-bridge.json) 和 [8.4.1](qa/kanata-sqlite-m0/evidence/windows/8.4.1-bridge.json)。随附原始 [8.3.1 JUnit](qa/kanata-sqlite-m0/evidence/windows/8.3.1-native.txt)、[8.4.1 JUnit](qa/kanata-sqlite-m0/evidence/windows/8.4.1-native.txt)、[KDF 样本](qa/kanata-sqlite-m0/evidence/windows/kdf.txt)、[设备属性](qa/kanata-sqlite-m0/evidence/windows/device.txt) 和 [测试 APK SHA-256](qa/kanata-sqlite-m0/evidence/windows/apk-sha256.json)。封装耗时含派生和 AES-GCM，样本只反映本机模拟器。暂不冻结 KDF 实现或参数。完成后核验转发端口已回收，清理合成 QA App 数据并关闭独立 AVD。

## 门禁

**M0 仍为 BLOCKED，M1 未开始。** 已消除本机模拟器上的桥接验证阻塞。仍需真实目标手机的 1k/10k/100k 同机 JSON 对照、峰值内存及有界桥接查询证据，以及 Android 的进程强停恢复、日志与偏好取证、Keystore 失效和生产受保护会话集成。原 P7 的 Android 512 MiB / 完整改密 120 秒和 Web 768 MiB 门槛继续有效。生产源码、Android 项目、依赖锁和 raw 原始资料的差异均为空。
