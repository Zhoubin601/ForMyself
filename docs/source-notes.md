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

## 2026-07-18 应用图标更新与 v1.0 APK

来源文件：

- `newicon.png`
- 当前项目的 `android/app/src/main/AndroidManifest.xml`
- 当前项目的 `android/app/src/main/res/mipmap-*` 图标资源
- 当前项目的 `public/manifest.webmanifest` 与 `icons/` 图标资源

关键事实：

- 用户提供的图标原图是 1259×1259 PNG，满足 Android 图标源至少 1024×1024 的尺寸要求。
- 原图左上角及主体背景色为 RGB `(68, 78, 113)`，即 `#444E71`。
- Android Manifest 使用 `@mipmap/ic_launcher` 和 `@mipmap/ic_launcher_round` 作为应用图标入口。
- 项目版本保持 `versionCode 1`、`versionName 1.0`；项目未配置生产发布密钥。
## 2026-07-22 每日通知可靠性修复

来源文件：

- 当前项目的 `src/services/reminderSchedule.js`
- 当前项目的 `src/services/notificationService.js`
- 当前项目的 `src/components/SettingsView.vue`
- 当前项目的 `tests/reminderSchedule.test.js`
- `node_modules/@capacitor/local-notifications` 8.2.1 的本地类型定义与 Android 实现

关键事实：

- 插件的 `schedule.on` 属于日历式循环调度，只设置 `hour/minute` 时会在触发后计算下一天，无需额外设置 `repeats`。
- Android 8 及以上使用通知渠道；原实现没有为每日提醒创建和绑定明确渠道。
- 原实现仅相信 `schedule()` 返回值，没有通过 `getPending()` 验证每日任务是否真正保留在系统待处理列表。
- Android 13 及以上的 `POST_NOTIFICATIONS` 权限已由 Local Notifications 插件 Manifest 合并提供，但仍需在运行时请求用户授权。
- 用户确认：保存每日通知设置成功后，需要立即收到一条设置成功通知。

模拟器验证来源：

- Android Studio AVD `Pixel_6_Pro`（Android 模拟器，设备 ID `emulator-5554`）。
- `adb dumpsys notification --noredact`：确认设置成功通知 ID `2198`、立即测试通知 ID `2199` 和每日心情提醒 ID `2101` 均使用高重要性渠道 `formyself-daily-reminders-v1`。
- `adb dumpsys alarm`：每日心情提醒在应用退到后台后由 `TimedNotificationPublisher` 触发，并自动安排到次日。
- 模拟器未授予精确闹钟特殊权限；15:45 的测试提醒实际于 15:47 左右送达，说明非精确闹钟模式可工作，但 Android 可能延迟投递。
