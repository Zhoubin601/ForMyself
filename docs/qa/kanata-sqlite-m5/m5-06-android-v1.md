# M5-06 Android SQLCipher 合成验收

- 日期 2026-11-18
- 工作分支 `m5/json-archive-migration`
- 验收基线 `3ff66376776f46659dfc91bcbd34b9a43abfcb5e`
- 测试实现 `a781563d25e1dab66f2f18046df5b80032e09a78`
- **BLOCKED**，本地执行结果见下文，同 SHA Web CI 与独立人员复核待完成。

本次使用新建隔离的 Windows/WHPX API 34 Android 14 模拟器（`kanata_m2_api34`，`emulator-5582`），WebView `113.0.5672.136`。SQLCipher 为 Gradle 锁定的 `net.zetetic:sqlcipher-android:4.17.0@aar`，运行时报告 `4.17.0 community`。原生桥实现沿用 `KanataSqlitePlugin.java`，其 SHA-256、安装读回的候选与测试 APK SHA-256、catalog 和 WebView QA bundle SHA-256 见[机器记录](m5-06-evidence-v1.json)。数据全由确定性逻辑 seed `m5-06-v1` 生成，密文盐与测试密钥在每轮随机生成。

## 命令与检查

以下命令在已授权的独立 M5 worktree 及本轮新建的合成 AVD 上执行。构建资产来自候选 QA 页。原生脚本验证 manifest、序列号、API、安装包名与读回指纹。只有初始场景之间重置本轮 QA 包，强杀恢复期间保留原库。

```powershell
$manifest = & docs/qa/kanata-sqlite-m2/start-windows-synthetic-avd.ps1
node --test tests/kanataSqliteDataMigration.test.js tests/kanataSqliteMigration.test.js tests/kanataSqliteEncryptedLegacySource.test.js
npm run check
# 在隔离工作树内将候选入口置为 QA 页后同步。
New-Item -ItemType Directory -Path dist -Force | Out-Null
Copy-Item -LiteralPath docs/qa/kanata-sqlite-m2/candidate-assets/public/index.html -Destination dist/index.html
node node_modules/@capacitor/cli/bin/capacitor sync android
.\android\gradlew.bat -p android --offline --max-workers=2 -PkanataM2Synthetic=true -PkanataM5Synthetic=true :app:assembleDebug :app:assembleDebugAndroidTest
node docs/qa/kanata-sqlite-m5/run-android.mjs $manifest smoke
node docs/qa/kanata-sqlite-m5/run-android.mjs $manifest full
node docs/qa/kanata-sqlite-m5/run-android.mjs $manifest 100k
```

- 定向测试退出 0，42 通过，0 失败，0 跳过。完整 `npm run check` 退出 0，Node 785 通过，Vitest 420 通过（45 文件），两套类型检查及 Web 构建通过，ESLint 0 错误、61 警告。
- 原生 instrumentation **2/2 通过**。独立临时库的密文没有明文 SQLite 文件头或 sentinel，系统 SQLite 和错误 SQLCipher 密钥拒绝读取，正确密钥重开并精确回读 sentinel。关闭后连接失效。独立 COMMIT 测试证明延迟外键约束失败后可在原写连接回滚。
- 55 条消息（2 活动、53 归档）完整导入。50 张目标表的计数与宿主 SQLite Oracle 一致，非空表精确值哈希逐表一致。归档标记、生活来源、未知扩展及 Unicode 正文保真。外键检查 0 行，完整性检查为 `ok`，重复导入零写入。原生释放后旧操作句柄被拒绝。
- 容量、主源和恢复负例使用相同加密 Repository 和导入器。源密文及 recovery journal 值逐字节一致，只有读取、stat、隔离内存归档列表调用。普通目录 723 条记录与基线生成结果逐字节一致，QA 目录 953 条记录。Schema 001–005 和 application ID 相同。普通 APK 构建未运行。

## 强杀与冷启动

| 中断点 | 新进程读取的已提交状态 | 重试 |
|---|---|---|
| 首批提交前，dataset 与游标已在事务内写入 | dataset 0 行，消息 0，归档游标 0/0，manifest pending | 导入完成 |
| 归档批次中，已在事务内写入消息及归档标记 | 消息与归档标记均为 0，归档游标 0/0 | 导入完成 |
| 首个归档批次成功提交之后 | 50 条消息和归档标记，3 条来源关系，游标 1/0 | 从下一页续接 |
| 数据批次全部提交，最终验证前 | 55 条消息、53 个归档标记，游标 2/0，manifest running | 完成最终验证后返回 `complete` |

四种测试均证明 PID 变化、源在强杀前与续传后不变，第二次复跑返回 `already-complete` 且无目标写入。错密钥、变化的有效源指纹、篡改归档、恢复态源及非空目标均拒绝。后四项在原事务追踪中无迁移写入，目标状态未变化。

## 容量

| 合成消息数 | 导入及最终校验（秒） | 消息批次 / 最大项数 | 批次均值 / 最大（ms） | 峰值 RSS（MiB） | 库体积（MiB） | 最近 / 历史分页（ms） | 结果 |
|---|---:|---:|---:|---:|---:|---:|---|
| 1,000 | 9.00 | 21 / 50 | 254.4 / 358.9 | 403.6 | 2.01 | 5.9 / 6.4 | PASS |
| 10,000 | 42.13 | 201 / 50 | 177.3 / 270.1 | 411.0 | 11.72 | 1.7 / 2.2 | PASS |
| 100,000 | 373.36 | 2001 / 50 | 168.2 / 303.7 | 568.3 | 109.91 | 1.3 / 1.0 | PASS |

三档均完成 50 张表核对，外键检查 0 行，完整性检查为 `ok`。RSS 每约一秒采样，取 QA App 和隔离 WebView renderer 的 RSS 加总峰值，不去重共享页。批次时长测量消息写入事务，最近与历史分页为同会话 50 行的目标 SQL keyset 测量。库体积在关闭连接后记录 SQLite 主文件字节。精确字节、fixture 指纹和批次数据见[机器记录](m5-06-evidence-v1.json)。

## 失败记录与未覆盖项

- 首次 Android 编译失败于误引 SQLCipher 异常类，改用实际 Android SQLite 异常类型后重建通过。首轮宿主目录校验的文本匹配把现有 DDL 和归档保护引用误算成 M5 运行语句。修正校验后，比较基线目录完整字节、Schema 元数据和 M5 journal 更新的目录归属。
- 首轮四个强杀场景、1k 和 10k 均通过。最后一种场景暴露了调用结果提前返回 `already-complete` 的状态问题。现已区分 manifest 未验证与已完成，增加 Node 回归并重跑原生矩阵。
- [基线 Quality CI](https://github.com/Zhoubin601/ForMyself/actions/runs/44280547214) Web 通过，Android 按分支策略跳过。实施 SHA 仅有本地证据，远端同 SHA CI 尚未运行。独立人员复核待完成。没有实体设备实测、真实用户数据迁移、生产接线或 APK 分发。
- 本轮 QA 包和模拟器已停止，移除同步生成的 QA 入口副本。只保留隔离测试资产与脱敏验收记录。
