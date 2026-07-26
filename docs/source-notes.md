# 资料来源记录

## 2026-07-24 时间转盘与临近日程小组件字号

来源：

- 用户 2026-07-24 当前需求
- 当前项目 `src/components/AppTimeField.vue`
- 当前项目 `android/app/src/main/res/layout/widget_schedule.xml`
- 当前项目 `android/app/src/main/res/values/widget_schedule_styles.xml`

关键事实：

- 现有应用内时间面板只列出 5 分钟间隔，不能直接选择全部 00–59 分钟。
- 用户希望恢复时钟转盘交互，同时继续保持与应用一致的自绘视觉。
- 临近日程 2×2 桌面小组件的标题、时间和事项文字偏小，需要在不改变组件尺寸的前提下放大。

## 2026-07-24 应用内反馈组件与侧边栏统一

来源文件：

- 用户截图 `C:\Users\a3185\AppData\Local\Temp\codex-clipboard-b47e3c16-6c8b-4654-8ada-63f54fb5b00b.png`
- 用户截图 `C:\Users\a3185\AppData\Local\Temp\codex-clipboard-a39ea673-fe38-4abe-ba8b-1f01608bb401.png`
- 当前项目 `src/App.vue`
- 当前项目 `src/components/*.vue`

关键事实：

- 主密码验证错误使用 WebView/Android 默认 `alert`，白色矩形、系统默认按钮和现有圆角玻璃风格不一致。
- 全项目共发现 77 处 `alert`、`confirm` 或 `prompt` 调用，分布在省钱、月报、心情、密码库、日程、设置、体重和应用锁屏。
- 设置页还保留一个原生 `select`，多个业务页使用原生日期/时间输入，会继续触发 WebView 的 Android 选择弹窗。
- 原侧边栏只有纯文字列表，缺少图标、分组、关闭按钮、品牌层级和设备内隐私说明。

## 2026-07-24 模块设置入口与锁屏视觉

来源文件：

- 用户截图 `C:\Users\a3185\AppData\Local\Temp\codex-clipboard-85281322-ee49-4d9f-a035-cecaf05845dc.png`
- 用户截图 `C:\Users\a3185\AppData\Local\Temp\codex-clipboard-39aa1c2a-6994-4c61-8328-a4faa0739411.png`
- 用户截图 `C:\Users\a3185\AppData\Local\Temp\codex-clipboard-fea5b4cc-70c9-44fc-a5e7-fce728e4ae23.png`
- 用户截图 `C:\Users\a3185\AppData\Local\Temp\codex-clipboard-6f77fd85-4e4b-4f00-9866-20133510cc7e.png`
- 用户截图 `C:\Users\a3185\AppData\Local\Temp\codex-clipboard-1eb4292d-a1fd-4bcb-8fa5-0d4f97ced1d5.png`
- 当前项目 `public/icon.png`、`src/App.vue`、`src/stores/settings.js`、`src/components/SettingsView.vue`

关键事实：

- 侧边栏顶部需要使用真实 App 图标，不能继续使用临时字母“F”。
- 只有存在独立配置的模块需要显示标题栏齿轮；用户明确首页不需要齿轮。
- 省钱、体重、心情、日程和密码库存在独立配置；省钱看板文案属于省钱计划；API、备份、主密码、背景和桌面组件属于通用配置。
- 日程页已经有常驻搜索框，标题栏搜索按钮功能重复，应移除。
- 原锁屏只有文字、单一输入框和按钮，视觉层级、品牌识别、安全说明和密码可见性操作不足。

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

## 2026-07-26 Galaxy 微动效视觉增强

来源：

- 用户指定的开源仓库 `https://github.com/uiverse-io/galaxy`
- Galaxy `README.md` 与 `LICENSE`
- Galaxy `Buttons/StealthWorm_spotty-horse-48.html`
- Galaxy `Cards/KhaledMatalkah_slippery-stingray-30.html`
- 当前项目 `src/App.vue`、`src/components/HomeView.vue`
- 当前项目 `src/components/MonthlyReportView.vue`、`src/components/ScheduleView.vue`

关键事实：

- Galaxy 是 Uiverse.io 社区 UI 片段的 HTML/CSS/Tailwind 集合，不是需要整体安装的 Vue 组件运行时。
- Galaxy 仓库与其中 UI 元素使用 MIT License，允许使用、修改与分发；仓库建议但不强制标注 Uiverse.io 与原作者。
- 参考按钮片段使用移动渐变、柔光和按压反馈；参考卡片片段使用缓慢变化的阴影与径向光晕。
- 当前项目已经有毛玻璃、渐变卡片和基础页面淡入，适合吸收动效思路，不适合直接复制深色霓虹、强 3D 或依赖鼠标 hover 的成品样式。
- 本次外部资料仅用于视觉实现与许可证核对，不涉及业务数据、市场结论或用户隐私。

