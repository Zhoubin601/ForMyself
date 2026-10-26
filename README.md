# ForMyself — 我的自留地

个人生活记录应用：省钱计划、体重、心情、每日待办、日程、密码库、月度报告与 AI 陪伴。采用 Vue 3、Pinia、Vite 和 Capacitor，支持 Web 与 Android。本机保存业务数据；启用 AI 时，聊天和选中的生活上下文会发送给用户配置的服务商。

## 开发与验证

```bash
npm ci
npm run dev
npm run check
```

`check` 包括 ESLint、Node 领域测试、Vitest 组件/故障回归、Vue 类型检查、严格契约类型检查和生产构建。`tests/types` 的负向样例必须被编译器拒绝，不能移除 `@ts-expect-error` 来掩盖接口问题。JavaScript 采用渐进检查，未宣称整个代码库已经严格类型化。

```bash
npm run build
npx cap sync android
cd android
./gradlew testDebugUnitTest assembleDebug
# 隔离模拟器运行；不得指向真实用户设备数据
./gradlew connectedDebugAndroidTest
```

Android 需要 JDK 21、匹配的 SDK/build-tools。`postinstall` 对通知、生物凭据和 Preferences 插件应用可重复的原生修补；遇到不支持的依赖源码会明确失败，升级依赖时必须重新验证。不要将 `node_modules` 的手动修改当成可交付修复。

## 目录与依赖边界

```text
src/application/          模块注册、导航、生命周期、备份协调、跨业务生活上下文
src/features/
  savings/ weight/ mood/  记录视图、Store、仓库与领域规则
  todo/ schedule/ chat/  规则、交互、持久化和通知适配
  vault/                 密码库视图、Store与加密保存
src/platform/
  storage/               Preferences适配、存储键、仓库接口、持久化状态、恢复日志
  security/              原生凭据适配
  ai/                    接收显式配置的AI传输客户端
src/shared/              无全局Store依赖的公共日期等规则
src/components/           应用公共控件、首页与设置分区
src/services/             通知、主题、报表等服务及历史兼容入口
src/stores/               认证、设置、受保护会话；部分历史入口转发到features
```

历史 `components/WeightView.vue`、`DebtListView.vue`、`PasswordVaultView.vue` 和相应 `stores` 路径保留为兼容入口，实现位于功能目录。新代码优先从功能目录访问相应能力；已有兼容入口不应扩充新的业务逻辑。

公共规则与 AI 传输层禁止导入 Pinia/全局业务 Store；功能 Store 通过仓库访问持久化插件。跨业务协作在应用层明确组合，避免将某个业务当作公共工具库。

## 新模块接入

1. 在功能目录实现领域规则、仓库、Store 和视图；仓库可注入驱动，先保证读取失败不覆盖旧数据、写入失败可见且能重试。
2. 在 `application/moduleRegistry.js` 注册 ID、标题、异步视图、设置、缓存及安全元数据。导航、菜单、标题和设置范围从注册信息派生。
3. 在 `application/ordinaryModules.js` 的组合根注册 initialize/resume/flush/subscribe/dispose。应用控制器不应增加模块专属生命周期分支。
4. 需要备份时在 `backupParticipants.js` 注册 export/ready/restore/flush；格式变化必须明确修改 `services/fullBackup.js` 的协议适配，未知参与者不可被静默遗漏。单项备份需要自己的解析与合并语义。
5. 敏感模块在 `protectedModules.js` 注册加载适配，并提供 release/reencrypt/flush/suspendPersistence；新增模块必须通过加载、会话释放、操作租约、改密失败回滚和备份往返测试。

设置页按分区投影字段和动作。字段缺失或同名字段来自不同引用时明确报错，防止大对象展开静默覆盖。聊天消息列表、编辑框及操作面板分别维护展示接口；副作用仍由聊天视图协调。

## 数据安全与恢复

首次使用配置主密码。可开启全屏入口验证，也可直达普通页面、首次访问密码库或聊天时按需验证。会话失效后释放敏感明文；密码库查看/复制仍遵守独立验证规则。

Android API Key 使用安全凭据适配器。配置有加载、保存、失败和重试状态；保存未成功时不能保证进程强杀后保留输入。Web 的安全能力与 Android 不同，不应将浏览器存储描述为 Android Keystore。

完整备份包含全部业务和设置，继续支持 v1–v12 导入。主密码和设备生物识别凭据不作为备份项导出；备份中的 AI 配置随文件一起加密。

完整恢复前持久化 AES-GCM 加密恢复记录。提交前中断则恢复旧快照；提交后中断保留目标数据。恢复未完成时阻止普通写入和 Todo 桌面修改，验证身份后可重试。介质持续失败、记录损坏或密钥不可用时保持保护状态，不能承诺自动修复任意损坏。存在恢复记录时必须先完成恢复，再降级到不支持该记录的旧版本。

阶段计划和实际验收记录位于 `docs/20261026-architecture-*.md`，对应合成测试证据位于 `docs/qa/architecture-20261026/`；每个阶段验收后单独提交并推送。
