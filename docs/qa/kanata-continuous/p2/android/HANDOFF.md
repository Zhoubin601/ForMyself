# Kanata Android 环境接续记录

状态：Android 设备门禁 BLOCKED。P2 不因本文件放行。原生构建仍在准备，最终结果见 gradle-final-build-result.json；文件时间必须晚于当前执行启动时间，避免读取上一轮结果。

## 隔离边界

全部环境资料在 /workspace/work/kanata-android。环境 Agent 没有修改仓库业务源码、配置、锁文件或 Git，没有安装产品 APK，没有执行会清资料的 E2E 驱动。

任务 AVD 为 KanataP2ATD34，目录 avds/KanataP2ATD34.avd，ADB 独立服务端口 5589，序列号 emulator-5580。另一任务 default API34 AVD 为 KanataP2Synthetic34，失败磁盘保留。两个都是本任务创建的合成环境，未 wipe。ATD 已正常 emu kill，所有数据与日志保留。

## 已执行与真实结果

- 官方 SDK 下载、校验并解压到 sdk/：platform-tools37.0.1、emulator37.3.5、API34 default/ATD、platform36、build-tools36/35。哈希与来源见 environment-summary.json。
- java --version 曾只能证明系统 JRE21；真实构建失败 JAVA_COMPILER，command -v javac 为空。已从 Eclipse Adoptium 官方发布下载 Temurin21.0.13+9，SHA256核对一致；java -version 与 javac -version 均 exit0，详见 jdk21-verification.json。
- Gradle8.14.3 wrapper 下载与版本执行成功，见 gradle-version.log。
- 隔离构建副本 build-snapshot-20261028/ 复制 Android 项目、所需插件及 dist；所有生成输出留在副本。cap copy 成功；发现需要 cordova.variables.gradle 后补 core 包并 cap sync android，exit0，见 cap-sync-final.log。
- Gradle attempt1 exit1：隔离准备缺少生成 Cordova 文件；attempt2 exit1：缺 build-tools35；attempt3 exit1：系统只有 JRE 无编译器；attempt4 exit1：Temurin自带信任库缺云代理CA。对应日志和 result.json 均按 attempt 保留。
- attempt5 使用完整 JDK21、官方build-tools35、保留 HTTP 代理和 /etc/ssl/certs/java/cacerts 信任库重新构建，不关闭 TLS 验证；结果待其日志更新。父 Agent 后续安全修复可能使此轮 dist 过时，必须最终再刷新并记录hash。
- default AVD 曾超过15分钟未得到 boot_completed；ATD 首轮 ART APEX dm-node 等待失败，随后 art_boot 不存在、zygote持续exit1。第二轮 ART已挂载，但15个其他关键APEX dm-node超时，包含conscrypt/media/resolv/tethering。
- 最新有效观测：2026-10-28T02:58:00Z，pm path android 因 adb offline exit1；sys.boot_completed 未得到1。ADB device/offline或bootanim stopped均不算验收。
- -prop ro.hw_timeout_multiplier=10 不生效：emulator警告只支持qemu.*，guest日志显示尝试vendor.ro.hw_timeout_multiplier被SELinux拒绝。不要复用此参数声称已修复。drawing覆盖也未通过guest getprop验证。

## 设备阻塞与复验

/dev/kvm 不存在。Emulator37.3.5 的 -help-all 明确标TCG为UNSUPPORTED；ANDROID_I_WANT_MY_TCG=yes仅开放尝试，并非支持承诺。此次真实尝试失败，不能以源码编译或单元测试代替设备验收。

后续必须在支持 /dev/kvm 的环境或明确隔离的真实设备继续。准备的 start-kvm-atd-avd.sh 从未执行，只重启本任务既有ATD，包含缺KVM立即退出的检查，不含wipe/清理。

```bash
/workspace/work/kanata-android/start-kvm-atd-avd.sh
/workspace/work/kanata-android/sdk/platform-tools/adb -P 5589 -s emulator-5580 shell getprop sys.boot_completed
/workspace/work/kanata-android/sdk/platform-tools/adb -P 5589 -s emulator-5580 shell pm path android
/workspace/work/kanata-android/sdk/platform-tools/adb -P 5589 -s emulator-5580 shell pidof system_server
/workspace/work/kanata-android/sdk/platform-tools/adb -P 5589 -s emulator-5580 shell setprop debug.hwui.drawing_enabled 1
/workspace/work/kanata-android/sdk/platform-tools/adb -P 5589 -s emulator-5580 shell getprop debug.hwui.drawing_enabled
```

仅当 boot_completed=1、package manager可用、关键APEX全挂载、框架稳定后才能安装匹配最终dist的主/测试APK。再执行instrumentation、Kanata专用容量/恢复/改密/强停冷启动检查。旧 docs 原生 verify.mjs 针对旧聊天，不可直接当新Kanata P2验收。

实际强停冷启动、安全恢复、原生容量、instrumentation与Android UI均未运行；P2 Android仍No-Go，不得进入依赖它的P3。
