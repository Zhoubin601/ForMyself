import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHAT_BACKUP_VERSION,
  CHAT_BACKUP_TYPE,
  CHAT_DATA_VERSION,
  CHAT_REACTION_EMOJIS,
  buildChatBackupSnapshot,
  mergeChatData,
  normalizeChatBackupSnapshot,
  normalizeChatData,
  normalizeOpenLoops,
  parseMemoryExtraction
} from '../src/services/chatRecords.js'

test('聊天消息按时间规范化、按 ID 去重并保留中止状态', () => {
  const avatar = 'data:image/png;base64,aGVsbG8='
  const normalized = normalizeChatData({
    profile: { companionName: '  小暖  ', companionAvatar: avatar },
    messages: [
      { id: 'b', role: 'assistant', content: '后来', createdAt: 20, status: 'stopped' },
      { id: 'a', role: 'user', content: '  先说  ', createdAt: 10 },
      {
        id: 'a',
        role: 'user',
        content: '更新后的先说',
        createdAt: 11,
        replyTo: { messageId: 'b', role: 'assistant', content: '后来' }
      }
    ]
  })

  assert.equal(normalized.profile.companionName, '小暖')
  assert.equal(normalized.profile.companionAvatar, avatar)
  assert.deepEqual(normalized.messages.map(item => item.id), ['a', 'b'])
  assert.equal(normalized.messages[0].content, '更新后的先说')
  assert.deepEqual(normalized.messages[0].replyTo, {
    messageId: 'b',
    role: 'assistant',
    content: '后来'
  })
  assert.equal(normalized.messages[1].status, 'stopped')
})

test('聊天合并按消息 ID 和记忆 key 去重，较新记忆优先且保留当前档案', () => {
  const currentAvatar = 'data:image/png;base64,bG9jYWw='
  const merged = mergeChatData({
    profile: { companionName: '当前名字', companionAvatar: currentAvatar },
    messages: [{ id: 'same', role: 'user', content: '本机消息', createdAt: 10 }],
    memories: [{
      id: 'old',
      key: '偏好:饮料',
      category: '偏好',
      content: '喜欢咖啡',
      createdAt: 10,
      updatedAt: 10
    }]
  }, {
    profile: { companionName: '备份名字', companionAvatar: 'data:image/png;base64,aW1wb3J0' },
    messages: [
      { id: 'same', role: 'user', content: '备份更新', createdAt: 20 },
      { id: 'new', role: 'assistant', content: '新消息', createdAt: 30 }
    ],
    memories: [{
      id: 'new-memory',
      key: '偏好:饮料',
      category: '偏好',
      content: '喜欢无糖咖啡',
      createdAt: 10,
      updatedAt: 20
    }]
  })

  assert.equal(merged.profile.companionName, '当前名字')
  assert.equal(merged.profile.companionAvatar, currentAvatar)
  assert.equal(merged.messages.length, 2)
  assert.equal(merged.messages.find(item => item.id === 'same').content, '备份更新')
  assert.equal(merged.memories.length, 1)
  assert.equal(merged.memories[0].content, '喜欢无糖咖啡')
})

test('长期记忆提取容忍 JSON 围栏、过滤敏感凭据并按 key 去重', () => {
  const result = parseMemoryExtraction(`\`\`\`json
  {"upserts":[
    {"key":"偏好:饮料","category":"偏好","content":"哥哥喜欢无糖咖啡"},
    {"key":"偏好:饮料","category":"偏好","content":"哥哥更喜欢冰的无糖咖啡"},
    {"key":"安全","category":"身份","content":"哥哥的 API Key 是 sk-secret"}
  ]}
  \`\`\``, 'assistant-1', 100)

  assert.equal(result.length, 1)
  assert.equal(result[0].content, '哥哥更喜欢冰的无糖咖啡')
  assert.equal(result[0].sourceMessageId, 'assistant-1')
})

