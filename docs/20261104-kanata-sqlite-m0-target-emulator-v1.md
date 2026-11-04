# M0 目标模拟器同机对照

2026-11-04（北京时间）。用户指定主工作区 `raw/Android - 快捷方式.lnk` 所指环境承担 M0 的设备验收。快捷方式只读解析到 `E:\Android`。本轮使用该目录的 SDK、WHPX 和独立的 Android 14 Google APIs x86_64 AVD `kanata_m0_api34`。2 核、2048 MiB、WebView 113.0.5672.136。数据由 `dataset.mjs` 合成，测试包为 `com.formyself.qa.m0`。验收证据标明模拟器环境，缺实体设备本身不阻断 M0。

## 复现

在独立 M 工作树安装根锁定依赖，生成 8.4.1 QA 项目。下面的 `work/m0/android-8.4.1-REPLACE` 替换为生成目录。

```powershell
node docs/qa/kanata-sqlite-m0/build-android.mjs 8.4.1
node docs/qa/kanata-sqlite-m0/bundle-target-benchmark.mjs work/m0/android-8.4.1-REPLACE
Push-Location work/m0/android-8.4.1-REPLACE
npm.cmd install --save-exact @capacitor/filesystem@8.1.2 @capacitor/preferences@8.0.1 --registry=https://registry.npmjs.org
node scripts/patch-capacitor-preferences.mjs
npx.cmd --no-install cap sync android
.\android\gradlew.bat -p android --max-workers=2 :app:assembleDebug
Pop-Location
node docs/qa/kanata-sqlite-m0/verify-emulator.mjs 8.4.1 --build-dir work/m0/android-8.4.1-REPLACE --bridge-only --target-benchmark json-archive 1000
node docs/qa/kanata-sqlite-m0/verify-emulator.mjs 8.4.1 --build-dir work/m0/android-8.4.1-REPLACE --bridge-only --target-benchmark sqlcipher 1000
```

对 10k、100k 替换末尾数量。驱动核对 AVD、API、合成包身份和启动状态，每个样本在独立 QA App 数据目录内冷启页面。导入后的 `same_process_reopen` 是同进程重新打开数据库或 Store。进程冷启后重开已有数据需额外验证。

## 测量口径

- JSON 使用当前生产 Kanata Store、加密归档仓库、Capacitor Filesystem 与 Preferences、原生 ArchiveFileBatch。SQLCipher 使用社区插件 8.1.1、SQLCipher 4.17.0、WAL、FULL 和每批 256 条，通过 WebView 桥接处理参数与完整消息 JSON。两边复用同一合成夹具与消息内容。
- 每次样本单独执行一次导入与同进程重开，重复五次最近 50、下一页 50 和单条增改删。每条返回消息核对夹具，SQL 额外检查分页查询计划命中索引。浏览器计时包含 bridge 往返。导入前生成 JSON 图的时间未纳入导入计时，SQLite 的分批生成时间计入。
- `SystemInfo.getProcessInfo` 标识 App 主进程与 WebView renderer。读取 `/proc` 的 VmHWM 与 CPU 计数，RSS 分别报告，独立高水位不能当作同一时刻的峰值。JS heap 为浏览器端点读数。数据库和归档字节为关闭后的文件大小。
- 首轮 SQLite 的多条语句写在同一行，漏建索引被查询计划断言捕获。拆成单条后，返回结果的 `wal_autocheckpoint` PRAGMA 需走 query 接口。两轮均保留失败诊断，最终数值只采用修正后的样本。

## 实测结果

最近 50、下一页和单条写入为 P50 / P95，单位 ms。每组五次，采用最近秩，P95 为该组最大值。导入每组执行一次，峰值 RSS 取 App 主进程和 renderer 的较大 VmHWM。

