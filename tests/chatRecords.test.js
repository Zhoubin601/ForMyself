import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHAT_BACKUP_TYPE,
  buildChatBackupSnapshot,
  mergeChatData,
  normalizeChatBackupSnapshot,
  normalizeChatData,
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

test('独立聊天备份 v1 往返保留名字、消息和记忆并拒绝错误类型', () => {
  const avatar = 'data:image/webp;base64,aGVsbG8='
  const snapshot = buildChatBackupSnapshot({
    profile: { companionName: '小暖', companionAvatar: avatar },
    messages: [{
      id: 'm1',
      role: 'user',
      content: '你好',
      createdAt: 10,
      replyTo: { messageId: 'm0', role: 'assistant', content: '在吗' }
    }],
    memories: [{ id: 'r1', key: '关系:称呼', category: '关系', content: '喜欢被叫哥哥', createdAt: 10, updatedAt: 10 }]
  }, '2026-07-26T08:00:00.000Z')
  const restored = normalizeChatBackupSnapshot(JSON.parse(JSON.stringify(snapshot)))

  assert.equal(restored.type, CHAT_BACKUP_TYPE)
  assert.equal(restored.data.profile.companionAvatar, avatar)
  assert.equal(restored.data.messages.length, 1)
  assert.equal(restored.data.messages[0].replyTo.messageId, 'm0')
  assert.equal(restored.data.memories.length, 1)
  assert.throws(() => normalizeChatBackupSnapshot({ ...snapshot, type: 'other' }), /INVALID_CHAT_BACKUP_TYPE/)
  assert.throws(() => normalizeChatBackupSnapshot({ ...snapshot, data: undefined }), /INVALID_CHAT_BACKUP_DATA/)
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
