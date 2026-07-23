import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const scheduleView = readFileSync(new URL('../src/components/ScheduleView.vue', import.meta.url), 'utf8')

test('日程默认列表包含此前日期并以灰色展示过期事项', () => {
  assert.match(
    scheduleView,
    /getOccurrences\(addDays\(today\.value, -180\), addDays\(today\.value, 365\)\)/
  )
  assert.doesNotMatch(
    scheduleView,
    /activeFilter\.value === 'all' && item\.historical/
  )
  assert.match(scheduleView, /\.agenda-item\.expired\s*\{\s*color:\s*#a5a5aa/)
  assert.match(scheduleView, /\.agenda-item\.expired \.item-copy\s*\{[^}]*text-decoration:\s*line-through/)
  assert.match(scheduleView, /今日暂无日程/)
  assert.match(scheduleView, /ref="agendaBottom"/)
  assert.match(scheduleView, /agendaBottom\.value\?\.scrollIntoView/)
  assert.match(scheduleView, /block:\s*'end'/)
  assert.match(scheduleView, /\.agenda-view, \.month-view\s*\{[^}]*overflow-y:\s*auto/)
  assert.doesNotMatch(scheduleView, /class="filter-pills"/)
  assert.doesNotMatch(scheduleView, /\{ id: 'task', label: '待办' \}/)
  assert.doesNotMatch(scheduleView, /\{ id: 'completed', label: '已完成' \}/)
  assert.doesNotMatch(scheduleView, /\{ id: 'history', label: '历史' \}/)
})
