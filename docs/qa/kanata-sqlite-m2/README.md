# Kanata SQLite M2 QA

当前状态为 **M2 Windows/WHPX 候选 PASS**。生产 canonical 保持 legacy。[验收 v2](../../20261109-kanata-sqlite-m2-acceptance-v2.md)、[Windows 机器汇总](evidence/windows-20261109/verification-summary.json)、[任务书](../../20261107-kanata-sqlite-m2-task-v1.md)、[技术设计](../../20261107-kanata-sqlite-m2-design-v1.md)。Linux 预检结果按历史保留，见[验收 v1](../../20261107-kanata-sqlite-m2-acceptance-v1.md)和[历史机器汇总](evidence/verification-summary.json)。

所有设备均为本任务新建合成环境，0真实API请求，不使用真实密码/聊天/备份。禁止把脚本指向用户设备或现有未知AVD。仓库只提交源码、日志和指纹，不提交SDK、APK、磁盘镜像、凭据或work。

## Windows/WHPX 实施与复现

从 M 的根目录执行。准备 Node 24、包含 `javac` 的 JDK 21、Android compile SDK 36/Build Tools 35、API 34 Google APIs x86_64 镜像与可用 WHPX。按原锁安装依赖，四项 postinstall 必须实际执行。现场使用新建目录和原始锁副本完成隔离安装。原始 Sharp 安装失败、成功缓存安装、工具链和锁文件指纹见 [Windows 证据](evidence/windows-20261109/verification-summary.json)。

```powershell
$manifest = & docs/qa/kanata-sqlite-m2/start-windows-synthetic-avd.ps1
$run = Split-Path -Parent $manifest
# 等待指定 serial 的 sys.boot_completed=1，并核对 manifest 中的 API 及 AVD 名。
& 'E:\Android\Sdk\platform-tools\adb.exe' -s emulator-5582 shell getprop sys.boot_completed
npm.cmd run check
node node_modules/@capacitor/cli/bin/capacitor sync android
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
& docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1 -ManifestPath $manifest -EvidenceDirectory (Join-Path $run 'candidate-full') -Mode full
```

Windows 实际首次以等价的逐项命令创建 AVD 并启动，启动器为后续复现入口。验收脚本复核 manifest、API、包名和安装读回 SHA，然后只重置合成包 `com.yubin.formyself.m2qa`。运行 instrumentation，接着用页面级 CDP 在真实 WebView 执行产出的 JS bundle。完整模式实跑挑战过期、后台、SIGKILL 重开、UI 和未来版本拒绝。预检的独立最小 Capacitor 包为 `com.formyself.qa.m2probe`，[nonce 结果](evidence/windows-20261109/preflight-nonce.json)只用于基础桥接门禁。

主机 SQLCipher 使用隔离 Python 环境的 `sqlcipher3==0.6.5` Windows wheel。执行 `node docs/qa/kanata-sqlite-m2/verify-host.mjs <python-exe>`。实际版本为 4.20.0 Community，不与设备 4.17.0 或 Linux 基线 4.12.0 混用。最终设备原始输出及完整日志见 [结果](evidence/windows-20261109/android-result.txt)和[原始档案索引](evidence/windows-20261109/archive-sha256.json)。

## Linux 历史 Preflight

以下保留 2026-11-09 Linux 阻塞和当时的复现步骤。Windows 本轮结果见上文。

## 依赖准备与基线

Node24/JDK21，根锁文件保持原字节，优先`npm ci`。本轮原锁文件794个resolved URL指向当前策略拒绝的npmmirror。解决方法：只在work/m2/dependencies中的锁文件副本将下载host换到官方registry.npmjs.org，保留全部版本/integrity；隔离`npm ci --ignore-scripts`形成校验后的npm缓存。随后根项目原锁文件`npm ci --offline`成功，实际执行全部postinstall补丁；没有提交临时改写锁文件或关闭补丁。身份核对见evidence/dependency-identity.json。不得把第一轮依赖未就绪的测试失败算作业务回归，也不得删除该失败证据。

已有依赖可直接执行本轮基线命令：

```sh
mkdir -p work/m2 work/m0
python3 -m venv work/m2/venv
work/m2/venv/bin/pip install sqlcipher3-binary==0.6.0
node --test tests/kanataSqliteSchema.test.js tests/kanataSqliteRemediation.test.js tests/kanataSqliteMapping.test.js
npm run check
node docs/qa/kanata-sqlite-m1-r/verify-host.mjs work/m2/venv/bin/python
```

可选`node docs/qa/kanata-sqlite-m2/run-baseline.mjs work/m2/baseline-UNIQUE work/m2/venv/bin/python`顺序运行并保存退出码、UTC起止和日志SHA，输出目录须不存在。脚本scope始终为既有M1/M1-R，不标M2 PASS。本轮实际原始结果在evidence/baseline-command-results.json，不冒称上述可选wrapper就是当时执行入口。

