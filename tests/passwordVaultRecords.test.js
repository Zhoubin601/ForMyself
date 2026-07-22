import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import {
  DEFAULT_VAULT_CATEGORY,
  compareVaultRecords,
  getVaultCategories,
  isVaultCategoryInUse,
  normalizePasswordVaultRecord,
  normalizePasswordVaultRecords,
  normalizeVaultCategoryList
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

test('保存过的分类列表可删除未使用内置项，并自动补入记录实际使用的分类', () => {
  assert.deepEqual(normalizeVaultCategoryList([' 个人 ', '个人']), ['个人', DEFAULT_VAULT_CATEGORY])
  assert.deepEqual(
    getVaultCategories([{ category: '工作' }], ['个人', DEFAULT_VAULT_CATEGORY]),
    ['个人', '工作', DEFAULT_VAULT_CATEGORY]
  )
  assert.equal(isVaultCategoryInUse([{ category: '工作' }], '工作'), true)
  assert.equal(isVaultCategoryInUse([{ category: '工作' }], '个人'), false)
})

test('密码分类支持添加和删除，但占用中分类与未分类不可删除', () => {
  setActivePinia(createPinia())
  const store = usePasswordVaultStore()

  assert.equal(store.addCategory('个人').ok, true)
  assert.equal(store.addCategory('个人').reason, 'EXISTS')
  assert.equal(store.deleteCategory('个人').ok, true)

  store.addCategory('工作账号')
  store.addRecord({ id: 'used', appName: '公司邮箱', category: '工作账号' })
  assert.equal(store.deleteCategory('工作账号').reason, 'IN_USE')
  assert.equal(store.deleteCategory(DEFAULT_VAULT_CATEGORY).reason, 'PROTECTED')
})
