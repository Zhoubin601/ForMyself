# M1 本轮实际命令与结果

2026-11-06，北京时间口径。仓库/workspace/ForMyself，M基线bda1a58，所有运行资料均为合成。原有M0生成工具保留在忽略的work/m0，生产依赖和Android项目未修改。

## 接续补测：M1 PASS

用户要求在当前环境继续完成M1。发现独立/tmp卷后，复制本轮合成盘过去，实际启动API34/FBE/SELinux Enforcing的隔离AVD。首次手动启动的命令参数及运行盘复制等价于新增start-temporary-emulator.mjs；进程中断后实际使用以下命令恢复。旧磁盘失败和下面此前的NOT RUN记录不改写。

```sh
df -h /workspace /tmp
node docs/qa/kanata-sqlite-m1/start-temporary-emulator.mjs --resume work/m0/m1-temporary-avd.json
node docs/qa/kanata-sqlite-m1/prepare-android.mjs work/m0/android-8.4.1-14xBaJ
# 使用下方同一JDK/SDK/Gradle代理环境重新执行assembleDebug和assembleDebugAndroidTest。
node docs/qa/kanata-sqlite-m1/verify-android.mjs work/m0/android-8.4.1-14xBaJ work/m0/m1-temporary-avd.json
npm run check
```

第一次实际JUnit因错误预期默认android_metadata存在而FAIL，输出保存android-first-attempt；完整字节码与真实对照确认SQLCipher4.17有codec时跳过首次locale初始化，改为验证真正空库，不删表、不放宽陌生结构拒绝。测试同时采用显式二进制collation标志及每次打开的池级外键API。长任务进程中断造成一次ADB预检连接拒绝，没有执行测试；另一次恢复因残留PID锁拒绝，确认PID为僵尸后清理本合成AVD的锁并正常恢复，不使用read-only多实例选项。

最终构建exit0/23s，设备驱动exit0，实际`M1_CIPHER_VERSION=4.17.0 community`、`OK (1 test)`/19.133s。该时长为整条功能测试，非性能样本。完整check再次exit0/605 Node/392组件42文件、类型/构建通过、lint0错误42既有警告。原始日志、实际设备配置、APK/Schema/数据指纹和清理记录保留evidence/android-closure；机器汇总verification-summary-v2.json，详细结论见[报告v2](../../20261106-kanata-sqlite-m1-report-v2.md)。

仅对本次新建临时AVD执行`am force-stop com.formyself.qa.m0`、`pm clear com.formyself.qa.m0`（Success）和`emu kill`（exit0）；ADB设备列表为空。没有清理原M0 AVD或真实用户资料。以下为此前磁盘BLOCKED时的原始检查点。

## 前置与开发检查

```sh
git status --short --branch
git branch --show-current
git fetch origin refs/heads/M:refs/remotes/origin/M
git rev-list --left-right --count HEAD...origin/M
git merge --ff-only origin/M
node docs/qa/kanata-sqlite-m0/validate-direct-gate.mjs
node docs/qa/kanata-sqlite-m0/validate-results.mjs
```

开始工作区干净、分支M，0/1，快进98fd0a3→bda1a58；两验证器exit0。M0是既有设备结果的离线核验，非本轮设备重测。阅读来源见docs/source-notes.md本轮条目。

```sh
node --test tests/kanataSqliteSchema.test.js
npm run typecheck
node docs/qa/kanata-sqlite-m1/verify-sqlcipher.mjs
npm run check
node docs/qa/kanata-sqlite-m1/write-catalog.mjs
```

首次空库冒烟修复列/约束顺序；strict接口初接失败的implicit any已补JSDoc，保留strict-types-first-failure.txt，之后类型检查通过。两轮审查后最终定向15/15通过，空库202个升级写入点分别故障/回滚/新连接重试，另有6种已有v1失败及真实SIGKILL；主机SQLCipher10组检查通过、cipher4.12.0、SQLite3.51.1，绝不代替Android4.17。最后完整check exit0：605 Node、392组件/42文件、两类类型、lint0错误/42既有警告、生产构建成功。catalog由内建SQLite3.53.3实际生成；DDL指纹与SQLCipher及Android准备输入相等。

本轮直接使用此前M0已安装并验证四项postinstall补丁的锁定依赖；根node_modules仍链接work/m0/deps/node_modules。没有修改根package/lock或升级依赖。新克隆请按根规范npm ci；若网络不允许旧锁内镜像，M0 prepare-host-deps.mjs保留官方地址/integrity不变的隔离准备方式。

## Android编译

