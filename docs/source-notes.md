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

## 2026-07-23 Android 到点提醒延迟诊断

来源文件：

- 用户反馈：提醒设置成功，但到设定时间没有收到通知。
- 当前项目的 `android/app/src/main/AndroidManifest.xml`
- 当前项目的 `src/App.vue`、`src/services/notificationService.js` 和 `src/components/SettingsView.vue`
- `node_modules/@capacitor/local-notifications` 8.2.1 的 README 与 Android 原生实现

关键事实：

- 修复前 Manifest 未声明 `android.permission.SCHEDULE_EXACT_ALARM`，Android 12+ 因而只能建立非精确闹钟。
- 插件首次非精确调度使用 `setAndAllowWhileIdle`；每日任务触发后的自动重排使用普通 `AlarmManager.set`，系统可给次日任务约一小时的投递窗口。
- 模拟器实测修复前 15:45 提醒约 15:47 才送达，次日任务的系统窗口为一小时，能够解释“到点没有通知”。
- 使用 `SCHEDULE_EXACT_ALARM` 需要用户在 Android 的“闹钟和提醒”特殊权限页手动允许；没有采用受应用商店政策严格限制的 `USE_EXACT_ALARM`。
- Android 从特殊权限页返回时权限状态传播存在短暂时序差，应用需要在恢复前台后延迟重新同步提醒，不能要求用户重启应用。

补充诊断（应用关闭与系统休眠）：

- 模拟器中使用 `am kill com.yubin.formyself` 完全结束应用进程后，首条 `RTC_WAKEUP` 提醒仍能准点启动原生接收器并显示通知。
- 模拟器重启后不打开 ForMyself，`BOOT_COMPLETED` 接收器约在系统完成启动 20 秒后恢复提醒，随后通知正常触发。
- Android 的“强制停止”会将包标记为 `stopped=true` 并取消 AlarmManager 任务；这是平台规则，任何本地通知都必须等用户再次打开应用后才能恢复。
- `@capacitor/local-notifications` 8.2.1 的 `TimedNotificationPublisher.rescheduleNotificationIfNeeded()` 未读取原任务的 `allowWhileIdle`，触发后把次日任务从 `RTC_WAKEUP` 降级为普通 `RTC`。
- 普通 `RTC` 不负责唤醒休眠设备；应用下次打开时会重新同步为 `RTC_WAKEUP`，因此会表现成“只有打开应用才有通知”。

## 2026-07-23 心情标签与密码分类管理 v2

来源文件：

- 当前项目的 `src/components/SettingsView.vue`
- 当前项目的 `src/components/PasswordVaultView.vue`
- 当前项目的 `src/stores/mood.js`
- 当前项目的 `src/stores/passwordVault.js`
- 当前项目的 `src/services/passwordVaultRecords.js`
- 当前项目的 `src/services/fullBackup.js`
- 当前项目的 `tests/moodRecords.test.js`、`tests/passwordVaultRecords.test.js`、`tests/fullBackup.test.js`
- 用户当前反馈：心情日记自定义标签需要在通用配置删除；密码库分类需要在通用配置增删；只有未被密码记录使用的分类才允许删除；编辑密码时分类下拉框失效。

关键事实：

- 原密码编辑器使用 `input + datalist`，Android WebView 对该组合的交互支持不稳定。
- 密码分类此前主要从记录动态推导，没有独立的加密分类配置，因此无法可靠保存“尚未使用的新增分类”或“已删除的默认分类”。
- 心情自定义标签已经独立保存，但此前没有从配置页删除并同步清理历史记录的入口。
- 本次实现及测试未使用 `raw/` 原始资料，也未使用外部网络资料。

## 2026-07-23 首页看板视觉拓展

来源文件：

- 当前项目的 `src/components/HomeView.vue`
- 当前项目的 `src/components/MonthlyReportView.vue`
- 当前项目的 `src/stores/debt.js`、`src/stores/weight.js`、`src/stores/mood.js`、`src/stores/settings.js`
- 用户当前反馈：先制作首页美化与拓展版本，用实际效果决定是否保留。

关键事实：

- 原首页已经包含 AI 每日陪伴、心情/体重/存钱快捷入口、省钱圆环、最新体重和七天心情。
- 本次仅重构首页展示与现有数据的聚合方式，不修改各模块数据结构、通知系统、密码库或备份格式。
- 本次实现及测试未使用 `raw/` 原始资料，也未使用外部网络资料。

## 2026-07-23 密码库分类下拉框视觉优化

来源文件：
- 当前项目的 `src/components/PasswordVaultView.vue`
- 用户当前反馈：密码库分类下拉框与软件整体视觉不协调，需要美化。

关键事实：
- 原界面使用系统原生 `select`，在 Android WebView 中会呈现系统默认弹层，圆角、间距、颜色和应用现有卡片体系不一致。
- 分类筛选和密码编辑使用同一套自定义选择器视觉，但继续沿用现有分类数据、筛选值和保存逻辑。
- 本次实现及测试未使用 `raw/` 原始资料，也未使用外部网络资料。
# 资料来源与关键事实