主机SQLCipher为4.12.0 community/SQLite3.51.1，执行原JS升级器、9组检查、2个真实SIGKILL场景；不是Android4.17结果，也未执行尚未实现的M2 Driver/Repository。

## 全新Linux API34环境复现

需要足够磁盘与内存。无KVM时使用正常TCG，不修改WebView sandbox、SELinux或完整性要求。当前SDK来源及SHA见evidence/sdk-artifacts.json。以下只用于全新任务目录；安装器拒绝覆盖SDK内容，启动器拒绝覆盖manifest/占用serial。

```sh
mkdir -p work/m2/android-sdk
curl -fsSL https://dl.google.com/android/repository/repository2-1.xml -o work/m2/android-repository.xml
curl -fsSL https://dl.google.com/android/repository/sys-img/aosp_atd/sys-img2-4.xml -o work/m2/atd-images.xml
curl -fsSL https://dl.google.com/android/repository/platform-tools_r37.0.2-linux.zip -o work/m2/platform-tools.zip
unzip -q work/m2/platform-tools.zip -d work/m2/android-sdk
python3 docs/qa/kanata-sqlite-m2/install-sdk.py
```

镜像为官方API34 AOSP_ATD x86_64 r2，614898904bytes/SHA1 `9ce4068934b26fa99ca104ffe6d10dec22abb317`；检查元数据后稀疏提取，保持全部逻辑字节/ZIP CRC，不裁剪镜像。当前安装器还准备后续候选构建所需compile36/build-tools35与36（AGP默认35），不代表已构建M2。

本地mkfs工具（不是安装到系统目录）：

```sh
curl -fsSL https://deb.debian.org/debian/pool/main/e/e2fsprogs/e2fsprogs_1.47.2-3+b12_amd64.deb -o work/m2/e2fsprogs.deb
curl -fsSL https://deb.debian.org/debian/pool/main/e/e2fsprogs/libext2fs2t64_1.47.2-3+b12_amd64.deb -o work/m2/libext2fs.deb
sha256sum work/m2/e2fsprogs.deb work/m2/libext2fs.deb
dpkg-deb -x work/m2/e2fsprogs.deb work/m2/e2fs-tools
dpkg-deb -x work/m2/libext2fs.deb work/m2/e2fs-tools
python3 docs/qa/kanata-sqlite-m2/start-synthetic-avd.py
```

两deb的SHA256依次为`e9e638eb3e22b5f14d01ce0b28aa512a5a22fcc0e70d1c733444579b67ea236b`、`9f5783fa48239e42260d41846fbc6c8b19c233251063524456096195660eaa09`，必须与本轮值匹配。该启动器把全新1GiB合成ext4放在/tmp独立卷，启用encrypt并保留journal，仅禁用旧内核不支持的orphan_file格式。不是格式化或清理已有用户盘。

本轮首次创建/启动用同一SDK和等价参数的逐项命令执行，后整理为以上拒绝覆盖的复现工具；工具新wrapper仅语法检查，不把语法检查当作另一轮设备测试。每次使用工具实际生成的manifest，不复用本报告中的临时路径假装设备仍存在。

## WebView基础探针

等到`adb -s emulator-5582 shell getprop sys.boot_completed`真实返回1；首次启动包含系统包优化，不能把进程已创建当设备已就绪。探针核对syntheticOnly manifest、精确AVD名kanata_m2_api34、serial emulator-5582、API34、boot状态与无第三方用户App，然后用系统HTMLViewer加载固定data:页面，不含Capacitor/SQLCipher/模型调用。

```sh
python3 docs/qa/kanata-sqlite-m2/probe-webview.py work/m2/device-manifest.json work/m2/webview-probe-UNIQUE
```

保存设备属性、WebView provider、SELinux、launch、PID时间序列、原始logcat和精简崩溃片段。exit2只用于真实CrRendererMain Fatal signal或chromium明确报告renderer crash且有libwebview堆栈；没有崩溃也只标PROBE_OBSERVED_REQUIRES_JS_VERIFICATION，不能冒称JS-to-native产品测试通过。无关系统崩溃不据此归因于WebView。若失败，先定位并尝试不降低安全的环境修复，再决定是否需要用户切换运行环境。

本探针不是M2 Android验收。生产候选APK、instrumentation、JS升级器/Repository/CAS/删除/强停等都必须单独按任务书实跑；未执行明确NOT RUN。

## 最小Capacitor桥接探针（独立于M2实现）

`bridge-probe/`保存本轮最小页面与Java源码，包名固定`com.formyself.qa.m2probe`，只有synthetic ping方法，不含数据库、产品Store或任何真实Key。`prepare-bridge-probe.mjs`可在指定全新work/m2子目录重建同一Capacitor8.4.1骨架；本轮首次按等价逐项命令创建。