```sh
node docs/qa/kanata-sqlite-m1/prepare-android.mjs work/m0/android-8.4.1-14xBaJ
JAVA_HOME="$PWD/work/m0/jdk" \
JAVA_TOOL_OPTIONS="-Dhttp.proxyHost=proxy -Dhttp.proxyPort=8080 -Dhttps.proxyHost=proxy -Dhttps.proxyPort=8080 -Djavax.net.ssl.trustStore=$PWD/work/m0/qa-cacerts -Djavax.net.ssl.trustStorePassword=changeit -Dhttp.nonProxyHosts=localhost|127.*" \
ANDROID_HOME="$PWD/work/m0/android-sdk" \
GRADLE_USER_HOME="$PWD/work/m0/gradle" \
bash work/m0/android-8.4.1-14xBaJ/android/gradlew \
  -p work/m0/android-8.4.1-14xBaJ/android --offline --no-daemon --max-workers=1 \
  :app:assembleDebug :app:assembleDebugAndroidTest
```

最终exit0，BUILD SUCCESSFUL in11s；测试APK包含本轮DDL、188条合成夹具命令、新JUnit和指纹回报。APK仅在work中，不发布、不上传。changeit只用于M0安装时生成的公开CA truststore，不是应用密码/DEK。已有本机JDK21/SDK/Gradle由M0说明复现，隔离项目路径随机，其他环境用自己的生成目录。

## 模拟器尝试（均未启动，非测试失败）

```sh
df -h /workspace
node docs/qa/kanata-sqlite-m0/start-emulator.mjs
work/m0/android-sdk/platform-tools/adb devices -l
```

M0 AVD在hasSufficientDiskSpace预检exit1，未产生设备。根盘约7.9GiB，初始空闲约1.7GiB。仅删除本会话下载的Gradle8.14.3发行包docs/src（不含lib/可执行程序、源码仓库或测试证据）回收约362MiB，空闲约2.0GiB。临时将M0 AVD配置的6GiB逻辑请求核对为其已有2GiB合成盘；再次仍预检失败，随后配置恢复原字节。旧AVD/合成盘不删、不wipe，无密钥/用户资料读取。

另以独立名称kanata_m1_schema_api34新建未使用AVD配置，使用同一官方AOSP_ATD API34镜像、全新1GiB sparse合成数据盘，mke2fs1.47.2格式化ext4保留journal/encrypt、关闭旧内核不支持的orphan_file。实际参数：

```sh
# 格式化只针对本轮以open('xb')新建并truncate(1024**3)的专用文件。
LD_LIBRARY_PATH="$PWD/work/m0/emulator/e2fsprogs-tools/usr/lib/x86_64-linux-gnu:$PWD/work/m0/emulator/e2fsprogs-tools/lib/x86_64-linux-gnu" \
work/m0/emulator/e2fsprogs-tools/usr/sbin/mke2fs -t ext4 -b 4096 -m 0 \
  -O encrypt,^orphan_file -L m1-synthetic \
  "$PWD/work/m0/emulator/avd/kanata_m1_schema_api34.avd/m1-synthetic.img"
ANDROID_HOME="$PWD/work/m0/android-sdk" \
ANDROID_SDK_ROOT="$PWD/work/m0/android-sdk" \
ANDROID_USER_HOME="$PWD/work/m0/emulator/prefs" \
ANDROID_AVD_HOME="$PWD/work/m0/emulator/avd" \
ANDROID_EMULATOR_HOME="$PWD/work/m0/emulator/home" \
work/m0/android-sdk/emulator/emulator -avd kanata_m1_schema_api34 -port 5580 \
  -accel off -no-window -no-audio -no-boot-anim -no-snapshot -no-metrics \
  -gpu swiftshader -feature -Vulkan -memory 2048 -cores 2 -partition-size 1024 \
  -data "$PWD/work/m0/emulator/avd/kanata_m1_schema_api34.avd/m1-synthetic.img"
```

格式化exit0，模拟器exit1仍为磁盘预检拒绝。实际未进入Android启动；模拟器日志提示RAM增至2560MiB，不能把命令请求的2048当设备实际配置或性能成绩。没有/dev/kvm，无实体手机。未关闭加密、SELinux、浏览器安全或资源预检绕过门禁。

因此`verify-android.mjs`/JUnit instrumentation本轮**NOT RUN**，不伪造输出。复测命令及操作者隔离manifest见README。结束adb设备列表为空，无emulator、无挂起设备测试。SDK/两个AVD/QA构建保留在忽略目录，后续可换充足磁盘环境或本地已确认AVD完成本门禁。

## 最后补充检查

所有M1 mjs用node --check、Python用ast.parse；prepare-android/verify-android传`.`均预期exit1/QA_BUILD_DIR_DENIED且未触设备；缺失QA Python在5秒内以QA_WORKER_UNAVAILABLE拒绝而非挂起。SQLCipher正常路径在该修正后再次exit0。指纹一致、生产bundle不含新Schema/升级器；结果见supplemental-checks.json。

交付前检查本轮文档本地链接、git diff --check及新增文件空白、敏感凭据模式、改动范围和远端变化；不执行提交推送、合并其他分支或发布APK。
