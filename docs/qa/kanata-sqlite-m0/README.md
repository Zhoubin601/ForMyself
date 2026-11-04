# Kanata M0 隔离验证

仅 M0；不接入生产 Repository、Store、密码、恢复或依赖。全部资料由 `dataset.mjs` 合成。正式结论见 `../../20261103-kanata-sqlite-m0-report-v1.md`。

后续已安装并启动 Android 14 软件模拟器，完成两套原生加密测试；WebView 桥接遇独立崩溃。当前设备补测状态见 `../../20261103-kanata-sqlite-m0-emulator-verification-v1.md`，首轮 NOT RUN 不覆盖这些新增结果。M0 仍 BLOCKED。

evidence 下的 `.txt` 是原始终端输出，保留工具产生的 CRLF、尾随空格和末尾空行；局部 `.gitattributes` 仅对这些输出及原样保存的 `upstream-changelog.md` 关闭文本换行转换/空白格式检查。项目源码、报告、JSON/CSV 继续正常检查，不为排版修改原始测试记录。

## 执行清单与来源

基线：M / `ac74f0b817ac32f65d9f5e506f094b1515477cc6`。用户明确授权拉取并切换最新 M；开始时无用户修改。最初 `git switch --track` 因仓库仅配置 main fetch refspec 失败，随后 `git switch --no-track -c M origin/M` 成功；HEAD 与 origin/M 差异 0/0。

已核对：根 AGENTS、架构说明书、20261103 M 计划、20261028 连贯计划；package/lock；Kanata Store/Repository/archive/planner/types/validators；passphraseAes；protectedModules/protectedAccess/auth/masterPasswordSecurity/masterPasswordChange/useSecuritySettings；fullBackupRuntime/kanataBackupRuntime/backupParticipants/backupRegistry/restoreCoordinator/restoreJournal/kanataBackup；Android Gradle/variables/manifest。无真实聊天或私人备份读取。

执行顺序：前置检查 → 实际架构调查 → 插件/npm/发布/源码/许可证核实 → 隔离原型与加密负例 → 1k/10k/100k 对照（每场景 5 次）→ 备份及改密影响分析 → 两轮自查、修正与复测 → BLOCKED/PASS/FAIL 报告。禁止进入 M1。

## 主机复现

在仓库根执行（需要 Node 24、Python 3.12，安装根锁定依赖）。常规使用 `npm ci`；若受限网络拒绝锁中的 npmmirror，在**无 node_modules 的干净环境**运行 `node docs/qa/kanata-sqlite-m0/prepare-host-deps.mjs`。该替代仅在 work 下改 tarball 镜像来源，保留版本/integrity，执行原 postinstall；不修改生产 package/lock。

```sh
mkdir -p work/m0
python3 -m venv work/m0/venv
work/m0/venv/bin/pip install sqlcipher3-binary==0.6.0
node --test docs/qa/kanata-sqlite-m0/key-envelope.test.mjs
work/m0/venv/bin/python docs/qa/kanata-sqlite-m0/verify-sqlcipher.py
node docs/qa/kanata-sqlite-m0/run-host.mjs --smoke
node docs/qa/kanata-sqlite-m0/run-host.mjs
# 使用上一步打印的 results.json 路径
node docs/qa/kanata-sqlite-m0/summarize.mjs work/m0/host-REPLACE/results.json work/m0/summary
npm run check
```

SQLCipher wheel 0.6.0 实际引擎为 **4.12.0 community / SQLite 3.51.1**，不是 Android 插件的 4.17.0。`requirements-host.txt` 固定 QA 包版本；轮子 hash 见证据。密钥仅随机生成并经进程 stdin 传递，不写 argv/env/普通偏好或结果。

JSON 侧直接导入当前生产 Store/Repository/加密/归档代码，注入限定到新建临时目录的 Node fs 驱动，写文件执行 fsync；journal 用加密内容文件模拟 Preferences，**不等同 Android Preferences/桥接 I/O**。通过 `restoreSnapshot` 使用原有 >1000/会话归档路径；普通写入执行实际 `store.update` + flush。按 ID 定位用活动消息查找或原归档页读，无激活写副作用；删除仅删除本次新插入、未被引用的合成消息。

