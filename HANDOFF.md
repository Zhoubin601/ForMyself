# ForMyself 项目终极深度交接白皮书 (全量解剖版)

> **生成时间**: 2026-07-02
> **项目类型**: Vue 3 + Vite + Capacitor 跨平台移动应用 (专注 Android)
> **技术亮点**: Pinia 状态管理 + BYOK AI 引擎原生直连 + 高度定制化毛玻璃原生 UI + 纯前端本地化无后端架构
> **核心定位**: 个人全维度管理 App，涵盖财务（省钱计划）、健康（体重记录）、心理（心情日记）三大领域，由高度定制化的 AI 引擎赋予情感价值。
> **阅读人群**: 本文档为接盘 AI 专家或全栈工程师设计，不存在任何略写，包含每一个文件、函数、状态、CSS 体系甚至魔法常量的极度细节解析。

---

## 零、阅读指南与设计哲学

本项目为**纯无后端（Serverless）架构**，所有的数据仅在用户的手机本地（或浏览器缓存）流转。由于完全依赖前端持久化方案，整个项目在数据同步、防空写覆盖（Race Condition）、时区修正方面做了大量精密的逻辑控制。接手本项目，请务必建立起“数据持久化驱动 UI”的核心理念。

---

## 一、基础工程设施与配置体系深度解析

### 1.1 `package.json` 与底层依赖树
- **前端框架**：`vue: ^3.5.32`，全部采用 Vue 3 的 Composition API 和 `<script setup>` 语法，没有一处 Options API。
- **状态枢纽**：`pinia: ^3.0.4`，所有状态的变更强制收敛至 Pinia，且由于是跨组件的单一数据源，项目废弃了 Vue-Router，改用 Pinia 的状态变量驱动根级组件 `<component is>` 或者 `v-if` 的切换。
- **构建引擎**：`vite: ^8.0.10` 配合 `@vitejs/plugin-vue`。注意项目中预留了 `@rolldown/binding-linux-x64-gnu` 以防在特定 Linux 容器（或 WSL）内打包时出现底层原生构建链断裂。
- **加密核心**：`crypto-js: ^4.2.0`。主要承担使用用户“主密码”进行 AES 数据的加解密。

### 1.2 Capacitor 插件生态深度剖析
项目中 `android/` 目录是由 Capacitor 桥接生成的。我们在项目中深度调用了以下原生插件：
- `@capacitor/preferences` (v8.0.1): 核心生命线！完全抛弃 `localStorage`（因在 WebView 中可能会被清理），使用 Preferences 插件将 JSON 字符串写入 Android 的原生 SharedPreferences 中。
- `@capacitor/core` & `@capacitor/app` (v8.3.1 / v8.1.0): 核心运行时，以及生命周期管理。项目中 `App.vue` 会监听 `appStateChange` 的 `isActive` 事件，用于应用从后台唤醒时的时间同步与心情日历“自动补签”。
- `@capgo/capacitor-native-biometric` (v8.4.2): 提供调用底层 Android Fingerprint / FaceID 验证的权限弹窗。
- `@capacitor/filesystem` (v8.1.2) & `@capacitor/share` (v8.0.1): 在“数据导出备份”流程中，Filesystem 用于把 AES 密文以 `Encoding.UTF8` 写入系统 Cache 目录，然后直接通过 Share 调起 Android 原生分享面板（微信/蓝牙/系统保存）。
- `@capacitor/status-bar` (v8.0.2): 在 `App.vue` 初始化时强制调用 `StatusBar.setOverlaysWebView({ overlay: true })`，让 UI 直接顶到屏幕刘海（沉浸式），并搭配安全的 iOS 安全区 CSS (`env(safe-area-inset-top)`) 进行排版。

---

## 二、CSS 架构与全局样式引擎体系

所有的基础样式全部收敛于 `src/App.vue` 的 `<style>` 无作用域块中，定义了系统级别的 CSS Token 变量。

### 2.1 CSS 原生变量引擎 (`:root`)
- **色彩规范**：
  - `--primary: #0066cc` / `--primary-focus: #0071e3`: Apple 风格系品牌蓝。
  - `--ink: #1d1d1f`: 深渊黑字体，比纯黑更护眼。
  - `--body-muted: #86868b`: 极致的高级灰，用于辅助说明和占位符。
  - `--canvas-parchment: #f5f5f7`: 底层画布色（偏向 iOS 的设置背景色）。
  - `--surface-pearl: #fafafc`: 用于卡片按下态或高亮条目。
  - `--divider-soft: #f0f0f0` / `--hairline: #e0e0e0`: 边框与极细分割线。
- **排版系统 (Typography)**：
  - 强制字体栈：`font-family: 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`。
  - 大量使用 `.display-lg` (40px, -0.374px 字距缩进), `.tagline` (21px), `.body-strong` (17px 600字重), `.caption` (14px) 构成严谨的 Apple Design 风格排版体系。