## 2026-07-26 全应用灵动治愈 UI 与主题系统

来源：

- 用户确认的实施计划：全应用统一、灵动治愈、保留并精简侧栏、中文为主、预设主题加自定义主色、暂不加入深色模式。
- 当前项目 `src/App.vue`、`src/components/`、`src/stores/settings.js` 与 `src/services/fullBackup.js`。
- 用户指定的完整备份文件 `C:/Users/a3185/Desktop/ForMyself_Full_Backup_2026-07-23.json`，仅用于 Android 模拟器恢复验证。
- 2026-07-26 vivo V2403A 真机首页截图。

关键事实：

- 当前顶部导航背景透明度为 0.8，真机滚动截图中下方“详情”文字会透入导航标题区域。
- 首页主卡最小高度为 310px，模块间距为 22px；英文眉题与中文标题混用，卡片与阴影规格未完全统一。
- 品牌蓝和部分模块强调色分散硬编码在多个 Vue 组件中，现有设置与完整备份尚不包含主题字段。
- 完整备份为约 2 MB 的 CryptoJS AES 密文；测试密码只用于本次模拟器解锁和导入，不记录到项目文件、日志或长期记忆。
- 本次不修改用户提供的备份文件，不复制到 `raw/`，不在模拟器测试后保留额外明文数据文件。
- 备份在 Pixel 6 Pro 模拟器中成功解密并识别五类数据；恢复确认后覆盖写入测试应用，验收结束已清空测试应用和模拟器备份副本。
- 用户补充提供“通用配置”真机截图，指出左上角汉堡按钮在圆角容器内存在视觉错位。
- 随后 USB 连接到 vivo V2403A；修正版通过 ADB 保留数据覆盖安装并成功启动，真机页面确认汉堡图标居中且顶部栏不再透出滚动内容。

## 2026-07-26 女朋友式 AI 多日陪伴提示词

来源：

- 用户当前确认：AI 以女朋友式亲密语气陪伴，可按语境称呼“宝宝”或“哥哥”，优先提供完整情绪价值。
- 用户当前确认：提示词和历史上下文不以 token 成本为裁剪依据；现有短文案场景仍保留展示字数限制，未来聊天模块不限制回复长度。
- 当前项目 `src/components/HomeView.vue`、`src/components/MoodView.vue`、`src/services/reminderContext.js`、`src/services/notificationPersonalizerCore.js` 与 `src/services/aiEngine.js`。

关键事实：

- 原心情回音只向 AI 发送本次事件，并限制 30 字；首页只使用最近三条心情、最近两次体重和当前省钱累计。
- 原通知上下文仅取最近三条心情或体重记录；心情自动补记可能混入历史上下文。
- 原首页在首次记录指纹时不会生成文案，且数据指纹未包含完整历史和当前日期。
- `raw/` 未提供本任务的外部原始资料；本次实现仅依据用户当前要求和现有项目代码，不使用外部资料。

## 2026-07-26 “温馨小家”AI 女朋友聊天模块

来源：

- 用户当前确认的完整实施计划：新增永久连续对话模块“温馨小家”，默认女朋友名为“小暖”，支持欢迎语、流式聊天、长期记忆、加密持久化、独立备份和完整备份。
- 当前项目的导航、首页、设置、AI 服务、主密码、生活数据、日程、反馈弹层和完整备份实现。
- 当前项目 Android Capacitor 工程及 Pixel 6 Pro Android 模拟器。

关键事实：

- 聊天继续复用用户现有 BYOK 服务地址、模型和 API Key，不新增或保存第二套 AI 凭据。
- 聊天请求允许发送用户主动选择的聊天记录、长期记忆和非敏感生活数据；密码库、主密码、API Key、账号凭据和安全字段不得进入提示词或长期记忆。
- 聊天回复不设置应用层字符上限；服务商上下文超限时仅逐步移除最早的请求上下文，本机完整记录不删除。
- 欢迎语仅属于当前页面会话，不写入聊天文件或备份。
- `raw/` 未提供本任务资料；未修改、移动或覆盖 `raw/` 文件，也未使用外部网络资料。

### 2026-07-26 真机聊天语气反馈

