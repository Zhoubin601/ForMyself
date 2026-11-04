# M0 模拟器补测：实际命令与证据

执行目录 `/workspace/ForMyself`。仅 M 分支隔离 QA；没有真实手机/私人资料，没有生产包安装、推送或发布。用户授权在当前环境安装模拟器并继续验证。

## 安装

检查 `/dev/kvm` 不存在，CPU 未暴露 vmx/svm；`emulator -accel-check` 返回 `KVM requires a CPU that supports vmx or svm`。使用已有 JDK21/SDK、会话 proxy/CA，执行：

```sh
work/m0/android-sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root="$PWD/work/m0/android-sdk" 'emulator' 'system-images;android-34;aosp_atd;x86_64'
```

Emulator 37.2.13 安装成功，镜像普通解压报 `No space left on device`。官方元数据：

```text
https://dl.google.com/android/repository/sys-img/aosp_atd/sys-img2-4.xml
https://dl.google.com/android/repository/sys-img/aosp_atd/x86_64-34_r02.zip
614898904 bytes / SHA1 9ce4068934b26fa99ca104ffe6d10dec22abb317
```

下载到 work/m0/emulator，核验 checksum 后执行：

```sh
python3 docs/qa/kanata-sqlite-m0/install-emulator-image.py
```

exit0。完整 8743920093 逻辑 bytes，实际 sparse 占用 1281261568 bytes；逐文件 hash 在 sparse-image-install.json。不是裁剪镜像，也没有修改镜像内容或跳过 ZIP CRC。

设置 `ANDROID_USER_HOME=.../work/m0/emulator/prefs`、`ANDROID_AVD_HOME=.../work/m0/emulator/avd`、`ANDROID_EMULATOR_HOME=.../work/m0/emulator/home`，执行：

```sh
printf 'no\n' | work/m0/android-sdk/cmdline-tools/latest/bin/avdmanager create avd -n kanata_m0_api34 -k 'system-images;android-34;aosp_atd;x86_64' -p "$PWD/work/m0/emulator/avd/kanata_m0_api34.avd"
```

exit0，SDK 识别本地镜像 r2。默认6GiB userdata需要7372.80MB空闲，无法在本环境创建。只为这个全新合成 AVD 建立2GiB稀疏数据盘；不接触其他AVD或任何用户数据。

首个512MiB空盘尝试因无ext4 superblock而挂载失败，内核日志保留。SDK自带mkfs1.42.13不支持encrypt；从 Debian 官方目录下载并仅解包到 work：

```text
https://deb.debian.org/debian/pool/main/e/e2fsprogs/e2fsprogs_1.47.2-3+b12_amd64.deb
https://deb.debian.org/debian/pool/main/e/e2fsprogs/libext2fs2t64_1.47.2-3+b12_amd64.deb
```

```sh
dpkg-deb -x work/m0/emulator/e2fsprogs.deb work/m0/emulator/e2fsprogs-tools
dpkg-deb -x work/m0/emulator/libext2fs.deb work/m0/emulator/e2fsprogs-tools
LD_LIBRARY_PATH="$PWD/work/m0/emulator/e2fsprogs-tools/usr/lib/x86_64-linux-gnu" work/m0/emulator/e2fsprogs-tools/usr/sbin/mke2fs -F -t ext4 -b 4096 -I 256 -m 0 -O encrypt,^orphan_file -L m0-synthetic-data work/m0/emulator/avd/kanata_m0_api34.avd/m0-userdata-formatted.img
```

数据盘由本轮新建、尚无测试 App 资料的文件建立，保留 journal/encrypt；orphan_file 仅为旧内核格式兼容。没有关闭SELinux/FBE/数据库加密。两套包只使用缓存随机合成目录。

## 启动和只读核验

带上述 Android 路径变量执行：

```sh
work/m0/android-sdk/emulator/emulator -avd kanata_m0_api34 -port 5580 -accel off -no-window -no-audio -no-boot-anim -no-snapshot -no-metrics -gpu swiftshader -feature -Vulkan -memory 2560 -cores 2 -partition-size 2048 -data "$PWD/work/m0/emulator/avd/kanata_m0_api34.avd/m0-userdata-formatted.img" -show-kernel
```

已转为 `node docs/qa/kanata-sqlite-m0/start-emulator.mjs` 可复现。内核/data挂载、cryptfs初始化、system_server启动成功；后续ADB只读验证：

