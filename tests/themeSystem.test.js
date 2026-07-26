import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  DEFAULT_THEME_SETTINGS,
  THEME_PRESETS,
  buildThemeCssVariables,
  contrastRatio,
  ensureWhiteTextContrast,
  getThemePrimary,
  normalizeHexColor,
  normalizeThemeSettings
} from '../src/services/themeSystem.js'

test('主题预设使用确认的四套治愈主色', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(THEME_PRESETS).map(([id, item]) => [id, item.primary])),
    {
      cloud: '#4A8FD8',
      peach: '#E4778F',
      mint: '#479B84',
      lavender: '#8878C4'
    }
  )
})

test('异常主题设置回退云朵蓝并规范自定义颜色', () => {
  assert.deepEqual(normalizeThemeSettings(), DEFAULT_THEME_SETTINGS)
  assert.deepEqual(normalizeThemeSettings({
    mode: 'unknown',
    presetId: 'missing',
    customPrimary: 'bad'
  }), DEFAULT_THEME_SETTINGS)
  assert.equal(normalizeHexColor('#abc'), '#AABBCC')
  assert.equal(getThemePrimary({ mode: 'custom', customPrimary: '#f8dd55' }), '#F8DD55')
})

test('任意自定义主色都会派生满足白字对比度的按钮色', () => {
  for (const color of ['#FFFFFF', '#F8DD55', '#111111', '#E4778F', '#4A8FD8']) {
    const strong = ensureWhiteTextContrast(color)
    assert.ok(contrastRatio(strong, '#FFFFFF') >= 4.5, `${color} 派生色对比度不足`)
  }
})

test('主题 CSS 变量包含浅色表面、边框、渐变和可访问主按钮色', () => {
  const variables = buildThemeCssVariables({ mode: 'custom', customPrimary: '#F8DD55' })
  assert.equal(variables['--theme-primary'], '#F8DD55')
  assert.match(variables['--theme-primary-rgb'], /^\d+, \d+, \d+$/)
  assert.match(variables['--theme-primary-soft'], /^#[0-9A-F]{6}$/)
  assert.match(variables['--theme-border'], /^#[0-9A-F]{6}$/)
  assert.ok(contrastRatio(variables['--primary'], variables['--theme-on-primary']) >= 4.5)
})

test('主题设置可持久化且首页栏目统一中文', async () => {
  const [settingsStore, settingsView, homeView, appView] = await Promise.all([
    readFile(new URL('../src/stores/settings.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/SettingsView.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/HomeView.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  ])

  assert.match(settingsStore, /my_theme_settings/)
  assert.match(settingsStore, /updateThemeSettings/)
  assert.doesNotMatch(settingsView, /type=["']color["']/)
  assert.doesNotMatch(homeView, />TODAY<|>WEIGHT<|>MOOD<|>RECENT<|MONTHLY REPORT/)
  assert.match(homeView, />今日日程<|>主要目标<|>体重趋势<|>心情回顾<|>最近记录<|>月度回顾</)
  assert.match(appView, /\.sub-nav-frosted\s*\{[\s\S]*?background:\s*#f8f9fc;/)
})
