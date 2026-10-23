import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { buildThemeCssVariables, THEME_PRESETS, contrastRatio } from '../../../src/services/themeSystem.js'

const root = process.cwd()
const qa = path.join(root, 'docs/qa/design-system-20261007')
const output = path.join(root, 'output')
fs.mkdirSync(qa, { recursive: true })
fs.mkdirSync(output, { recursive: true })
const normalize = value => value.replaceAll('\\', '/')
const link = (file, label = file, needle) => {
  let suffix = ''
  if (needle) {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n')
    const index = lines.findIndex(line => line.includes(needle))
    if (index < 0) throw new Error(`Evidence not found: ${file}: ${needle}`)
    suffix = `:${index + 1}`
  }
  return `[${label}](<${normalize(path.join(root, file))}${suffix}>)`
}
const sources = [
  'package.json', 'package-lock.json', 'index.html', 'src/main.js', 'src/App.vue',
  'src/styles/app.css', 'src/styles/settings.css', 'src/services/themeSystem.js',
  'src/composables/useAppController.js', 'src/components/HomeView.vue',
  'src/components/WeightView.vue', 'src/components/DebtListView.vue',
  'src/components/PasswordVaultView.vue', 'src/components/AppFeedbackHost.vue',
  'src/components/AppDateField.vue', 'src/components/AppTimeField.vue',
  'src/components/AppColorPalette.vue', 'src/components/CommonNoteField.vue',
  'src/components/settings/SettingsOverview.vue', 'src/components/settings/SettingsAppearance.vue',
  'src/features/todo/TodoProgressCard.vue', 'src/features/todo/TodoView.vue',
  'src/features/mood/MoodView.vue', 'src/features/schedule/ScheduleView.vue',
  'src/features/chat/ChatView.vue', 'src/components/MonthlyReportView.vue',
  'android/app/src/main/java/com/yubin/formyself/TodoWidgetSpacing.java',
  'android/app/src/main/java/com/yubin/formyself/TodoWidgetAnimation.java',
  'docs/20261003-app-audit-v1.md', 'docs/20261002-todo-v8-verification.md'
]
const screenshots = ['390-home.png', '390-todo-filled.png', '390-settings.png', '390-mood.png', '390-schedule.png', '390-passwords.png', '390-weight.png']
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const walk = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]) : []
const rawSnapshot = () => crypto.createHash('sha256').update(walk(path.join(root, 'raw')).sort().map(file => `${path.relative(root, file)}:${digest(file)}`).join('\n')).digest('hex')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const libraries = ['vue', 'pinia', 'lucide-vue-next', 'morphicons', '@capacitor/core', 'vite'].map(name => ({ name, declared: pkg.dependencies?.[name] || pkg.devDependencies?.[name], installed: JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version }))
const themes = Object.fromEntries(Object.keys(THEME_PRESETS).map(id => [id, buildThemeCssVariables({ presetId: id })]))
const contrastPairs = [
  ['原正文/白', '#1D1D1F', '#FFFFFF'], ['原次文字/白', '#7D8491', '#FFFFFF'],
  ['原次文字/页面', '#7D8491', '#F6F8FB'], ['原品牌蓝/白', '#4A8FD8', '#FFFFFF'],
  ['建议次文字/白', '#626D7D', '#FFFFFF'], ['建议次文字/页面', '#626D7D', '#F6F8FB'],
  ['危险文字/白', '#C44343', '#FFFFFF'], ['成功文字/浅绿', '#23734F', '#EAF8F1'],
  ['警告文字/浅黄', '#8B5610', '#FFF5E5'], ['待办白/背景', '#FFFFFF', '#19191F'],
  ['待办白/填充', '#FFFFFF', '#315956']
].map(([name, fg, bg]) => ({ name, fg, bg, ratio: Number(contrastRatio(fg, bg).toFixed(3)) }))
const evidence = {
  date: '2026-10-07', timezone: 'Asia/Shanghai', commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
  initialGitStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }),
  rawAggregateSha256Before: rawSnapshot(),
  sources: sources.map(file => ({ file, sha256: digest(path.join(root, file)) })),
  screenshots: screenshots.map(name => ({ file: `docs/qa/app-audit-20261003/${name}`, sha256: digest(path.join(root, 'docs/qa/app-audit-20261003', name)), captured: '2026-10-03', reviewed: '2026-10-07', kind: 'historical synthetic-data screenshots' })),
  libraries, themes, contrastPairs,
  skills: [
    { name: 'design-system', file: 'C:/Users/a3185/.agents/skills/design-system/SKILL.md', version: '1.0.0', use: '三层 tokens、组件规范' },
    { name: 'ui-ux-pro-max', file: 'C:/Users/a3185/.agents/skills/ui-ux-pro-max/SKILL.md', version: '资料未声明', use: '本地焦点/语义控件检索与交互审核' }
  ]
}
fs.writeFileSync(path.join(qa, 'source-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')

const cssName = '20261007-formyself-design-tokens-v1.css'
const mdName = '20261007-formyself-design-system-v1.md'
for (const name of [cssName, mdName]) if (fs.existsSync(path.join(output, name))) throw new Error(`Refusing to overwrite ${name}`)

const themeBlock = (id, selector) => {
  const vars = themes[id]
  const keys = ['primary', 'primary-rgb', 'primary-strong', 'on-primary', 'primary-soft', 'primary-soft-strong', 'surface-tint', 'border', 'gradient-start', 'gradient-end']
  return `${selector} {\n${keys.map(key => `  --fm-theme-${key}: ${vars[`--theme-${key}`]};`).join('\n')}\n}`
}
const css = `/* ForMyself Design System v1 · 2026-10-07
 * 依据当前源码生成。fm-* 为交付命名空间；不覆盖旧变量或安装任何库。
 * primitive → semantic → component。默认云朵蓝；运行时优先绑定 themeSystem.js。
 * [data-fm-theme] 只用于没有旧 --theme-* 的独立展示，设置在 html 元素上。
 * 本文件包含变量定义；组件状态与布局须按配套 Markdown 接入。
 */

/* 1. Primitive：运行时算法实际派生值，不复制 app.css 的过时静态回退 */
${themeBlock('cloud', ':root')}
${Object.keys(themes).filter(id => id !== 'cloud').map(id => themeBlock(id, `:root[data-fm-theme="${id}"]`)).join('\n\n')}

:root {
  --fm-p-white: #FFFFFF;
  --fm-p-ink: #1D1D1F;
  --fm-p-heading: #172033;
  --fm-p-muted: #626D7D; /* 建议统一值，替代低对比度 #7D8491 */
  --fm-p-page: #F6F8FB;
  --fm-p-pearl: #FAFBFD;
  --fm-p-hairline: #DFE4EA;
  --fm-p-divider: #EDF0F4;
  --fm-p-success: #23734F; /* 建议文字色 */
  --fm-p-success-soft: #EAF8F1;
  --fm-p-warning: #8B5610; /* 建议文字色 */
  --fm-p-warning-soft: #FFF5E5;
  --fm-p-danger: #C44343;
  --fm-p-danger-soft: #FFF0EF;
  --fm-p-disabled-bg: #EDF0F4;
  --fm-p-disabled-fg: #737C8A;
  --fm-p-todo-bg: #19191F;
  --fm-p-todo-fill: #315956;
  --fm-p-todo-accent: #72D1BD;
  --fm-p-todo-muted: #C0CFCC;
  --fm-p-todo-badge: #F5FAF8;
  --fm-p-todo-badge-ink: #142423;
  --fm-p-font-body: 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif;
  --fm-p-font-display: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif;
  --fm-p-font-mono: ui-monospace, 'SFMono-Regular', Consolas, monospace;
  --fm-p-size-caption: .75rem; /* 12：建议最小信息字号 */
  --fm-p-size-small: .875rem; /* 14 */
  --fm-p-size-body: 1.0625rem; /* 17 */
  --fm-p-size-nav: 1.1875rem; /* 19 */
  --fm-p-size-section: 1.3125rem; /* 21 */
  --fm-p-size-panel: 1.5rem; /* 24：由现有23/25收敛 */
  --fm-p-size-display: 2.5rem; /* 40 */
  --fm-p-size-progress: 4.375rem; /* 70：待办专用 */
  --fm-p-weight-regular: 400;
  --fm-p-weight-medium: 500;
  --fm-p-weight-semibold: 600;
  --fm-p-weight-bold: 700;
  --fm-p-line-tight: 1.2;
  --fm-p-line-body: 1.5;
  --fm-p-line-long: 1.6;
  --fm-p-space-1: .25rem;
  --fm-p-space-2: .5rem;
  --fm-p-space-3: .75rem;
  --fm-p-space-4: 1rem;
  --fm-p-space-5: 1.25rem;
  --fm-p-space-6: 1.5rem;
  --fm-p-space-8: 2rem;
  --fm-p-space-10: 2.5rem;
  --fm-p-space-12: 3rem;
  --fm-p-radius-input: 14px;
  --fm-p-radius-card: 20px;
  --fm-p-radius-panel: 24px;
  --fm-p-radius-feature: 26px;
  --fm-p-radius-sheet: 28px;
  --fm-p-radius-pill: 9999px;
  --fm-p-border-width: 1px;
  --fm-p-shadow-card: 0 10px 28px rgba(42, 55, 78, .065);
  --fm-p-shadow-panel: 0 20px 54px rgba(36, 51, 75, .12);
  --fm-p-shadow-floating: 0 26px 70px rgba(20, 31, 54, .24), 0 2px 8px rgba(20, 31, 54, .08);
  --fm-p-duration-fast: 120ms;
  --fm-p-duration-control: 180ms;
  --fm-p-duration-panel: 340ms;
  --fm-p-duration-progress: 400ms;
  --fm-p-ease-standard: cubic-bezier(.2, .8, .2, 1);
  --fm-p-ease-progress: cubic-bezier(.22, .68, .3, 1);
  --fm-p-touch-target: 48px; /* 建议移动 WebView 控件盒；原生用48dp */
  --fm-p-content-max: 800px;
  --fm-p-dialog-max: 390px;
  --fm-p-editor-max: 580px;
  --fm-p-icon-sm: 18px;
  --fm-p-icon-md: 21px;
  --fm-p-icon-lg: 24px;
  --fm-p-icon-stroke: 1.8;
  --fm-p-blur: 24px;
  --fm-p-z-content: 1;
  --fm-p-z-header: 50;
  --fm-p-z-drawer-mask: 100;
  --fm-p-z-drawer: 101;
  --fm-p-z-editor: 3500; /* 建议普通业务面板统一到此层 */
  --fm-p-z-popover: 10020;
  --fm-p-z-picker: 18000;
  --fm-p-z-dialog: 20000;
  --fm-p-z-toast: 21000;
}

/* 2/3. Semantic 与 Component 在同一主题作用域声明，供独立预览和项目接入 */
:root, .fm-design-system {
  --fm-color-brand: var(--theme-primary, var(--fm-theme-primary));
  --fm-color-action: var(--theme-primary-strong, var(--fm-theme-primary-strong));
  --fm-color-on-action: var(--theme-on-primary, var(--fm-theme-on-primary));
  --fm-color-action-soft: var(--theme-primary-soft, var(--fm-theme-primary-soft));
  --fm-color-selected: var(--theme-primary-soft-strong, var(--fm-theme-primary-soft-strong));
  --fm-color-theme-surface: var(--theme-surface-tint, var(--fm-theme-surface-tint));
  --fm-color-theme-border: var(--theme-border, var(--fm-theme-border));
  --fm-color-text: var(--fm-p-ink);
  --fm-color-heading: var(--fm-p-heading);
  --fm-color-text-secondary: var(--fm-p-muted);
  --fm-color-page: var(--fm-p-page);
  --fm-color-surface: var(--fm-p-white);
  --fm-color-surface-soft: var(--fm-p-pearl);
  --fm-color-border: var(--fm-p-hairline);
  --fm-color-divider: var(--fm-p-divider);
  --fm-color-success: var(--fm-p-success);
  --fm-color-success-soft: var(--fm-p-success-soft);
  --fm-color-warning: var(--fm-p-warning);
  --fm-color-warning-soft: var(--fm-p-warning-soft);
  --fm-color-danger: var(--fm-p-danger);
  --fm-color-danger-soft: var(--fm-p-danger-soft);
  --fm-color-disabled-bg: var(--fm-p-disabled-bg);
  --fm-color-disabled-fg: var(--fm-p-disabled-fg);
  --fm-color-scrim: rgba(16, 21, 34, .38);
  --fm-color-glass: rgba(255, 255, 255, .9);
  --fm-decoration-gradient: linear-gradient(145deg, var(--theme-gradient-start, var(--fm-theme-gradient-start)), var(--theme-gradient-end, var(--fm-theme-gradient-end)));
  --fm-font-body: var(--fm-p-font-body);
  --fm-font-display: var(--fm-p-font-display);
  --fm-font-mono: var(--fm-p-font-mono);
  --fm-size-body: var(--fm-p-size-body);
  --fm-size-small: var(--fm-p-size-small);
  --fm-size-caption: var(--fm-p-size-caption);
  --fm-size-nav: var(--fm-p-size-nav);
  --fm-size-section: var(--fm-p-size-section);
  --fm-size-panel: var(--fm-p-size-panel);
  --fm-size-display: var(--fm-p-size-display);
  --fm-line-body: var(--fm-p-line-body);
  --fm-line-long: var(--fm-p-line-long);
  --fm-space-inline: var(--fm-p-space-2);
  --fm-space-row: var(--fm-p-space-3);
  --fm-space-card: var(--fm-p-space-4);
  --fm-space-section: var(--fm-p-space-6);
  --fm-page-gutter: var(--fm-p-space-4);
  --fm-page-max: var(--fm-p-content-max);
  --fm-radius-control: var(--fm-p-radius-input);
  --fm-radius-card: var(--fm-p-radius-card);
  --fm-radius-panel: var(--fm-p-radius-panel);
  --fm-shadow-card: var(--fm-p-shadow-card);
  --fm-shadow-panel: var(--fm-p-shadow-panel);
  --fm-shadow-floating: var(--fm-p-shadow-floating);
  --fm-duration-fast: var(--fm-p-duration-fast);
  --fm-duration-control: var(--fm-p-duration-control);
  --fm-duration-panel: var(--fm-p-duration-panel);
  --fm-duration-progress: var(--fm-p-duration-progress);
  --fm-ease-standard: var(--fm-p-ease-standard);
  --fm-ease-progress: var(--fm-p-ease-progress);
  --fm-focus-color: var(--fm-color-action);
  --fm-focus-width: 2px;
  --fm-focus-offset: 3px;
  --fm-touch-target: var(--fm-p-touch-target);
  --fm-icon-sm: var(--fm-p-icon-sm);
  --fm-icon-md: var(--fm-p-icon-md);
  --fm-icon-lg: var(--fm-p-icon-lg);
  --fm-icon-stroke: var(--fm-p-icon-stroke);
  --fm-glass-blur: var(--fm-p-blur);
  --fm-z-header: var(--fm-p-z-header);
  --fm-z-drawer-mask: var(--fm-p-z-drawer-mask);
  --fm-z-drawer: var(--fm-p-z-drawer);
  --fm-z-editor: var(--fm-p-z-editor);
  --fm-z-popover: var(--fm-p-z-popover);
  --fm-z-picker: var(--fm-p-z-picker);
  --fm-z-dialog: var(--fm-p-z-dialog);
  --fm-z-toast: var(--fm-p-z-toast);

  --fm-button-bg: var(--fm-color-action); /* 小字按钮用实色；渐变单独复核 */
  --fm-button-fg: var(--fm-color-on-action);
  --fm-button-secondary-bg: var(--fm-color-surface);
  --fm-button-secondary-fg: var(--fm-color-action);
  --fm-button-secondary-border: var(--fm-color-action);
  --fm-button-danger-bg: var(--fm-color-danger);
  --fm-button-danger-fg: var(--fm-p-white);
  --fm-button-disabled-bg: var(--fm-color-disabled-bg);
  --fm-button-disabled-fg: var(--fm-color-disabled-fg);
  --fm-button-hover-filter: brightness(.96);
  --fm-button-pressed-filter: brightness(.92);
  --fm-button-radius: var(--fm-p-radius-pill);
  --fm-button-height: var(--fm-touch-target);
  --fm-button-padding-x: 22px; /* 现有按钮值，显式保留 */
  --fm-button-weight: var(--fm-p-weight-semibold);
  --fm-button-duration: var(--fm-duration-control);
  --fm-input-bg: var(--fm-color-surface);
  --fm-input-fg: var(--fm-color-text);
  --fm-input-placeholder: var(--fm-color-text-secondary);
  --fm-input-border: var(--fm-color-border);
  --fm-input-error-border: var(--fm-color-danger);
  --fm-input-radius: var(--fm-radius-control);
  --fm-input-height: 52px;
  --fm-input-padding-x: var(--fm-p-space-4);
  --fm-input-padding-y: 14px;
  --fm-card-bg: var(--fm-color-glass);
  --fm-card-border: var(--fm-color-border);
  --fm-card-radius: var(--fm-radius-card);
  --fm-card-padding: var(--fm-space-card);
  --fm-card-shadow: var(--fm-shadow-card);
  --fm-nav-bg: #F8F9FC; /* 已有稳定不透明顶栏 */
  --fm-nav-height: 58px;
  --fm-nav-button-radius: var(--fm-radius-control);
  --fm-dialog-bg: var(--fm-color-surface);
  --fm-dialog-radius: var(--fm-radius-panel);
  --fm-dialog-max: var(--fm-p-dialog-max);
  --fm-dialog-padding: var(--fm-p-space-6);
  --fm-sheet-radius: var(--fm-p-radius-sheet);
  --fm-sheet-max: var(--fm-p-editor-max);
  --fm-picker-max-height: 92dvh;
  --fm-segment-bg: var(--fm-color-surface-soft);
  --fm-segment-selected-bg: var(--fm-color-surface);
  --fm-segment-selected-fg: var(--fm-color-action);
  --fm-segment-radius: var(--fm-radius-control);
  --fm-segment-height: var(--fm-touch-target);
  --fm-chip-bg: var(--fm-color-action-soft);
  --fm-chip-fg: var(--fm-color-action);
  --fm-chip-radius: var(--fm-p-radius-pill);
  --fm-toast-bg: rgba(33, 38, 49, .92);
  --fm-toast-fg: var(--fm-p-white);
  --fm-toast-radius: var(--fm-p-radius-pill);
  --fm-todo-bg: var(--fm-p-todo-bg);
  --fm-todo-fill: var(--fm-p-todo-fill);
  --fm-todo-accent: var(--fm-p-todo-accent);
  --fm-todo-fg: var(--fm-p-white);
  --fm-todo-muted: var(--fm-p-todo-muted);
  --fm-todo-badge-bg: var(--fm-p-todo-badge);
  --fm-todo-badge-fg: var(--fm-p-todo-badge-ink);
  --fm-todo-radius: var(--fm-p-radius-feature);
  --fm-todo-padding: 22px;
  --fm-todo-percent-size: var(--fm-p-size-progress);
  --fm-todo-row-height: 56px;
  --fm-todo-check-size: 44px; /* 视觉尺寸；点击盒另取48 */
  --fm-todo-duration: var(--fm-duration-progress);
}

/* 纯 CSS token 降级；控件本身仍需 disabled/ARIA/焦点管理 */
@supports not (backdrop-filter: blur(1px)) {
  :root, .fm-design-system { --fm-color-glass: var(--fm-p-white); --fm-glass-blur: 0px; }
}
@media (prefers-reduced-motion: reduce) {
  :root, .fm-design-system {
    --fm-duration-fast: 0ms;
    --fm-duration-control: 0ms;
    --fm-duration-panel: 0ms;
    --fm-duration-progress: 0ms;
  }
}
`

const themeRows = Object.entries(themes).map(([id, vars]) => `| ${THEME_PRESETS[id].name} / ${id} | ${vars['--theme-primary']} | ${vars['--theme-primary-strong']} | ${vars['--theme-primary-soft']} | ${vars['--theme-border']} | ${contrastRatio(vars['--theme-primary-strong'], '#FFFFFF').toFixed(2)}:1 |`).join('\n')
const libraryRows = libraries.map(({name,declared,installed})=>`| ${name} | ${declared} | ${installed} | ${({'vue':'界面框架与自绘组件；不是现成组件库','pinia':'界面状态管理；不是 UI 库','lucide-vue-next':'导航、设置、省钱等线性 SVG 图标','morphicons':'日程完成按钮的 MorphIcon，导入 morphicons/vue','@capacitor/core':'Android WebView 与原生桥接；不是 UI 库','vite':'构建工具；不是 UI 库'})[name]} |`).join('\n')
const contrastRows = contrastPairs.map(item=>`| ${item.name} | ${item.fg} | ${item.bg} | ${item.ratio.toFixed(2)}:1 |`).join('\n')
const md = `# ForMyself 设计系统 v1

日期：2026-10-07（北京时间）。依据：当前提交 ${evidence.commit} 的项目源码、已存在的合成数据界面截图及用户本次要求。用户已确认以 Markdown + CSS 交付，沿用浅色、柔和卡片和可切换主题色方向，并要求记录 UI 库和技能。

交付配套：${link(`output/${cssName}`, 'CSS design tokens')}。这是设计和前端交接规范；以下“建议统一”描述目标规则，不能理解为功能已经改造。

## 1. 资料边界、产品气质与用户场景

附图 codex-clipboard-2c8b7fd5-2648-4527-b304-98478d7ea0f5.jpg 是需求清单，未展示 App UI。视觉归纳使用本项目的真实界面实现和 2026-10-03 QA 截图；截图里的日期、模拟记录、空状态属于当时合成测试，不能当作真实用户数据。本轮查看了首页、待办、设置、心情、日程、密码库、体重七份截图，并以当前代码核对数值。

raw/ 中是私人加密备份，本任务没有采用其内容或解密。memory-bank/ 资料未提供。用户画像研究、年龄分布、访谈、品牌手册、正式深色主题方案：资料未提供。

**产品气质（设计判断）**：温和、私密、可持续的个人生活记录空间。首页“安排好今天，也照顾好自己”、待办“还有…件小事，慢慢来”，以及日记、存钱、体重、密码模块，支持“生活陪伴 + 轻量管理”的定位。该判断不是用户调研结论。

**目标用户（设计推断）**：希望在同一个私人空间记录情绪、健康、目标和日常安排的个人使用者；愿意自行配置 AI 服务的用户属于扩展场景。不能从源码推断具体年龄、收入或市场规模。

**核心场景**：打开首页快速了解今天；以少量步骤记录心情/体重/存入；安排日程和勾选待办；定期回看趋势；按需要解锁密码库、备份和调整外观；主动使用温馨小家/AI。设计优先级是记录与回看，其次是配置与陪伴。

依据：${link('src/components/HomeView.vue', '首页', '<div class="home-dashboard">')}、${link('src/features/todo/TodoProgressCard.vue', '待办文案', 'todo-subtitle')}、${link('src/App.vue', '导航', '生活面板')}。隐私文案必须对应实际数据流：存在 AI 请求和用户主动分享/导出，不得把“核心数据在设备内”扩写成“所有数据永远不离开设备”。

## 2. 现有视觉语言：保留哪些规律

| 维度 | 当前具体实现 | 归纳与处理 |
|---|---|---|
| 页面底色 | #F6F8FB，局部主题色径向柔光 | 低对比环境底；减少大面积高饱和色 |
| 卡片表面 | 白色或白色 .82～.97 透明度，细边框、柔和阴影 | 中低层级，信息先于装饰；长文与表单优先不透明白 |
| 主色 | 四套预设 + 自定义；交互色经算法加深 | 把“品牌色”和“小字操作色”分开 |
| 字体 | SF Pro 名称 + 系统回退；Android 实际字体由系统决定 | 不宣称已加载 SF Pro；补中文系统回退 |
| 页面结构 | 大多16px侧边距、800px最大内容宽度；首页三个快捷卡；设置双列 | 移动优先、内容分组清楚；日程/聊天为全高独立结构 |
| 圆角 | 输入14、全局卡片20、面板24；局部16/18/22/26/28并存 | 统一常用层级；26待办与28底部选择器保留专用用途 |
| 按钮 | 主按钮胶囊、渐变与按压缩放；反馈按钮14圆角矩形 | 保留胶囊操作语义，区分底部编辑器/对话框内部操作 |
| 图标 | Lucide线性、手写SVG、Morphicons、Emoji/文字符号 | 同层级统一21/24px、1.8线宽；Emoji保留情绪内容用途 |
| 待办 | #19191F深色卡、#315956填充、#72D1BD薄荷强调、70px百分比 | 独立“目标进度”变体，不推广为全站深色主题 |
| 动效 | 控件160～200ms、抽屉340ms、待办400ms，背景常驻漂浮 | 微反馈保留，装饰动效默认静态为建议；进度400ms例外保留 |

尺寸依据：${link('src/styles/app.css', '全局 tokens 与字体', ':root {')}、${link('src/components/HomeView.vue', '首页快捷栅格', '.today-grid {')}、${link('src/styles/settings.css', '设置栅格', '.settings-container .general-settings-grid')}、${link('src/features/todo/TodoProgressCard.vue', '待办样式', '.todo-progress-card {')}。

## 3. 设计原则

| 规范 | 适用场景 | 不要怎么用 |
|---|---|---|
| 一屏突出一个当前行动；记录按钮用动词 | 首页快捷记录、空状态、新增页 | 同一分组放两个同样强的主按钮，让用户猜下一步 |
| 温柔表达、准确状态；缺失用“尚未记录” | 情绪、体重、待办、AI | 用失败、落后等词评价用户；把没有记录显示成0或默认开心 |
| 私密感来自可控操作和准确边界 | 密码查看、导出、AI发送前说明 | 用模糊的“绝对安全”代替具体范围 |
| 视觉一致以语义为单位 | 普通卡、业务表单、组件状态 | 为追求统一把待办深色卡、日程全高结构全部改成同一容器 |
| 内容和可操作性先于柔光 | 长备注、图表、软键盘、大字 | 为保留固定卡片高度裁掉重要信息或保存按钮 |
| 颜色必须有文本/图形辅助 | 分类、错误、完成、选中 | 单靠红绿区别意义；只改透明度就当完成了 disabled 语义 |

## 4. 色彩系统

### 4.1 主题色与算法

以下是本轮执行 buildThemeCssVariables 得到的实际运行值，**不是 app.css 的静态回退值**：

| 主题 | 品牌色 | 操作色 strong | soft表面 | 主题边框 | strong对白字 |
|---|---|---|---|---|---|
${themeRows}

品牌色适合柔光、色块、主题预览；小字链接、主按钮、选中标签用 strong。不要把品牌蓝 #4A8FD8 直接当小字白字按钮底，其对白字只有3.38:1。自定义色继续通过 ${link('src/services/themeSystem.js', 'themeSystem.js', 'export function ensureWhiteTextContrast')} 的算法派生，不手写另一套 HEX 变换。

算法已有“对白字达到4.5”的设计目标，本规范沿用作为普通文字验收目标，不宣称 App 已满足完整无障碍标准。渐变亮端经过加白后可能低于此目标；建议文字操作用 strong 实色，渐变用于装饰或重新逐点测量后使用。半透明、壁纸和禁用状态需单独评价，纯色对比不能代替完整画面验证。

### 4.2 中性与状态色

| 语义 / CSS token | 值 | 适用场景 | 不要怎么用 |
|---|---|---|---|
| text / --fm-color-text | #1D1D1F（现有） | 正文、数据 | 所有层级一律黑色 |
| heading / --fm-color-heading | #172033（来自首页） | 章节与品牌标题 | 业务模块继续引入任意不同黑色 |
| secondary / --fm-color-text-secondary | #626D7D（建议统一） | 说明、日期、未填信息 | 继续用原#7D8491承担小字号核心信息 |
| page / --fm-color-page | #F6F8FB（现有） | 页面底 | 做主要控件边界而没有其他轮廓 |
| surface / --fm-color-surface | #FFFFFF（现有） | 输入、弹窗、长文 | 把“透明”作为信息卡的必选项 |
| border / divider | #DFE4EA / #EDF0F4（现有） | 卡片分组/内容分隔 | 仅靠很淡的分隔线标识可点控件 |
| success / soft | #23734F / #EAF8F1（前者建议） | 保存成功、已完成 | 作为主题绿的替代或传达健康诊断 |
| warning / soft | #8B5610 / #FFF5E5（前者建议） | 操作前提示、可恢复风险 | 把一般说明全部警告化 |
| danger / soft | #C44343 / #FFF0EF（现有反馈色） | 删除、失败、不可逆覆盖 | 体重上升一概染红；低落心情等同错误 |
| disabled | #EDF0F4底 / #737C8A字（建议） | 当前不能执行的操作 | 使用低透明度后仍可点击 |
| todo变体 | #19191F / #315956 / #72D1BD（现有） | 今日待办与目标进度 | 把这三色当全局品牌色或正式深色模式 |

测量记录（源码纯色对，非完整截图抽样）：

| 对象 | 前景 | 背景 | 对比度 |
|---|---|---|---|
${contrastRows}

建议值是本次设计方案，未写回 src。完整主题色明细和计算证据见 ${link('docs/qa/design-system-20261007/source-evidence.json', 'source-evidence.json')}。

## 5. 字体与数字系统

| 层级 / token | 建议字号、字重、行高 | 适用场景 | 不要怎么用 |
|---|---|---|---|
| display | 40px / 600～700 / 1.1 | 体重等核心数值；现有.display-lg基准 | 用于长标题或一屏多个大数 |
| progress | 70px / 700 / 1.1，待办专用 | 百分比主视觉，现有值 | 作为普通卡片的默认数字 |
| panel | 24px / 600 / 1.2（收敛23/25） | 面板标题 | 直接套在导航导致撑高 |
| section | 21px / 600 / 1.3 | 首页章节、模块小结 | 挤在长段落内部 |
| nav | 19px / 600 / 1.2 | 顶栏标题，沿用.tagline尺寸 | 对所有中文机械套用负字距 |
| body | 17px / 400 / 1.5 | 表单正文、主要动作、叙述 | 为省高度降到11px |
| small | 14px / 400～600 / 1.5 | 列表标题/辅助信息 | 用低对比色表示核心动作 |
| caption | 12px / 400 / 1.5（建议下限） | 时间、图表标签、计数说明 | 继续用首页8px日期或9px英文承担阅读信息 |

原实现SF Pro Text/Display只是字体栈名称，未发现字体文件加载。交付栈增加 PingFang SC、Microsoft YaHei、Noto Sans CJK SC 回退名称，**不打包字体**。默认正文用系统字体，中文 letter-spacing: normal；只对大号拉丁数字进行少量光学校正。金额、体重、计数建议 font-variant-numeric: tabular-nums；密码内容可用 --fm-font-mono，但不把整站变成等宽字体。

rem值按浏览器16px基准对应上述px；不固定html字号，接受用户放大。长备注使用正常换行/overflow-wrap:anywhere，关键字段最多两行时必须能进入详情看全文。适用：大字、长任务名、中文和英文混排；不要用 transform:scale 缩小整个页面解决排版。

## 6. 间距、栅格与安全区

| 规范 | 适用场景 | 不要怎么用 |
|---|---|---|
| 4px基础；8/12/16/20/24/32/40/48档 | 相邻图标8、列表12、卡内16～20、章节24 | 每个页面增加9/11/13/17等新档；22px可作为已有hero/待办特例保留 |
| 页面侧边距16px、标准宽度上限800px | 普通模块；来源.content-area | 将长内容铺满1440px屏幕 |
| <380px设置卡一列；≥380px两列 | 已有设置布局，间隔建议12（现有11） | 在320px硬塞双列，使说明挤成单字列 |
| 首页记录入口保持三等分、8px间隔 | 心情/体重/存钱三个短入口 | 增加第4/5入口仍强塞三列；大字溢出时应允许改为单列 |
| 省钱计划保持手机两列及自定义分组 | 现有省钱网格和拖动 | 从规范推导成所有列表都应两列；更改已确认拖动逻辑 |
| 密集表单用纵向行，不用多列小输入 | 待办编辑器、日期/时间/重复规则 | 为减少滚动而让标签、值、箭头互相遮挡 |
| 日程/聊天独立全高布局 | 原有全高滚动区与聊天输入栏 | 直接继承800px外壳与52px底padding造成双滚动 |
| 固定顶部/底部必须加env安全区 | 顶栏、底部sheet、聊天工具栏 | 将safe-area-inset-top的fallback当所有Android设备真实状态栏高度 |
| 软键盘出现时保留可见保存动作和可滚动表单 | 待办、密码编辑、日记 | 只凭100vh认为键盘不会遮挡；缓存固定可视高度 |

建议移动WebView普通控件点击盒至少48×48 CSS px；Android原生控件用48dp，两者不直接当成同单位。视觉图标仍可21～24px，通过容器扩大点击区。密集日历和桌面待办需单独验收邻接间距，不为凑尺寸改坏现有排版。

原生桌面v8任务行约32/36/40dp与Web待办56px是不同实现；原生版存在已确认紧凑设计及动画压力限制，不宣称本CSS会改变或修复它。依据：${link('docs/20261002-todo-v8-verification.md', 'v8验收')}、${link('android/app/src/main/java/com/yubin/formyself/TodoWidgetSpacing.java', '原生间距')}。

## 7. 圆角、边框、阴影与透明层

| token/规范 | 适用场景 | 不要怎么用 |
|---|---|---|
| control14 / card20 / panel24 | 输入、普通卡、中心弹窗的三个基础层级 | 普通信息卡继续随机16/18/22；下层元素比父级更圆 |
| feature26 / sheet28 | 待办特例；日期/时间底部面板 | 每块普通卡都升格成26/28 |
| pill9999 | 主动作、状态chip、toast | 表单输入也做胶囊，削弱文字对齐 |
| 默认1px边框 | 普通卡与字段；点击边界要可辨认 | 以透明边框和低对比阴影作为唯一控件线索 |
| shadow-card：0 10px 28px rgba(42,55,78,.065) | 首页与可进入的卡 | 每一个列表行都加浮层阴影 |
| shadow-panel：0 20px 54px rgba(36,51,75,.12) | hero和重要面板 | 背景装饰制造比前景更重的阴影 |
| shadow-floating：反馈现有26px/70px浮层阴影 | 对话框、浮层选择 | 用来伪造按钮禁用/选中状态 |
| 24px blur、白底透明度≥.9为默认建议 | 弹层、短内容玻璃卡 | 在长文下面叠强壁纸；不支持blur时保留高透明表面 |

长文、表单、危险确认优先不透明白；不支持 backdrop-filter 时退化为白色实面。阴影用于层级，不承担成功/警告含义。模态遮罩统一建议rgba(16,21,34,.38)，仍须在复杂壁纸下核验。

## 8. 核心组件交接规格

| 组件 | 结构与规范 | 状态/行为 | 适用场景 | 不要怎么用 |
|---|---|---|---|---|
| 顶栏 | 高度基准58 + 安全区；19px标题；左右等宽48点击盒、21/24图标、14圆角 | 返回/菜单/模块设置有明确aria-label；占位保持标题居中 | 普通模块导航 | 首页强加无用途齿轮；日程再放重复搜索入口 |
| 主/次按钮 | min-height48；17px/600；主色strong+白字；主按钮胶囊；次按钮白底主色边框 | hover亮度.96、pressed .92；焦点2px+3px offset；disabled用原生语义 | 页面主要动作；对话框内按钮允许14圆角 | 宽高跟随加载内容跳动；所有操作都主按钮 |
| 图标按钮 | 图标21/24，stroke1.8；点击盒48 | aria-label、pressed反馈、focus-visible | 设置、关闭、上一日 | 只给36/38像素视觉图形点击区 |
| 输入/长文本 | 白底、14圆角、1px边；单行min52、左右16；显式label；说明14、错误14 | focus有可见轮廓；错误色边+文字；失败保留输入 | 密码、金额、备注、日记 | 只靠placeholder作标签；静默清空用户内容 |
| 日期/时间 | 复用AppDateField/AppTimeField；图标18、字段跟随表单字体；底部sheet28 | Esc/返回关闭、恢复焦点；日期当前/选中/不可选区分；00～59分钟可达 | 业务表单 | 混用系统选择器形成另一套不可控视觉 |
| 常用备注 | 复用CommonNoteField；输入内箭头；匹配字段宽度的浮层、内部可滚 | combobox/listbox状态；上下键/Enter/Esc；选择后关闭；管理单独入口 | 省钱、体重备注 | 修改常用备注时改写历史原备注 |
| 普通卡 | 20圆角、16～20内边距、细边框、轻阴影；标题与辅助信息两级 | 仅可点击卡提供pressed/focus；静态卡不显示箭头 | 首页、设置、列表摘要 | 里面嵌套多个独立点击区但整卡也抢事件 |
| 待办进度卡 | 26圆角、22padding、70px百分比、56行；深灰/深绿/薄荷色；计数badge | 400ms进度过渡；复选框44视觉+48点击盒；完成加勾和划线；提供编辑入口 | 首页摘要、今日待办 | 当全站深色模式；无限循环进度；仅颜色表示完成 |
| 分段控件 | 一组等宽按钮，容器14圆角；背景浅灰、选中白；操作色文本；min48 | 同步选中语义；键盘可达；完整显示选项 | 时间范围、列表/月历等视图选择 | 只有active类而辅助技术无法知晓；选项太多压缩字号 |
| 分类chip/标签 | 胶囊、12/14px；颜色圆点+文字；选中浅主题底与strong文字 | 可点标签扩大点击区；aria-pressed或checkbox语义 | 心情多选、分类过滤、收藏 | 所有chip都看起来可点；只用颜色无名称 |
| 日历 | 七列、月份居中；今天小圆点/轮廓；选中主色；事件点+文本说明 | 可访问日期标签；当前/选中/空白区分；不捏造未记心情 | 心情和日程日期回看 | 没有记录就默认填入真实事件；数字变色是唯一状态 |
| 对话框/底部面板 | 简单确认中心max390；业务sheet max580、顶角28；长表单内部滚动 | modal焦点圈定、Esc/返回栈、关闭后焦点恢复；危险操作标题说明范围 | 删除、覆盖、编辑、选择 | 仅写aria-modal当作完成焦点管理；多个无遮罩浮层叠加 |
| Toast/行内提示 | toast深灰胶囊、14px白字、短句；行内说明放字段下方 | 非阻塞成功role=status；可操作错误留行内；连续相同提示合并为建议 | 保存、复制、撤销反馈 | 一次保存堆两个toast；只toast报错随后消失 |
| 图表/趋势 | 现有自绘SVG；线2px；12px建议标签；空数据明确提示 | 选中点有文本摘要；颜色+位置；大量点减少标记 | 体重与首页趋势 | 为视觉平滑伪造数据；用健康诊断口吻解释波动 |
| 搜索/空态 | 搜索显式名称；空态标题+解释+一个明确动作 | 搜索中/无匹配/首次无数据分别提示 | 密码库、日程、各记录页 | 所有空态写“失败”；搜索失败展示“无结果”掩盖错误 |

共享组件来源：${link('src/components/AppFeedbackHost.vue', 'AppFeedbackHost')}、${link('src/components/AppDateField.vue', 'AppDateField')}、${link('src/components/AppTimeField.vue', 'AppTimeField')}、${link('src/components/CommonNoteField.vue', 'CommonNoteField')}、${link('src/features/todo/TodoProgressCard.vue', 'TodoProgressCard')}。Date/Time调色字段仍需组件行为配合，CSS变量不实现选择逻辑。

## 9. 状态与动效规范

| 状态 | 必须具备 | 适用场景 | 不要怎么用 |
|---|---|---|---|
| default | 可阅读的文字、清楚的点击边界 | 所有控件 | 使用禁用般的低对比度作默认态 |
| hover | 仅支持悬停设备启用，轻微底色/亮度变化 | 桌面/PWA | 移动点按后留下永久hover；变化尺寸 |
| pressed | 120～180ms亮度/颜色反馈；目标建议不位移 | 普通触控 | 延用全局scale(.95)让文字和点击目标明显收缩 |
| focus-visible | 2px操作色轮廓、3px偏移；深卡另用薄荷色 | 键盘、辅助输入 | outline:none后没有替代；焦点藏进关闭抽屉 |
| selected | 背景+文字+勾/ARIA；与today区分 | 主题、分类、日期、分段 | 仅通过颜色表示选中 |
| disabled | disabled/不可交互；稳定布局；说明不可用原因 | 请求中、缺少必要输入 | pointer-events:none当唯一语义；只opacity |
| loading | 保留按钮宽度和动作对象；防重复提交；aria-busy | 解锁、生成、保存 | spinner无限转且不允许取消/重试 |
| empty | 原因+合适下一步；占位数字用-- | 新用户、无匹配、指定范围无记录 | 把尚未记录当0、自动填补个人事实 |
| error | 行内错误、保留输入、提供修正/重试；颜色+文字 | 校验、加载、持久化失败 | 没落盘就显示“已保存”；反复toast代替错误说明 |
| success | 明确操作对象；可恢复操作提供撤销 | 保存、复制、完成 | 宣称未完成或未验证的动作已成功 |
| drag | 抬起/目标槽/返回反馈；300ms长按沿用既有；键盘/按钮替代 | 省钱分组拖动 | 破坏正常滚屏；所有卡片都变成可拖 |
| reduced motion | 装饰静态、非必要过渡0ms；进度立即到最终值 | 系统减少动画偏好 | 仅缩短动画而继续常驻漂浮；强制动画全部同一时长 |

动效档：fast120ms、control180ms、panel340ms、progress400ms；standard cubic-bezier(.2,.8,.2,1)，待办保留 cubic-bezier(.22,.68,.3,1)。400ms是业务进度的既有特例，原生环形进度仍由Java控制。不要通过新CSS承诺原生动画压力问题已解决。

层级建议：内容1、顶栏50、抽屉遮罩100/本体101、普通业务编辑器3500、备注浮层10020、日期时间选择器18000、反馈对话框20000、toast21000。层级须配合焦点和返回键管理；不靠增大z-index修复所有叠层问题，锁屏时关闭业务浮层。

## 10. 图标、插画与品牌素材

| 规范 | 适用场景 | 不要怎么用 |
|---|---|---|
| 现有Lucide为常规结构图标，21px为默认、24为大、18为尾箭头；线宽1.8 | 导航、设置、功能动作 | 混入另一套粗填充图标或因技能默认推荐而新增React图标库 |
| Morphicons仅保留日程完成/未完成的有意义过渡 | 现有MorphIcon；reduced-motion=user | 让全部导航图标持续变形 |
| 手写SVG与Lucide保持相同viewBox/线帽/线宽 | Date/Time/反馈等已有组件 | 同一行混1.5/2.5粗细，Emoji替代关闭/设置 |
| Emoji允许用于用户心情表达，与中文情绪名称并列 | 心情等级、日记情绪内容 | 作为系统导航、密码/安全操作的唯一图标 |
| 品牌使用public/icon.png现有真实图标 | 锁屏、侧栏、应用入口 | 用字母F或临时插画冒充Logo；随意变形 |
| 插画限空态和情绪辅助，优先复用现有SVG | 省钱空态、欢迎场景 | 本次规范凭空增加新品牌吉祥物、网络素材或医疗象征 |

图标控件必须有aria-label；旁边已有相同文字的装饰图标aria-hidden=true；选择/展开状态通过ARIA同步。素材文件没有正式品牌授权/手册资料，故不推断完整商标规范。此次未生成图片、未使用ImageGen、未下载字体和网络图标。

## 11. 文案语气规范

| 场景 | 推荐 | 避免 | 使用规则 |
|---|---|---|---|
| 空状态 | “还没有体重记录”“记录今天的第一个事件” | “数据异常”用于首次无记录 | 讲清缺失范围，给一个动作 |
| 待办 | 沿用“还有…件小事，慢慢来” | “你又没完成任务” | 计数真实，不给人格评价 |
| 保存 | 持久化成功后“体重已保存” | 写入前就提示“保存成功” | UI必须等业务成功；仅规范交接，本轮未修复存储实现 |
| 删除 | “删除这条记录？”+影响范围+取消/删除 | “确定吗？”无对象 | 不可逆动作明确说明，可撤销时说明撤销入口 |
| 校验 | “请输入大于0的金额” | “参数错误” | 指向字段和修正动作 |
| 权限 | 说明功能、请求原因、跳过后的影响 | “不开启就无法正常使用”泛化 | 按用户实际选择保留可用能力 |
| 健康/情绪 | 记录趋势、描述变化 | 医疗诊断、把低落等同错误 | App行为文案不越过已有业务边界 |
| 隐私/AI | 区分本机保存、主动AI请求和导出 | “所有数据绝不上传” | 有发送行为时说明实际范围；不展示密钥 |

普通动作使用“记录、保存、添加、修改、删除、取消、完成”。界面主体中文，产品名ForMyself可保留；“MY PRIVATE SPACE”仅作现有品牌装饰，不承担主要阅读。文案不出现实现术语、token名字、IPC等工程细节。

## 12. 当前不一致与设计红线

这里的“统一”是建议实施项，源码证据可复核；2026-10-03实测结论明确标为历史结果，本轮未重跑全部交互。

| 问题 / 优先级 | 具体证据 | 建议统一 | 不要怎么处理 |
|---|---|---|---|
| 次文字对比P1 | 原#7D8491对白3.76:1；很多11px说明 | 改用#626D7D、主要辅助≥14、caption≥12 | 为看起来柔和继续降低透明度 |
| 静态与动态主题分叉P1 | app.css strong=#35679C，而云朵运行值=#3E77B4；soft也不一致 | themeSystem.js为派生色来源；交付CSS桥接它 | 手抄静态回退值声称是当前生效值 |
| 渐变亮端对白字P1 | themeSystem把strong加白8%；白字contrast可能不足 | 小字按钮改strong实色，渐变仅装饰/实测后用 | 只测strong就宣称整段渐变合格 |
| 按钮焦点P1 | ${link('src/styles/app.css', '全局outline:none', "[role='button'],")}，缺少统一focus-visible | 提供主题/深卡两套焦点轮廓 | 只给输入框焦点，遗漏菜单和按钮 |
| 抽屉/模态焦点P1 | ${link('src/App.vue', 'drawer', 'class="drawer"')}未圈定关闭时焦点；历史审查确认可聚焦；反馈只自动focus prompt输入 | 关闭抽屉移出Tab顺序；模态圈定与恢复焦点 | 仅视觉移出屏幕或aria-modal=true |
| 小点击区P2 | 全局nav38、drawer-close36，日程plain-icon36，Date42/Time40 | 图标不变、点击盒扩48；密集网格单独复核 | 无依据认定所有小目标都违反完整标准 |
| 顶栏结构P2 | 普通58px不透明底+边框按钮；日程年份28、无框36按钮 | 保留年份语义但共享点击盒/焦点/安全区和图标规范 | 把日程标题改成普通模块名，牺牲已有功能 |
| 形状与字号漂移P2 | 心情calendar18、card16；password-card18；chart-card16；反馈26；导航字重650 | 常规card20、panel24；限定special26/28；字重400/500/600/700 | 更改全部圆角却未区分卡片/选择器 |
| 输入样式P2 | apple-input14，Time10、min40，待办标题12、min48 | 表单控件14/52；紧凑行组件保留布局但共享状态/触控 | 每页重写一套日期时间字段 |
| 图标混用P2 | 首页使用☺、⚖、¥等文字；密码空态🔐；日程MorphIcons、导航Lucide | 系统动作统一Lucide，情绪Emoji保留，MorphIcons限有意义状态转换 | 将“情绪内容”也机械替换掉 |
| 固定颜色P2 | 待办标签#21574B/新建#D8F0E8，普通标签rgba(0,102,204,.09) | 普通工具栏/标签跟主题；待办内部三色保留变体 | 宣称换主题已经覆盖所有业务元素 |
| 过多装饰动画P2 | 全局按钮9s渐变，ambient22/26s，首页分组依次入场 | 业务触控优先；装饰默认静态为本次建议 | 把高频记录体验改成每次等待完整片头 |
| 语言/控件语义P2 | ${link('index.html', 'lang=en', '<html lang="en">')}；历史审查有placeholder-only和心情div操作 | zh-CN、关联label、button/radio语义 | 仅补视觉标签而不关联输入 |
| 原生/网页差异P2 | Web待办44圆角方框/✓；原生v8圆形矢量+环形进度、紧凑行 | 记录为平台变体，行为与数据一致；跨端统一外观另做专项 | 本次CSS强行宣称覆盖RemoteViews |

额外红线：不得伪造记录填满空态；不得把尚未完成的请求写成成功；不得将颜色作为唯一状态；不得覆盖raw、曝光密码或密钥；不得把本轮设计建议包装成用户研究结论。适用所有页面与交接审核；不要通过隐藏错误或伪造数据“美化”截图。

## 13. CSS tokens 使用与迁移

### 13.1 三层架构与命名

--fm-p-*是基础值，--fm-color/space/font/radius-*是语义，--fm-button/input/card/todo-*是组件。--fm-theme-*存运行算法的默认/预设回退；语义层通过var(--theme-*, fallback)跟随现有主题服务。设计师用语义/组件token标注；前端使用组件token，不复制裸HEX。

配套CSS只定义变量、减少动效及无blur降级，未向现有src添加import、未覆盖旧变量。保存位置output是交付文件；后续接入时复制到src/styles/design-tokens.css，统一入口导入，避免运行代码依赖交付目录。

### 13.2 接入示例（交接代码，尚未写入产品）

\`\`\`js
// src/main.js，复制文件后在 App 样式之前引入
import './styles/design-tokens.css'
// 继续由现有 useAppController 写入 themeSystem.js 派生的 --theme-*。
\`\`\`

\`\`\`css
.primary-action {
  min-height: var(--fm-button-height);
  padding-inline: var(--fm-button-padding-x);
  border: 0;
  border-radius: var(--fm-button-radius);
  background: var(--fm-button-bg);
  color: var(--fm-button-fg);
  font: inherit;
  font-weight: var(--fm-button-weight);
  transition: filter var(--fm-button-duration) var(--fm-ease-standard);
}
@media (hover: hover) {
  .primary-action:hover:not(:disabled) { filter: var(--fm-button-hover-filter); }
}
.primary-action:active:not(:disabled) { filter: var(--fm-button-pressed-filter); }
.primary-action:focus-visible {
  outline: var(--fm-focus-width) solid var(--fm-focus-color);
  outline-offset: var(--fm-focus-offset);
}
.primary-action:disabled {
  background: var(--fm-button-disabled-bg);
  color: var(--fm-button-disabled-fg);
}
\`\`\`

按钮仍使用真实button与disabled绑定；token不会自动赋予可访问语义、加载防重、焦点圈定或错误处理。适用现有自绘Vue组件的渐进迁移；不要仅import文件就声称组件已统一。

独立展示没有旧--theme-*时，可在html设data-fm-theme="peach|mint|lavender"；缺省cloud。在真实项目里以现有主题服务为准，不同时维护两套控制器。没有正式dark selector：当前项目未提供完整深色模式，本轮不凭空增加。

### 13.3 旧变量对应

| 现有变量/组件 | 新规范入口 | 处理 |
|---|---|---|
| --theme-primary | --fm-color-brand | 继续由主题服务决定 |
| --theme-primary-strong / --primary | --fm-color-action / --fm-button-bg | 小字操作优先strong实色 |
| --ink / --body-muted | --fm-color-text / --fm-color-text-secondary | 次文字使用本次建议新值；需组件替换引用 |
| --canvas-parchment / --canvas | --fm-color-page / --fm-color-surface | 沿用现有中性背景 |
| --radius-input/card/panel | --fm-input/card/dialog-radius | 统一角色引用，保留专用26/28 |
| --shadow-card/panel | --fm-card-shadow / --fm-shadow-panel | 沿用已有层级 |
| TodoProgressCard裸色与400ms | --fm-todo-* | 仅Web组件；Java资源另行映射 |

迁移顺序建议：主题值与对比→焦点/输入标签/触控→普通控件与弹层→图标和圆角→装饰动效。每步检查四套主题、320/390/768/1440宽度、长内容、大字、键盘和减少动画；不同时重写业务数据与视觉组件。

## 14. 实际 UI 库、工具与本次技能

### 14.1 项目实际使用

| 包 | package.json声明 | 本机已安装版本 | 用途 |
|---|---|---|---|
${libraryRows}

**UI组件体系**：项目自绘Vue组件 + 原生HTML控件 +普通CSS/scoped CSS。package.json未声明Element Plus、Vant、Naive UI、Vuetify、shadcn或Tailwind，本次也未引入它们。Lucide和Morphicons是图标库，不能称为整套UI组件库。体重图表是自绘SVG，未发现Chart.js/ECharts依赖；本次没有新增图表库。

版本区分声明范围和本机安装快照，不宣称为上游最新版本。本次没有安装、升级或替换任何依赖。证据：${link('package.json', 'package.json')}、${link('src/main.js', 'Vue/Pinia入口')}、${link('src/features/schedule/ScheduleView.vue', 'MorphIcon导入', "from 'morphicons/vue'")}、${link('src/components/WeightView.vue', 'SVG趋势图', '<svg viewBox="0 0 300 160"')}。

### 14.2 本次使用的技能

| 技能 | 来源 | 本次实际用途 | 不代表什么 |
|---|---|---|---|
| design-system（1.0.0） | [SKILL.md](<C:/Users/a3185/.agents/skills/design-system/SKILL.md>)；阅读token-architecture和component-specs | 三层变量、组件状态和前端交接结构 | 未把通用示例的字体、蓝色或卡间距直接套进项目 |
| ui-ux-pro-max（文件未声明版本） | [SKILL.md](<C:/Users/a3185/.agents/skills/ui-ux-pro-max/SKILL.md>) | 核对焦点/触控/图标/语义；本地检索keyboard focus visible（ux）及semantic controls accessibility（vue），匹配结果已核查 | 是工作技能，不是安装在App里的UI库；未调用全新视觉方向生成器覆盖现有UI |

未使用imagegen、ui-styling或Office/PDF技能；本次交付格式是Markdown + CSS。没有联网补充资料，未调用外部UI服务；技能内链接仅是本地资料背景，不冒充本轮网络核验。

## 15. 验收与待复核范围

本轮验证针对交付文件：源码来源行定位、主题算法派生值、CSS语法/引用、四主题默认回退与运行时桥接、减少动画变量，以及raw/与产品源码保持原内容。具体执行结果留在 ${link('docs/qa/design-system-20261007/verification.md', '验证记录')}。已有2026-10-03截图用于视觉提炼，未伪称本轮新截图或全功能测试。

用户/设计师复核：目标用户画像是设计推断；#626D7D等新色、12px字号下限、普通按钮实色/不缩放、48px点击盒和装饰静态是本次统一建议。真机中文字体、壁纸叠加、最大字号、原生桌面点击区及动效仍需实施后复核；设备和启动器型号资料未提供。

未完成项：未修改产品UI、未迁移业务组件、未构建APK、未验证真机与原生桌面改版；这些不属于本次规范与tokens交付。正式深色模式与新增品牌素材未提供输入，本规范不承诺覆盖。
`
fs.writeFileSync(path.join(output, cssName), css)
fs.writeFileSync(path.join(output, mdName), md)

const append = (file, text) => fs.appendFileSync(path.join(root, file), `\n\n${text.trim()}\n`)
append('docs/source-notes.md', `## 2026-10-07 设计系统资料来源\n- 用户当前消息及需求附件codex-clipboard-2c8b7fd5-2648-4527-b304-98478d7ea0f5.jpg；该图是需求文字，不是App视觉截图。\n- 用户确认Markdown + CSS、沿用当前浅色柔和卡片和可切换主题色；补充要求记录UI库和Skill。\n- 当前代码${evidence.commit}；主题、全局/局部CSS、自绘组件、图标导入、package.json与本机安装版本。\n- docs/qa/app-audit-20261003/中的七份390px历史合成截图：首页、待办含数据、设置、心情、日程、密码、体重；本轮实际查看。\n- docs/20261003-app-audit-v1.md与v8待办验收，仅作为历史记录，未当成本轮新实测。\n- raw加密备份未采用或解密；仅计算文件整体摘要核对未改动；memory-bank目录、用户画像研究和品牌手册资料未提供。\n- 本地技能design-system与ui-ux-pro-max用于结构/交互参考；未联网使用新外部资料。\n- 详细文件名、源码hash、历史截图hash、主题派生与对比计算：docs/qa/design-system-20261007/source-evidence.json。`)
append('docs/analysis-notes.md', `## 2026-10-07 设计系统判断与交接\n- 结构：产品气质/场景→现有视觉→原则→色彩/字体/栅格/形状→核心组件→状态/图标/文案→不一致/红线→tokens迁移→库/技能→验收。\n- 保留浅色、柔光、主题预设、卡片布局；待办深色薄荷进度记录为专用变体。\n- 设计推断与代码事实分别标注；未将用户画像和推荐方案写成调查结论。\n- 主题运行cloud strong #3E77B4，与app.css静态#35679C不同；以themeSystem.js为来源。\n- 原次文字#7D8491对白约3.76:1；建议#626D7D。渐变加白亮端需独立验证；普通文字按钮推荐strong实色。\n- 重点漂移：圆角16/18/20/22/26/28；字体8～17px辅助层；点击盒36/38/40px；统一focus-visible不足；日程顶栏与普通顶栏不同；硬编码业务色与主题分叉。\n- CSS三层命名fm-*、桥接现有theme-*，四预设回退通过真实算法生成；不覆盖业务CSS、不提供虚构全局dark主题。\n- UI技术：自绘Vue/HTML/CSS、Lucide、日程Morphicons、自绘SVG图表；未安装额外UI组件库或字体。\n- 目标色/字号/触控/动效属于规范建议，未迁移src或原生RemoteViews。\n- 完整规范：output/${mdName}；tokens：output/${cssName}。`)
append('docs/questions.md', `## 2026-10-07 设计系统确认与复核\n已确认：Markdown + CSS；沿用当前浅色、柔和卡片和可切换主题色；列明UI库与实际使用技能。无阻塞交付问题。\n待复核（不阻塞本次规范交付）：推断的目标用户、统一的次文字颜色/字号、实色按钮/48px点击盒/装饰静态建议；具体真机中文字体、最大字号与原生桌面变体。设备型号/启动器与品牌手册资料未提供；正式深色模式未提供输入。`)
append('docs/plan.md', `## 2026-10-07 设计系统交付计划\n1. [x] raw/docs/memory资料核对，保留已有工作区修改。\n2. [x] 确认交付格式与视觉方向，补充UI库和Skill记录。\n3. [x] 源码与七份历史截图视觉审阅，派生主题值、对比度、组件漂移证据。\n4. [x] 生成output/${mdName}和output/${cssName}；过程与来源留docs。\n5. [ ] 验证CSS、变量桥接/四主题/减少动画、引用链接与文件边界，记录验证结果。`)
console.log(JSON.stringify({ generated: [mdName, cssName], sourceCount: sources.length, screenshots: screenshots.length, rawAggregateSha256Before: evidence.rawAggregateSha256Before }))
