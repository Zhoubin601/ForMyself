# 2026-10-19 Android 原生模拟器测试

结果：11/11 通过；测试使用本轮功能代码构建的 Debug APK，无需修改业务代码。

## 实际环境

- 用户指定目录：E:\Android。
- AVD：Pixel_6_Pro；实际型号 sdk_gphone16k_x86_64，Google Android 17 / API37，16KB page size。
- 序列：emulator-5586；WebView 145.0.7632.218。
- 分辨率 1440×3120，560dpi；WebView CSS视口 411×826。
- 本地未找到三星配置，本次测试不能代表三星 One UI 兼容性验证。
- 保留既有应用数据，覆盖安装最新 Debug APK；新建临时 Android 用户12，只使用合成测试数据与测试图片。完成后已切回原用户0，临时用户自动清理。

## 检查结果

| 场景 | 结果 |
| --- | --- |
| 首次进入与原生安全存储 | 通过 |
| 系统照片选择器选择图片并上传 | 通过；使用同目录合成 PNG，图片经 Android 照片选择器返回 |
| 原生触摸拖动模糊滑块 | 通过 |
| 解锁页0%/0%，其他页75%/45%，独立保存 | 通过 |
| Android退到后台自动锁定、返回后使用解锁页效果 | 通过 |
| 解锁后自动改用其他页效果 | 通过 |
| 关闭温馨小家取消系统通知 | 通过；预先创建主动/补话通知各1条，关闭后系统 getPending 均不再包含 |
| 关闭后保留聊天和记忆 | 通过 |
| 首页鼓励语保留、点击仅提示、未读角标与侧栏入口隐藏 | 通过 |
| force-stop 后冷启动，图片、参数与开关恢复 | 通过 |
| 重新开启后可从首页进入聊天，历史与记忆仍存在 | 通过 |
| 横向布局与运行异常 | 通过；文档宽度411px与视口一致，无未捕获异常，Android崩溃缓冲区为空 |

主执行器 run.mjs；结果 results.json；截图 native-appearance-pages.png、native-appearance-lock.png、native-lock-clear.png、native-home-disabled.png、native-drawer-disabled.png、native-cold-start-lock.png、native-chat-reenabled.png。

## 构建与交付

- 使用既有生产构建，Capacitor Android同步通过；Gradle assembleDebug 成功（304项任务）。
- 安装包：output/20261019-background-warmhome-v1-debug.apk。
- 大小：12,193,963字节。
- SHA-256：BD4AAA02F6834B09D0A93664B49517A7B423900F3912A69A241E800E9DC065D2。
- 未改动 raw/，未接入真实业务数据，未配置AI Key，未保存测试密码。

用户可继续复核照片清晰度和文字可读性；本轮未执行三星实体机或 One UI 专项测试。