## 2026-07-24 vivo 风格日程系统与临近日程小组件

来源：
- 用户提供的两张 vivo 原生日历参考截图（新建日程页、日程列表页）
- 当前项目 `src/App.vue`、`src/components/HomeView.vue`、`src/components/SettingsView.vue`
- 当前项目 `src/services/notificationService.js`、`src/services/fullBackup.js`
- 当前项目 Android AppWidget Provider、RemoteViews 布局与 Manifest

关键事实：
- 用户确认日程模块采用 vivo 原生日历的信息层级与表单结构，同时融合 ForMyself 现有视觉。
- 用户确认新建页包含完整字段：开始/结束、全天、农历、时区、提醒方式、重复、地点与备注。
- 用户确认新增独立 2×2“临近日程”小组件，采用 vivo 日期排版和液态玻璃背景，最多显示未来 7 天内 3 条事项。
- 本次没有使用 `raw/` 原始资料，也没有使用外部网络资料；参考图来自当前对话。
- 真机首轮预览后，用户进一步确认：日程下拉选择必须使用 App 内自绘面板；预设标签只保留“学习”；其他标签在通用配置手动添加；移除时区与农历；重复增加可手动输入的“每几天”。
- 用户最终补充：日程标签配置只保留名称与颜色，不需要图案；颜色不能局限于少量预设色，需要可自由选择的调色盘。
- 用户最终补充：日程列表、新建/编辑页及选择面板需要像“新建计划”一样具有自然的页面过渡动画。
- 用户明确要求备份区域同步修改：完整备份升级到 v2 并包含日程、发生记录和分类，保留 v1 导入兼容；另提供独立日程数据备份入口，备份类型选择使用 App 内自绘面板。
- 用户真机验证确认静息状态能收到日程通知，但点击进入 App 后同一提醒会再次发送；要求取消“闹钟提醒”，仅保留普通“通知提醒”。
- 用户补充日程标签删除规则需与密码库分类一致：仍有日程内容使用的标签不能删除，只有空标签可删除。
- 用户提供 vivo 日程列表截图并确认：默认列表需同时展示此前日程，过期内容灰显；顶部不再提供独立的“待办、已完成、历史”筛选，日程与待办合并显示，历史/完成状态使用灰色与删除线表达。
- 用户进一步通过真机截图确认：删除搜索框上方的“全部”按钮；顶部区域固定，只允许“全部分类”下方的日程内容窗口独立滚动，窗口默认停在最底部，向上滑查看旧日程。

## 2026-07-24 Android 2×2 桌面信息卡

来源文件：

- 当前项目的 `android/app/src/main/AndroidManifest.xml`
- 当前项目的 `android/app/src/main/java/com/yubin/formyself/MainActivity.java`
- 当前项目的 `src/App.vue`
- 当前项目的 `src/stores/settings.js`
- 用户当前要求：新增桌面占用 2×2 的信息型小组件，并在当前 USB 调试手机上实现

关键事实：

- 应用包名为 `com.yubin.formyself`，Android 最低版本 API 24、目标版本 API 36。
- 现有应用使用单 Activity 的 Capacitor 架构，页面由 `settingsStore.currentView` 控制。
- 当前主要非敏感功能包括心情、体重、省钱和月度报告；密码库属于敏感内容，不适合在桌面小组件展示。
- 用户确认内部不要求四宫格，改为一体化信息卡，并希望使用透明液态玻璃风格、功能图标和圆形应用图标。
- Android RemoteViews 不支持桌面壁纸实时模糊或折射，本次使用半透明渐变、高光描边和透明胶囊模拟玻璃质感。
- USB 真机为 vivo V2403A；系统 AppWidget 状态确认 Provider 最小尺寸为 110dp × 110dp，桌面实例可见。
- 本次实现未使用 `raw/` 原始资料，也未使用外部网络资料。

## 2026-07-24 日程顶部压缩与模拟器复核

来源文件：

- 用户当前对话提供的日程页顶部截图。
- 用户指定的完整备份文件（仅在原位置只读验证并导入模拟器，未复制到项目、未修改原文件）。
- 当前项目的 `src/components/ScheduleView.vue`、`src/App.vue` 与 Android Debug 构建。

关键事实：

- 用户要求缩小日程页顶部的菜单、年份和搜索图标区域。
- 顶部行通过减小安全区外的上下留白、图标尺寸和年份字号完成压缩，保留年份居中与左右点击区域。
- Pixel 6 Pro 模拟器覆盖安装时保留已导入数据；解锁后确认首页数据、今日日程卡、历史日程和自定义标签仍存在。
- 模拟器确认日程页默认定位最新日期，旧日程位于上方；列表滑动时年份、视图切换、搜索和分类区域保持固定。
- 未记录或保存用户密码；未使用 `raw/` 资料和外部网络资料。
