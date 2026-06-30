# ForMyself 项目交接文档

> 生成时间: 2026-06-23
> 项目类型: Vue 3 + Vite + Capacitor 跨平台移动应用 (Android)
> 技术亮点: Pinia 状态管理 + BYOK AI 引擎

---

## 一、项目总览

ForMyself 是一款个人全维度管理 App，涵盖财务、健康、心理三大领域。

核心功能：
- **首页综合看板** — AI 每日陪伴晨报、今日快速打卡、省钱进度环形图、体重趋势、七天心情电波
- **AI 情绪陪伴 (BYOK)** — 每日晨报 / 心情回音壁 / 存钱里程碑拉拉队
- **省钱计划** — 设立目标、记录存款、分页列表、AI 鼓励语
- **体重记录** — 记录体重、SVG 趋势图、时间筛选、分页列表
- **心情日记** — 日历视图、Emoji 心情选择、日记文字、自动补齐缺失日期、AI 情绪回音壁
- **安全锁屏** — 主密码 + 生物指纹认证
- **数据加密备份** — AES 加密导出/导入（省钱/体重/心情三类数据独立操作）
- **个性化设置** — 自定义背景图、看板文案、AI 配置

---

## 二、项目目录结构

```
formyself-app/
├── index.html                              # Vite 入口 HTML
├── package.json                            # 依赖 & 脚本
├── vite.config.js                          # Vite 构建配置
├── capacitor.config.json                   # Capacitor 配置
├── HANDOFF.md                              # 本文档
│
├── src/
│   ├── main.js                             # 入口：Vue App + Pinia 注册
│   ├── App.vue                             # 根组件：锁屏 + 导航骨架
│   │
│   ├── services/                           # AI BYOK 引擎
│   │   └── aiEngine.js                     #   原生 fetch 调用 OpenAI 兼容 API
│   │
│   ├── stores/                             # ★ Pinia 状态管理 (5 Store)
│   │   ├── auth.js                         #   授权 (主密码/指纹/锁定)
│   │   ├── debt.js                         #   省钱计划 (CRUD + isDataLoaded 保护)
│   │   ├── weight.js                       #   体重记录 (CRUD + isDataLoaded 保护)
│   │   ├── mood.js                         #   心情日记 (CRUD + 自动补齐)
│   │   └── settings.js                     #   设置 (导航/看板/背景/AI配置/缓存)
│   │
│   ├── components/
│   │   ├── HomeView.vue                    # 【首页】综合看板 + AI 晨报
│   │   ├── DebtListView.vue                # 【省钱】计划列表 + AI 鼓励语 + 里程碑
│   │   ├── WeightView.vue                  # 【体重】统计 + 折线图 + 记录列表
│   │   ├── MoodView.vue                    # 【心情】日历 + 列表 + AI 回音壁
│   │   └── SettingsView.vue                # 【设置】看板/背景/密码/备份/AI配置
│   │
│   └── assets/
│
├── public/
├── android/                                # Capacitor Android 原生壳
├── icons/
└── dist/
```

---

## 三、技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Vue 3 (SFC, `<script setup>`) | ^3.5.32 |
| 状态管理 | Pinia (Setup Store 语法) | ^3.0.4 |
| 构建工具 | Vite | ^8.0.10 |
| 原生壳 | Capacitor (Android) | ^8.3.1 |
| 本地存储 | @capacitor/preferences | ^8.0.1 |
| 指纹认证 | @capgo/capacitor-native-biometric | ^8.4.2 |
| 文件系统 | @capacitor/filesystem | ^8.1.2 |
| 核心运行时 | @capacitor/core | ^8.3.1 |
| 生命周期 | @capacitor/app | ^8.x.x |
| AI 引擎 | 原生 fetch (BYOK) | OpenAI 兼容 |
| 加密 | crypto-js | ^4.2.0 |

### 运行命令

```bash
npm run dev             # 浏览器调试
npm run build           # 构建 dist
npx cap sync            # 同步到原生壳
npx cap open android    # Android Studio 打开
```