test('独立聊天备份 v3 往返保留名字、互动消息、已读状态和关系状态', () => {
  const avatar = 'data:image/webp;base64,aGVsbG8='
  const snapshot = buildChatBackupSnapshot({
    profile: { companionName: '小暖', companionAvatar: avatar },
    messages: [{
      id: 'm1',
      role: 'user',
      content: '你好',
      createdAt: 10,
      type: 'text',
      reactions: [{ actor: 'assistant', emoji: '❤️', createdAt: 12 }],
      replyTo: { messageId: 'm0', role: 'assistant', content: '在吗' }
    }],
    memories: [{ id: 'r1', key: '关系:称呼', scope: 'relationship', category: '关系', content: '喜欢被叫哥哥', createdAt: 10, updatedAt: 10 }],
    companionState: {
      date: '2026-07-26',
      mood: '开心',
      statusText: '等哥哥回来',
      updatedAt: 20
    },
    openLoops: [{
      id: 'loop-1',
      key: '周末游戏',
      type: 'promise',
      content: '周末一起玩游戏',
      createdAt: 20,
      updatedAt: 20
    }],
    proactiveSettings: { enabled: true, dailyMax: 1, activeStart: '10:00', activeEnd: '22:00' },
    readState: { lastReadAt: 9 }
  }, '2026-07-26T08:00:00.000Z')
  const restored = normalizeChatBackupSnapshot(JSON.parse(JSON.stringify(snapshot)))

  assert.equal(restored.type, CHAT_BACKUP_TYPE)
  assert.equal(restored.version, CHAT_BACKUP_VERSION)
  assert.equal(restored.data.version, CHAT_DATA_VERSION)
  assert.equal(restored.data.profile.companionAvatar, avatar)
  assert.equal(restored.data.messages.length, 1)
  assert.equal(restored.data.messages[0].replyTo.messageId, 'm0')
  assert.equal(restored.data.messages[0].reactions[0].emoji, '❤️')
  assert.equal(restored.data.readState.lastReadAt, 9)
  assert.equal(restored.data.memories.length, 1)
  assert.equal(restored.data.memories[0].scope, 'relationship')
  assert.equal(restored.data.companionState.mood, '开心')
  assert.equal(restored.data.openLoops[0].type, 'promise')
  assert.equal(restored.data.proactiveSettings.dailyMax, 1)
  assert.throws(() => normalizeChatBackupSnapshot({ ...snapshot, type: 'other' }), /INVALID_CHAT_BACKUP_TYPE/)
  assert.throws(() => normalizeChatBackupSnapshot({ ...snapshot, data: undefined }), /INVALID_CHAT_BACKUP_DATA/)
})

test('旧聊天数据自动迁移为哥哥记忆并补齐新关系字段', () => {
  const legacy = {
    type: CHAT_BACKUP_TYPE,
    version: 1,
    createdAt: '2026-07-23T08:00:00.000Z',
    data: {
      profile: { companionName: '小暖' },
      messages: [{ id: 'm1', role: 'user', content: '旧消息', createdAt: 10 }],
      memories: [{
        id: 'old-memory',
        key: '偏好:咖啡',
        category: '偏好',
        content: '哥哥喜欢咖啡',
        createdAt: 10,
        updatedAt: 10
      }]
    }
  }
  const restored = normalizeChatBackupSnapshot(legacy)

  assert.equal(restored.version, CHAT_BACKUP_VERSION)
  assert.equal(restored.data.memories[0].scope, 'user')
  assert.deepEqual(restored.data.openLoops, [])
  assert.deepEqual(restored.data.proactiveOutbox, [])
  assert.equal(restored.data.proactiveSettings.activeStart, '09:00')
  assert.equal(restored.data.readState.lastReadAt, 10)

  const restoredV2 = normalizeChatBackupSnapshot({ ...legacy, version: 2 })
  assert.equal(restoredV2.data.messages[0].type, 'text')
  assert.deepEqual(restoredV2.data.messages[0].reactions, [])
  assert.equal(restoredV2.data.readState.lastReadAt, 10)
})

test('消息互动只接受固定表情和类型，同一方只保留最新回应', () => {
  const normalized = normalizeChatData({
    messages: [{
      id: 'm1',
      role: 'assistant',
      type: 'poke',
      content: '小暖拍了拍哥哥',
      createdAt: 10,
      reactions: [
        { actor: 'user', emoji: '❤️', createdAt: 11 },
        { actor: 'user', emoji: '😂', createdAt: 12 },
        { actor: 'assistant', emoji: '🧨', createdAt: 13 },
        { actor: 'other', emoji: '👍', createdAt: 14 }
      ]
    }]
  })

  assert.deepEqual(CHAT_REACTION_EMOJIS, ['❤️', '😂', '🥺', '😤', '👍', '👀'])
  assert.equal(normalized.messages[0].type, 'poke')
  assert.deepEqual(normalized.messages[0].reactions.map(item => ({
    actor: item.actor,
    emoji: item.emoji
  })), [{ actor: 'user', emoji: '😂' }])
})

