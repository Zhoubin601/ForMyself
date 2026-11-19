# M6 分支 Android CI 基线修复记录

日期：2026-11-19  
执行模型：Gemini 4 Hydrogen High  
目标分支：`m6/encrypted-backup-recovery`  
基线提交：`4c22b0129244bbae0380edcc8a916c602f9541b9`  
关联 Run：GitHub Actions Quality #44478200157 (https://github.com/Zhoubin601/ForMyself/actions/runs/44478200157)

---

## 一、问题背景

在基线提交 `4c22b01` 触发的 GitHub Actions Quality 工作流（Run #44478200157）中：
- Web Job：PASS（`npm run check` 完整通过）。
- Android Job：编译与单元测试通过，但在执行 Instrumentation 测试阶段发生失败：
  - `com.yubin.formyself.KanataEventActionCompatibilityTest > rawJsonAndDecodedTextHaveSeparateUtf16Contracts` FAILED (`ComparisonFailure: expected:<com.yubin.formyself[.m2qa]> but was:<com.yubin.formyself[]>`)
  - `com.yubin.formyself.KanataSqliteTransactionTest > failedCommitCanRollbackOnPrimaryWriter` FAILED (`ComparisonFailure: expected:<com.yubin.formyself[.m2qa]> but was:<com.yubin.formyself[]>`)

---

## 二、根因分析

1. **断言历史成因**：
   - `KanataSqliteTransactionTest`（M2 引入）与 `KanataEventActionCompatibilityTest`（M4 ER1 引入）在设计之初，主要用于本地独立 Synthetic AVD 验证。
   - 当时本地专用测试脚本通过 Gradle 属性 `-PkanataM2Synthetic=true` 编译 Debug APK，此时 `applicationIdSuffix '.m2qa'` 生效，包名变为 `com.yubin.formyself.m2qa`，且 `BuildConfig.KANATA_M2_SYNTHETIC == true`。
   - 编写两项测试时，作者硬编码了 `assertEquals("com.yubin.formyself.m2qa", context.getPackageName())`（以及在 ER1 测试中硬编码了 `assertTrue(BuildConfig.KANATA_M2_SYNTHETIC)`），以保证测试不意外作用于非测试包。

2. **CI 环境矛盾**：
   - 在标准 CI 流程（`.github/workflows/quality.yml` 及 `docs/qa/architecture-20261026/native/run-ci.sh`）中，构建命令为标准 Debug 构建（无 `-PkanataM2Synthetic=true`），因此 Debug APK 的 `applicationId` 保持为正式包名 `com.yubin.formyself`，`BuildConfig.KANATA_M2_SYNTHETIC` 为 `false`。
   - CI 中的其他测试（例如 `ExampleInstrumentedTest`）明确要求 `appContext.getPackageName()` 为 `com.yubin.formyself`。
   - CI 中的授权命令 `adb shell pm grant com.yubin.formyself android.permission.POST_NOTIFICATIONS` 绑定 `com.yubin.formyself`。
   - 后续执行的 WebView Playwright 端到端测试（`docs/qa/architecture-20261026/native/verify.mjs`）严格依赖 `pkg = 'com.yubin.formyself'`。
   - 业务和安全规范禁止在正式构建中开启 `kanataM2Synthetic` 或更改应用正式包名。

3. **结论**：
   - 两个测试实际验证的是 SQLCipher 底层事务回滚、编码兼容性及独立临时数据库功能，其在执行时均使用 `context.getCacheDir()` 生成随机 UUID 的独立数据库文件并在 `finally` 块中删除，并不依赖 `.m2qa` 独有的业务状态。
   - 硬编码包名断言过度收紧，导致标准 CI 构建下的测试失败。

---

## 三、实施范围核对

1. **build.gradle**：
   - 核对 `android/app/build.gradle`：`kanataM2Synthetic` 保持默认 `false`，仅在显式传入属性时启用 `.m2qa`；生产和常规 Debug 构建不受影响，保持不变。
2. **run-ci.sh**：
   - 核对 `docs/qa/architecture-20261026/native/run-ci.sh`：流程为标准 APK 安装、通知授权、运行 instrumentation、重新安装并启动 WebView Playwright，保持不变。
3. **全部 Instrumentation 测试对 applicationId 和 BuildConfig 的假设**：
   - `ExampleInstrumentedTest.java`：断言 `com.yubin.formyself`（符合标准构建）。
   - `ArchitectureContractTest.java`：使用 `context.getFilesDir()` 和偏好存储，不硬编码包名。
   - `ArchiveFileBatchTest.java`：使用 `context.getCacheDir()`，不硬编码包名。
   - `TodoNativeTest.java`：动态获取 `c.getPackageName()`。
   - `KanataEventActionCompatibilityTest.java`：曾硬编码 `.m2qa` 及 `KANATA_M2_SYNTHETIC == true`。
   - `KanataSqliteTransactionTest.java`：曾硬编码 `.m2qa`。
4. **WebView Playwright**：
   - `docs/qa/architecture-20261026/native/verify.mjs` 中写死 `const pkg = 'com.yubin.formyself'`，严格要求标准应用包名。
5. **最小且一致修复方案**：
   - 修改 `KanataEventActionCompatibilityTest` 和 `KanataSqliteTransactionTest`：
     - 允许包名为 `com.yubin.formyself`（标准 Debug 构建）或 `com.yubin.formyself.m2qa`（合成 QA 构建）。
     - 增加一致性断言：`assertEquals("com.yubin.formyself.m2qa".equals(context.getPackageName()), BuildConfig.KANATA_M2_SYNTHETIC);`，确保包名与合成构建标志严格匹配，避免状态错位。

---

## 四、修改文件

1. `android/app/src/androidTest/java/com/yubin/formyself/KanataEventActionCompatibilityTest.java`
2. `android/app/src/androidTest/java/com/yubin/formyself/KanataSqliteTransactionTest.java`
3. `docs/qa/kanata-sqlite-m6/m6-ci-baseline-fix-v1.md`（本文档）

---

## 五、验证结果

1. **Web 基线验证**：
   - `npm run check` 顺序执行 lint、Node 测试、Vitest、Vue 类型、strict 契约类型和生产构建。
   - 结果：791/791 Node 测试通过，Vitest 全过，生产打包成功（0 错误）。
2. **Android 编译验证**：
   - `gradlew testDebugUnitTest assembleDebug assembleDebugAndroidTest compileDebugAndroidTestJavaWithJavac`
   - 结果：BUILD SUCCESSFUL。
3. **CI 触发与结果**：
   - 提交推送到目标分支 `m6/encrypted-backup-recovery` 后，GitHub Actions 重新运行 Quality 工作流验证。
