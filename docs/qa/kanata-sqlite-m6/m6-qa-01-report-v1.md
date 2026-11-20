# M6-QA-01：KanataView 聊天收发验收语义与 Playwright 健壮性整改记录

- 日期：2026-11-20
- 执行模型：Gemini 4 Hydrogen (High)
- 任务编号：`M6-QA-01`
- 目标分支：`m6/encrypted-backup-recovery`
- 起点基线：`0b258e21d7ccff56388a92995073d5f4276a8d7d`（Quality `#44678646569` Web + Android 全绿通过）
- 代码修复与实机全绿验收 SHA：`522d26455f72e62b19d9fe7a5624e99837424893`
- 实机全绿 CI Run ID：[Quality #44684735609](https://github.com/Zhoubin601/ForMyself/actions/runs/44684735609)（前序尝试 `541a2d22e0119b81a8638c5e24fd39b5a7ed7305` / Run `#44681563409` 因 Playwright 第 6 次冷启动 `device.webView({ pkg })` 竞态失败，已于 `522d264` 修复）
- 文档同步提交与最终 SHA CI Run ID：由本记录同步提交触发，最终 SHA 与对应 Run ID 在最终交付阶段核验并另行报告（不在同提交内自指未生成的提交哈希）

---

## 一、整改结论

**`M6-QA-01` 代码修复与 Web + Android 全链路验收已通过。**

本次整改在严格不修改任何 Kanata 生产业务架构、SQLCipher 数据库、Schema 001–005、迁移器、主密码事务与完整备份格式的前提下，解决了独立复核提出的三项问题（`M-01`、`M-02`、`L-01`），并修复了第 6 次冷启动时 Playwright `device.webView({ pkg })` 的进程名匹配竞态。

---

## 二、问题定位与修复前后行为对比

### 1. M-01：KanataView 聊天收发验收语义不准确（Medium）

- **代码位置**：`docs/qa/architecture-20261026/native/verify.mjs`、新增 `docs/qa/architecture-20261026/native/runtimeAdapter.mjs`。
- **业务入口核实**：经阅读 `KanataView.vue`、`KanataSetupView.vue`、`KanataWorldManager.vue`、`KanataConversationView.vue`、`kanataRuntime.js` 与 `kanataChatRuntime.js`，确认当前 `KanataView` 存在完整、受支持的消息发送入口：
  `KanataSetupView`（`开始准备彼方` → `确认清理并准备`）→ `KanataWorldManager`（`.kanata-conversation-list` 选择私聊会话）→ `KanataConversationView`（`.kanata-chat textarea[placeholder="说说此刻想分享的事"]` 输入 → `发送消息` → `kanataChatRuntime.send` 写入用户消息并调用 `completeChat` 获取回复写入 `assistant` 消息）。
- **修复前行为**：切到 `chat` 后看到 `.kanata-setup`，即走 `else` 分支只等待容器可见并直接设置 `results.chatSendReply = true`，未执行世界初始化、未进入会话、未发送合成消息也未等待 assistant 回复。
- **修复后行为**：
  1. 拆分结果字段为 `chatModuleLoaded`、`chatViewReady`、`kanataWorldInitialized`、`chatUserMessageSent`、`chatAssistantReplied`、`chatSendReply`（保留旧 `ChatView` 兼容分支，`kanataWorldInitialized` 在旧分支记为 `'not-applicable'`）。
  2. 通过 `computeChatSendReply(results)` 强制要求 `chatModuleLoaded && chatViewReady && chatUserMessageSent && chatAssistantReplied` 均成立才可置为 `true`。
  3. 在 `KanataView` 分支执行真实 UI 原生点击与业务链路：初始化阿拜多斯世界 → 点击进入私聊（`小鸟游星野`）→ 输入「合成原生测试消息」→ 点击 `发送消息` → 断言 `kanata.snapshot.messages` 与 `.kanata-chat-timeline` DOM 同时出现用户消息和完整的「合成回复：原生验证已收到消息。」→ 等待 `textarea` 恢复可输入并 `flush()` 落盘后截取 `native-chat.png`。
  4. 收紧 `captureNative('native-chat.png')` 选择器为 `.chat-composer textarea, .kanata-chat .kanata-form textarea`；后台重入不再把 `.kanata-setup` 视为已初始化状态。

### 2. M-02：密码变更后的 Kanata 数据保留断言不充分

- **代码位置**：`docs/qa/architecture-20261026/native/verify.mjs`、`docs/qa/architecture-20261026/native/runtimeAdapter.mjs`（`verifyKanataPreservedData`）。
- **修复前行为**：`passwordChangeColdStartPreservesChat` 仅检查 `protectedAccess.status.chat === 'ready' && stores.get('kanata').isDataLoaded`，无法证明原有数据在主密码变更与冷启动后被保留。
- **修复后行为**：
  1. 在 M-01 完成持久化后，记录隔离合成数据的稳定身份与内容：`worldId`、`worldName`、`conversationId`、`conversationTitle`、`userMessageId`、`userMessageContent`、`assistantMessageId`、`assistantMessageContent`（并在结果中记录非敏感 ID 摘要 `kanataSyntheticRecord`）。
  2. 主密码变更并冷启动解锁进入 `chat` 后，调用 `verifyKanataPreservedData(snapshot, expected)` 逐一核对世界、会话、用户消息和 assistant 回复的 ID、状态及内容一致，并点击进入对应会话验证 `.kanata-chat-timeline [data-message-id="..."]` DOM 可见。
  3. 只有模块就绪、数据加载且四项身份/内容校验全通过时，`passwordChangeColdStartPreservesChat` 才为 `true`。

### 3. L-01：`loadRuntime` 导出函数盲目调用（Low）

- **代码位置**：`docs/qa/architecture-20261026/native/verify.mjs`、`docs/qa/architecture-20261026/native/runtimeAdapter.mjs`。
- **真实 Vite 产物核查**：检查 `npm run build` 产物 `dist/assets/fullBackupRuntime-*.js`，其真实导出结构为 `export{G as a,Z as i,ae as n,W as r,$ as t}`，其中 `ae`（由 Rollup 为 `useAppController.js` 动态 `import('../application/fullBackupRuntime.js')` 生成）是仅包含 `{ createFullBackupRuntime: $ }` 的命名空间对象，而其他单字母导出为共用导入的 `kanataBackup.js` 校验/编解码函数，无参调用会抛出 `KanataValidationError`。
- **修复前行为**：`loadRuntime` 将 `...Object.values(mod)` 与 `...Object.values(mod.n || {})` 展开为候选函数列表并逐一无参调用。
- **修复后行为**：
  1. 在 `runtimeAdapter.mjs` 中提供 `resolveFullBackupRuntimeFactory(mod)`：优先读取 `mod.createFullBackupRuntime`，否则扫描 `Object.values(mod)` 中仅含属性 `typeof value.createFullBackupRuntime === 'function'` 的唯一命名空间对象，**零无关函数调用**。
  2. 同时在 `runtimeAdapter.mjs` 统一提供纯属性/方法形状检查的 `resolveRestoreState` 与 `resolveRestoreJournal`，由 `verify.mjs` 共用。

### 4. 附加稳定性修复：Playwright Android WebView Socket 解析竞态（Run #44681563409 暴露）

- **现象**：提交 `541a2d2` 在 Run `#44681563409` 中通过了所有前序阶段（包括 Kanata 世界初始化、聊天收发、deep link、后台释放、回滚与提交恢复），但在第 6 次冷启动（改密后）`attach()` 调用 `device.webView({ pkg })` 时超时 120s，尽管 `android-display-failure.png` 显示应用已正常渲染到首页（`pidof com.yubin.formyself` 为 `3652`）。
- **根因**：`playwright-core` 内部 `_extractPkg(pid)` 使用 `ps -A | grep <pid>` 并以最后一行结尾字段覆盖 `pkg`，若匹配到 `grep <pid>` 自身或进程刚从 Zygote `<pre-initialized>` 启动，会永久在 `_webViews` Map 中缓存错误的 `pkg`，导致后续 `device.webView({ pkg })` 永远等不到事件；同时此前多次 `coldStart()` 未及时清理旧 CDP 与端口转发。
- **修复（`522d264`）**：在 `verify.mjs` 中新增 `cleanupTransport()`（每次冷启动前释放旧 CDP 连接与 ADB 端口转发）和 `waitForWebViewPid()`（通过 `pidof` 与 `/proc/net/unix` 中的 `webview_devtools_remote_<pid>` 确定性获取当前应用进程的 WebView DevTools Socket）。

---

## 三、实际修改文件列表

1. `docs/qa/architecture-20261026/native/runtimeAdapter.mjs`（新增：专用 QA adapter）
2. `docs/qa/architecture-20261026/native/verify.mjs`（修改：M-01/M-02/L-01 整改与 WebView Socket 确定性附着）
3. `tests/nativeQaAdapter.test.js`（新增：5 条 Node 回归测试）
4. `docs/qa/kanata-sqlite-m6/m6-qa-01-report-v1.md`（本报告）
5. `docs/20261119-kanata-sqlite-m6-encrypted-backup-recovery-plan-v1.md`（补充 `9.6 M6-QA-01 执行结果`）

未修改任何产品源码、SQLCipher、Schema、迁移器、主密码事务或完整备份格式。

---

## 四、测试与 CI 验证结果

### 1. 本地验证（独立 worktree `.worktrees/kanata-m6-qa-01`）

- `node --check docs/qa/architecture-20261026/native/runtimeAdapter.mjs` 与 `verify.mjs`：通过。
- `npm run check`（`522d264` 验证）：
  - ESLint：`0 errors`（61 个既有 warnings）。
  - Node 测试：`796/796` 通过，`0 failed`，`0 skipped`（包含新增 `tests/nativeQaAdapter.test.js` 5 条用例）。
  - Vitest 组件测试：`45` 个文件 / `420` 条用例全部通过。
  - TypeScript / Vue 类型检查（`vue-tsc` + `tsc`）：`0 errors`。
  - Vite 生产构建：`dist/assets` 打包成功（`1.06s`）。
- Android Gradle 本地构建与单元测试（`npx cap sync android` + `.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest`）：`BUILD SUCCESSFUL in 1m 40s`，`ExampleUnitTest` 1/1 通过。
- 本地模拟器与 WebView Playwright：**未在本地运行**（本地未安装 `cmdline-tools`/`avdmanager`，且无任务专用已确认隔离的 API 34 模拟器运行中），由 GitHub Actions Ubuntu KVM 隔离模拟器完成实机验证。

### 2. GitHub Actions 验证（SHA `522d26455f72e62b19d9fe7a5624e99837424893` · Run `#44684735609`）

- **Web Job（ID `136116265622`）— `success`**：
  - ESLint：0 错误（61 warnings）。
  - Node 测试：`796/796` 通过，`0 failed`，`0 skipped`。
  - Vitest：`45` 个文件 / `420` 条用例通过。
  - `vue-tsc` + `tsc` + `vite build`（809ms）：通过。
- **Android Job（ID `136116265186`）— `success`**：
  - Gradle 单元测试与 APK 构建通过。
  - Instrumentation（`TEST-emulator-5554 - 14-_app-.xml`）：总计 `15` 条，`14` 条通过、`0` 失败、`0` 错误、`1` 条按既有条件跳过（`TodoWidgetHarness.launcherFixture`）；`KanataEventActionCompatibilityTest` 与 `KanataSqliteTransactionTest` 均通过。
  - WebView Playwright（`playwright-results.json`）：
    - `pageErrors: []`
    - `chatArchitecture: "kanata"`
    - `chatModuleLoaded: true`, `chatViewReady: true`, `kanataWorldInitialized: true`, `chatUserMessageSent: true`, `chatAssistantReplied: true`, `chatSendReply: true`
    - `kanataSyntheticRecord`: `worldId: "world-de8d45bf45c446ebe45dbd46f69119fc"`, `conversationId: "private-3bf694547e20ddc66b1ed64902184663"`, `userMessageId: "message-123294a3-49a7-4657-927d-a1dfc32bc43f"`, `assistantMessageId: "message-e9204df5-d53f-47fb-baf9-ba8e3304231c"`
    - `kanataDataIdentityCheck`: `{"ok": true, "worldFound": true, "conversationFound": true, "userMessageMatched": true, "assistantMessageMatched": true}`
    - `passwordChangeColdStartPreservesChat: true`
    - `uncommittedForceStopRollback: true`, `committedForceStopRetainsTarget: true`
    - `apiKeyAfterPasswordChange: true`, `passwordChangeColdStartPreservesVault: true`
    - `renderedScreenshotCount: 3`, `nativeScreenshotsRendered: true`（包含展示真实用户消息与小鸟游星野回复气泡的 `native-chat.png`）

---

## 五、未覆盖事项、风险与后续建议

1. **未覆盖事项**：
   - `verify.mjs` 仅测试了当前主线 `KanataView` 私有会话单条消息收发与回复（未覆盖群聊多角色回复、消息修订/删除、历史归档分页以及未配置 `aiApiKey` 时的禁用态，这些由 Vitest 组件测试与单测覆盖）。
   - 旧版 `ChatView` 兼容分支在当前生产注册表中已不作为 `chat` 页面使用，本轮仅保留分支兼容逻辑并经过结果语义单测校验，未在旧视图布局上重新实机运行。
   - 本机 Windows 环境下因缺少 `cmdline-tools` / 隔离任务 AVD 未直接跑本地 `verify.mjs`，实机验证依赖 GitHub Actions 隔离 API 34 ATD 模拟器。
2. **风险**：
   - 若未来修改 `useAppController.js` 使 `fullBackupRuntime.js` 变为完全静态导入且 Vite 不再生成 `{ createFullBackupRuntime }` 命名空间导出对象，`resolveFullBackupRuntimeFactory` 将按设计显式报错而非盲目调用无关函数，届时需补充显式测试 QA adapter。
3. **后续建议与治理边界**：
   - 本次完成仅代表 **`M6-QA-01 PASS`**，不代表 `M6-00` 完成，也不自动启动 `M6-01`。
   - 后续按原定治理门禁继续推进：**`M6-00` 架构审计与设计输入冻结 → 独立复核 → 用户批准 → `M6-01` 备份格式与合成 Codec**。