### 2.2 特殊视觉质感实现
- **深层毛玻璃 (Frosted Glass)**：
  背景层如存在自定义背景图，会在底层加一个 `.bg-blur-layer`，样式为 `backdrop-filter: blur(40px) saturate(150%)` 加白膜遮罩。所有前台卡片 `.glass-card` 使用 `backdrop-filter: blur(20px)`，创造出层次分明的亚克力透明效果。
- **弹性动画 (Spring-like Transitions)**：
  几乎所有的可点击按钮 `.capsule`, `.button-primary`, 列表卡片都加上了 `:active { transform: scale(0.95); }`。
- **全局沉浸式阻尼**：
  `html, body` 强行设死 `100dvh` (而非 vh, 避免移动端浏览器底栏收缩导致的跳动)，且强制 `overflow: hidden`，`-webkit-user-select: none`（防止双击选中文字出蓝底），滑动区域完全通过容器的 `overflow-y: auto` 掌控。

---

## 三、全局启动与状态注水机制 (Hydration Matrix)

在 `src/App.vue` 的 `onMounted` 钩子中，是整个 App 的“点火”流程：

```javascript
  await Promise.all([
    authStore.loadAuthData(),
    settingsStore.loadSettings(),
    debtStore.loadDebts(),
    weightStore.loadWeightRecords(),
    moodStore.loadMoodRecords()
  ])
```

### 3.1 为什么必须使用 `isDataLoaded` 保护位？
每一个 Pinia Store 内部都有一个 `watch(state, saveToPreferences, { deep: true })`。
在 Vue 挂载时，初始 `state` 均为空数组 `[]` 或空对象。如果没有防御机制，在读取 `Preferences.get` 的异步过程尚未完成时，空的初始状态就会触发 `watch`，紧接着把空数组写入手机本地，造成灾难性的 **数据清零事故**！
因此，在每个 Store 的 `loadXxxData()` 中，会在 `finally` 块将 `isDataLoaded.value = true`。而在 `watch` 函数内，永远被 `if (isDataLoaded.value)` 所包裹。只有当本地读取完全完毕，并注入到了内存后，这道“写操作闸门”才会打开。

---

## 四、五大模块（Pinia Stores）微观粒度全解析

### 4.1 锁屏与权限认证中心 (`auth.js`)
- **核心响应式状态**：
  - `isLocked` (boolean): 控制应用启动时的第一层蒙版。默认为 `true`。
  - `hasMasterPassword` / `savedMasterPwd`: 记录本地是否有主密码，如果没有，锁屏页会进入“初始化强设密码”模式。
  - `hasBiometric`: 是否有生物识别可用。
- **核心方法**：
  - `loadAuthData()`: 首先尝试读取主密码。接着被一个 `try...catch` 包裹调用 `NativeBiometric.isAvailable()`。如果不在手机环境，捕获错误，关闭生物识别选项。
  - `updatePassword(oldPwd, newPwd, confirmNewPwd)`: 执行强校验逻辑——至少 4 位数，两次输入必须一致，且原密码需比对无误（如果是通过生物识别绕过的重设密码，oldPwd 传 null）。

### 4.2 设置与 AI 配置枢纽 (`settings.js`)
这是跨组件最繁忙的 Store，接管了所有非业务型数据。
- **AI 缓存与数据指纹核心机制 (`dataFingerprint` & `cachedQuote`)**：
  大模型 API 计费且有延时，不能每次用户切回首页都发请求。
  系统设计了指纹函数：将当下的 `离目标最近的存钱计划进度|计划名称|最新体重|今日心情Emoji|累计总存钱数` 组合成一个 MD5 类似的长字符串。
  每次进入 `HomeView`，比对指纹，如果不一致，才会触发 `fetchAIQuote()`，获取新的晨报并同时覆盖指纹与缓存的晨报对象（含文本和生成日期），以此达成请求的最优节流。
- **持久化细节**：
  `bannerSettings`, `aiApiKey/Url/Model`, `customBg`, 甚至上面提到的缓存，都在单独的 Preferences Key（如 `my_home_cache`）里存储。

### 4.3 财务系统：省钱计划 (`debt.js`)
- **数据解剖** (Single Debt Object):
  ```javascript
  {
    id: "时间戳",
    name: "买辆自行车",
    totalAmount: 3000, 
    remainingAmount: 3000, // 每存一笔就会递减
    startDate: "2026-06-01",
    records: [ { id: "xx", date: "2026-06-05", amount: 100, note: "少喝奶茶" } ],
    isCleared: false // 当 remainingAmount <= 0 时置为 true，自动归入已达成 Tab
  }
  ```
