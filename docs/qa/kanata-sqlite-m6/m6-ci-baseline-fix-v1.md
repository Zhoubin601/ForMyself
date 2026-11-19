# M6 分支 Android CI 基线修复记录

日期：2026-11-19  
执行模型：Gemini 4 Hydrogen High  
目标分支：`m6/encrypted-backup-recovery`  
基线提交：`4c22b0129244bbae0380edcc8a916c602f9541b9`  
关联 Run 1：GitHub Actions Quality #44478200157 (https://github.com/Zhoubin601/ForMyself/actions/runs/44478200157)  
关联 Run 2：GitHub Actions Quality #44486632381 (https://github.com/Zhoubin601/ForMyself/actions/runs/44486632381)  

---

## 一、问题背景

在基线提交 `4c22b01` 触发的 GitHub Actions Quality 工作流（Run #44478200157）中：
- Web Job：PASS（`npm run check` 完整通过）。
- Android Job：编译与单元测试通过，但在执行 Instrumentation 测试阶段发生失败：
  - `com.yubin.formyself.KanataEventActionCompatibilityTest > rawJsonAndDecodedTextHaveSeparateUtf16Contracts` FAILED (`ComparisonFailure: expected:<com.yubin.formyself[.m2qa]> but was:<com.yubin.formyself[]>`)
  - `com.yubin.formyself.KanataSqliteTransactionTest > failedCommitCanRollbackOnPrimaryWriter` FAILED (`ComparisonFailure: expected:<com.yubin.formyself[.m2qa]> but was:<com.yubin.formyself[]>`)

在修复 Instrumentation 测试（提交 `0d97d3e`）后触发的 Run #44486632381 中：
- Instrumentation 测试阶段 100% 通过（14 passed, 1 skipped, 0 failed；两个原失败测试完全通过）。
- 但紧随其后的 `npm run test:e2e:android`（`docs/qa/architecture-20261026/native/verify.mjs:203`）在第 203 行发生等待超时：
  `TimeoutError: page.waitForSelector: Timeout 120000ms exceeded. waiting for locator('.chat-composer textarea') to be visible`

---

## 二、根因分析

### 1. Instrumentation 测试包名断言问题
- **历史成因**：`KanataSqliteTransactionTest`（M2 引入）与 `KanataEventActionCompatibilityTest`（M4 ER1 引入）在设计之初主要用于本地独立 Synthetic AVD 验证，当时通过 Gradle 属性 `-PkanataM2Synthetic=true` 编译，包名为 `com.yubin.formyself.m2qa`，测试中硬编码了此包名和 `BuildConfig.KANATA_M2_SYNTHETIC == true`。
- **CI 环境矛盾**：标准 CI 流程使用常规 Debug 构建（无 `-PkanataM2Synthetic=true`），包名保持为生产正式包名 `com.yubin.formyself`，`BuildConfig.KANATA_M2_SYNTHETIC` 为 `false`。
- **事实依据**：两项测试使用 `context.getCacheDir()` 生成随机独立 SQLite 数据库并在 `finally` 块中清理，并不依赖真实业务 DB 或 `.m2qa` 后缀独有能力。

### 2. WebView Playwright (`verify.mjs`) 聊天选择器超时问题
- **历史成因**：`verify.mjs` 是 2026-10-26 针对 P6 架构编写的端到端自动化验收脚本。在 P6 阶段，`moduleRegistry.get('chat')` 对应的是 `src/features/chat/ChatView.vue`，其中包含 `.chat-composer textarea`。
- **架构演进**：在后续 Kanata 架构重构中，`moduleRegistry.js` 中的 `chat` 模块视图已切换为 `KanataView.vue`，受保护 Store 切换为 `useKanataStore`（`protectedModules.js` 中 `chat` 解析为 `useKanataStore`），且 `tests/chatViewResources.test.js` 有强契约断言 `assert.notEqual(moduleRegistry.get('chat').name, 'ChatView')`。
- **矛盾点**：在空数据冷启动下，切换到 `chat` 路由展示的是 `KanataView`（未初始化状态展示 `KanataSetupView`，准备就绪后展示 `KanataWorldManager`），页面不存在 `.chat-composer textarea`。此外，测试中原先对 `stores.get('chat').messages` 的断言在当前以 `stores.get('kanata')` 为受保护载体的架构下不匹配。

