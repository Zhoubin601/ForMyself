# Kanata SQLite M1 验证

本目录仅保存合成结构测试。生产 Schema 在 `src/features/chat/storage/sqlite/`，没有接入组合根、Store 或原生插件。M0原型的 `qa_messages` 不属于正式Schema。

常规门禁（Node22最新LTS或24，需支持内建`node:sqlite`）：

```sh
node --test tests/kanataSqliteSchema.test.js
npm run check
```

真实SQLite覆盖空库/逐版升级、完整现有领域夹具、跨世界/孤儿/唯一/状态/revision/环拒绝、JSON原文保留、有界keyset查询计划、提交失败、新连接重试、双连接排他以及真正SIGKILL后的DDL/版本回滚。没有模拟SQL解析器，也不依赖网络或Python完成常规测试。

额外主机SQLCipher（M0固定wheel `sqlcipher3-binary==0.6.0`，实际cipher4.12；不能替代Android4.17）：

```sh
node docs/qa/kanata-sqlite-m1/verify-sqlcipher.mjs work/m0/venv/bin/python
```

复用同一JS升级器、DDL和合成夹具，临时数据库和随机密钥仅在worker内存/专用临时目录。stdout只有版本、指纹和检查项，不输出密钥/SQL原生错误。结束后删除worker自己新建的合成库。此前依赖准备见[M0说明](../kanata-sqlite-m0/README.md)。

Android：先按M0说明创建8.4.1独立QA项目；`prepare-android.mjs`只接受work/m0下匹配包身份和精确版本的目录。示例中的REPLACE替换为实际生成目录。

```sh
node docs/qa/kanata-sqlite-m1/prepare-android.mjs work/m0/android-8.4.1-REPLACE
# 配置JDK21、SDK和Gradle代理/CA后，在仓库根执行；Windows用对应gradlew.bat。
bash work/m0/android-8.4.1-REPLACE/android/gradlew -p work/m0/android-8.4.1-REPLACE/android --no-daemon --max-workers=1 :app:assembleDebug :app:assembleDebugAndroidTest
node docs/qa/kanata-sqlite-m1/verify-android.mjs work/m0/android-8.4.1-REPLACE work/m0/m1-device.json
```

`m1-device.json`必须由操作者核对专用合成AVD后创建，内容为`{"syntheticOnly":true,"serial":"emulator-5580","avdName":"kanata_m0_api34"}`；本轮新建的结构探针AVD可用`kanata_m1_schema_api34`。拒绝其他设备、未完成启动/API不符/生产包。脚本只覆盖安装独立QA包，不卸载或清应用数据。JUnit只操作target cache的新随机子目录，用同一生成DDL与夹具验证SQLCipher4.17的约束、事务回滚、索引和重新打开；**它不执行JS升级器或桥接生命周期**。源码检查或APK构建不能替代此设备结果。

最新实际结果和两轮自查见[M1验收v2](../../20261106-kanata-sqlite-m1-report-v2.md)：主机和Android新结构测试已通过。旧[磁盘BLOCKED报告](../../20261106-kanata-sqlite-m1-report-v1.md)保留。云端空间不足时可将合成运行盘放到独立临时卷，见[复现与安全边界](temporary-volume.md)，不绕过资源检查。
