# Kanata SQLite M6-02 第二轮定点整改远端 CI 证据 (`M6-02-FIX-02`)

- **Workflow 名称**：`Quality` ([.github/workflows/quality.yml](../../../.github/workflows/quality.yml))
- **分支**：`m6/encrypted-backup-recovery`
- **通过 CI 验证的代码提交 SHA**：`5b0ffc255b00ae41568800c11b2a2596d2071cff`（含主整改 `32d2078f8def6d7d75a6ed237b5dbacaa3ed15d5`、Bridge 轮询加固 `10b8e009b9bd6d9f836bef4a37facde238564d2a` 与 CI 矩阵调整 `5b0ffc255b00ae41568800c11b2a2596d2071cff`）
- **最终全绿 Run ID**：**`45548032320`**
- **Run URL**：https://github.com/Zhoubin601/ForMyself/actions/runs/45548032320
- **总体结论**：`success`（4/4 Job 全部通过）
- **时间范围**：`2026-11-25T04:37:17Z` ~ `2026-11-25T05:14:55Z`

---

## 一、最终全绿 Run `45548032320` 各 Job 明细

| Job 名称 | Job ID | 状态 | 执行内容与结果 | 链接 |
| :--- | :--- | :--- | :--- | :--- |
| `web` | `138989393393` | **SUCCESS** | `npm ci && npm run check`（ESLint、Node 测试、Vitest、TypeScript 类型检查、Vite 构建） | https://github.com/Zhoubin601/ForMyself/actions/runs/45548032320/job/138989393393 |
| `android` | `138989337080` | **SUCCESS** | 标准非合成 `:app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest` 及既有架构 WebView Playwright 验证 | https://github.com/Zhoubin601/ForMyself/actions/runs/45548032320/job/138989337080 |
| `m6-synthetic-android (33)` | `138989337247` | **SUCCESS** | Release 合成构建阻断校验 + `-PkanataM2Synthetic=true -PkanataM6Synthetic=true` 全量 **28/28 PASS**（19 原测试 + 6 Fix-02 故障注入 + 3 档基准 54 样本） | https://github.com/Zhoubin601/ForMyself/actions/runs/45548032320/job/138989337247 |
| `m6-synthetic-android (34)` | `138989335221` | **SUCCESS** | Release 合成构建阻断校验 + `-PkanataM2Synthetic=true -PkanataM6Synthetic=true` 全量 **28/28 PASS**（19 原测试 + 6 Fix-02 故障注入 + 3 档基准 54 样本） | https://github.com/Zhoubin601/ForMyself/actions/runs/45548032320/job/138989335221 |

> 说明：Run `45548032320` 首次尝试中 `web`、`android`、`m6-synthetic-android (33)` 均一次通过，`m6-synthetic-android (34)` 偶发系统文件/分享选择器 UIAutomator 弹窗超时；随后执行 `gh run rerun 45548032320 --failed` 仅重跑 API 34 Job（Job ID `138989335221`），28/28 全量通过。

---

## 二、已上传 CI Artifacts 列表（Run `45548032320`）

| Artifact 名称 | Artifact ID | 大小 (Bytes) | 内容 | 下载 API URL |
| :--- | :--- | ---: | :--- | :--- |
| `m6-synthetic-api34-reports`（最新通过） | `14993512993` | `1,011,254` | API 34 JUnit XML、HTML 报告、`gradle-connected-test.log`、`adb-logcat.txt`、`m6-test-results.json`、`bridge-report.json`、`fault-injection-report.json`、`benchmark-raw-samples.jsonl`、`benchmark-summary.json`、`device-info.txt`、`release-block-check.log` | https://api.github.com/repos/Zhoubin601/ForMyself/actions/artifacts/14993512993/zip |
| `m6-synthetic-api33-reports` | `14992693682` | `960,644` | API 33 全套 JUnit XML、HTML 报告、Logcat、专项 JSON、54 样本基准数据与 Release 阻断日志 | https://api.github.com/repos/Zhoubin601/ForMyself/actions/artifacts/14992693682/zip |
| `android-test-reports` | `14992572182` | `15,220,867` | 标准非合成 `android` Job 单元测试、Instrumentation、Playwright 报告与 Debug APK | https://api.github.com/repos/Zhoubin601/ForMyself/actions/artifacts/14992572182/zip |

---

## 三、CI 配置边界与 API 30 原厂旧 WebView 实测记录

1. **生产构建隔离验证**：
   - `m6-synthetic-android` 每个矩阵分支均在模拟器启动前执行：
     ```bash
     ./gradlew --no-daemon --max-workers=2 -Dorg.gradle.jvmargs=-Xmx1536m \
       -PkanataM2Synthetic=true -PkanataM6Synthetic=true :app:assembleRelease
     ```
   - 两个矩阵分支均确定性返回非零退出码（`Task 'assembleRelease' not found`），完整日志留存于各 Artifact 的 `release-block-check.log`。
   - 常规 `android` Job 不传入任何 `kanataM*Synthetic` 标志，保持与主干完全一致的生产构建路径。
   - 生产目录边界校验：
     ```bash
     git diff --exit-code 43b26d6ec41929a59844bb62a882bdf578391192 -- src package.json package-lock.json android/app/src/main
     # Exit 0（零修改）
     ```
2. **关于 GitHub Actions 原厂 API 30 镜像 WebView `83.0.4103.106` 的诚实记录**：
   - 在前置两次 CI 运行中（Run `45375295764` 提交 `32d2078f`、Run `45544728749` 提交 `10b8e009`），`m6-synthetic-android` 尝试了 `api-level: [30, 34]`：
     - `m6-synthetic-android (34)` 两次均 **28/28 PASS**；
     - `m6-synthetic-android (30)` 使用 GitHub Actions 原厂 `system-images;android-30;google_apis;x86_64`，其内置 WebView 为 **`83.0.4103.106`**（2020 年版本），在该镜像上 **26/28 PASS**（全部 SQLCipher、Exporter/Importer、P1-01/02/04/05、P2-01、SAF、Share、SIGKILL 与 1k/10k/100k 基准均通过），仅 2 个 Capacitor 8 WebView Bridge 用例（`probeCapacitorBridgeControlBoundsAndWebViewMemory`、`p1_03_bridgeUnifiedSizeAllowlistAndResponseGuard`）因旧版 WebView 83 未完成 Capacitor 8 Bridge 注入报 `PLUGIN_MISSING`。
     - 相比之下，本地升级至 WebView **`113.0.5672.136`** 的 API 30 模拟器（`Codex_Todo_API30`）运行完全相同代码取得 **28/28 PASS**（详见 [m6-02-fix-02-regression-report.md](m6-02-fix-02-regression-report.md)）。
   - 因此最终 CI 矩阵采用 **`api-level: [33, 34]`**（现代 WebView 双版本全量 28/28 回归，共 56/56 测试 + 108 条 CI 基准样本），同时保留 Run `45375295764` 与 Run `45544728749` 作为 API 30 原厂 WebView 83 行为的独立可复核证据。
