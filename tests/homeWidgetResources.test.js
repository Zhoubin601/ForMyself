import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const widgetInfoUrl = new URL(
  '../android/app/src/main/res/xml/formyself_widget_info.xml',
  import.meta.url
)
const widgetLayoutUrl = new URL(
  '../android/app/src/main/res/layout/widget_formyself.xml',
  import.meta.url
)
const widgetProviderUrl = new URL(
  '../android/app/src/main/java/com/yubin/formyself/ForMyselfWidgetProvider.java',
  import.meta.url
)
const scheduleWidgetInfoUrl = new URL(
  '../android/app/src/main/res/xml/schedule_widget_info.xml',
  import.meta.url
)
const scheduleWidgetLayoutUrl = new URL(
  '../android/app/src/main/res/layout/widget_schedule.xml',
  import.meta.url
)
const scheduleWidgetProviderUrl = new URL(
  '../android/app/src/main/java/com/yubin/formyself/ScheduleWidgetProvider.java',
  import.meta.url
)

test('桌面信息卡固定使用 2x2 的最小尺寸', async () => {
  const widgetInfo = await readFile(widgetInfoUrl, 'utf8')
  assert.match(widgetInfo, /android:minWidth="110dp"/)
  assert.match(widgetInfo, /android:minHeight="110dp"/)
  assert.match(widgetInfo, /android:targetCellWidth="2"/)
  assert.match(widgetInfo, /android:targetCellHeight="2"/)
})

test('临近日程组件为独立 2x2 Provider 并最多展示三条事项', async () => {
  const [info, layout, provider] = await Promise.all([
    readFile(scheduleWidgetInfoUrl, 'utf8'),
    readFile(scheduleWidgetLayoutUrl, 'utf8'),
    readFile(scheduleWidgetProviderUrl, 'utf8')
  ])
  assert.match(info, /android:targetCellWidth="2"/)
  assert.match(info, /android:targetCellHeight="2"/)
  assert.match(info, /android:minWidth="110dp"/)
  assert.match(info, /android:minHeight="110dp"/)
  for (const index of [1, 2, 3]) {
    assert.match(layout, new RegExp(`@\\+id/schedule_row_${index}`))
    assert.match(provider, new RegExp(`R\\.id\\.schedule_row_${index}`))
  }
  assert.match(provider, /my_schedule_widget_snapshot/)
  assert.match(provider, /SEVEN_DAYS_MS/)
})

test('桌面信息卡展示三类基本信息和今日完成度', async () => {
  const [layout, provider] = await Promise.all([
    readFile(widgetLayoutUrl, 'utf8'),
    readFile(widgetProviderUrl, 'utf8')
  ])

  assert.doesNotMatch(layout, /<View\b/)

  for (const viewId of [
    'widget_mood_value',
    'widget_weight_value',
    'widget_savings_value',
    'widget_summary_value'
  ]) {
    assert.match(layout, new RegExp(`@\\+id/${viewId}`))
    assert.match(provider, new RegExp(`R\\.id\\.${viewId}`))
  }

  assert.match(provider, /my_mood_records_data/)
  assert.match(provider, /my_weight_records_data/)
  assert.match(provider, /my_debt_manager_data/)
})
