# 资料来源记录

## 2026-07-18 密码库功能合并

来源文件：

- `D:\2026Spring Semester File\已完结\An-app\password-app\src\App.vue`
- `D:\2026Spring Semester File\已完结\An-app\password-app\src\components\VaultView.vue`
- `D:\2026Spring Semester File\已完结\An-app\password-app\src\components\AddView.vue`
- `D:\2026Spring Semester File\已完结\An-app\password-app\src\components\SettingsView.vue`
- 当前项目的 `src/stores/auth.js`、`src/components/SettingsView.vue` 与 `src/App.vue`

关键事实：

- 旧项目密码记录结构为 `{ appName, account, password, extraFields }`。
- 旧项目使用 Preferences Key `my_password_manager_data` 明文保存密码记录。
- 旧项目导出文件使用当前主密码通过 CryptoJS AES 加密。
- 用户确认采用更安全的设备内加密存储，并要求密码数据使用独立备份入口。

## 2026-07-18 心情多事件与标签升级

来源文件：

- `Test_data/心情.json`
- 当前项目的 `src/stores/mood.js`、`src/components/MoodView.vue`、`src/components/SettingsView.vue`

关键事实：

- 测试备份使用现有应用的 CryptoJS AES 格式加密。
- 使用用户本次提供的测试主密码仅在测试进程内解密验证，未写入项目文件。
- 备份中共有 25 条旧心情记录，字段为 `id/date/mood/note`，不含标签字段。
- 旧实现同一日期只保留一条记录，新增记录会覆盖该日已有记录。

## 2026-07-18 密码库分类、收藏与二次生物识别

来源文件：

- 当前项目的 `src/stores/passwordVault.js`、`src/components/PasswordVaultView.vue`、`src/components/SettingsView.vue`
- `node_modules/@capgo/capacitor-native-biometric/dist/esm/definitions.d.ts`
- `Test_data/密码.json`

关键事实：

- 已确认原密码备份记录结构为 `{ appName, account, password, extraFields }`，不含分类和收藏字段。
- 原生插件提供 `isAvailable({ useFallback: false })` 和 `verifyIdentity()`，可在访问明文前执行独立生物识别。
- `Test_data/密码.json` 是 CryptoJS AES 密文，但无法使用用户此前提供的测试主密码解密，因此未读取其中的明文内容，也未尝试猜测密码。

补充验证：

- 用户随后说明密码库备份使用独立主密码；该密码仅注入一次性测试进程和 Android 测试会话，未写入项目文件或文档。
- 修正后真实密码备份成功解密出 37 条旧结构记录，字段仍为 `appName/account/password/extraFields`；Android 导入及分类/收藏默认迁移均通过。

## 2026-07-18 体重目标、BMI、变化提醒与周平均

来源文件：

- 当前项目的 `src/stores/weight.js`、`src/stores/settings.js`、`src/components/WeightView.vue`
- 当前项目的 `src/services/notificationService.js`、`src/services/monthlyReport.js`
- `Test_data` 中的体重加密备份

关键事实：

- 真实体重备份成功解密出 14 条记录，字段为 `id/date/weight/note`，不含身高、目标体重或提醒设置。
- 14 条记录覆盖 4 个自然周；旧体重备份继续保持数组输入格式，不因新增健康设置而改变。
- 身高、目标体重和变化提醒属于设备健康设置，独立保存在 `my_health_settings`。

## 2026-07-18 完整数据备份

来源文件：

- 当前项目的 `src/components/SettingsView.vue`
- 当前项目的 `src/stores/debt.js`、`src/stores/weight.js`、`src/stores/mood.js`
- 当前项目的 `src/stores/passwordVault.js`、`src/stores/settings.js`

关键事实：

- 原有备份入口按省钱、体重、心情、密码库四种数据类型分别导入导出，备份明文结构均为数组。
- 所有备份文件均使用当前主密码通过 CryptoJS AES 加密。
- 主密码只存在于认证 Store 的运行时状态中，设备生物识别凭据由系统及原生插件管理，不属于可导出的应用数据。
- 完整备份需要覆盖四类业务数据、心情追踪元数据和应用设置；单项备份格式继续保持不变。
