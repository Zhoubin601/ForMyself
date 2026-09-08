# ForMyself 启动与解锁性能验收

日期：2026-09-06
设备：Pixel 6 Pro Android 17 模拟器，411px CSS 视口
构建：`output/20260906-ForMyself-unlock-performance-v1-debug.apk`

## 实施结果

- 主密码校验改为异步 Web Crypto PBKDF2-HMAC-SHA256，继续使用 v1 记录结构、16 字节盐、32 字节摘要和 210,000 次迭代。旧记录无需重建。
- Web Crypto 不可用时改由 Worker 执行兼容的 CryptoJS 派生；两种能力都不可用时保持锁定并安全失败。
- 解锁提交先绘制“正在解锁”状态，阻止重复提交；验证通过后先显示首页，再并行解密聊天和密码库。
- 首次生物凭据建立改为首页非模态提示。用户主动启用后，指纹解锁和指纹授权修改主密码继续可用。
- 首页保留同步加载；报告、省钱、体重、心情、日程、聊天、密码库和设置改为异步组件。聊天未读数通过轻量属性回填。
- 启动任务按锁屏、首页、受保护数据和通知/组件同步分阶段执行，消除重复启动链路。

## 性能数据

### 热解锁到首页首次绘制

10 次结果（毫秒）：

`32.4, 43.7, 37.3, 33.2, 42.6, 41.6, 33.1, 48.2, 50.5, 48.9`

- 中位数：42.15ms
- 最大值：50.5ms
- 验收目标：中位数不超过 500ms，单次不超过 1,000ms
- 结果：通过

### 冷启动到锁屏

Android `am start -W` 的 5 次 `TotalTime`（毫秒）：

`1103, 944, 734, 724, 731`

- 中位数：734ms
- 最大值：1,103ms
- 验收目标：中位数不超过 1,500ms
- 结果：通过

### 受保护数据与首包

- 聊天和密码库后台并行加载实测 186.1ms；提前进入聊天页时先出现固定尺寸安全加载态，随后正常显示内容。
- 主入口从 444.03kB（gzip 158.57kB）降至 143.71kB（gzip 51.66kB），原始体积减少约 67.6%。
- CryptoJS 和 PBKDF2 Worker 均从首页首包拆出，业务页面各自形成异步 chunk。

## 功能与视觉回归

- 错误密码保持锁定，加载状态可以恢复；正确密码立即进入首页。
- 首次设密、旧 v1 验证记录兼容、中文与 emoji 密码、不同迭代次数、Web Crypto/旧算法一致性和 Worker 回退均有自动化覆盖。
- 首页、月报、省钱、体重、心情、日程、聊天、密码库和通用配置逐页检查，横向溢出均为 0。
- 聊天和密码库在受保护数据就绪前显示不改变页面宽度的加载态。
- 临时 Android 用户完成指纹录入、首次凭据启用、锁屏指纹解锁、指纹授权打开改密表单、实际改密和改密后再次指纹解锁。
- 原模拟器用户覆盖安装后仍显示既有主密码锁屏，未访问其私人业务数据。
- 当前应用进程日志中崩溃、ANR 和敏感桥日志均为 0。唯一 WebView error 为 Chromium variations seed 签名缺失，属于模拟器 WebView 环境信息，不影响应用。

视觉证据：

- `docs/20260905-performance-home.png`
- `docs/20260906-performance-original-lock.png`
- `docs/20260906-biometric-setup-prompt.png`
- `docs/20260906-biometric-lock.png`
- `docs/20260906-biometric-unlock.png`
- `docs/20260906-biometric-change-password.png`
- `docs/20260906-biometric-password-reset-success.png`

## 自动化与构建

- ESLint：0 errors，64 个存量 warnings。
- Node 单元测试：226/226 通过。
- Vue 组件测试：7/7 通过，覆盖即时反馈、首页提前显示、聊天/密码库加载态、生物启用提示和后台失败重新锁定。
- `vue-tsc --noEmit`：通过。
- Vite 生产构建：通过。
- Capacitor Android 同步：通过。
- Gradle `assembleDebug`：通过。
- `git diff --check`：通过。

最终 APK：

- 文件：`output/20260906-ForMyself-unlock-performance-v1-debug.apk`
- 大小：10,207,430 字节
- SHA-256：`98508CE384DF4405B6BB7F84D83C586A82CE722F12551D1F992FC65B94F3B74F`

测试结束后已切回 Android 原用户、删除临时测试用户并移除调试转发。测试主密码、系统 PIN 和虚拟指纹未写入源码、文档或交付物。
