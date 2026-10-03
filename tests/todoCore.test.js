import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTodoCommand, buildTodoBackup, buildTodoNotifications, getTodoDay, normalizeTodoData, readTodoBackup, todoProgress } from '../src/features/todo/todoCore.js'
import { buildFullBackupSnapshot, normalizeFullBackupSnapshot } from '../src/services/fullBackup.js'
const task = (extra = {}) => ({ id:'water', title:'每天喝水', startDate:'2026-10-01', recurrence:{ type:'daily' }, ...extra })
const create = (extra = {}) => normalizeTodoData({ tasks:[task(extra)] })

test('每日、星期与间隔规则按日期独立生成，跨月不漂移', () => {
  const data = normalizeTodoData({ tasks:[task(), task({ id:'week', recurrence:{ type:'weekly', weekdays:[1,4] } }), task({ id:'gap', recurrence:{ type:'custom', intervalDays:3 } })] })
  assert.deepEqual(getTodoDay(data,'2026-10-01').map(i=>i.id).sort(), ['gap','water','week'])
  assert.equal(getTodoDay(data,'2026-11-03').some(i=>i.id==='gap'),true)
  assert.equal(getTodoDay(data,'2026-11-02').some(i=>i.id==='gap'),false)
})
test('未来修改原子拆分，完成记录保持旧键与历史标题', () => {
  let data=create()
  data=applyTodoCommand(data,{ type:'complete', taskId:'water', date:'2026-10-02', completed:true })
  const original=structuredClone(data.completions)
  data=applyTodoCommand(data,{ type:'edit', taskId:'water', date:'2026-10-05', scope:'future', newId:'coffee', changes:{ title:'每天喝咖啡' } })
  assert.equal(data.tasks[0].endsOn,'2026-10-04')
  assert.equal(data.tasks[1].parentTaskId,'water')
  assert.deepEqual(data.completions,original)
  assert.equal(getTodoDay(data,'2026-10-02')[0].title,'每天喝水')
  assert.equal(getTodoDay(data,'2026-10-05')[0].title,'每天喝咖啡')
  data=applyTodoCommand(data,{ type:'edit', taskId:'coffee', date:'2026-10-10', scope:'future', newId:'tea', changes:{ title:'喝茶' } })
  assert.equal(data.tasks[2].parentTaskId,'coffee')
  assert.deepEqual(readTodoBackup(buildTodoBackup(data)),data)
})
test('仅本次编辑不丢完成记录，撤销不丢单次覆盖', () => {
  let data=applyTodoCommand(create(),{ type:'complete',taskId:'water',date:'2026-10-01',completed:true })
  data=applyTodoCommand(data,{ type:'edit',taskId:'water',date:'2026-10-01',scope:'single',changes:{ title:'喝温水' } })
  assert.equal(getTodoDay(data,'2026-10-01')[0].completed,true)
  data=applyTodoCommand(data,{ type:'complete',taskId:'water',date:'2026-10-01',completed:false })
  assert.equal(getTodoDay(data,'2026-10-01')[0].title,'喝温水')
  assert.equal(getTodoDay(data,'2026-10-02')[0].title,'每天喝水')
})
test('打卡保护拒绝未来范围改写，不改变输入快照', () => {
  const data=applyTodoCommand(create(),{ type:'complete',taskId:'water',date:'2026-10-07',completed:true })
  const before=JSON.stringify(data)
  assert.throws(()=>applyTodoCommand(data,{ type:'edit',taskId:'water',date:'2026-10-05',scope:'future',newId:'coffee',changes:{title:'咖啡'} }), e=>e.code==='TODO_HISTORY_PROTECTED' && e.earliestDate==='2026-10-08')
  assert.equal(JSON.stringify(data),before)
})
test('名称修改保持间隔锚点，首日拆分旧版归档', () => {
  let data=create({ recurrence:{ type:'custom', intervalDays:3 } })
  data=applyTodoCommand(data,{type:'edit',taskId:'water',date:'2026-10-07',scope:'future',newId:'next',changes:{title:'新名字'}})
  assert.equal(data.tasks[1].recurrenceAnchorDate,'2026-10-01')
  assert.equal(getTodoDay(data,'2026-10-10')[0].id,'next')
  const first=applyTodoCommand(create(),{type:'edit',taskId:'water',date:'2026-10-01',scope:'future',newId:'next',changes:{title:'新名字'}})
  assert.equal(first.tasks[0].archived,true)
  assert.equal(getTodoDay(first,'2026-10-01').length,1)
})
test('取消单次不计入进度，零任务不当成100%，日期各自独立', () => {
  const data=applyTodoCommand(create(),{type:'delete',taskId:'water',date:'2026-10-01',scope:'single'})
  assert.deepEqual(todoProgress(getTodoDay(data,'2026-10-01')),{total:0,done:0,ratio:0,percent:0})
  assert.equal(getTodoDay(data,'2026-10-02').length,1)
})
test('完成取消当次提醒，撤销只恢复尚未到点的提醒', () => {
  const initial=create({time:'09:00',reminder:true})
  const now=new Date('2026-10-01T08:00:00')
  const data=applyTodoCommand(initial,{type:'complete',taskId:'water',date:'2026-10-01',completed:true})
  assert.ok(buildTodoNotifications(initial,now).some(n=>n.schedule.at.getDate()===1 && n.schedule.at.getMonth()===9))
  assert.ok(!buildTodoNotifications(data,now).some(n=>n.schedule.at.getDate()===1 && n.schedule.at.getMonth()===9))
  const undone=applyTodoCommand(data,{type:'complete',taskId:'water',date:'2026-10-01',completed:false})
  assert.ok(!buildTodoNotifications(undone,new Date('2026-10-01T10:00:00')).some(n=>n.schedule.at.getDate()===1 && n.schedule.at.getMonth()===9))
})
test('完整备份v10保留任务；v9缺失待办保持缺失语义', () => {
  const full=buildFullBackupSnapshot({todos:create()})
  assert.equal(full.version,10)
  assert.deepEqual(normalizeFullBackupSnapshot(full).data.todos,full.data.todos)
  const old=buildFullBackupSnapshot({}); old.version=9
  assert.equal(Object.hasOwn(normalizeFullBackupSnapshot(old).data,'todos'),false)
})
test('损坏版本链与未来未知格式不静默清空数据', () => {
  assert.throws(()=>normalizeTodoData({version:2}),/UNSUPPORTED_TODO_VERSION/)
  assert.throws(()=>normalizeTodoData({tasks:[task({parentTaskId:'missing'})]}),/INVALID_TODO_PARENT/)
  assert.throws(()=>normalizeTodoData({tasks:[task({parentTaskId:'water'})]}),/INVALID_TODO_PARENT/)
  assert.throws(()=>readTodoBackup({type:'formyself-todo-backup',version:1}),/INVALID_TODO_BACKUP/)
  assert.throws(()=>readTodoBackup({...buildTodoBackup(create()),version:2}),/INVALID_TODO_BACKUP/)
})
