# 2026-10-19 组件透明度、壁纸裁剪与启动验证

本轮依据用户依次提出的需求实施：全站主要卡片半透明、手动透明度、启动壁纸延迟、选图裁剪、双指缩放。仅使用项目源码、本地 UI/UX 技能与合成测试图片；未读取私人加密备份，raw/ 无写入，未使用外部资料。

## 实现与使用

- 通用配置 → 外观与首页 → 组件透明度：默认40%，可调0–100%，实时作用于首页及其他页面的主要卡片、列表、输入区域、导航表面。文字和图标保持自身颜色。偏好自动保存、完整备份往返保留，旧备份缺失时使用默认值。
- 弹窗、菜单和日期/时间选择器保留至少88%的底色，避免后方文字穿透影响操作；强调按钮及状态图标保留配色。
- 更换环境背景图片 → 裁剪窗口：当前屏幕比例、单指拖动、双指捏合100–300%、缩放滑块、方向键、重置、取消和确认。两指中点作为原图锚点；松开一指后继续拖动，页面缩放保持1。
- 确认后生成最长边不超过2560px的JPEG（质量0.9、不放大小图），保存失败保留旧壁纸并允许重试。原始选图文件不被修改。取消、Esc或原生返回键保留旧壁纸。
- 原启动链在快捷入口、状态栏、鉴权和首帧之后才读取壁纸。现改为挂载前独立并行读取外观并预解码图片，完整设置初始化复用结果；默认背景和壁纸不再于首个应用画面之后切换。
- 系统图片选择器沿用项目的原生活动保护机制，避免选择图片时触发后台锁定而丢失裁剪流程。

## 修改范围

- src/services/componentAppearance.js：透明度归一化、CSS变量、图片预解码。
- src/services/backgroundCrop.js、src/components/BackgroundCropper.vue：裁剪几何、锚点缩放、触摸/键盘交互、JPEG输出。
- src/main.js、src/stores/settings.js、src/composables/useAppController.js：外观首屏准备、共享变量及持久化。
- src/components/settings/SettingsAppearance.vue、src/composables/settings/useAppearanceSettings.js：透明度设置与裁剪确认流程。
- src/platform/storage/keys.js、src/services/fullBackup.js：透明度存储键与v11备份的兼容扩展。
- src/styles/app.css、src/styles/settings.css、各页面局部样式及共享字段组件：将内容表面改用共享半透明颜色变量。
- tests/backgroundCrop.test.js、tests/AppearanceSettings.spec.js、tests/themeSystem.test.js：几何边界、缩放锚点、持久化/备份、首次解码与历史契约更新。
- docs/source-notes.md、analysis-notes.md、questions.md、plan.md：追加本轮过程，保留此前未提交内容。

## 验证结果

1. npm run check通过：Node 260/260、组件56/56、类型检查、生产构建通过；ESLint 0错误，55项既有警告。见project-check.log。
2. 浏览器使用隔离Chrome配置和合成图，验证首页、月报、省钱、体重、心情、待办、日程、聊天、密码库、设置10页表面；320/390/1280px无横向溢出，裁剪对话框保持在视口内。
3. 浏览器验证双指放大/缩小、原图锚点稳定、页面缩放保持1、触摸取消、鼠标拖动、方向键、取消保存、JPEG尺寸/比例、透明度两端及刷新恢复。刷新后的首个Vue画面已有壁纸与保存的透明度。见verification.json、verify.mjs及PNG。
4. Android 17/API37、Pixel_6_Pro AVD、WebView145，在新建临时用户12使用合成图片；既有用户数据不清空。原生系统照片选择器返回裁剪、真实单指拖动、滑块、保存、冷启动恢复等7项通过，见native-verification.json。
5. 最终双指构建在原生WebView中验证双指放大、缩小并松开一指继续拖动、页面缩放保持1、返回键取消保留旧图、确认保存，5项通过。触摸通过CDP多触点注入，合成图片经实际file-input change处理器进入，见native-pinch-verification.json及native-pinch.png。
6. 最终构建冷启动：外观准备标记早于首次内容绘制，保存的JPEG与透明度恢复；见native-cold-start-timing.json。耗时仅作为模拟器观测，真机仍需复核。
7. Capacitor同步与Gradle assembleDebug通过，304项任务。git diff --check通过。

测试执行器曾遇到刷新尚未真正导航便读取旧Store，以及系统照片选择器的半屏/全屏布局、Done按钮和触点释放语义差异；修正等待与测试注入后复测通过。原生首次冷启动因屏幕休眠受干扰，补测记录单列。上述失败不记作App功能通过的证据。

## 交付

- 最终安装包：output/20261019-wallpaper-transparency-crop-v2-debug.apk。
- 大小：12,193,963字节。
- SHA-256：D82156D8AAE4214947C54F1593FBAD08B63298C3D7E3215825E1C3855BB4AB7B。
- v1为双指需求追加前的滑块裁剪历史包，保留；应安装v2。此前背景功能APK保留。

用户可复核真实壁纸下的文字清晰度、双指手感及手机冷启动观感。本轮未做实体手机专项测试。功能实现、项目检查和安装包交付已完成；没有阻塞交付的问题。用户已授权本轮源码和验证记录提交并推送远端；APK、原始资料、日志及调试截图继续保留本地。
