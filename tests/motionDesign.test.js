import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appUrl = new URL('../src/App.vue', import.meta.url)
const homeUrl = new URL('../src/components/HomeView.vue', import.meta.url)
const reportUrl = new URL('../src/components/MonthlyReportView.vue', import.meta.url)
const scheduleUrl = new URL('../src/components/ScheduleView.vue', import.meta.url)

test('Galaxy 风格动效不依赖第三方运行时并覆盖核心界面', async () => {
  const [app, home, report, schedule] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(homeUrl, 'utf8'),
    readFile(reportUrl, 'utf8'),
    readFile(scheduleUrl, 'utf8')
  ])

  assert.match(app, /class="ambient-canvas"/)
  assert.match(app, /@keyframes galaxyButtonGradient/)
  assert.match(app, /@keyframes galaxyButtonShine/)
  assert.match(home, /@keyframes galaxySectionRise/)
  assert.match(home, /@keyframes reportBannerShine/)
  assert.match(report, /@keyframes reportBarGrow/)
  assert.match(schedule, /@keyframes scheduleFabBreathe/)
  assert.doesNotMatch([app, home, report, schedule].join('\n'), /\bgsap\b|\blottie\b|requestAnimationFrame/)
})

test('动效遵循系统减少动态效果偏好', async () => {
  const [app, home, report] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(homeUrl, 'utf8'),
    readFile(reportUrl, 'utf8')
  ])

  assert.match(app, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(app, /animation-duration:\s*\.01ms\s*!important/)
  assert.match(app, /animation-iteration-count:\s*1\s*!important/)
  assert.match(home, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.report-banner::before/)
  assert.match(report, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.ai-spark/)
})

test('默认自定义壁纸不会与氛围柔光重复叠加', async () => {
  const app = await readFile(appUrl, 'utf8')
  assert.match(app, /<div v-if="settingsStore\.customBg" class="bg-blur-layer"><\/div>\s*<div v-else class="ambient-canvas"/)
})
