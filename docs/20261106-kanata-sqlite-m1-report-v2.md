# Kanata SQLite M1 验收 v2：Android 补测完成

2026-11-06（北京时间），M分支，基线bda1a58。用户要求在当前环境继续完成M1。本报告接续[报告v1](20261106-kanata-sqlite-m1-report-v1.md)，保留v1当时的磁盘BLOCKED及原始证据，不把历史未运行改写为已通过。

**结论：M1 PASS。** 真实SQLite、主机SQLCipher、完整check及新增Android SQLCipher4.17.0结构测试均实际通过。M1限于Schema、约束与版本升级；生产Repository/Store尚未切换，M2未开始，M7/P7性能与完整迁移仍单独验收。

阶段结论、运行范围、源码/设备APK指纹的机器记录见[verification-summary-v2.json](qa/kanata-sqlite-m1/evidence/verification-summary-v2.json)；v1机器记录作为历史检查点保留。

## 结构与阶段验收

定义仍为47表、114触发器、36显式索引，升级链001核心及防护→002访问索引。DDL未因设备补测而修改，Schema SHA256仍为`0f9bda8f7fb594adcbba1860e05922f5936e61bc876b5c632cab086baf18cfbe`。全部集合、PK/UNIQUE/NOT NULL/CHECK/FK、可选字段与原卡JSON的映射及业务校验边界见v1和[精确目录](qa/kanata-sqlite-m1/evidence/schema-catalog.json)、[生成SQL](qa/kanata-sqlite-m1/evidence/schema.sql)。

| M1必须验收 | 本次证据 | 判定 |
| --- | --- | --- |
| 表/键/唯一/外键/索引/状态与领域模型映射 | 真实类型/三套领域校验器映射、生成目录；原生执行同一完整DDL | PASS |
| 禁止跨世界会话成员、消息、关系、记忆/事件来源 | 真实SQLite正负用例；Android同世界完整夹具及跨世界成员/来源拒绝 | PASS |
| 空库逐版升级、失败回滚、重启重试 | JS升级器全部202个写入点故障、已有v1六种失败且文件原字节不变、实际SIGKILL后重开；Android完整DDL回滚及重开 | PASS |
| 未知未来版本拒写、可恢复错误 | 真实SQLite与主机SQLCipher执行同一JS升级器，拒绝未来版本且零DDL/记录写入；异常保留原库和固定错误码 | PASS |
| 非法/重复/孤儿/revision冲突 | 常规15项结构/故障测试；Android额外状态/来源revision/未升revision编辑拒绝；外键与密文完整性 | PASS |

Android JUnit执行的是**同一DDL和合成命令**，不假称在设备执行了JS升级器或生产Driver。JS升级器通过常规真实SQLite和独立SQLCipher连接运行；正式Capacitor Driver、会话桥接与CAS仍属于后续接入。本轮没有用编译成功替代设备运行。

## 环境阻塞如何解决

先前只核对/workspace磁盘，遗漏了独立/tmp卷。实际/workspace空闲约2.0GiB、/tmp约4.9GiB。将本轮新建合成AVD运行盘复制至/tmp独立随机目录后，模拟器正常通过原有资源预检，未关闭/绕过检查，不动用户AVD或真实资料。

隔离AVD为`kanata_m1_schema_api34`，AOSP_ATD Android14/API34、x86_64、TCG软件执行、2560MiB、2核、SwiftShader、320×640@160dpi、1GiB数据分区。实际boot_completed=1、文件加密、SELinux Enforcing；[设备记录](qa/kanata-sqlite-m1/evidence/android-closure/device.json)。首次完整启动320681ms；进程被SIGKILL后正常恢复启动200607ms。它们只是环境启动观察，不是Kanata数据库冷启动或目标手机性能成绩。

模拟器启动已改为独立进程组；恢复仅在确认旧锁PID不存在/僵尸时清理本任务的残留锁，不wipe、不用实验性多实例选项。详细命令见[临时卷复现](qa/kanata-sqlite-m1/temporary-volume.md)，启动工具会明确区分“进程已创建”和“设备已就绪”。

## 原生测试发现与修正

补测准备时，我根据locale初始化函数片段，错误判断默认打开会创建android_metadata。第一轮真实对照显示表数为0，而测试错误预期为1；保留[失败输出](qa/kanata-sqlite-m1/evidence/android-first-attempt/instrumentation.txt)及[失败APK/数据指纹](qa/kanata-sqlite-m1/evidence/android-first-attempt/result.json)。继续核对完整调用路径，SQLCipher4.17检测到codec时会跳过首次locale初始化。这个失败属于测试预期错误，不是已证实的Schema或插件缺陷。