| 条数 | 方案 | 导入 ms | 最近 50 ms | 下一页 50 ms | 单条写入 ms | 最高进程 RSS MiB |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 | JSON/归档 | 1,405.1 | 0.8 / 2.4 | 0.4 / 1.5 | 760.2 / 802.7 | 208.6 |
| 1,000 | SQLCipher | 1,345.3 | 55.5 / 60.7 | 51.7 / 62.3 | 8.6 / 18.0 | 225.7 |
| 10,000 | JSON/归档 | 6,463.5 | 2.0 / 6.0 | 0.7 / 0.9 | 1,761.4 / 1,986.9 | 251.5 |
| 10,000 | SQLCipher | 7,892.0 | 21.7 / 27.6 | 24.6 / 30.9 | 8.0 / 8.9 | 265.5 |
| 100,000 | JSON/归档 | 59,308.0 | 3.6 / 5.7 | 2.8 / 4.1 | 8,437.0 / 9,794.4 | 661.1 |
| 100,000 | SQLCipher | 54,676.1 | 14.6 / 26.8 | 17.0 / 40.9 | 11.9 / 18.8 | 265.1 |

原始样本及其他操作见 [JSON 证据汇总](qa/kanata-sqlite-m0/evidence/target/summary.json)。100k SQLCipher 关闭后数据库为 117,661,696 字节，JSON/归档为 145,005,576 字节。三档的两个方案均返回同一组 100 条消息，两边分别与合成夹具逐条核对。SQL 分页查询计划显示 `SEARCH ... USING INDEX qa_scope_time` 并包含 `(created_at,id)<(?,?)`。JSON 查询命中 Store 内的近期活动数据，SQLite 每页经过原生桥接。

100k 试跑中 SQLCipher 的最近页与下一页 P95 均低于拟议 50 ms，写与改 P95 为 18.8 / 32.1 ms，低于拟议 100 ms。同进程重开单样本 633.4 ms。现有 JSON 的 661.1 MiB 高于原 P7 512 MiB 调查门槛，本轮测量属于 QA 存储探针。完整 App 的改密、恢复、内存与冷启仍按原 P7 验收流程验证。

## 强停和密钥检查

- 以相同 QA 包分别运行 `verify-emulator.mjs 8.4.1 --build-dir <build> --bridge-only --target-crash stage` 和 `--target-crash resume`。第一进程提交行 1，在未提交事务内插入并读到行 2。第二次通过 `am force-stop` 强停后换 PID 重开，保留行 1、回滚行 2，普通与密文完整性检查均通过。此探针沿用社区插件的持久加密偏好 API，覆盖插件崩溃恢复。[强停证据](qa/kanata-sqlite-m0/evidence/target/crash-recovery.json)
- `adb -s emulator-5580 shell am instrument -w -r -e class com.formyself.qa.m0.M0KeystoreTest com.formyself.qa.m0.test/androidx.test.runner.AndroidJUnitRunner` 通过 1 项。AndroidKeyStore AES-GCM 辅助密钥可封装随机 DEK，删除别名后新句柄无法取回。App 自有 SharedPreferences 文件和测试进程 logcat 中未发现该 DEK 的 Base64 或十六进制表示。取证范围为本次辅助密钥探针。[原生检查](qa/kanata-sqlite-m0/evidence/target/keystore-native.txt)
- 设备核验结束后回收 ADB 转发、清理合成 QA 包数据并关闭独立 AVD。容量与安全测试的 App/Test 构建摘要已记录。[APK SHA-256](qa/kanata-sqlite-m0/evidence/target/apk-sha256.json)

## M0 门禁

后续直接原生候选及最终阶段状态见 [M0 会话与门禁](20261104-kanata-sqlite-m0-direct-gate-v1.md)。本节保留本轮同机对照完成时的历史判断。

目标设备按用户指定采用本次模拟器，三档同机对照及隔离强停、Keystore 探针已有证据。M0 尚未放行。社区插件的持久 secret 路径和先前约 7.2–8.7 秒的原生 KDF 封装耗时仍待解决。原生临时会话需要经桥接验证撤销、冷启动和正式密钥流的取证，批量导入及冷启也需重复测量才能冻结参数。Android 512 MiB、完整改密 120 秒和 Web 768 MiB 的 P7 门槛仍适用。
