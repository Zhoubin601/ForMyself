# ForMyself — 我的自留地

ForMyself 是一个面向个人的全功能生活陪伴应用，集成**心情日记、省钱计划、体重记录**三大核心模块，并配备 AI 情绪陪伴引擎，帮助你记录日常、追踪目标、感受成长。

> 基于 Vue 3 + Vite + Capacitor 构建，支持 PWA 与 Android 原生部署。

---

## 功能概览

| 模块 | 功能 |
|------|------|
| **🏠 首页总览** | 数据面板聚合展示省钱进度、最新体重、7 天心情曲线；AI 每日简报根据数据变化生成鼓励语 |
| **😊 心情日记** | 日历视图记录每日心情（5 级 mood 选择）、可写日记；支持按月浏览与分页；AI 情绪回音壁自动共情 |
| **💰 省钱计划** | 自定义存钱目标、记录每次存入金额、环形进度展示；AI 里程碑祝贺与激励 |
| **⚖️ 体重记录** | 记录每日体重、统计面板（最轻/最重/变化趋势）、SVG 趋势折线图；支持周/月/全部筛选 |
| **⚙️ 通用配置** | 安全密码锁（支持指纹）、AI BYOK 接入、AES 加密数据导入/导出、自定义背景墙纸 |

---

## 技术栈

- **框架**: Vue 3 (Composition API + `<script setup>`)
- **构建**: Vite 8
- **状态管理**: Pinia 3
- **移动端**: Capacitor 8 (Android / PWA)
- **存储**: @capacitor/preferences (本地持久化)
- **AI 引擎**: BYOK 模式，兼容 DeepSeek / OpenAI / 通义千问等标准 API
- **安全**: CryptoJS AES 加密（数据备份）、@capgo/capacitor-native-biometric（指纹认证）
- **设计**: 类 Apple 设计语言 — SF Pro 字体、毛玻璃效果、圆角卡片、柔和动效

---

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

### 构建 Android 应用

```bash
npm run build
npx cap sync android
npx cap open android
```

---

## AI 情绪陪伴（BYOK）

ForMyself 内置 AI 陪伴引擎，你可以在设置页中配置自己的 API Key（支持 DeepSeek、OpenAI 等），数据仅在本机流转：

- **每日简报**: 首页自动生成结合省钱、体重、心情数据的个性化鼓励
- **情绪回音壁**: 记录心情后自动触发 AI 共情回复
- **省钱里程碑**: 进度到达 25%/50%/75%/100% 时自动祝贺
- **激励语**: 首页看板动态生成省钱鼓励语

---

## 数据安全

- 应用启动需主密码验证（支持指纹快捷解锁）
- 数据备份使用 AES 算法加密（以主密码为密钥）
- 三类数据（省钱/体重/心情）独立备份文件
- 所有数据仅存储在本地设备

---

## 项目结构

```
src/
├── App.vue              # 主入口（锁屏、导航、路由）
├── main.js              # 应用初始化
├── components/
│   ├── HomeView.vue     # 首页总览
│   ├── DebtListView.vue # 省钱计划
│   ├── MoodView.vue     # 心情日记
│   ├── WeightView.vue   # 体重记录
│   └── SettingsView.vue # 通用配置
├── stores/
│   ├── auth.js          # 认证状态
│   ├── debt.js          # 省钱数据
│   ├── mood.js          # 心情数据
│   ├── weight.js        # 体重数据
│   └── settings.js      # 应用设置
└── services/
    └── aiEngine.js      # AI API 调用封装
```
