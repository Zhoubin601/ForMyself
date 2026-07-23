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
  moodMetadata: { trackingStartDate: '2026-07-01', customTags: ['运动', '运动'] },
  vaultMetadata: { categories: ['工作', '个人', '未分类'] },
  settings: {
    banner: { prefix: '累计省下', suffix: '元', subtitle: '继续保持', titleSize: 42 },
    ai: { url: 'https://example.invalid', key: 'encrypted-api-key', model: 'demo-model' },
    autoLockDelaySeconds: 60,
    health: { targetWeight: 60, heightCm: 170, weightChangeReminderEnabled: true, weightChangeThreshold: 0.8 }
  }
}, '2026-07-18T08:00:00.000Z')

test('完整备份包含五类数据和设置，但不包含主密码或生物识别凭据', () => {
  const snapshot = buildFixture()
  const serialized = JSON.stringify(snapshot)

  assert.equal(snapshot.type, FULL_BACKUP_TYPE)
  assert.equal(snapshot.version, FULL_BACKUP_VERSION)
  assert.deepEqual(getFullBackupCounts(snapshot), { savings: 1, weight: 1, mood: 1, passwords: 1, schedules: 1 })
  assert.equal(snapshot.settings.ai.key, 'encrypted-api-key')
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
  assert.equal(restored.data.schedules.series[0].title, '课程提醒')
  assert.deepEqual(restored.metadata.mood.customTags, ['运动'])
  assert.deepEqual(restored.metadata.vault.categories, ['工作', '个人', '未分类'])
})

test('完整恢复在写入前拒绝错误类型、版本、日期和缺失数据集', () => {
  const snapshot = buildFixture()

  assert.throws(() => normalizeFullBackupSnapshot({ ...snapshot, type: 'other' }), /INVALID_FULL_BACKUP_TYPE/)
  assert.throws(() => normalizeFullBackupSnapshot({ ...snapshot, version: 3 }), /UNSUPPORTED_FULL_BACKUP_VERSION/)
  assert.throws(() => normalizeFullBackupSnapshot({ ...snapshot, createdAt: 'not-a-date' }), /INVALID_FULL_BACKUP_DATE/)
  assert.throws(() => normalizeFullBackupSnapshot({
    ...snapshot,
    data: { ...snapshot.data, weight: undefined }
  }), /INVALID_FULL_BACKUP_WEIGHT/)
})

test('v1 完整备份可导入并自动补为空日程', () => {
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
  assert.equal(restored.version, 2)
  assert.deepEqual(restored.data.schedules.series, [])
})
