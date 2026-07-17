import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import {
  DEFAULT_VAULT_CATEGORY,
  compareVaultRecords,
  normalizePasswordVaultRecord,
  normalizePasswordVaultRecords
} from '../src/services/passwordVaultRecords.js'
import { usePasswordVaultStore } from '../src/stores/passwordVault.js'

test('原备份格式导入后补齐未分类和未收藏且不损失字段', () => {
  const legacy = {
    appName: '旧应用',
    account: 'legacy-user',
    password: 'legacy-secret',
    extraFields: [{ fieldName: '备注', fieldValue: '旧字段' }]
  }
  const normalized = normalizePasswordVaultRecord(legacy, () => 'generated-id')
  assert.deepEqual(normalized, {
    id: 'generated-id',
    ...legacy,
    category: DEFAULT_VAULT_CATEGORY,
    favorite: false
  })
})

test('兼容旧别名 group 和 isFavorite', () => {
  const normalized = normalizePasswordVaultRecord({
    id: 1,
    appName: '示例',
    group: '工作',
    isFavorite: true
  })
  assert.equal(normalized.id, '1')
  assert.equal(normalized.category, '工作')
  assert.equal(normalized.favorite, true)
})

test('分类为空时安全回退且异常附加字段不会破坏导入', () => {
  const [record] = normalizePasswordVaultRecords([{
    id: 'a',
    appName: '示例',
    category: '   ',
    extraFields: null
  }])
  assert.equal(record.category, DEFAULT_VAULT_CATEGORY)
  assert.deepEqual(record.extraFields, [])
})

test('收藏记录排序优先于普通记录', () => {
  const records = [
    { appName: '普通', category: '社交', favorite: false },
    { appName: '收藏', category: '工作', favorite: true }
  ].sort(compareVaultRecords)
  assert.equal(records[0].appName, '收藏')
})

test('Store 追加原备份并支持收藏切换', () => {
  setActivePinia(createPinia())
  const store = usePasswordVaultStore()
  store.appendRecords([{
    id: 'old-id',
    appName: '旧备份应用',
    account: 'old-account',
    password: 'old-password',
    extraFields: []
  }])
  assert.equal(store.records[0].category, DEFAULT_VAULT_CATEGORY)
  assert.equal(store.records[0].favorite, false)
  store.toggleFavorite('old-id')
  assert.equal(store.records[0].favorite, true)
})
