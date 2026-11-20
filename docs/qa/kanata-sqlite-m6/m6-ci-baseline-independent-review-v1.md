# M6 CI 基线修复独立复核报告

- 复核日期：2026-11-20
- 复核角色：GPT-6.2 Sol High（独立复核）
- 目标分支：`m6/encrypted-backup-recovery`
- 复核基线：`af31867bf2f20fc79adad8385dc43637122b7fa8`
- 功能修复及全绿 CI SHA：`dbd35ab8f7435736237dd6778d146c9be8ceacf7`
- 最终文档同步 SHA：`af31867bf2f20fc79adad8385dc43637122b7fa8`
- CI： [Quality #44677069315](https://github.com/Zhoubin601/ForMyself/actions/runs/44677069315)

## 一、独立复核结论

**CI 基线修复：PASS。端到端业务覆盖：存在 1 项 Medium 后续整改。**

本报告区分两个结论：

1. 本轮 Android CI 基线修复目标已达成。最终文档提交 SHA `af31867...` 对应的 GitHub Actions Web 与 Android Job 均为 `success`。
2. 当前 Playwright 脚本对新版 KanataView 路径存在一个验收语义缺口：新版分支没有实际发送合成消息，却将 `chatSendReply` 标记为 `true`。因此不能将该字段解释为新版 Kanata 聊天发送/回复功能已完成端到端验证。

该 Medium 项不影响本轮 CI 工作流的真实通过结果，但应在后续 QA 任务中修正，且在修正前不得将 `chatSendReply` 作为 Kanata 消息收发已验收的证据。

## 二、复核基线与变更范围

源码和 CI 以远端提交 `af31867bf2f20fc79adad8385dc43637122b7fa8` 为准。

与 CI 修复起点 `4c22b0129244bbae0380edcc8a916c602f9541b9` 比较，远端累计变更为 7 个提交，最终文件差异集中在以下四个文件：

1. `android/app/src/androidTest/java/com/yubin/formyself/KanataEventActionCompatibilityTest.java`
2. `android/app/src/androidTest/java/com/yubin/formyself/KanataSqliteTransactionTest.java`
3. `docs/qa/architecture-20261026/native/verify.mjs`
4. `docs/qa/kanata-sqlite-m6/m6-ci-baseline-fix-v1.md`

最终文档提交 `af31867...` 相对于功能修复及全绿 CI SHA `dbd35ab...` 只更新了上述修复记录文档，没有新增业务代码或测试代码变化。

本轮未修改仓库文件、未运行本地构建或模拟器、未创建实现提交；复核基于 GitHub 远端源码、提交差异、Actions 元数据和 Android Job 日志。

## 三、验证通过项

### CI 与提交绑定

- 远端分支 `m6/encrypted-backup-recovery` HEAD 与 `af31867...` 一致。
- 最终 CI #44677069315 的 `head_sha` 精确等于 `af31867...`。
- Web Job：`success`。
- Android Job：`success`。
- `dbd35ab...` 的功能修复提交对应的 CI #44542364600 也为 `success`，因此功能代码在最终文档同步提交前已有同 SHA 全绿证据。
- #44677069315 的 Android Job 日志显示：
  - Gradle 单元测试及 Debug / AndroidTest APK 构建成功。
  - `:app:connectedDebugAndroidTest` 成功，日志显示 16 项测试执行记录、0 失败；其中 `TodoWidgetHarness > launcherFixture` 按既有条件跳过。
  - WebView Playwright 脚本退出码为 0，最终结果记录 `pageErrors: []`、3 张不同截图、`nativeScreenshotsRendered: true`。
- Web Job 日志显示 Node 测试 791/791 通过，Vitest 420/420 通过，类型检查和 Vite 构建通过。

### Instrumentation 包名契约

两项原失败测试现在允许标准包名 `com.yubin.formyself` 和合成 QA 包名 `com.yubin.formyself.m2qa`，并通过：

```java
assertEquals(
    "com.yubin.formyself.m2qa".equals(context.getPackageName()),
    BuildConfig.KANATA_M2_SYNTHETIC
);
```

将 applicationId 与构建标志绑定。该断言避免包名与 synthetic build 标志互相矛盾。Gradle 中 `kanataM2Synthetic` 默认值仍为 false；标准包名未被修改。

### Playwright 适配

复核确认脚本已：
- 对当前 KanataView 与旧 ChatView 采用不同可见容器识别。
- 对 `restoreState-*.js` 独立 chunk 优先加载，并保留 settings chunk fallback。
- 将 `page.evaluate` 参数封装为单一对象。
- 不再依赖旧版 ChatView 输入框作为进入聊天模块的唯一条件。

## 四、发现

### M-01 — Medium：新版 KanataView 路径把未执行的消息收发测试标记为通过

位置：`docs/qa/architecture-20261026/native/verify.mjs`，进入 chat 模块的分支（约第 200 行附近，以本次复核基线文件为准）。

当前逻辑：

```js
if (await chatComposer.isVisible()) {
  await chatComposer.fill('合成原生测试消息')
  await tapButton(page, '发送消息')
  await waitState(page, /* assistant reply assertion */)
} else {
  await kanataView.first().waitFor({ state: 'visible' })
}
results.chatSendReply = true
```

旧 ChatView 分支确实输入消息、点击发送并等待 assistant 完成回复。新版 KanataView 分支只等待容器可见，随后仍把 `chatSendReply` 设为 true。

因此在当前 KanataView 分支：
- 实际验证的是 chat/Kanata 视图可见；
- 没有验证合成消息写入；
- 没有验证 assistant 回复；
- 日志中的 `chatSendReply: true` 对新版路径构成误导。

建议后续独立 QA 修复：
1. 若 KanataView 当前没有可用的消息发送入口，将结果字段改为 `chatViewReady` 或类似准确名称，不要复用 `chatSendReply`。
2. 若产品设计要求 KanataView 承担聊天交互，则增加真实的合成消息发送与回复断言。
3. 对密码变更后的 Kanata 数据保留测试，也应在有合成记录时核对记录标识/内容；仅检查 `isDataLoaded` 只能证明加载完成，不能证明原数据被保留。

该发现不阻断本轮 CI 基线修复，但限制了“聊天发送/回复已通过端到端验收”的结论。

### L-01 — Low：loadRuntime 仍保留导出函数盲目候选扫描

位置：`verify.mjs` 的 `loadRuntime`。

修复后的代码优先查找 `createFullBackupRuntime`，但仍将 `Object.values(mod)` 和 `Object.values(mod.n || {})` 中其他函数作为候选逐一无参调用，再通过返回值形状筛选。

目前已通过 CI，未观察到副作用；但对任意导出函数执行无参调用不够确定。建议后续只调用已知命名工厂导出，若打包导出形态不稳定，则用显式测试导出或稳定 QA adapter，避免调用无关模块函数。

## 五、风险分级与处置建议

| 编号 | 等级 | 事项 | 处置 |
|---|---|---|---|
| CI-01 | PASS | Web 与 Android 同 SHA CI | 已关闭 |
| CI-02 | PASS | Instrumentation 包名契约 | 已关闭 |
| CI-03 | PASS | Playwright chunk / 参数兼容 | 已关闭 |
| M-01 | Medium | KanataView 路径没有执行真实消息收发，却标记 chatSendReply=true | 后续 QA 任务修正 |
| L-01 | Low | loadRuntime 对导出函数候选无参调用 | 后续可收紧 |

## 六、阶段建议

1. **M6 CI 基线修复可以关账为 PASS。**
2. 将 M-01 纳入一个范围严格限定的后续 QA 任务，不要把它混入 M6-01 备份格式/加密实现。
3. L-01 可登记为低优先级健壮性改进，不需要阻断 M6 CI 基线关账。
4. M6-00 架构审计的独立复核结论仍需结合原审计与 Neon 报告综合处理；本报告不代表 M6-00 已通过，也不代表 M6-01 已获准开工。
5. M5 Overall 关账仍是独立治理事项。

**最终裁决：M6 CI 基线修复 PASS；M-01 作为 Medium 测试语义缺口保留跟进。M6-01 不因本次 CI 变绿而自动获准。**