- 用户在真机实际对话后确认：当前回复仍然“像 AI”，目标是更接近熟悉女朋友之间的真人私聊。
- 反馈指向聊天专属表达节奏，不要求修改首页简报、心情回音和通知的既有情绪链。
- 本次调整继续以用户反馈和现有代码为唯一依据，未使用外部资料，未读取或记录用户 AI 凭据。

### 2026-07-26 温馨小家真机布局反馈

来源图片：

- `3b65073529ffcbcd7d9f7eadb4078b56.jpg`：温馨小家长消息页面，底部输入框未出现在可视区域。
- `69222b006eae74a80d9e6c2418a5e3b1.jpg`：温馨小家设置页，模块说明、长期记忆输入和按钮在窄屏上排版拥挤。

用户确认：

- 输入框必须恒定在屏幕最底部，只有中间消息列表滚动。
- 每次重新进入温馨小家时必须自动定位到最新消息，行为与日程列表一致。
- 设置页需要修正窄屏字体、换行和输入区域显示不全。
- 两张图片仅用于本次布局定位，未复制到项目目录，`raw/` 未修改。

- 用户追加截图 `e1df861fde3024449147b4e85776b282.jpg`：窄屏排版已完整显示，但“女朋友名字”输入框与“保存名字”按钮之间没有足够留白。
- 用户追加截图 `6b0b13d9de55e402c36a2753d826556d.jpg`：AI 一次回复仍集中在带多个空行的大气泡中；用户希望改为像真人聊天一样连续发送多条小消息。
- 用户补充确认：小说式括号动作可以保留，但动作旁白应与紧接着的对白放在同一个气泡，不单独发送。
- 用户真机反馈：每次进入温馨小家都会从消息顶部快速滑到最底部；期望页面首次出现时已经位于最新消息，不显示滚动过程。
- 用户追加截图 `2b57d1d8d01b4c446fdf12f05680f4b4.jpg`：参考微信长按消息后的操作方式，希望聊天气泡支持长按引用回复，并新增女朋友头像图片自定义上传。
- 用户追加截图 `daa217006421f5fd3bc6fca493664df8.jpg`：长期记忆数量增加后设置页过长，希望每 3 条分页显示，或按类型折叠；本轮按用户优先提出的“3 条一页”实现。
- 两张追加图片仅用于确认交互和列表密度，未复制到项目目录，未修改 `raw/`。

## 2026-07-27 “温馨小家”真人女朋友感升级

来源：

- 用户确认的完整实施计划：将“小暖”升级为有连续状态、未完话题、适度主动、温柔但有主见的虚拟女朋友。
- 用户确认默认值：每天主动一至两次，默认活跃时段 09:00–23:00；六小时内反复进入不重复说话；短消息短回，复杂心事才展开。
- 用户指定的完整备份 `C:/Users/a3185/Desktop/ForMyself_Full_Backup_2026-07-23.json`，用于 Android 模拟器验证完整备份旧版本迁移。
- 当前项目的聊天 Store、AI 服务、通知服务、完整/独立备份、设置页和 Android Capacitor 工程。

关键事实：

- 原实现每次进入都生成不持久化欢迎语，没有女朋友当日状态、未完话题、记忆归属或主动联系队列。
- 原聊天在用户发送一条消息后立即开始回复，生成期间禁用输入，无法自然承接连续发送或在用户补充后重新回答。
- 原长期记忆不区分“哥哥 / 她 / 我们”；旧数据迁移时必须默认归入“哥哥”，不能丢失现有消息、头像、引用和记忆。
- 主动消息只使用聊天、关系状态和非敏感生活上下文；密码库、主密码、API Key 与安全凭据不进入提示词或备份过程记录。
- 女朋友角色明确属于“温馨小家”的虚拟关系，不冒充现实真人；可表达偏好、不同意和轻微吃醋，但禁止控制、羞辱、冷暴力、威胁或制造依赖焦虑。
- 用户提供的密码只用于本次模拟器解密操作，不记录到项目文件、截图说明、测试日志或长期记忆。
- 本任务未修改、移动或覆盖 `raw/`，未使用外部网络资料。
- 指定备份原文件大小为 2,031,360 字节，保持在桌面原位置且未被修改；模拟器导入识别为完整备份 v2。
- 模拟器恢复确认结果为：省钱计划 22 条、体重 16 条、心情 37 条、密码库 37 条、日程 4 条；v2 不含聊天数据，因此新版聊天、关系状态和主动消息字段按空数据与安全默认值迁移。
- 恢复后的 AI 测试仅使用备份中用户已有的 BYOK 配置完成端到端对话，不读取或输出 API Key；验收结束后已清空模拟器应用数据并删除模拟器中的备份副本。

