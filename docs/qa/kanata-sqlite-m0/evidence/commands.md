# M0 实际命令、结果与来源

日期 2026-11-03；时间戳原始记录使用 UTC，报告面向用户使用北京时间。仓库 `/workspace/ForMyself`。所有 scratch 在 `work/m0/`；测试目录由 mkdtemp 新建，只生成合成资料。没有真实手机、私聊或私人备份。

## Git

```sh
git status --short --branch
git branch -vv
git rev-parse HEAD
git diff --stat
git ls-remote origin refs/heads/M
git fetch origin M
git fetch origin refs/heads/M:refs/remotes/origin/M
git switch -c M --track origin/M
# 上一步失败：默认 fetch refspec 只有 main；未覆盖任何用户修改
git switch --no-track -c M origin/M
git rev-list --left-right --count HEAD...origin/M
```

初始 work 干净；用户授权后切为 M，HEAD `ac74f0b817ac32f65d9f5e506f094b1515477cc6`，0/0。没有 reset/clean、提交、推送、合并。结束状态以 git-baseline.json / scope-final.json 为准。

## 依赖与平台准备

根 `npm ci` 因锁定 npmmirror 的请求 403 未完成，停止该本轮启动的进程。复制 package、lock、scripts 到 work/m0/deps，TEMP lock 的 794 个 npmmirror tarball 地址换为官方 registry.npmjs.org，版本/integrity 未变：

```sh
npm ci --prefix work/m0/deps
```

exit 0，693 个包，执行并验证四项原 postinstall 补丁。根 node_modules 只链接到临时安装目录；生产 package/lock 无修改。可复现等价命令在 prepare-host-deps.mjs。没有绕过完整性或 TLS 校验。

```sh
npm view @capacitor-community/sqlite@8.1.1 version peerDependencies license dist time repository --json
npm pack @capacitor-community/sqlite@8.1.1 --pack-destination work/m0/vendor
git ls-remote https://github.com/capacitor-community/sqlite.git 'refs/tags/v8.1.1*'
python3 -m venv work/m0/venv
work/m0/venv/bin/pip install sqlcipher3-binary==0.6.0
work/m0/venv/bin/pip download --no-deps sqlcipher3-binary==0.6.0 -d work/m0/vendor
```

均成功。主机 wheel cp312 manylinux x86_64；实际 cipher 4.12.0 community，SQLite 3.51.1。哈希见 download-fingerprints.json。社区插件 tag/README/CHANGELOG 和 release 页面已读取；插件 MIT 和 SQLCipher Community 许可随证据保存。

SDK 下载 URL：`https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip`。接受 SDK 许可并执行：

```sh
work/m0/android-sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root="$PWD/work/m0/android-sdk" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'
```

成功；Gradle 另自动安装 build-tools 35.0.0。运行环境原为 OpenJDK 21 JRE，无 javac。Oracle latest JDK 下载 URL 返回 404；随后使用官方 Temurin 21.0.9+10：

`https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.9%2B10/OpenJDK21U-jdk_x64_linux_hotspot_21.0.9_10.tar.gz`

解包 work/m0/jdk。复制其 CA truststore 到 work/m0/qa-cacerts，用 keytool 导入环境公开 CA `/usr/local/share/ca-certificates/environment-proxy-ca.crt`。truststore 默认口令 changeit 仅保护公开 CA 集，不是应用主密码或数据密钥。代理参数没有附加凭据。未关闭证书验证。

## Android

首轮在 docs 下独立 prototype：npm install、esbuild、`npx --no-install cap add android`、`cap sync android` 成功。Gradle 初次没有 Java proxy → UnknownHost；加 proxy 后发现 JRE 无 compiler。失败日志保留。

最终独立项目准备命令：

```sh
JAVA_HOME=/workspace/ForMyself/work/m0/jdk \
JAVA_TOOL_OPTIONS='-Dhttp.proxyHost=proxy -Dhttp.proxyPort=8080 -Dhttps.proxyHost=proxy -Dhttps.proxyPort=8080 -Djavax.net.ssl.trustStore=/workspace/ForMyself/work/m0/qa-cacerts -Djavax.net.ssl.trustStorePassword=changeit -Dhttp.nonProxyHosts=localhost|127.*' \
ANDROID_HOME=/workspace/ForMyself/work/m0/android-sdk \
GRADLE_USER_HOME=/workspace/ForMyself/work/m0/gradle \
node docs/qa/kanata-sqlite-m0/build-android.mjs 8.3.1
# 同样环境变量，分别运行 8.4.1
```