---

## 四、核心架构

### 4.1 数据流模型

```
src/main.js → createPinia()

┌──────────────────────────────────────────────────────────┐
│                    Pinia Store 层 (5个)                    │
│                                                          │
│  每个 Store 内置 watch(..., { deep: true }) 自动持久化      │
│  加载保护: isDataLoaded 标志位防止空数组覆盖本地存储        │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│                    App.vue (骨架)                         │
│  · 锁屏界面 (useAuthStore)                                │
│  · 导航栏 + 抽屉菜单 (useSettingsStore)                   │
│  · 按 currentView 条件渲染 5 个子组件                      │
│  · 全局统一加载所有 Store 数据（Promise.all）               │
└──────────────────────┬───────────────────────────────────┘
                       │
            ┌────┬────┼────┬────┬────┐
            ▼    ▼    ▼    ▼    ▼
      HomeView  DebtListView  WeightView  MoodView  SettingsView
```

### 4.2 视图切换

| currentView | 渲染组件 | 抽屉菜单 |
|-------------|---------|---------|
| `home` (默认) | HomeView | 首页总览 |
| `debts` | DebtListView | 省钱计划 |
| `weight` | WeightView | 体重记录 |
| `mood` | MoodView | 心情日记 |
| `settings` | SettingsView | 通用配置 |

---

## 五、Store 模块

### 5.1 useAuthStore (`stores/auth.js`)
管理锁屏状态、主密码验证、生物识别。

### 5.2 useDebtStore (`stores/debt.js`)
管理省钱计划列表，含自动持久化。

**数据结构 (单条 debt)**:
```js
{ id, name, totalAmount, remainingAmount, startDate, records: [{ id, date, amount, note }], isCleared }
```

### 5.3 useWeightStore (`stores/weight.js`)
管理体重记录列表。

**数据结构**:
```js
{ id, date ('YYYY-MM-DD'), weight (kg), note }
```

### 5.4 useMoodStore (`stores/mood.js`)
管理心情日记记录。

**数据结构**:
```js
{ id, date, mood: 'great'|'good'|'normal'|'bad'|'terrible', note }
```

**自动补齐**: 每次加载数据时自动调用 `autoFillMissingDays()`，从最后一条记录的下一天到昨天之间所有缺失日期自动补入 `mood: "normal"`。

**后台唤醒**: App.vue 监听 `@capacitor/app` 的 `appStateChange` 事件。

### 5.5 useSettingsStore (`stores/settings.js`)
管理当前视图、抽屉状态、看板配置、自定义背景和 AI 配置。

**AI BYOK 字段**:
- `aiProviderUrl`: API 端点地址（默认 `https://api.deepseek.com`）
- `aiApiKey`: API Key（密码态存储）
- `aiModel`: 模型名（默认 `deepseek-chat`）
- `cachedQuote`: `{ text, date }` — AI 每日晨报缓存，按天去重
- `dataFingerprint`: 首页数据指纹，用于检测变动
- `lastEncouragement`: 省钱页鼓励语缓存（格式 `金额|文本`）

**持久化 key**: `my_home_cache`（含 cachedQuote / dataFingerprint / lastEncouragement）

---

## 六、组件

### 6.1 HomeView 【首页】

调用 useSettingsStore + useMoodStore + useWeightStore + useDebtStore + askAI

**数据指纹机制**:
- `getDataFingerprint()` 生成 `debtPct|debtName|weightVal|moodKey|totSaved`
- `dataFingerprint` 持久化到 Preferences（`my_home_cache`）
- `fetchAIQuote()` 检查指纹：无指纹则保存后返回；有指纹则对比，有变化才调 API

**界面布局**:
- **Hero AI 晨报卡片** — 毛玻璃卡片展示 AI 每日陪伴语录，带骨架屏加载态
- **今日快速打卡** — 三颗胶囊按钮：心情 Emoji / 体重 / 存钱入口
- **省钱进度环形图** — SVG 环形进度条
- **体重趋势** — 最新体重 + 对比箭头(↑↓→)
- **七天心情电波** — 横向排列过去 7 天的心情 Emoji 矩阵

