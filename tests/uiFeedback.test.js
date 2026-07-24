import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const sourceRoot = join(process.cwd(), 'src')

const collectSourceFiles = directory => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory()
      ? collectSourceFiles(path)
      : /\.(vue|js)$/.test(entry.name) ? [path] : []
  })

const combinedSource = collectSourceFiles(sourceRoot)
  .map(path => readFileSync(path, 'utf8'))
  .join('\n')

test('业务界面不再调用浏览器或 Android WebView 原生弹窗', () => {
  assert.doesNotMatch(combinedSource, /\b(?:window\.)?alert\s*\(/)
  assert.doesNotMatch(combinedSource, /\b(?:window\.)?confirm\s*\(/)
  assert.doesNotMatch(combinedSource, /\b(?:window\.)?prompt\s*\(/)
  assert.match(combinedSource, /AppFeedbackHost/)
  assert.match(combinedSource, /appConfirm/)
})

test('日期、时间与下拉选择不再触发 WebView 原生选择弹窗', () => {
  assert.doesNotMatch(combinedSource, /<select\b/i)
  assert.doesNotMatch(combinedSource, /type=["']date["']/i)
  assert.doesNotMatch(combinedSource, /type=["']time["']/i)
  assert.match(combinedSource, /AppDateField/)
  assert.match(combinedSource, /AppTimeField/)
})

test('应用内日期面板先选中日期，再由确定按钮提交选择', () => {
  const dateFieldSource = readFileSync(join(sourceRoot, 'components', 'AppDateField.vue'), 'utf8')
  assert.match(dateFieldSource, /const draftValue = ref\(''\)/)
  assert.match(dateFieldSource, /draftValue\.value = item\.value/)
  assert.match(dateFieldSource, /emit\('update:modelValue', draftValue\.value\)/)
  assert.match(dateFieldSource, /@click="confirm">确定<\/button>/)
  assert.match(dateFieldSource, /:aria-pressed="item\.selected"/)
  assert.match(dateFieldSource, /disabled:\s*Boolean\(/)
})

test('应用内时间转盘支持每一分钟精确选择', () => {
  const timeFieldSource = readFileSync(join(sourceRoot, 'components', 'AppTimeField.vue'), 'utf8')
  assert.match(timeFieldSource, /length: 60/)
  assert.match(timeFieldSource, /Math\.round\(angle \/ 6\) % 60/)
  assert.match(timeFieldSource, /adjustMinute\(1\)/)
  assert.match(timeFieldSource, /精确到 1 分钟/)
  assert.doesNotMatch(timeFieldSource, /baseMinutes/)
})

test('侧边栏包含统一图标导航、隐私说明和关闭控件', () => {
  const appSource = readFileSync(join(sourceRoot, 'App.vue'), 'utf8')
  assert.match(appSource, /drawerItems/)
  assert.match(appSource, /drawer-item-icon/)
  assert.match(appSource, /核心数据保存在设备内/)
  assert.match(appSource, /aria-label="关闭导航菜单"/)
})

test('只有存在独立配置的模块显示设置入口', () => {
  const appSource = readFileSync(join(sourceRoot, 'App.vue'), 'utf8')
  const settingsStoreSource = readFileSync(join(sourceRoot, 'stores', 'settings.js'), 'utf8')
  const settingsViewSource = readFileSync(join(sourceRoot, 'components', 'SettingsView.vue'), 'utf8')
  assert.match(appSource, /moduleSettingsViews = new Set\(\['debts', 'weight', 'mood', 'passwords'\]\)/)
  assert.doesNotMatch(appSource, /moduleSettingsViews = new Set\([^)]*'home'/)
  assert.match(settingsStoreSource, /openModuleSettings/)
  assert.match(settingsViewSource, /settingsScope === 'passwords'/)
  assert.match(settingsViewSource, /settingsScope === 'general'/)
  assert.match(
    settingsViewSource,
    /v-if="settingsScope === 'debts'" class="setting-section">\s*<h3[^>]*>省钱看板文案/,
  )
})

test('日程页保留搜索框并移除重复的顶部搜索按钮', () => {
  const scheduleViewSource = readFileSync(join(sourceRoot, 'components', 'ScheduleView.vue'), 'utf8')
  assert.match(scheduleViewSource, /placeholder="搜索日程"/)
  assert.doesNotMatch(scheduleViewSource, /search-trigger/)
})