test('旧聊天没有 readState 时全部视为已读，新快照保留真实未读边界', () => {
  const legacy = normalizeChatData({
    messages: [
      { id: 'm1', role: 'assistant', content: '一', createdAt: 10 },
      { id: 'm2', role: 'assistant', content: '二', createdAt: 20 }
    ]
  })
  const current = normalizeChatData({
    messages: legacy.messages,
    readState: { lastReadAt: 10 }
  })

  assert.equal(legacy.readState.lastReadAt, 20)
  assert.equal(current.readState.lastReadAt, 10)
})

test('合并相同消息时优先保留带更新表情的版本', () => {
  const merged = mergeChatData({
    messages: [{
      id: 'same-reaction',
      role: 'assistant',
      content: '抱一下',
      createdAt: 10,
      reactions: [{ actor: 'user', emoji: '🥺', createdAt: 30 }]
    }]
  }, {
    messages: [{
      id: 'same-reaction',
      role: 'assistant',
      content: '抱一下',
      createdAt: 10,
      reactions: []
    }]
  })

  assert.equal(merged.messages[0].reactions[0].emoji, '🥺')
})

test('相同语义键按哥哥、她和我们三个归属分别保留', () => {
  const data = normalizeChatData({
    memories: [
      { id: 'u', key: '喜欢咖啡', scope: 'user', category: '偏好', content: '哥哥喜欢咖啡', createdAt: 1, updatedAt: 1 },
      { id: 'c', key: '喜欢咖啡', scope: 'companion', category: '偏好', content: '她喜欢听哥哥聊咖啡', createdAt: 1, updatedAt: 1 },
      { id: 'r', key: '喜欢咖啡', scope: 'relationship', category: '关系', content: '两人约好一起研究咖啡', createdAt: 1, updatedAt: 1 }
    ]
  })

  assert.equal(data.memories.length, 3)
  assert.deepEqual(data.memories.map(item => item.scope).sort(), ['companion', 'relationship', 'user'])
})

test('头像只接受安全的栅格 data URL，引用缺少正文时会被丢弃', () => {
  const normalized = normalizeChatData({
    profile: { companionAvatar: 'data:image/svg+xml;base64,PHN2Zz4=' },
    messages: [{
      id: 'm1',
      role: 'user',
      content: '继续',
      createdAt: 10,
      replyTo: { messageId: 'm0', role: 'assistant', content: '' }
    }]
  })

  assert.equal(normalized.profile.companionAvatar, '')
  assert.equal(normalized.messages[0].replyTo, null)
})

test('合并时同 ID 的较旧导入消息不会覆盖本机较新消息', () => {
  const merged = mergeChatData({
    messages: [{ id: 'same', role: 'user', content: '本机较新', createdAt: 20 }]
  }, {
    messages: [{ id: 'same', role: 'user', content: '备份较旧', createdAt: 10 }]
  })
  assert.equal(merged.messages[0].content, '本机较新')
})

test('未完话题按内容去重并清理已经被多轮对话越过的旧问题', () => {
  const duplicateLoops = normalizeOpenLoops([
    { id: 'l1', key: '旧键一', type: 'question', content: '哥哥喜欢我主动一点吗？', createdAt: 10, updatedAt: 10 },
    { id: 'l2', key: '旧键二', type: 'question', content: '哥哥喜欢我主动一点吗？', createdAt: 20, updatedAt: 20 }
  ])
  assert.equal(duplicateLoops.length, 1)
  assert.equal(duplicateLoops[0].id, 'l2')

  const data = normalizeChatData({
    messages: [
      { id: 'source', role: 'assistant', content: '喜欢我主动一点吗？', createdAt: 10 },
      { id: 'u1', role: 'user', content: '先聊别的', createdAt: 20 },
      { id: 'u2', role: 'user', content: '第二件事', createdAt: 30 },
      { id: 'u3', role: 'user', content: '第三件事', createdAt: 40 }
    ],
    openLoops: [{
      id: 'stale',
      key: '主动偏好',
      type: 'question',
      content: '哥哥喜欢我主动一点吗？',
      sourceMessageId: 'source',
      createdAt: 10,
      updatedAt: 10
    }]
  })

  assert.equal(data.openLoops.length, 0)
  assert.equal(data.messages.length, 4)
})
