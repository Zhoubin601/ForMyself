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
  assert.doesNotMatch(scheduleView, /\.agenda-item\.expired \.item-copy\s*\{[^}]*text-decoration:\s*line-through/)
  assert.doesNotMatch(scheduleView, /\.agenda-item\.task\.expired \.item-copy\s*\{[^}]*text-decoration:\s*line-through/)
  assert.match(scheduleView, /\.agenda-item\.completed \.item-copy\s*\{[^}]*text-decoration:\s*line-through/)
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

test('修改开始日期时保留原日程时长，标题可动态缩放并完整换行', () => {
  assert.match(scheduleView, /const updateStartDate = value =>/)
  assert.match(scheduleView, /form\.endDate = addDays\(value, durationDays\)/)
  assert.match(scheduleView, /@update:model-value="updateStartDate"/)
  assert.match(scheduleView, /const scheduleTitleStyle = title =>/)
  assert.match(scheduleView, /overflow-wrap:\s*anywhere/)
  assert.match(scheduleView, /white-space:\s*normal/)
  assert.doesNotMatch(scheduleView, /\.item-copy strong\s*\{[^}]*text-overflow:\s*ellipsis/)
  assert.doesNotMatch(scheduleView, /class="state-label">未完成/)
  assert.match(scheduleView, /task:\s*item\.type === 'task'/)
  assert.match(scheduleView, /event:\s*item\.type === 'event'/)
})