**系统时间**: 所有日期计算通过 `getTodayStr()` 调用 `new Date()` 获取年月日，消除 `toISOString()` 时区偏差

### 6.2 DebtListView 【省钱计划】
调用 useDebtStore + useSettingsStore + askAI

功能：
- 看板横幅 + AI 鼓励语（`lastEncouragement` 持久化，金额变动才刷新）
- 新建/存入/编辑/删除/搜索
- 进行中/已完成 Tab
- Client-side 分页（每页 10 条）
- AI 里程碑拉拉队（25%/50%/75%/100% 阈值，弹出 AI 贺词弹窗）
- `getTodayStr()` 获取系统时间

### 6.3 WeightView 【体重记录】
调用 useWeightStore

功能：
- 统计卡片（当前/最轻/最重/总体变化）
- SVG 折线图（趋势可视化）
- 时间筛选（全部/近一月/近一周）
- 记录列表 + 趋势箭头
- Client-side 分页（每页 10 条）
- `getTodayStr()` 获取系统时间

### 6.4 MoodView 【心情日记】
调用 useMoodStore + useSettingsStore + askAI

功能：
- 日历视图（CSS Grid 月历，Emoji 心情图标，当天蓝色高亮）
- 添加按钮（显示今日心情 Emoji）
- 记录列表 + 分页
- AI 情绪回音壁（保存日记后底部浮动气泡）
- `getTodayStr()` 获取系统时间

### 6.5 SettingsView 【通用配置】
调用 4 个 Store + askAI

功能：
- 主页看板文案配置（前缀/后缀/字体大小）
- 自定义背景图（base64，5MB 限制）
- 安全管理（主密码修改、生物识别、安全锁定）
- AI 情绪陪伴 BYOK 配置（URL / Key / Model + Test Connection）
- 数据备份（三类独立 AES 加密导出/导入，原生 + 浏览器降级）

**aiEngine.js 说明**:
- `askAI(prompt)` — 原生 fetch 调用 OpenAI 兼容 `/v1/chat/completions` 端点
- 自动拼接端点路径
- GLM 模型不加 system prompt
- `max_tokens: 1024`，`temperature: 0.7`
- 推理模型（R1 系列）兼容 `reasoning_content`
- 速率限制优雅处理

---

## 七、数据持久化对照表

| Preferences Key | Store | 说明 |
|----------------|-------|------|
| `my_master_password` | auth | 主密码（明文） |
| `my_debt_manager_data` | debt | 省钱计划 JSON |
| `my_weight_records_data` | weight | 体重记录 JSON |
| `my_mood_records_data` | mood | 心情日记 JSON |
| `my_banner_settings` | settings | 看板文案配置 JSON |
| `my_custom_bg` | settings | 自定义背景 base64 |
| `my_ai_settings` | settings | AI 配置 JSON (url/key/model) |
| `my_home_cache` | settings | 首页缓存 (cachedQuote/fingerprint/encouragement) |

---

## 八、注意事项

1. **Pinia Setup Store 语法** — Composition API 风格
2. **无 vue-router** — `settingsStore.currentView` + v-if 手动管理
3. **仅中文界面**
4. **Capacitor 插件** 需真机/模拟器，浏览器 fallback console.warn
5. **密码明文存储** — 建议后续加盐哈希
6. **所有日期通过 `new Date()` 插值获取**，不使用 `toISOString().split('T')`，消除时区偏差
7. **已打包 APK**: `android/app/release/app-release.apk`
8. **无 iOS 支持**
9. **原生 binding** — Vite 8 依赖 rolldown/lightningcss，部分 Linux 需手动安装
10. **数据持久化竞争条件** — 已通过 `isDataLoaded` 标志位保护，防止空数组覆盖本地存储
