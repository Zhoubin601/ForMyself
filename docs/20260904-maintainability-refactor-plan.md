# 2026-09-04 长期维护重构

用户已确认按以下顺序实施。保留现有数据格式、页面行为和历史备份兼容性；每阶段以自动化测试和构建验证。

1. [x] 拆分 SettingsView 与 App：按设置职责拆 composable/界面片段；提取应用生命周期和全局样式。
2. [x] 建立统一 Preferences 适配层、串行写入策略与存储键清单。
3. [x] 改造 Android 桌面组件为版本化展示快照，移除对业务数据结构的直接依赖。
4. [x] 迁移主密码与 API Key 到安全存储，保留生物认证改密和旧备份导入。
5. [x] 加入 lint、渐进类型检查、真实组件测试和 CI。
6. [x] 按 features 整理业务模块并更新文档与测试路径。

## 来源与边界

- 来源：当前 src、tests、scripts、android、package.json、package-lock.json、README.md 与已安装插件源码。
- 原始资料：本轮不需要 raw 中的用户备份或敏感数据。
- 基线：212 项 Node 测试通过，Vite 生产构建通过。
- 不覆盖用户已有的 docs/source-notes.md 修改，不操作真实设备中的用户数据。
- 主密码阶段细节见 20260904-master-password-security-plan.md。

## 完成结果

- `App.vue` 的生命周期和跨模块编排已移入 `useAppController`，全局样式移入 `styles/app.css`。
- `SettingsView.vue` 已拆成 11 个设置界面片段和 8 个设置 composable，样式移入 `styles/settings.css`。
- Preferences 仅通过 `platform/storage/preferences.js` 访问，所有键集中在 `platform/storage/keys.js`。
- 首页与日程桌面组件使用带版本号的展示快照，Android Provider 不再解析心情、体重、省钱等业务记录。
- `features/chat`、`features/mood`、`features/schedule` 已各自归拢视图、Store 与领域服务。
- 质量门禁包括 ESLint、Node 测试、Vitest 组件测试、`vue-tsc`、Vite 构建和 GitHub Actions。
- 验证：220 个 Node 测试、1 个组件测试、类型检查、生产构建、Capacitor Android 同步及 `assembleDebug` 全部通过。