## 2026-07-27 “温馨小家”微信式互动升级

来源：

- 用户当前确认的完整实施计划：保留现有长按引用，新增右滑引用、AI 主动引用、双方表情回应、双击头像拍一拍、未读角标与定位。
- 用户确认默认值：AI 小动作采用“自然偶尔”；每轮最多一种动作；表情限于 `❤️ 😂 🥺 😤 👍 👀`；进入聊天仍直接显示最底部。
- 当前项目的聊天消息、引用、主动联系、长期关系、加密文件、独立/完整备份、首页、侧栏、通知深链与 Android Capacitor 工程。

关键事实：

- 原消息已具备 `replyTo` 引用快照及点击定位，但没有手势右滑、消息表情、拍一拍事件或已读边界。
- 微信式互动属于轻量语境，不应触发长期记忆提取；发送给模型时只转换为不可见的自然互动说明。
- AI 互动判断与正常回复并行执行，结构化结果必须校验真实 user 消息 ID、动作类型与表情白名单；异常、断网或 4 秒超时统一降级为无动作。
- 旧聊天缺少已读字段时按“历史全部已读”迁移，避免升级后首页与侧栏突然出现大量旧消息角标。
- 独立聊天备份升级到 v3，完整备份升级到 v5；继续接受聊天备份 v1–v2和完整备份 v1–v4。
- 本任务未读取或发送密码库、主密码、API Key 与安全凭据；模拟器仅使用本轮临时测试数据，验收后已清空。
- `raw/` 未提供本任务资料，未修改、移动或覆盖 `raw/`；未使用外部网络资料。

## 2026-07-27 聊天表情落点与回应节奏反馈

来源：

- 用户当前对话提供的截图 `codex-clipboard-6a475690-957f-49c2-a3ae-c36184241d2d.jpg`。
- 用户反馈：点赞/爱心表情展示生硬，位置与相邻气泡发生视觉穿插。
- 当前项目 `src/components/ChatView.vue`、`src/services/chatInteraction.js` 及对应自动化测试。

关键事实：

- 原表情标签使用负上边距、明显白色描边和阴影，会让标签压在气泡边界上，并在连续气泡间产生穿插感。
- 原表情后续判断允许对爱心或点赞再生成完整文字；截图中轻量爱心动作后出现较长补充气泡，使简单互动显得刻意。
- 本轮将爱心与点赞定义为默认静默回应，不再调用 AI 生成补充话；其他表情仍可在确有必要时补一条短句。
- 本轮资料仅用于界面与交互定位，未复制到项目目录；`raw/` 未修改，未使用外部网络资料。

## 2026-07-27 长期生活上下文、黏人主动消息与 emoji 频率

来源：

- 用户确认：近期生活记录继续完整提供，久远记录只需要概览。
- 用户确认：主动消息可以纯粹因为想哥哥，并希望女朋友整体更黏人。
- 用户确认：聊天回复可以更频繁使用 emoji；话多时整轮三至四个可以接受。
- 当前项目的心情、体重、存钱、日程 Store，以及聊天上下文和主动通知实现。

关键事实：

- 直接在每轮请求中发送全部历史明细，单轮 token 随记录数量近似线性增长；长期反复发送会显著增加累计消耗并可能触发服务商上下文上限。
- 本轮采用分层上下文：最近30天生活记录和前后30天日程实例完整保留，更早的心情、体重和范围外日程按月概览，重复日程规则继续保留。
- 主动联系第一条约六成使用“想哥哥”原因；未回应不追发、最近两小时刚互动不打扰的既有边界保持不变。
- 短回复自然使用一至两个 emoji；话多或连续气泡时整轮可分散三至四个；明显低落、严肃求助和安全风险场景降低使用频率。
- 本轮未修改、移动或覆盖 `raw/`，未使用外部网络资料，也未记录用户主密码或 AI 凭据。

## 2026-07-27 聊天颜文字表达

- 用户确认希望女朋友增加颜文字，并允许在话多时保留较丰富的可爱表达。
- 聊天提示新增撒娇、开心、害羞、委屈和得意场景的颜文字规则；普通一轮通常零至一个，长回复最多两个。
- 主动想念消息的本地兜底加入少量颜文字，在线生成也允许用一个颜文字替代 emoji。
- 颜文字不会在明显低落、严肃求助或安全风险场景中密集出现，也不会与多个 emoji 堆叠。
