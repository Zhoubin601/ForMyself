import assert from 'node:assert/strict'
import test from 'node:test'
import CryptoJS from 'crypto-js'
import {
  FULL_BACKUP_TYPE,
  FULL_BACKUP_VERSION,
  buildFullBackupSnapshot,
  getFullBackupCounts,
  normalizeFullBackupSnapshot
} from '../src/services/fullBackup.js'

const buildFixture = () => buildFullBackupSnapshot({
  savings: [{ id: 'saving-1', name: '旅行计划', records: [{ amount: 100 }] }],
  weight: [{ id: 'weight-1', date: '2026-07-18', weight: 65.2 }],
  mood: [{ id: 'mood-1', date: '2026-07-18', mood: 'good', note: '完成测试' }],
  passwords: [{ id: 'vault-1', appName: '示例账户', account: 'demo', password: 'demo-password' }],
  schedules: {
    series: [{ id: 'schedule-1', title: '课程提醒', startDate: '2026-07-19', startTime: '09:00' }],
    occurrences: [],
    categories: []
  },
  chat: {
    profile: {
      companionName: '小暖',
      companionAvatar: 'data:image/jpeg;base64,aGVsbG8='
    },
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: '今天有点累',
        createdAt: 1752825600000,
        status: 'complete',
        reactions: [{ actor: 'assistant', emoji: '🥺', createdAt: 1752825610000 }]
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: '宝宝，先来抱抱。',
        createdAt: 1752825660000,
        status: 'complete',
        replyTo: { messageId: 'msg-1', role: 'user', content: '今天有点累' }
      }
    ],
    memories: [
      { id: 'memory-1', key: '偏好:咖啡', scope: 'user', category: '偏好', content: '哥哥喜欢无糖咖啡', createdAt: 1752825660000, updatedAt: 1752825660000 },
      { id: 'memory-2', key: '周末约定', scope: 'relationship', category: '关系', content: '两人约好周末看电影', createdAt: 1752825660000, updatedAt: 1752825660000 }
    ],
    companionState: {
      date: '2026-07-18',
      mood: '期待',
      energy: '高',
      statusText: '等周末约会',
      virtualMoment: '在温馨小家里整理片单',
      updatedAt: 1752825660000
    },
    openLoops: [{
      id: 'loop-1',
      key: '周末电影',
      type: 'promise',
      content: '周末看完电影继续聊',
      createdAt: 1752825660000,
      updatedAt: 1752825660000
    }],
    proactiveSettings: { enabled: true, dailyMax: 2, activeStart: '09:00', activeEnd: '23:00' },
    readState: { lastReadAt: 1752825600000 }
  },
  moodMetadata: { trackingStartDate: '2026-07-01', customTags: ['运动', '运动'] },
  vaultMetadata: { categories: ['工作', '个人', '未分类'] },
  settings: {
    banner: { prefix: '累计省下', suffix: '元', subtitle: '继续保持', titleSize: 42 },
    theme: { mode: 'custom', presetId: 'peach', customPrimary: '#F1A25B' },
    ai: { url: 'https://example.invalid', key: 'encrypted-api-key', model: 'demo-model' },
    autoLockDelaySeconds: 60,
    health: { targetWeight: 60, heightCm: 170, weightChangeReminderEnabled: true, weightChangeThreshold: 0.8 }
  }
}, '2026-07-18T08:00:00.000Z')

test('完整备份 v5 包含互动聊天、连续关系、五类生活数据和设置，但不包含安全凭据', () => {
  const snapshot = buildFixture()
  const serialized = JSON.stringify(snapshot)

  assert.equal(snapshot.type, FULL_BACKUP_TYPE)
  assert.equal(snapshot.version, FULL_BACKUP_VERSION)
  assert.deepEqual(getFullBackupCounts(snapshot), {
    savings: 1,
    weight: 1,
    mood: 1,
    passwords: 1,
    schedules: 1,
    chatMessages: 2,
    chatMemories: 2
  })
  assert.equal(snapshot.settings.ai.key, 'encrypted-api-key')
  assert.deepEqual(snapshot.settings.theme, { mode: 'custom', presetId: 'peach', customPrimary: '#F1A25B' })
  assert.equal(serialized.includes('masterPassword'), false)
  assert.equal(serialized.includes('savedMasterPwd'), false)
  assert.equal(serialized.includes('biometric'), false)
})

test('完整备份可用当前主密码加密并完整解密', () => {
  const snapshot = buildFixture()
  const testPassword = 'test-only-master-password'
  const encrypted = CryptoJS.AES.encrypt(JSON.stringify(snapshot), testPassword).toString()
  const plaintext = CryptoJS.AES.decrypt(encrypted, testPassword).toString(CryptoJS.enc.Utf8)
  const restored = normalizeFullBackupSnapshot(JSON.parse(plaintext))

  assert.equal(restored.data.savings[0].name, '旅行计划')
  assert.equal(restored.data.mood[0].tags[0], '学习')
  assert.equal(restored.data.passwords[0].category, '未分类')
  assert.equal(restored.settings.health.heightCm, 170)
  assert.equal(restored.settings.theme.customPrimary, '#F1A25B')
  assert.equal(restored.data.schedules.series[0].title, '课程提醒')
  assert.equal(restored.data.chat.profile.companionName, '小暖')
  assert.equal(restored.data.chat.profile.companionAvatar, 'data:image/jpeg;base64,aGVsbG8=')
  assert.equal(restored.data.chat.messages.length, 2)
  assert.equal(restored.data.chat.messages[0].reactions[0].emoji, '🥺')
  assert.equal(restored.data.chat.messages[1].replyTo.messageId, 'msg-1')
  assert.equal(restored.data.chat.readState.lastReadAt, 1752825600000)
  assert.equal(restored.data.chat.memories.length, 2)
  assert.equal(restored.data.chat.memories.find(item => item.id === 'memory-1').scope, 'user')
  assert.equal(restored.data.chat.companionState.mood, '期待')
  assert.equal(restored.data.chat.openLoops[0].type, 'promise')
  assert.equal(restored.data.chat.proactiveSettings.dailyMax, 2)
  assert.deepEqual(restored.metadata.mood.customTags, ['运动'])
  assert.deepEqual(restored.metadata.vault.categories, ['工作', '个人', '未分类'])
})