- **关键 Getter**：`totalSaved()` 会通过一个双层 `reduce` 遍历所有 Debt 以及它们内部的 records，计算出用户使用本 App 以来的“历史累计总攒钱金额”。

### 4.4 心理系统：心情日记 (`mood.js`)
- **缺失打卡断层修补 (Auto-fill Algorithm)**：
  - `autoFillMissingDays()` 是本模块的灵魂。
  - 日历组件的连贯性不能有断层。当应用启动时，系统查出 `moodRecords` 中**排期最后一条记录的日期**，以及系统当前的**“昨天”**（留出“今天”的空白让用户主动打卡）。
  - 通过一个 `while` 循环（按天 `getDate() + 1` 递增），如果日期池里找不到这条数据，立刻强行 `push` 一条 `mood: 'normal'`、`note: ''` 的占位数据进入数组，并通过前述的 watch 闸门自动静默保存至本地。
- **业务方法**：`addRecord(date, mood, note)`，如日期已存在，通过 `findIndex` 执行合并覆盖；如果不存在则新增。

### 4.5 身体指标：体重系统 (`weight.js`)
- 数据模型最简单：`{ id, date, weight: Number, note }`。
- 不涉及复杂的自动补齐，完全依靠用户真实填报。

---

## 五、视图组件 (Vue Components) UI 极客深度拆解

### 5.1 大满贯仪表盘：`HomeView.vue`
整个页面的数据密度极高，调动了所有 Store。
1. **系统安全时区算法 (`getTodayStr`)**:
   你会发现在 `HomeView`，甚至所有组件中，都手写了获取今天字符串的逻辑：
   ```javascript
   const n = new Date()
   const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
   ```
   **原因**：决不能用 `new Date().toISOString().slice(0, 10)`！因为 `toISOString()` 输出的是 UTC 零时区时间。对于东八区，早上 8 点前的输出全是“昨天”的日子，这将彻底摧毁基于日期绑定的心情日历和体重追踪！
2. **AI Prompt 动态组装 (`fetchAIQuote`)**：
   提取 3 个维度的动态数据，例如：计算体重 `diff` 趋势、通过 Array.sort 取最后三天的心情 emoji、算出最紧迫财务目标的百分比。组装成的 Prompt 极具结构化。
3. **SVG 圆环精度绘制 (`<circle>`)**：
   `<svg viewBox="0 0 40 40">` 中的进度条，半径 `r=16`。其周长 = `2 * PI * 16 ≈ 100.53`。
   核心代码：`:stroke-dasharray="100.53"`，`:stroke-dashoffset="100.53 - progress * 1.0053"`。并在最后加上 `transform="rotate(-90, 20, 20)"`，实现完美的 12 点方向顺时针绘制动画。

### 5.2 列表与交互狂魔：`DebtListView.vue`
- **拉拉队机制 (`triggerCheerleader`)**:
  这是情感价值的巅峰。当执行 `submitRepay()` (存入金钱) 时，系统会分别算出存钱前的 `oldProgress` 和存钱后的 `newProgress`。
  定义了四道红线：`milestones = [25, 50, 75, 100]`。
  使用 `reverse().find(m => oldProgress < m && newProgress >= m)`，捕捉越过阈值的那一刻。如果捕捉到且非 100%（100%有另外的完成提示），立刻弹出一个全屏 Modal，并在 `cheerText.value` 显示 `isCheerLoading` 状态，背后静默请求大模型专门生成激昂贺词。
- **Client-side 硬分页**：使用 `computed` 切割原数组 `filteredDebts.slice((page-1)*10, page*10)`。

### 5.3 数据可视化：`WeightView.vue`
- **极简 SVG 折线趋势图**：
  不依赖图表库。在 `computed` 中 `chartPoints` 的计算非常硬核。
  1. 取出过滤后的所有体重，找出 Max 和 Min。
  2. 上下各拉伸 15% 的冗余范围 (Y 轴映射比例尺：`yRange = yMax - yMin`)。
  3. 通过 `CHART_PADDING.left + (index / maxIndex) * plotW` 映射 X 轴坐标。
  4. 最终拼接出 `chartLinePath = 'M x,y L x,y L x,y'`。并在图表底部通过 `<linearGradient>` 结合一条封闭的 `Z` 路径，画出一层泛蓝透明的面积折线渐变，美轮美奂。
- **数据输入校验防御**：`saveRecord` 函数里硬编码了 `< 20` 或 `> 300` 抛出提示：`体重数值似乎不合理`，保证图表渲染不会因飞线数据崩溃。

### 5.4 精密日历算子：`MoodView.vue`
- **CSS Grid 日历生成器**：
  核心难点是计算当月第一天前面空了几个格子（周日到周六）。
  `firstDayOffset`：`new Date(year, month - 1, 1).getDay()` 获取。
  在模板中用 `<div v-for="i in firstDayOffset" class="cal-day empty"></div>` 强行挤占前面的网格。配合 `grid-template-columns: repeat(7, 1fr)` 形成极严密的周历排布。
