# 2026-10-19 温馨小家与背景效果验证

用户确认：全局共用背景图片；解锁页和其他页面分别保存模糊程度、背景淡化；关闭温馨小家后保留首页鼓励语，点击提示入口关闭。依据为本轮需求和现有项目代码，无外部资料，未读取原始业务数据，raw/ 无修改。

## 实现

- 「通用配置 → 外观与首页」新增温馨小家总开关和管理入口。关闭后保留聊天/记忆/头像，隐藏侧栏入口与首页角标，取消主动消息、补话及缓存聊天任务。首页鼓励语保持原生成与缓存逻辑。
- 「环境背景」提供解锁页/其他页面分组、实时预览、两个 0–100% 滑块和当前组默认效果恢复，两组默认均为 20%/20%。两组共用图片，效果随锁定状态切换。
- 支持图片解码与保存错误提示，失败保留旧图，重复选择同一文件可再次上传。图片之外的文字与卡片不随滑块模糊。
- 新设置持久化并纳入 v11 完整备份；兼容旧备份及既有背景图片。

## 修改文件

- 背景与设置：src/App.vue、src/components/settings/SettingsAppearance.vue、src/composables/settings/useAppearanceSettings.js、src/stores/settings.js、src/services/backgroundSettings.js、src/styles/app.css、src/styles/settings.css。
- 温馨小家生命周期与入口：src/components/HomeView.vue、src/composables/useAppController.js、src/features/chat/ChatView.vue、src/features/chat/chatStore.js、src/features/chat/chatProactive.js、src/features/chat/chatFollowup.js、src/composables/settings/useChatSettings.js。
- 存储与备份：src/platform/storage/keys.js、src/services/fullBackup.js、src/composables/settings/useBackupSettings.js。
- 新增 tests/AppearanceSettings.spec.js、tests/backgroundSettings.test.js、tests/chatFeatureNotifications.test.js；更新解锁页、聊天缓存、背景结构及备份版本相关回归测试。过程记录追加至 docs/source-notes.md、docs/analysis-notes.md、docs/questions.md、docs/plan.md，保留原有内容。

## 检查结果

- npm run check：通过。Node 257/257；Vitest 54/54；ESLint 0 错误（保留既有警告）；类型检查及生产构建通过。
- 独立临时 Chrome 配置，仅合成背景和合成数据，未配置 API Key。320/390/1280px 无横向溢出。
- 验证锁屏清晰背景、解锁后其他页效果、分别调节及刷新恢复；验证关闭后首页文案可见、点击只提示、侧栏隐藏；验证已缓存 ChatView 被卸载。
- 单元测试覆盖关闭时取消通知、不请求权限、等待权限期间关闭、正在提交通知时关闭后的串行取消、图片解码和存储失败保留旧图、恢复当前组默认效果不影响另一组。
- git diff --check 通过；raw/ 无修改。

证据：verification.json、verify.mjs、project-check.log 及同目录 PNG。

## 待用户复核与未执行项

可复核两组默认清晰度及照片与内容的视觉效果。已补充 Android 17 原生 WebView 测试，11/11 场景通过，安装包已交付至 output/20261019-background-warmhome-v1-debug.apk。实际配置为 Pixel 6 Pro，未执行三星 One UI 专项测试。详情见 [原生验证记录](native/verification.md)。