生成目录：8.3.1 `work/m0/android-8.3.1-izwXPq`；8.4.1 `work/m0/android-8.4.1-14xBaJ`。最初测试缺 androidx.sqlite 编译依赖；试 2.6.2 与运行时 2.4.0 一致解析约束冲突，修正为仅 AndroidTest 显式 2.4.0。没有改插件或生产依赖。

原根级 `assembleAndroidTest` 又构建无关生成 Cordova 库的空测试，出现 Kotlin duplicate classes。没有排除 App 测试，改为明确 App 任务。两套目录都重新拷贝最终 QA app.mjs、`npm run build`、`npx --no-install cap sync android`，再按上述环境执行：

```sh
./android/gradlew -p android --no-daemon --max-workers=2 :app:assembleDebug :app:assembleDebugAndroidTest
```

两者 exit 0，分别 `BUILD SUCCESSFUL in 26s` / `28s`。App 与本次 SqlCipherM0Test 编译/打包成功，**没有运行任何 Android 测试**。原失败、重试、最终日志及 APK SHA256 均保留；最终脚本已经使用正确依赖和 App 任务。

```sh
work/m0/android-sdk/platform-tools/adb devices -l
```

exit 0，无设备条目；无 /dev/kvm、未配置模拟器。没有执行 adb install、强停用户 App 或 connectedAndroidTest；无真实设备性能成绩。

## 主机验证与性能

```sh
node --test docs/qa/kanata-sqlite-m0/key-envelope.test.mjs
work/m0/venv/bin/python docs/qa/kanata-sqlite-m0/verify-sqlcipher.py
node docs/qa/kanata-sqlite-m0/run-host.mjs --smoke
node docs/qa/kanata-sqlite-m0/run-host.mjs
```

早期 sender/count/scope 修正前失败 JSON 已保留。探索性全量结果 host-exploratory-overlap.json 与 Gradle/check 有资源竞争，**不作为正式性能结论**。正式轮在所有 Gradle/check 结束后顺序执行 envelope、安全测试和全量 benchmark，stdout 为 work/m0/host-final-isolated.txt；正式结果复制 host-final.json，完整 SHA256 和开始/结束时间、每次数字在文件内。

```sh
node docs/qa/kanata-sqlite-m0/summarize.mjs work/m0/host-RUN/results.json docs/qa/kanata-sqlite-m0/evidence/performance-summary
npm run check
```

总检查 exit 0：lint、590 Node 测试、42 文件/392 组件测试、typecheck、Vite build。benchmark 的执行范围与 RSS/JS heap/冷热局限见 README/报告，不能用其主机数字替代 Android/Web P7 门槛。summarize 拒绝非完整 30 组正式结果。

## 外部一手来源（引用日 2026-11-03）

- community 官方 README/API/发布记录：`https://github.com/capacitor-community/sqlite/tree/v8.1.1`；npm JSON、tarball integrity、tag 已核对。
- SQLCipher Android POM：`https://repo.maven.apache.org/maven2/net/zetetic/sqlcipher-android/4.17.0/sqlcipher-android-4.17.0.pom`；Community LICENSE：`https://github.com/sqlcipher/sqlcipher/blob/v4.17.0/LICENSE.md`。
- SQLCipher raw key：`https://www.zetetic.net/blog/2019/06/07/technical-guidance-using-random-values-as-sqlcipher-keys/`；API：`https://www.zetetic.net/sqlcipher/sqlcipher-api/`。
- Capgo 候选：`https://capgo.app/docs/plugins/fast-sql/`；npm `@capgo/capacitor-fast-sql@8.2.16` metadata 与包内 Java/Gradle 已读，未安装到 App。原先探测的 `@capgo/capacitor-sqlite` 公共 npm 404，后根据官方来源找到正确包名，没有据错误名字否定该供应商。
- Capawesome：`https://capawesome.io/docs/sdks/capacitor/sqlite/`；`https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/sqlite/README.md`。需 Insiders 私有 registry/许可，本环境无凭据；没有尝试绕过或请求购买。

最终证据核验：`node docs/qa/kanata-sqlite-m0/validate-results.mjs` exit 0，验证30正式运行/360操作样本/源码hash/有界结果/索引/完整性/Android未运行状态。`git diff --check` exit0；生产src/android/package/lock diff为空；结束远端M仍与本地相同。