- **AI 情绪回音壁 (`activeEcho`)**：
  `saveRecord` 后，如果填了日记 (`editNote`)，触发大模型 API。界面使用 `<Transition name="fade-slide">`（包含透明度下降和下沉动画），在底层浮出一个固定在屏幕底部的对话气泡。

### 5.5 后勤保障基地：`SettingsView.vue`
- **全平台数据导入导出机制 (AES-256 加密体系)**：
  这是系统极其刚性且硬核的设计，不可妥协。
  1. **导出 (`exportJSON`)**：序列化 `dataArray`，调用 `CryptoJS.AES.encrypt(raw, 主密码)` 生成超长密文。
  如果判断是 `Capacitor.isNativePlatform()`：使用 `@capacitor/filesystem` 写入应用 Cache，用 `@capacitor/share` 抛出给安卓底层，调用社交软件发送给其他手机；如果判断是 Web 环境，则挂载虚拟 `<a>` 下载。
  2. **导入 (`handleFileUpload`)**：通过 `<input type="file">` 拿到 File 对象。用 `FileReader` 以文本形式读取（绝不能作为 DataURL 读取！）。调用 `CryptoJS.AES.decrypt`，如果解密抛出异常，说明用前朝的剑斩本朝的官（当前主密码与该文件的备份密码不匹配），拦截并弹窗报错！若成功，弹出 `confirm` 询问覆盖还是追加。

---

## 六、引擎机理：`aiEngine.js`（核心跨界驱动网络）

这里存放着大模型通信的绝密逻辑。
- **URL 智能修复**：用户无论填写 `https://api.deepseek.com` 还是 `...com/` 还是 `...com/v1`。
  引擎内部均通过正则和 `endsWith` 裁剪补齐为合法的 `/v1/chat/completions` 或者非标准厂商的 `/chat/completions`。
- **深层防御策略与模型适配**：
  - **GLM (智谱清言) 适配**：代码中有 `const isGLM = model.toLowerCase().includes('glm')`。因为某些 GLM 版本极度排斥 System Prompt，所以我们用这个判断主动切断了 `role: 'system'` 数组元素的注入（`payload.messages.unshift` 只对非推理非 GLM 模型执行）。
  - **推理模型 R1 系列自适应提取**：`!model.toLowerCase().includes('r1')` 也会阻断 System 提示语下发（DeepSeek R1 官方不推荐下发 System），同时它的回答由于都在思考链内，返回的 `content` 经常是空字符串。
    **提取魔术**：在拿到 JSON 后，我们会探测 `data.choices?.[0]?.message?.reasoning_content`。这堆长达几千字的文本，会被 `split('\n')` 炸成数组，然后经过一层极其严酷的过滤器 `.filter(l => !l.includes('分析') && !l.includes('指令') && !l.includes('限制') ...)`，剔除掉模型自我辩论的碎碎念，强行 `pop()` 抽出最后一行输出给用户。
- **全局网络捕获**：
  底层采用 `fetch`。第一层 Try 包裹 Fetch 请求本身（拦截物理断网、CORS），第二层 Try 用于解析 `response.json()`（拦截 Nginx 的 502/HTML 强推页面），做到了极致健壮。

---

## 七、开发迭代与维护规范 (Developer Protocols)

1. **绝对禁忌指令 1**：不要在任何组件的 `<script>` 区去请求大模型，任何需要 AI 辅助的均需通过 `import { askAI } from '../services/aiEngine'`，因为这里有统一的请求体组装和防暴乱拦截。
2. **绝对禁忌指令 2**：不得轻易改变 Pinia Store 的属性名或拆分数据结构，因为这会摧毁 AES 加密导出的旧备份 JSON 的反序列化兼容性（一旦用户拿三个月前的备份恢复，发现字段丢失，这是不可原谅的）。
3. **Teleport 使用规范**：本项目所有的 Modal（新建计划、记录体重等）统一通过 `<Teleport to="body">` 传送到根节点之外。这规避了由于父级元素的 `transform` 和 `overflow: hidden` 切断导致的固定定位 (`position: fixed`) 塌陷问题。
4. **CSS 变量使用**：新增界面色彩必须取自 `:root` 定义的 CSS Variables。不要写死十六进制色值，为后续全局增加 Dark Mode 铺路。

---
> 各位 AI 工程师和接盘开发者们，你们已手握 `ForMyself` 的至尊兵符。在这个无后端的本地应用里，数据的流转比渲染更加神圣不可侵犯，每一个 `isDataLoaded` 和 AES 的锁扣，都是保卫用户隐私与体验的护城河。祝您重构顺遂，代码不倒！