```sh
work/m0/android-sdk/platform-tools/adb -s emulator-5580 shell getprop sys.boot_completed
work/m0/android-sdk/platform-tools/adb -s emulator-5580 shell getprop ro.crypto.state
work/m0/android-sdk/platform-tools/adb -s emulator-5580 shell getprop ro.crypto.type
work/m0/android-sdk/platform-tools/adb -s emulator-5580 shell getenforce
work/m0/android-sdk/platform-tools/adb -s emulator-5580 shell dumpsys webviewupdate
```

返回1 / encrypted / file / Enforcing。WebView113.0.5672.136。首次跨多个失败尝试的观察器报过10分钟timeout，不代表最后一次启动失败；新的formatted观察器已记录bootCompleted=1。没有将模拟器电量/温度/启动时间当手机性能成绩。

## 构建修正和原生测试

第一次 native831-before-wal-fix.txt：实际 instrumentation 失败，原因 execSQL 被用于返回结果的 WAL PRAGMA。修正源码为 enableWriteAheadLogging + rawQuery 读回 wal、FULL=2、cipher_version=4.17；普通SQLite拒读探针采用不删除加密源的corruption handler。保留所有原断言，再将最终Java源码拷到两套QA项目，按原JDK/proxy/CA环境重新执行：

```sh
./android/gradlew -p android --no-daemon --max-workers=1 :app:assembleDebug :app:assembleDebugAndroidTest
```

8.3.1 / 8.4.1 都 exit0，48s / 45s。没有修改生产src/android/package/lock。

```sh
node docs/qa/kanata-sqlite-m0/verify-emulator.mjs 8.3.1
node docs/qa/kanata-sqlite-m0/verify-emulator.mjs 8.4.1
```

脚本分别执行 adb install -r -t（独立QA包及Test包），随后：

```sh
adb -s emulator-5580 shell am instrument -w -r -e class com.formyself.qa.m0.SqlCipherM0Test com.formyself.qa.m0.test/androidx.test.runner.AndroidJUnitRunner
```

两套真实输出 `OK (1 test)`；JUnit记录28.356s / 25.496s，只是整条功能测试时长，不是数据库性能样本。各测试内部真实执行五次重开和加密/错误密钥/普通SQLite拒读/提交回滚/WAL/FULL/完整性断言。

原控制器遇到pidof启动竞态先退出，保留结果；后补PID和debug socket轮询、phase记录，并用`--bridge-only`重试。该模式不执行native，明确写NOT_RUN_THIS_INVOCATION，不能冒充再次全套通过。

## WebView 对照

最初两套QA App运行在控制器取得页面目标之前发生CrRendererMain SIGTRAP / libwebviewchromium.so崩溃，未点击按钮。修正控制器后的桥接单独重试仍崩溃、没有完整结果，故桥接不通过。没有通过降低数据库或浏览器安全要求绕过。

独立静态HTML对照使用系统自带HTMLViewer，不含Capacitor或SQLite：

```sh
adb -s emulator-5580 shell am start -W -n com.android.htmlviewer/.HTMLViewerActivity -a android.intent.action.VIEW -d data:text/html,%3Chtml%3E%3Cbody%3EM0%20WebView%20control%3C%2Fbody%3E%3C%2Fhtml%3E -t text/html
```

Activity启动成功后约半分钟，也出现同一renderer崩溃点；观察器记录pid先存在、随后消失。保留精简堆栈与观察记录，不把crashpad原始内存minidump当测试交付物。证据只说明故障可独立于SQLite复现，尚不指定唯一根因。

参考官方排查入口（引用日2026-11-03）：https://developer.android.com/studio/run/emulator-troubleshooting 。当前已使用其软件渲染与关闭Vulkan配置，无WebView sandbox、安全认证或加密绕过。

## 验证范围

原生PASS、桥接BLOCKED、真机性能BLOCKED分别记录。所有运行均在新建M0 AVD；原主机五轮基准没有改写或被模拟器数字替换。未开始M1，未提交/推送/合并/发布。结束时的进程/清理状态见installation.json。

### 本轮结束状态

清理仅限本轮新建AVD上的独立QA包：`adb -s emulator-5580 shell am force-stop com.formyself.qa.m0`；`adb -s emulator-5580 shell pm clear com.formyself.qa.m0` 返回 Success；移除本轮9228转发后 `adb -s emulator-5580 emu kill` 正常关闭。SDK/AVD保留，可用start-emulator.mjs恢复。没有接触com.yubin.formyself生产包或真实设备数据。

格式化前的数据文件以Python排他创建（不是覆盖）：`with Path('work/m0/emulator/avd/kanata_m0_api34.avd/m0-userdata-formatted.img').open('xb') as f: f.truncate(2*1024*1024*1024)`。原始镜像内容与用户设备数据均未修改。