SQLCipher 侧是独立 Python 服务，Node 按 256 条导入，查询每次最多 50 条。唯一 qa_messages 表和 qa_scope_time 索引只是 M0 测试形状，保留完整 Message payload，**不是 M1 Schema**，不具备完整领域校验/审计/跨表约束。主机随机 raw key 避免重复 SQLCipher 口令 KDF，与原插件持久 secret API 的打开成本不同。

两侧消息内容/分布/指纹相同；扫描核对每个会话的完整 payload hash、总数、顺序、时间戳并列及世界范围；keyset 不使用 OFFSET。不强制 GC。场景序列固定、引擎顺序交替；正式轮需停止 Gradle/check 等竞争任务。冷启动指新 Node/Python 进程，**不清 OS 文件缓存**；热启动为同进程关闭再打开，不是 UI 启动。

RSS：外部 10ms 采样 Node+Python RSS，并保留两进程 rusage 高水位；相加是保守上界，不能当同时发生的精确峰值。每操作高水位包含此前操作。JS heap 为操作端点和 V8 GC 记录观察最大值，含 GC 次数/external；**不是每操作精确瞬时峰值**。原始结果保留这些限制，不用它替代 Android/Web P7 内存测量。CPU = Node user+system + SQLCipher 服务该请求 CPU。数据库/WAL 按操作采样，文件总大小在关闭后计数。

## Android 复现

需要 JDK 21 **含 javac**、SDK platform 36、build-tools 35/36、可访问 Gradle/Google/Maven；设置 JAVA_HOME、ANDROID_HOME、GRADLE_USER_HOME。云环境 Java 还需遵从会话 HTTP proxy 与 CA；本轮使用 `work/m0/qa-cacerts` 导入环境 CA，未关闭 TLS 校验。详见 evidence/commands.md。

```sh
node docs/qa/kanata-sqlite-m0/build-android.mjs 8.3.1
node docs/qa/kanata-sqlite-m0/build-android.mjs 8.4.1
```

脚本生成独立 `com.formyself.qa.m0` 应用并构建 Debug/AndroidTest APK，关闭系统备份/迁移；不操作生产 Android。8.3.1 使用随附 prototype 锁；8.4.1 优先使用 evidence 固定锁。只有首次建立 8.4.1 证据时才解析并冻结新 QA 锁。生成物都在 work，最终不发布 APK。

在新环境构建时，work 下目录后缀由 mkdtemp 生成。设备驱动可显式接收该次构建输出路径：`node docs/qa/kanata-sqlite-m0/verify-emulator.mjs 8.3.1 --build-dir work/m0/android-8.3.1-REPLACE`。参数必须指向 work/m0 下、名称/包身份/Capacitor 版本均匹配的独立 QA 项目；省略参数沿用本轮记录中的目录。

无设备时不要运行 connectedAndroidTest。之后仅可在明确隔离的合成设备上，安装生成的 QA App/Test 包，并执行：

```sh
adb devices -l
# 先选择/确认隔离合成测试设备。此处仅给命令，不代表本轮执行过。
adb -s QA_SERIAL install -r -t work/m0/android-VERSION-RUN/android/app/build/outputs/apk/debug/app-debug.apk
adb -s QA_SERIAL install -r -t work/m0/android-VERSION-RUN/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s QA_SERIAL shell am instrument -w -r com.formyself.qa.m0.test/androidx.test.runner.AndroidJUnitRunner
```

`SqlCipherM0Test` 验证引擎；QA 页按钮才经过 Capacitor 桥接。两者均不能替代进程强停、偏好/日志抓取、Keystore、100k 真机性能与完整会话生命周期测试。桥接 secret 仍经原插件持久加密偏好存储，是已记录限制，不能作为生产设计。

## 待补门禁

真实目标手机及型号/系统/RAM/CPU/存储/电源温度；Android 桥接运行与强停；密钥/日志/Preferences 扫描与 Keystore 失效；安全临时密钥 API；Android KDF 校准与完整改密/恢复中断；原 P7 所有 Android/Web 门槛。M0 BLOCKED 时不进入 M1。
