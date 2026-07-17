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
