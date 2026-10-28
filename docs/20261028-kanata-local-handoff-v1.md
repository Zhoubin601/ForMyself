# Kanata 本地开发接续检查点

2026-10-28，用户明确授权将当前P2未验收检查点提交并推送远端，以转入本地开发。该授权覆盖此前“P2验收后才提交推送”的等待条件，**不改变P2 BLOCKED、不授权跳过门禁进入P3**。

## 当前状态

- 分支：`Kanata`；P1提交`dd9c912`已PASS。本次P2提交标题明确包含Android验收阻塞；准确提交号用`git log -2 --oneline`查看。
- P2新仓库/Store、确认清理与首启、新旧备份分流、实际协调器、设置页已实现；Android设备验收未完成。P3–P7未开始。
- 最近完整`npm run check`退出0：Node407、Vitest219（23文件）、lint0错误/33警告、类型和构建通过。这是云环境当次结果，本地需重新运行。
- 真实Web合成测试通过；Android最终debug与test APK构建通过、55个dist资源SHA256逐一匹配。JVM仅原有算术测试，不是产品功能验证。
- 无KVM的云模拟器关键APEX设备映射超时，无法boot_completed/使用package manager。Android instrumentation、强停冷启动/恢复/改密/增长仍未运行。详细证据：[P2验收记录](20261028-kanata-stage-p2-verification-v1.md)、[Android报告](qa/kanata-continuous/p2/android/README.md)、[15场景覆盖](qa/kanata-continuous/p2/requirements-coverage.json)。

## 本地同步与检查

先保留本地已有工作，不执行reset/clean/覆盖未提交文件；确认本地可以安全切换后：

```bash
git fetch origin
git switch Kanata
git pull --ff-only origin Kanata
git status --short --branch
git log -2 --oneline
npm ci
npm run check
```

若锁文件的镜像地址在本地不可达，可沿用已验证的安装命令，不修改锁文件：

```bash
npm ci --replace-registry-host=always --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=30000 --loglevel=error
```

开发前依次复核AGENTS、根架构规范（第15–16节为实际Kanata契约）、连续计划v3、预设规格、clean-start-v2、raw需求及四份过程文档；不要重新做P0或按历史文档迁移旧聊天。

## 优先补齐P2设备门禁

使用全新、明确可清理的**合成资料模拟器**，不要用用户日常资料环境。安装完整JDK21（确认`javac -version`）、Android SDK platform36/build-tools35和36；配置本地SDK/JDK路径，通过Android Studio或本地硬件加速环境创建可正常启动的设备。先验证boot_completed=1、package manager可用与框架稳定。

```bash
npm run build
npx cap sync android
cd android
./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
./gradlew :app:connectedDebugAndroidTest
```

Windows使用`gradlew.bat`；连接测试前核对只连接了任务合成设备。云环境下载的SDK/JDK/AVD/APK未打包进Git；`docs/qa/.../android/start-kvm-atd-avd.sh`使用云绝对路径，**不是本地通用启动脚本**。

需要补齐并记录两轮自查/实际命令与结果：

1. 实际原生文件桥接：不存在、错误版本/解密、主备损坏、写失败/重试，确认不会把失败当空数据覆盖。
2. 旧合成文件/恢复键/通知：确认前0删除，确认后仅白名单，清理中断/重进/强停不复活旧聊天、不重复seed；其他模块和全局配置保留。
3. 新备份完整往返、v1–v12旧全备非chat恢复、失败补偿/回滚失败日志阻塞，强停后按实际加密日志恢复；旧单项chat拒绝。
4. 主密码改密、失败补偿、会话过期明文释放，强停后重新解锁重载。
5. Android1k/10k合成数据增长基线，记录设备、系统/WebView、组成、耗时和内存测量口径。当前仍全量JSON，没有真分页；P7需独立设计存储分片/索引/迁移回滚并测100k，不得拿UI切片替代。

旧`npm run test:e2e:android`驱动仍面向旧聊天，其聊天断言不能直接当Kanata P2验收；**Kanata原生专用场景驱动仍需本地接入/实际运行**。instrumentation通过也不能替代上述新业务设备用例。

P2所有强制条件通过后，再记录Go、普通提交推送Kanata并自动进入P3，继续P3→P7。P3还需角色卡/世界管理/预设来源版权审查，P4–P6聊天/记忆/自治等尚未实现。真实旧资料删除始终只允许应用运行时明确确认，不因本次提交授权而自动执行。

提交前格式核对：新增源码/类型/测试的3处EOF空行已规范化（不改变行为）。完整`git diff --cached --check`对原样保存的终端测试日志报告尾空格/EOF空行；这些证据保持原字节，不改写输出。排除`docs/qa/kanata-continuous/p2/`原始证据后的源码与文档范围格式检查通过。
