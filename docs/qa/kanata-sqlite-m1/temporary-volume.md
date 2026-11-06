# 云环境临时卷上的隔离模拟器

2026-11-06接续补测。工作区盘与临时卷是不同挂载：`df -h /workspace /tmp`实际分别约2.0GiB、4.9GiB可用。此前只检查工作区盘而将设备门禁停在BLOCKED，遗漏了可用临时卷。把本轮合成运行盘放到临时卷后，模拟器正常通过自身磁盘预检；没有关闭或绕过资源检查，也没有移动/删除用户AVD。

先按[原命令记录](commands.md)准备SDK、未使用的专用`kanata_m1_schema_api34`配置及1GiB ext4合成种子盘。脚本只克隆这个任务盘，保留原盘和旧M0 AVD。运行：

```sh
node docs/qa/kanata-sqlite-m1/start-temporary-emulator.mjs
```

输出含随机run目录、PID与manifest路径。`PROCESS_STARTED_BOOT_NOT_YET_VERIFIED`仅代表创建了进程，不是启动/测试通过。日志写入run/boot.txt，运行目录在系统tmpdir的`kanata-m1-emulator-*`下；继续以ADB检查：

```sh
work/m0/android-sdk/platform-tools/adb -s emulator-5580 shell getprop sys.boot_completed
work/m0/android-sdk/platform-tools/adb -s emulator-5580 emu avd name
work/m0/android-sdk/platform-tools/adb -s emulator-5580 shell getprop ro.build.version.sdk
work/m0/android-sdk/platform-tools/adb -s emulator-5580 shell getenforce
```

必须boot_completed=1、AVD名称/任务清单匹配且API34，才运行测试。当前没有KVM，使用TCG、SwiftShader、2560MiB/2核/320×640、Vulkan关闭；这是结构/故障验证环境，不替代M0目标模拟器或M7/P7性能证据。

```sh
node docs/qa/kanata-sqlite-m1/verify-android.mjs work/m0/android-8.4.1-REPLACE work/m0/m1-tmp-avd-REPLACE/manifest.json
```

长任务期间需恢复**同一个本轮临时AVD**时，可传原manifest（必须在work/m0内且指向受限tmpdir）：

```sh
node docs/qa/kanata-sqlite-m1/start-temporary-emulator.mjs --resume work/m0/m1-tmp-avd-REPLACE/manifest.json
```

脚本拒绝已有emulator-5580；只在锁文件PID已不存在或确认为僵尸时移除该临时AVD的残留锁，不wipe、不删除数据镜像、不使用实验性多实例选项。模拟器脱离启动工具的进程组运行，避免启动工具会话结束误杀它。恢复后仍须重新验证boot和设备身份，不把旧ready文件当当前设备状态。

测试结束只在这个新建合成AVD清理`com.formyself.qa.m0`测试资料，使用`adb -s emulator-5580 emu kill`正常关闭。是否已实际测试通过，以[最终报告v2](../../20261106-kanata-sqlite-m1-report-v2.md)和原始JUnit/指纹为准；旧磁盘阻塞、首轮错误断言及中断记录继续保留。
