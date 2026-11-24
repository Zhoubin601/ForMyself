# Kanata SQLite M6-02 第二轮定点整改远端 CI 证据 (`M6-02-FIX-02`)

- **Workflow 名称**：`Quality` ([.github/workflows/quality.yml](../../../.github/workflows/quality.yml))
- **分支**：`m6/encrypted-backup-recovery`
- **待触发 / 回填 Run ID**：（将在推送代码提交后立即执行并回填实际 Run ID、Job ID、Artifact URL 与状态）

## CI 配置与执行范围

1. **`web`**：执行 `npm ci && npm run check`（ESLint、Node 测试、Vitest、TypeScript 类型校验、Vite 构建）。
2. **`android`**：执行无合成标志的标准 `:app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest` 与原有架构验证套件，不混入合成测试代码。
3. **`m6-synthetic-android`（`api-level: [30, 34]`, `target: google_apis`, `x86_64`）**：
   - 验证 `-PkanataM2Synthetic=true -PkanataM6Synthetic=true :app:assembleRelease` 确定性被禁用阻断；
   - 通过 [run-m6-ci.sh](run-m6-ci.sh) 显式启用 `-PkanataM2Synthetic=true -PkanataM6Synthetic=true` 执行 `:app:connectedDebugAndroidTest`，运行：
     - 原有 19 项非基准测试（`KanataM6N01..N04`, `KanataM6SchemeCInteropAndNegativeTest`, `KanataM6F02FaultMatrixTest`）
     - Fix-02 新增 6 项故障注入测试（`KanataM6Fix02FaultInjectionTest`）
     - 3 档 A/C 性能基准测试（`KanataM6AcBenchmarkTest`，每平台 54 样本、两平台共 108 样本）
   - 上传 Artifact `m6-synthetic-api<30|34>-reports`（含 JUnit XML、完整 Gradle 日志、Android Logcat、专项 JSON、`bridge-report.json`、`fault-injection-report.json`、`benchmark-raw-samples.jsonl`、`benchmark-summary.json`、`device-info.txt`、`release-block-check.log`）。
