# Kanata SQLite M1-R QA（2026-11-07）

只使用独立合成数据。入口：[任务书](../../20261106-kanata-sqlite-m1-r-remediation-task-v1.md)、[审计/两轮自检](../../20261107-kanata-sqlite-m1-r-audit-v1.md)、[字段映射](../../20261107-kanata-sqlite-m1-r-field-mapping-v1.md)、[外键明细](../../20261107-kanata-sqlite-m1-r-foreign-keys-v1.md)。正式验收交付在 `output/20261107-kanata-sqlite-m1-r-acceptance-v1.md`（依仓库规则本地忽略，不冒充已提交到GitHub）。原M1 v1/v2与原始证据未覆盖。

## 复现与常规回归

在仓库根，使用支持 `node:sqlite` 的Node24、安装锁文件对应依赖：

```sh
node docs/qa/kanata-sqlite-m1-r/reproduce.mjs
node docs/qa/kanata-sqlite-m1-r/write-audit-docs.mjs
node docs/qa/kanata-sqlite-m1-r/run-regression.mjs
node docs/qa/kanata-sqlite-m1/write-catalog.mjs
```

`run-regression.mjs`逐项运行3个定向测试文件和完整`npm run check`，每次建立独立`work/m0/m1-r-regression-*`，记录真实开始/结束、退出码和指纹；失败返回非零，不将未完成步骤记为通过。也可直接执行：

```sh
node --test tests/kanataSqliteSchema.test.js tests/kanataSqliteRemediation.test.js tests/kanataSqliteMapping.test.js
npm run check
```

修复前复现使用 `git archive a33eda7 src tests/helpers docs/qa/kanata-sqlite-m1/evidence/schema-catalog.json`解到任务自建的`work/m0/m1-r-20261107/before`，仅复制R复现工具和早期新增测试到该临时副本；不切换/重置任何分支。初版10个R测试3通过/7失败是预期的缺陷复现；不能说它们是最终完整新增测试。当前复现脚本在原快照上的直接探针保存在`evidence/reproduction-before.json`，修复后为`reproduction-after.json`。R2/R6前后均符合要求。

常规测试覆盖所有226个空库写入失败点；既有v2追加003的24个写入失败点及提交失败均逐字节保留原库、重新连接重试；另有旧v1失败、时钟错误、实际SIGKILL、双连接独占、keyset计划、跨世界/孤儿/错角色/快照/重复审计/不可逆隐私脱敏和全局ID登记反例。347字段映射从真实类型声明生成，逐目标列核对；108组FK与真实PRAGMA逐项比对，并执行关键父项、叶子删除与延迟提交/回滚。不是M5生产投影/回读测试。

## 主机 SQLCipher

沿用M0已有隔离venv（`sqlcipher3-binary==0.6.0`，实测SQLCipher4.12.0 community/SQLite3.51.1）：

```sh
node docs/qa/kanata-sqlite-m1/verify-sqlcipher.mjs work/m0/venv/bin/python
node docs/qa/kanata-sqlite-m1-r/verify-host.mjs work/m0/venv/bin/python
```

原工具10组检查复测当前003；R工具另9组，执行实际JS升级器，SIGKILL分别命中新应用时间记录和业务+审计未提交事务。后者随机256bit QA密钥只经stdin进入受限worker，父进程内存保留以便崩溃重开；不写argv/env/密钥文件/日志。仅删除自己创建的合成库，拒绝普通SQLite读取并检查cipher/FK/常规完整性。没有验证M6主密码体系或生产密钥生命周期。

## Android 原生范围与实际命令

本轮复用专用QA项目`work/m0/android-8.4.1-14xBaJ`，Capacitor8.4.1、SQLCipher4.17.0。无生产依赖、Android App或Store变更。项目建立方式见[M0 QA](../kanata-sqlite-m0/README.md)。原[M1临时卷工具](../kanata-sqlite-m1/temporary-volume.md)本次生成全新合成AVD克隆：

```sh
node docs/qa/kanata-sqlite-m1/start-temporary-emulator.mjs
node docs/qa/kanata-sqlite-m1-r/prepare-android.mjs work/m0/android-8.4.1-14xBaJ
```

本次实际manifest为`work/m0/m1-tmp-avd-i6zlMu/manifest.json`。新运行必须使用启动工具实际输出的manifest，不能用旧运行路径假装设备仍存在。AVD须为`kanata_m1_schema_api34`、serial `emulator-5580`、API34，工具验证syntheticOnly、包名和精确依赖；拒绝其他设备。实际构建命令（`changeit`只是公开QA CA truststore默认口令，无应用密钥）：

```sh
JAVA_HOME="$PWD/work/m0/jdk" \
JAVA_TOOL_OPTIONS="-Dhttp.proxyHost=proxy -Dhttp.proxyPort=8080 -Dhttps.proxyHost=proxy -Dhttps.proxyPort=8080 -Djavax.net.ssl.trustStore=$PWD/work/m0/qa-cacerts -Djavax.net.ssl.trustStorePassword=changeit -Dhttp.nonProxyHosts=localhost|127.*" \
ANDROID_HOME="$PWD/work/m0/android-sdk" \
GRADLE_USER_HOME="$PWD/work/m0/gradle" \
bash work/m0/android-8.4.1-14xBaJ/android/gradlew \
-p work/m0/android-8.4.1-14xBaJ/android --offline --no-daemon --max-workers=1 \
:app:assembleDebug :app:assembleDebugAndroidTest
node docs/qa/kanata-sqlite-m1-r/verify-android.mjs work/m0/android-8.4.1-14xBaJ work/m0/m1-tmp-avd-i6zlMu/manifest.json
```

原生JUnit一项包含多个结构断言，不能计为数十个独立测试。涵盖空库→003回滚、真实002夹具→003回滚/提交、旧错误快照SQL预检、日志/审计/登记保护、location、业务+审计回滚、隐私脱敏、FK/密文完整性和重新打开。原生只写旧版本未知时间，不伪造由JS采样的003应用时间。**本轮设备未执行JS升级器、生产Driver、消息Repository或全局改密；没有真机性能结果。**

## 证据口径

`evidence/verification-summary.json`给出实际环境、命令退出码、代码/DDL/夹具/APK指纹；原始stdout、JUnit、构建和完整check按本轮新增目录保存。`schema-catalog.json`/`schema.sql`是003的新目录，旧M1目录仍是历史002。空库迁移226写入点不是226个单独Node测试。测试日志中的故意注入错误/本地降级输出不代表测试失败，最终以退出码及测试框架汇总判定。

本次曾发生临时副本目录缺失，修正路径后重新运行；另有两次中间check误共用同一日志文件，已弃用该混合日志，最终凭独立目录的重新实跑及receipt验收。没有把中间结果覆盖成虚假成功。1k/10k/100k性能、目标手机、Android512MiB/完整改密120秒/Web768MiB及P7全需求均不在本轮实测通过范围，门槛保持。
