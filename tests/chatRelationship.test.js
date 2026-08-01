import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDailyStatePrompt,
  buildRelationshipUpdatePrompt,
  formatChatDate,
  localDailyCompanionState,
  parseRelationshipUpdate
} from '../src/services/chatRelationship.js'

test('每日状态只发生在虚拟小家且包含连续关系背景', () => {
  const prompt = buildDailyStatePrompt({
    companionName: '小乖',
    now: new Date('2026-07-27T10:00:00+08:00'),
    memories: [{ scope: 'relationship', category: '关系', content: '约好周末聊天' }],
    openLoops: [{ type: 'promise', content: '周末聊完那部电影' }]
  })

  assert.match(prompt, /小乖/)
  assert.match(prompt, /虚拟陪伴角色/)
  assert.match(prompt, /不得声称她在现实中上班/)
  assert.match(prompt, /约好周末聊天/)
  assert.equal(formatChatDate(new Date('2026-07-27T10:00:00+08:00')), '2026-07-27')
  assert.match(localDailyCompanionState(new Date('2026-07-27T10:00:00+08:00')).virtualMoment, /温馨小家/)
})

test('关系更新限制每轮派生记忆、整理未完话题和女朋友状态', () => {
  const parsed = parseRelationshipUpdate({
    memoryUpserts: [
      { key: '咖啡', scope: 'user', category: '偏好', content: '哥哥喜欢无糖咖啡' },
      { key: '虚拟摆件', scope: 'companion', category: '偏好', content: '她喜欢温馨小家里的蓝色抱枕' },
      { key: '周末约定', scope: 'relationship', category: '关系', content: '两人约好周末一起看电影' },
      { key: '敏感', scope: 'user', category: '身份', content: '哥哥的 API Key 是 secret' }
    ],
    openLoopUpserts: [
      { key: '电影', type: 'promise', content: '周末看完电影后继续聊' }
    ],
    resolvedLoopKeys: ['旧问题', '旧问题'],
    companionState: {
      mood: '期待',
      energy: '高',
      statusText: '等周末约会',
      currentThought: '想和哥哥选一部电影',
      virtualMoment: '在温馨小家里整理片单',
      attitude: '会表达自己想看的类型'
    }
  }, {
    sourceMessageId: 'assistant-1',
    now: new Date('2026-07-27T12:00:00+08:00').getTime()
  })

  assert.equal(parsed.memoryUpserts.length, 2)
  assert.ok(parsed.memoryUpserts.every(item => !/API Key/i.test(item.content)))
  assert.equal(parsed.openLoopUpserts[0].type, 'promise')
  assert.deepEqual(parsed.resolvedLoopKeys, ['旧问题'])
  assert.match(parsed.companionState.virtualMoment, /温馨小家/)
})

test('关系整理提示禁止把控制、凭据和现实经历当作亲密', () => {
  const prompt = buildRelationshipUpdatePrompt({
    companionName: '小暖',
    userMessages: [{ content: '等我回来' }],
    assistantMessages: [{ content: '好呀' }]
  })

  assert.match(prompt, /不得保存密码/)
  assert.match(prompt, /不得把女朋友的猜测写成哥哥的事实/)
  assert.match(prompt, /女朋友随口提出但哥哥没有回答的问题不算未完话题/)
  assert.match(prompt, /每轮最多两条/)
  assert.match(prompt, /控制性状态/)
  assert.match(prompt, /scope 只能是 user/)
})