修正为验证默认打开确实为空，既不删除android_metadata，也不放宽升级器对未知结构的拒绝。主机增加同名陌生表的拒绝回归。M1 Android配置显式使用NO_LOCALIZED_COLLATORS保证二进制排序；每次打开通过setForeignKeyConstraintsEnabled(true)配置整个连接池，避免只用单次PRAGMA配置某条连接。随机256-bit原始密钥沿M0验证的字节形式仅在测试内存存在，不通过命令行/报告或Preferences持久化。全局主密码和密钥包装体系未更改。

修正后重新准备合成资产、构建并覆盖安装独立QA App/Test，执行：

```sh
node docs/qa/kanata-sqlite-m1/start-temporary-emulator.mjs --resume work/m0/m1-temporary-avd.json
# boot_completed=1、身份/API检查通过后：
node docs/qa/kanata-sqlite-m1/verify-android.mjs work/m0/android-8.4.1-14xBaJ work/m0/m1-temporary-avd.json
```

路径是本机生成目录，其他环境按QA说明替换；manifest指向本轮专用合成AVD。实际原生调用为：

```sh
adb -s emulator-5580 shell am instrument -w -r -e class com.formyself.qa.m0.SqlCipherM1SchemaTest com.formyself.qa.m0.test/androidx.test.runner.AndroidJUnitRunner
```

结果：`OK (1 test)`，JUnit整条功能测试19.133秒，实际输出`M1_CIPHER_VERSION=4.17.0 community`。涵盖默认空库对照、完整DDL未提交回滚/重新执行、188条真实领域合成命令、非法引用/revision/状态拒绝、外键/密文/普通完整性、keyset索引与关闭重开。耗时不是性能样本，不与M0 P50/P95比较。

| 指纹 | SHA256 |
| --- | --- |
| QA App APK | `51d302da61d6ba0234eed08bd0006f5b9fb72d773f2ac2ade141b07d9a6a7d20` |
| 最终Test APK | `c439c1e35d4b7576e8ef25a01cf200789f12887ae715216188231477e1befb58` |
| 合成领域数据 | `12173bac784fc02bd14b4ded8b6b47cd097897e3717350e99c104ea6f7d984c1` |

JUnit报告实际Schema/夹具指纹，驱动与当前源定义比较；不是仅从本机文件名推断设备版本。[最终原始输出](qa/kanata-sqlite-m1/evidence/android-closure/instrumentation.txt)、[设备运行结果](qa/kanata-sqlite-m1/evidence/android-closure/result.json)、[构建日志](qa/kanata-sqlite-m1/evidence/android-closure/build.txt)。APK二进制只在忽略目录，不发布。

## 完整检查及两轮接续自查

- 本轮重新执行`npm run check`，exit0：605 Node、392组件/42文件、两类类型检查、生产构建通过，lint0错误/42既有警告。[完整输出](qa/kanata-sqlite-m1/evidence/android-closure/check.txt)。
- M1定向15/15复测通过，新增android_metadata陌生结构仍零写入拒绝。[输出](qa/kanata-sqlite-m1/evidence/android-closure/schema-tests.txt)。既有主机SQLCipher4.12检查及同一DDL指纹仍保留，不冒充设备4.17结果。
- 第一轮接续检查聚焦环境/实际设备，找到独立临时卷、修正错误对照预期和连接池配置；实际失败与中断均保留，重新构建和实跑。
- 第二轮聚焦需求/证据，核对M1五项门禁、源码/夹具/设备APK对应关系、完整check、未知结构拒绝及业务未接入边界。设备结果与主机升级器证据分别标注，未用功能耗时宣称性能达标。

## 收尾与边界

仅清理本轮新建临时AVD内`com.formyself.qa.m0`合成测试数据，正常关闭模拟器；[清理记录](qa/kanata-sqlite-m1/evidence/android-closure/cleanup.json)。原M0配置、源合成盘、历史失败和其他业务资料保留；没有真实用户数据读取/删除、没有未完成恢复或挂起设备测试。

M1的原磁盘设备阻塞已解除。仍须后续验证：M2正式Driver/事务/CAS和消息Repository、M4有界Store、M5旧数据导入、M6改密与恢复、M7/P7整应用容量与性能；Android512MiB/完整改密120秒、Web768MiB门槛不变。没有在本报告中宣称生产迁移、全局安全集成或这些阶段已通过。

验收完成时，代码与报告保留在M的本地工作区、尚未提交/推送。用户随后已明确授权提交推送至M，发布记录以Git历史为准。未修改Kanata/main、生产Store/存储访问路径、生产Android项目、根依赖、旧JSON/归档、主密码与备份恢复体系。下一阶段为M2，本轮未开始。