```sh
node docs/qa/kanata-sqlite-m2/prepare-bridge-probe.mjs work/m2/bridge-probe-UNIQUE
```

在生成目录建立本地标准debug签名（公开QA口令android）后，沿会话既有proxy/CA，以JDK21、独立GRADLE_USER_HOME和ANDROID_USER_HOME执行`:app:assembleDebug`。CA truststore使用本地JDK副本导入环境公共代理证书，公开默认truststore口令changeit不是应用密钥。不修改根Gradle/依赖或全局CA。完整实际命令随验收记录，APK留work不提交。

安装前必须核对本轮manifest、AVD/API/boot状态、APK applicationId与sha256；只安装上述独立QA包。结果必须读到`window.__M2_PREFLIGHT_RESULT`中syntheticOnly=true、nonce=M2_SYNTHETIC_NONCE，且title=M2_PREFLIGHT_PASS才算最小ping往返；进程存在/构建成功/页面能显示均不够。这个ping即使通过也不是M2 Driver/Repository验收。

## 本轮最终环境结论

系统HTMLViewer的renderer1486与最小Capacitor App的renderer3707均在libwebviewchromium.so的同一BuildId/PC崩溃，code5，随后宿主SIGTRAP。Capacitor实际ping未返回nonce，exit2。绘制开启和关闭合成蓝牙服务都未使该ping通过。根因未确定，不把无KVM直接当唯一因果。

最小QA APK SHA256为`6978be559e6baf990deaf2a7c3175b77ee48fc40f26af4c62ba1cc9dc4d53654`，设备base.apk读回相同。初始WebView探针60秒标签是名义sleep索引、未计ADB耗时，且晚到崩溃发生在采集后；保留原result并另存late-observation/late-logcat，不覆盖初始证据。后续探针改为真实单调耗时和更完整的renderer错误识别；静态未见崩溃仍不标PASS。三个静态观察都不是M2实现后两轮自检。

本目录启动/构建路径为本轮Linux环境工具，不能直接冒充Windows实测。用户已经选择Windows/WHPX；Windows接续需重新核对真实SDK/AVD/syntheticOnly，并完整实施M2生产Driver、Repository、Runtime/UI及所有故障/自检门禁。

实际最小QA最终构建命令如下（truststore与debug口令均为公开开发默认值，不是应用密钥）：

```sh
JAVA_HOME="$PWD/work/m2/jdk21/jdk-21.0.9+10" \
JAVA_TOOL_OPTIONS="-Dhttp.proxyHost=proxy -Dhttp.proxyPort=8080 -Dhttps.proxyHost=proxy -Dhttps.proxyPort=8080 -Djavax.net.ssl.trustStore=$PWD/work/m2/probe-cacerts -Djavax.net.ssl.trustStorePassword=changeit -Dhttp.nonProxyHosts=localhost|127.*" \
ANDROID_USER_HOME="$PWD/work/m2/probe-android-home" \
ANDROID_HOME="$PWD/work/m2/android-sdk" \
GRADLE_USER_HOME="$PWD/work/m2/gradle" \
bash work/m2/bridge-probe/android/gradlew -p work/m2/bridge-probe/android \
--no-daemon --max-workers=1 :app:assembleDebug
node docs/qa/kanata-sqlite-m2/verify-bridge-probe.mjs \
work/m2/device-manifest.json work/m2/bridge-probe work/m2/capacitor-probe
```

调用前已在本轮新AVD中执行`adb -s emulator-5582 shell setprop debug.hwui.drawing_enabled 1`；ping期间`svc bluetooth disable`成功，蓝牙设置读回0。SELinux仍Enforcing，文件加密保持，未设置WebView flags或关闭sandbox。最小APK创建步骤中的keytool使用本地`synthetic-debug.keystore`标准debug签名；不提交该文件。

收尾正常停止本轮两个合成App并关闭AVD，ADB转发已回收；保留任务磁盘/manifest，不clear用户包、不清理旧数据。机器汇总与逐文件SHA记录实际退出码、scope和未运行项。Windows环境未连接是当前外部条件；原M2任务书全部门槛保留。

原始stdout/logcat中有工具自带行尾空白与控制字节；为同时保持原字节和严格`git diff --check`，仅将受影响的新日志副本无损保存为`.gz`，未删除日志内容或放宽Git检查。`evidence/raw-log-archives.json`记录压缩前后SHA与字节数，解压后与work原始文件逐字节一致；未受影响的摘要/JSON/短摘录仍可直接阅读。复核压缩日志示例：`gzip -dc evidence/capacitor-probe/logcat.txt.gz`。历史证据没有修改。