test('完整恢复在写入前拒绝错误类型、版本、日期和缺失数据集', () => {
  const snapshot = buildFixture()

  assert.throws(() => normalizeFullBackupSnapshot({ ...snapshot, type: 'other' }), /INVALID_FULL_BACKUP_TYPE/)
  assert.throws(() => normalizeFullBackupSnapshot({ ...snapshot, version: FULL_BACKUP_VERSION + 1 }), /UNSUPPORTED_FULL_BACKUP_VERSION/)
  assert.throws(() => normalizeFullBackupSnapshot({ ...snapshot, createdAt: 'not-a-date' }), /INVALID_FULL_BACKUP_DATE/)
  assert.throws(() => normalizeFullBackupSnapshot({
    ...snapshot,
    data: { ...snapshot.data, weight: undefined }
  }), /INVALID_FULL_BACKUP_WEIGHT/)
  assert.throws(() => normalizeFullBackupSnapshot({
    ...snapshot,
    data: { ...snapshot.data, chat: undefined }
  }), /INVALID_FULL_BACKUP_CHAT/)
})

test('v1 完整备份可导入并自动补为空日程与聊天', () => {
  const snapshot = buildFixture()
  const legacy = {
    ...snapshot,
    version: 1,
    data: {
      savings: snapshot.data.savings,
      weight: snapshot.data.weight,
      mood: snapshot.data.mood,
      passwords: snapshot.data.passwords
    }
  }
  const restored = normalizeFullBackupSnapshot(legacy)
  assert.equal(restored.version, FULL_BACKUP_VERSION)
  assert.deepEqual(restored.data.schedules.series, [])
  assert.deepEqual(restored.data.chat.messages, [])
  assert.deepEqual(restored.data.chat.memories, [])
})

test('v2 完整备份可导入并自动补为空聊天', () => {
  const snapshot = buildFixture()
  const legacy = {
    ...snapshot,
    version: 2,
    data: {
      savings: snapshot.data.savings,
      weight: snapshot.data.weight,
      mood: snapshot.data.mood,
      passwords: snapshot.data.passwords,
      schedules: snapshot.data.schedules
    }
  }
  const restored = normalizeFullBackupSnapshot(legacy)
  assert.equal(restored.version, FULL_BACKUP_VERSION)
  assert.equal(restored.data.schedules.series.length, 1)
  assert.deepEqual(restored.data.chat.messages, [])
})

test('v3 完整备份聊天自动迁移为哥哥记忆并补齐关系状态', () => {
  const snapshot = buildFixture()
  const legacyChat = {
    profile: snapshot.data.chat.profile,
    messages: snapshot.data.chat.messages,
    memories: snapshot.data.chat.memories.map(({ scope, ...memory }) => memory)
  }
  const restored = normalizeFullBackupSnapshot({
    ...snapshot,
    version: 3,
    data: { ...snapshot.data, chat: legacyChat }
  })

  assert.equal(restored.data.chat.memories.every(item => item.scope === 'user'), true)
  assert.deepEqual(restored.data.chat.openLoops, [])
  assert.equal(restored.data.chat.proactiveSettings.activeEnd, '23:00')
})

test('v4 完整备份继续兼容并把旧聊天全部标记为已读', () => {
  const snapshot = buildFixture()
  const legacyChat = { ...snapshot.data.chat }
  delete legacyChat.readState
  legacyChat.messages = legacyChat.messages.map(({ reactions, type, ...message }) => message)
  const restored = normalizeFullBackupSnapshot({
    ...snapshot,
    version: 4,
    data: { ...snapshot.data, chat: legacyChat }
  })

  assert.equal(restored.version, FULL_BACKUP_VERSION)
  assert.equal(restored.data.chat.messages.every(item => item.type === 'text'), true)
  assert.equal(restored.data.chat.messages.every(item => item.reactions.length === 0), true)
  assert.equal(restored.data.chat.readState.lastReadAt, 1752825660000)
})

test('旧完整备份缺少主题字段时回退云朵蓝', () => {
  const snapshot = buildFixture()
  const legacySettings = { ...snapshot.settings }
  delete legacySettings.theme
  const restored = normalizeFullBackupSnapshot({ ...snapshot, settings: legacySettings })
  assert.deepEqual(restored.settings.theme, {
    mode: 'preset',
    presetId: 'cloud',
    customPrimary: '#4A8FD8'
  })
})