---

## 三、实施范围核对

1. **build.gradle**：
   - 核对 `android/app/build.gradle`：`kanataM2Synthetic` 保持默认 `false`，仅在显式传入属性时启用 `.m2qa`；生产和常规 Debug 构建不受影响，严格保证正式包名及生产构建配置不被意外修改。
2. **run-ci.sh**：
   - 核对 `docs/qa/architecture-20261026/native/run-ci.sh`：流程为标准 APK 安装、通知授权、运行 instrumentation、重新安装并启动 WebView Playwright，保持不变。
3. **全部 Instrumentation 测试对 applicationId 和 BuildConfig 的假设**：
   - `ExampleInstrumentedTest.java`：断言 `com.yubin.formyself`（符合标准构建）。
   - `ArchitectureContractTest.java`：使用 `context.getFilesDir()` 和偏好存储，不硬编码包名。
   - `ArchiveFileBatchTest.java`：使用 `context.getCacheDir()`，不硬编码包名。
   - `TodoNativeTest.java`：动态获取 `c.getPackageName()`。
   - `KanataEventActionCompatibilityTest.java`：已放宽包名，并增加包名与 `BuildConfig.KANATA_M2_SYNTHETIC` 的严格一致性断言。
   - `KanataSqliteTransactionTest.java`：已放宽包名，并增加包名与 `BuildConfig.KANATA_M2_SYNTHETIC` 的严格一致性断言。
4. **WebView Playwright**：
   - `docs/qa/architecture-20261026/native/verify.mjs` 中写死 `const pkg = 'com.yubin.formyself'`，严格依赖正式应用包名。
5. **最小且一致修复方案**：
   - **Instrumentation**：保留正式包名 `com.yubin.formyself`，修改两处测试断言以同时支持标准构建与合成 QA 构建，且保证包名与标志位一致。
   - **WebView Playwright**：
     - 在 `captureNative` 中将 `native-chat.png` 的 selector 支持当前视图容器（`.chat-composer textarea, .kanata-form textarea, .kanata-manager, .kanata-frame, .kanata-setup`），并使用 `.first().waitFor({state:'visible'})` 避免 strict mode violation。
     - 在进入 `chat` 时，自适应识别当前是旧版 `ChatView` 还是当前 `KanataView`：
       - 若为 `KanataView` 且未准备好，点击“开始准备彼方”并“确认清理并准备”建立世界；
       - 进入会话列表首个私聊，填写“合成原生测试消息”，点击“发送消息”；
       - 等待 mock 回复（`合成回复：原生验证`）保存并更新至 `stores.get('kanata').snapshot.messages`。
     - 在后台敏感数据释放断言与重新进入受保护模块时，同时检查 `kanataStore`（`snapshot === null`）与兼容旧版 `chatStore`（`messages.length === 0`）。
     - 在主密码修改后的冷启动验证中，同时检查 `kanataStore` 与 `chatStore` 中是否成功解密保留了“合成原生测试消息”。

---

## 四、修改文件

1. `android/app/src/androidTest/java/com/yubin/formyself/KanataEventActionCompatibilityTest.java`
2. `android/app/src/androidTest/java/com/yubin/formyself/KanataSqliteTransactionTest.java`
3. `docs/qa/architecture-20261026/native/verify.mjs`
4. `docs/qa/kanata-sqlite-m6/m6-ci-baseline-fix-v1.md`（本文档）

---

## 五、验证结果

1. **Web 基线验证 (`npm run check`)**：
   - ESLint：0 错误。
   - Node 测试：791/791 通过。
   - Vitest 组件测试：54/54 通过。
   - TypeScript/Vue 类型检查：通过（0 错误）。
   - Vite 生产打包：成功。
2. **Android 编译验证**：
   - `gradlew testDebugUnitTest assembleDebug assembleDebugAndroidTest compileDebugAndroidTestJavaWithJavac`：BUILD SUCCESSFUL。
3. **Instrumentation 测试验证**：
   - GitHub Actions Run #44486632381 实测：`:app:connectedDebugAndroidTest` 14 个测试全过，1 个跳过（`TodoWidgetHarness.launcherFixture`），0 个失败。原失败的两个测试均通过。
4. **WebView Playwright 语法与静态校验**：
   - `node --check docs/qa/architecture-20261026/native/verify.mjs` 通过。
