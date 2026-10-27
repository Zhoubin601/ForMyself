import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import preset from '../src/features/chat/presets/abydos.v1.json' with { type: 'json' }
import { createEmptyKanataData } from '../src/features/chat/domain/kanataCore.js'
import { validateKanataData, KanataValidationError } from '../src/features/chat/domain/kanataValidation.js'
import { instantiateWorldPreset, validateWorldPreset } from '../src/features/chat/domain/presetCore.js'

const copy = value => structuredClone(value)
const idFactory = (kind, key) => kind + '-' + createHash('sha256').update(key).digest('hex').slice(0, 24)
const options = key => ({ initializationKey: key, now: 1000, timeZone: 'Asia/Shanghai', idFactory })
const seed = (key = 'first', data = createEmptyKanataData('user-local')) => instantiateWorldPreset(data, preset, options(key))
const fails = (data, code) => assert.throws(() => validateKanataData(data), e => e instanceof KanataValidationError && e.code === code)
const rich = () => {
  const d = seed(), worldId = d.worlds[0].id, instanceId = d.instances[0].id, conversation = d.conversations[0]
  d.messages.push({ id: 'message-one', worldId, conversationId: conversation.id, role: 'user', senderType: 'user',
    senderId: d.identities[0].id, senderNameSnapshot: '合成用户', content: '周五讨论测试安排', createdAt: 1000, revision: 1,
    status: 'complete', turnId: 'turn-one', batchId: 'batch-one' })
  const sourceRefs = [{ messageId: 'message-one', revision: 1 }]
  d.memories.push({ id: 'memory-one', worldId, ownerType: 'character', ownerId: instanceId, layer: 'L3', key: 'synthetic-plan',
    content: '合成安排', sourceRefs: copy(sourceRefs), status: 'active', revision: 1, visibility: 'private' })
  d.events.push({ id: 'event-one', worldId, participantIds: [instanceId], sourceRefs: copy(sourceRefs), causedByEventIds: [],
    status: 'committed', visibility: 'private', summary: '合成测试事件', effectiveAt: 1000, recordedAt: 1000, revision: 1 })
  d.effects.push({ id: 'effect-one', worldId, eventId: 'event-one', targetType: 'instance', targetId: instanceId,
    operation: 'set', path: 'state.mood', value: '平静', ruleVersion: 1 })
  d.tasks.push({ id: 'task-one', worldId, kind: 'memory', state: 'pending', idempotencyKey: 'extract-one', sourceRefs: copy(sourceRefs),
    sourceRevision: 1, attempt: 0, notBefore: 1000, leaseUntil: 0, conversationId: conversation.id, instanceId, resultEventIds: ['event-one'] })
  d.lifeGrants.push({ id: 'grant-one', worldId, instanceId, moduleId: 'todo', read: true, remember: false, share: false, revision: 1 })
  return validateKanataData(d)
}

test('P1-01 五人预设精确计数，无旧小暖、伪历史、任务或默认生活授权', () => {
  const d = seed()
  assert.equal(d.worlds.length, 1); assert.equal(d.cards.length, 5); assert.equal(d.cardVersions.length, 5)
  assert.equal(d.instances.length, 5)
  assert.equal(d.conversations.filter(c => c.type === 'private').length, 5)
  const group = d.conversations.filter(c => c.type === 'group')
  assert.equal(group.length, 1); assert.equal(group[0].participantIds.length, 6)
  assert.equal(d.relationships.filter(r => r.kind === 'teammate').length, 20)
  assert.equal(d.relationships.filter(r => r.kind === 'teacher').length, 5)
  assert.ok(d.lorebookEntries.length >= 8)
  assert.equal(d.lorebookEntries.filter(l => l.scope !== 'character').length, 8)
  for (const field of ['messages', 'memories', 'events', 'effects', 'tasks', 'lifeGrants']) assert.equal(d[field].length, 0)
  assert.deepEqual(d.cardVersions.map(c => c.definition.name), ['小鸟游星野', '砂狼白子', '十六夜野宫', '黑见芹香', '奥空绫音'])
  assert.ok(d.worlds.every(w => !w.autonomyEnabled && !w.proactiveEnabled && !w.notificationsEnabled))
})
test('P1-02 重复seed三次不增，重试不重新取ID且初始化键冲突拒绝', () => {
  const first = seed()
  let next = first
  for (let i = 0; i < 3; i++) next = instantiateWorldPreset(next, preset, { ...options('first'), now: 2000, idFactory: () => { throw new Error('unexpected factory') } })
  assert.deepEqual(next, first); assert.notEqual(next, first)
  assert.throws(() => instantiateWorldPreset(first, { ...preset, presetVersion: 2 }, options('first')), /INITIALIZATION_CONFLICT/)
})
test('P1-03 同卡手动第二世界重用五卡但实例、私聊、关系、记忆及水位独立', () => {
  const first = rich(), firstBefore = copy(first), two = seed('second', first), w2 = two.worlds[1].id
  assert.equal(two.cards.length, 5); assert.equal(two.instances.length, 10); assert.equal(two.conversations.length, 12)
  assert.equal(new Set(two.instances.map(c => c.id)).size, 10)
  assert.equal(two.instances[0].cardId, two.instances[5].cardId)
  two.instances[5].state.mood = '第二世界的合成状态'; two.worlds[1].lastSimulatedAt = 2000
  assert.equal(two.instances[0].state.mood, first.instances[0].state.mood)
  assert.equal(two.worlds[0].lastSimulatedAt, 1000)
  assert.equal(two.memories.filter(m => m.worldId === w2).length, 0)
  assert.deepEqual(first, firstBefore)
  assert.ok(two.relationships.filter(r => r.worldId === w2).every(r => !first.relationships.some(old => old.id === r.id)))
})
test('P1-04 卡版本更新不覆盖既有实例引用、预设原文或用户身份', () => {
  const d = seed(), originalId = d.instances[0].cardVersionId, card = d.cards[0], originalVersion = d.cardVersions[0]
  d.cardVersions.push({ ...copy(originalVersion), id: 'card-revision-two', revision: 2,
    definition: { ...copy(originalVersion.definition), speechStyle: '用户自定义表达' } })
  card.currentVersionId = 'card-revision-two'; d.identities[0].displayName = '访客'
  const two = seed('new', d)
  assert.equal(two.instances[0].cardVersionId, originalId)
  assert.equal(two.instances[5].cardVersionId, 'card-revision-two')
  assert.equal(two.identities[0].displayName, '访客'); assert.equal(two.identities[1].displayName, '老师')
  assert.notEqual(two.cardVersions[0].definition.speechStyle, '用户自定义表达')
})
test('P1-05 人格、知情边界与动机五份独立数据，不执行隐式时钟/随机或AI', () => {
  for (const field of ['summary', 'speechStyle', 'disagreementStyle', 'knowledgeBoundary']) assert.equal(new Set(preset.characters.map(c => c.definition[field])).size, 5)
  const oldNow = Date.now, oldRandom = Math.random
  try {
    Date.now = () => { throw new Error('hidden clock') }; Math.random = () => { throw new Error('hidden randomness') }
    assert.deepEqual(seed(), seed())
  } finally { Date.now = oldNow; Math.random = oldRandom }
  const d = seed(); d.cardVersions[0].definition.anchors.push('仅修改返回数据')
  assert.ok(!preset.characters[0].definition.anchors.includes('仅修改返回数据'))
})

const invalid = [
  ['未知未来版本', 'UNSUPPORTED_KANATA_VERSION', d => { d.version = 999 }],
  ['旧v4不是彼方', 'INVALID_KANATA_TYPE', d => { d.type = 'formyself-chat-backup'; d.version = 4 }],
  ['缺少集合', 'INVALID_COLLECTION', d => { delete d.memories }],
  ['重复实体ID', 'DUPLICATE_ID', d => { d.messages.push(copy(d.messages[0])) }],
  ['孤儿世界', 'ORPHAN_WORLD', d => { d.instances[0].worldId = 'no-world' }],
  ['跨世界群成员', 'CROSS_WORLD_REFERENCE', d => { const two = seed('second', d); Object.assign(d, two); d.conversations[5].participantIds.push(d.instances[5].id) }],
  ['孤儿成员', 'INVALID_PARTICIPANT', d => { d.conversations[0].participantIds[1] = 'missing' }],
  ['重复群成员', 'DUPLICATE_REFERENCE', d => { d.conversations[5].participantIds.push(d.instances[0].id) }],
  ['私聊不允许多人', 'INVALID_CONVERSATION_MEMBERS', d => { d.conversations[0].participantIds.push(d.instances[1].id) }],
  ['角色会话不能含用户', 'INVALID_CONVERSATION_MEMBERS', d => { d.conversations[5].type = 'character' }],
  ['未知模型role', 'INVALID_ENUM', d => { d.messages[0].role = 'system' }],
  ['用户不能伪装assistant', 'INVALID_SENDER', d => { d.messages[0].role = 'assistant' }],
  ['非成员不能发言', 'SENDER_NOT_PARTICIPANT', d => { d.messages[0].role = 'assistant'; d.messages[0].senderType = 'character'; d.messages[0].senderId = d.instances[1].id }],
  ['孤儿卡版本', 'ORPHAN_CARD_VERSION', d => { d.instances[0].cardVersionId = 'missing-version' }],
  ['不同卡的版本', 'ORPHAN_CARD_VERSION', d => { d.instances[0].cardVersionId = d.instances[1].cardVersionId }],
  ['关系边重复', 'DUPLICATE_RELATIONSHIP', d => { d.relationships.push({ ...copy(d.relationships[0]), id: 'duplicate-edge' }) }],
  ['事件因果环', 'EVENT_CAUSAL_CYCLE', d => { d.events[0].causedByEventIds = ['event-one'] }],
  ['候选事件不可挂正式effect', 'UNCOMMITTED_EFFECT', d => { d.events[0].status = 'candidate' }],
  ['effect禁止原型路径', 'UNSAFE_EFFECT_PATH', d => { d.effects[0].path = 'constructor.prototype' }],
  ['任务幂等键重复', 'DUPLICATE_TASK_KEY', d => { d.tasks.push({ ...copy(d.tasks[0]), id: 'duplicate-task' }) }],
  ['三权限不能使用字符串', 'INVALID_BOOLEAN', d => { d.lifeGrants[0].share = 'false' }],
  ['授权重复', 'DUPLICATE_GRANT', d => { d.lifeGrants.push({ ...copy(d.lifeGrants[0]), id: 'duplicate-grant' }) }],
  ['来源引用孤儿', 'ORPHAN_SOURCE', d => { d.memories[0].sourceRefs[0].messageId = 'missing' }],
  ['来源未来版本', 'FUTURE_SOURCE_REVISION', d => { d.memories[0].sourceRefs[0].revision = 2 }],
  ['无效时区', 'INVALID_TIMEZONE', d => { d.worlds[0].timeZone = 'Invalid/Timezone' }],
  ['时间水位错误', 'INVALID_TIME_WATERMARK', d => { d.worlds[0].lastSimulatedAt = 10 }],
  ['不统一的真实用户', 'INVALID_USER_IDENTITY', d => { d.identities[0].userId = 'another-user' }],
  ['伪角色身份', 'INVALID_ENUM', d => { d.messages[0].senderType = 'tool' }]
]
for (const [label, code, mutate] of invalid) test('P1-06 拒绝' + label, () => { const d = rich(); mutate(d); fails(d, code) })

for (const [field, change] of [
  ['memory-owner', (d, w2, c2) => { d.memories[0].ownerId = c2 }],
  ['memory-source', (d, w2) => { d.memories[0].worldId = w2; d.memories[0].ownerId = d.instances[5].id }],
  ['event-participant', (d, w2, c2) => { d.events[0].participantIds = [c2] }],
  ['event-cause', (d, w2) => { d.events.push({ ...copy(d.events[0]), id: 'event-second', worldId: w2, participantIds: [], sourceRefs: [], causedByEventIds: ['event-one'] }) }],
  ['relationship', (d, w2, c2) => { d.relationships[0].toId = c2 }],
  ['lore', (d, w2, c2) => { d.lorebookEntries[0].knownBy = [c2] }],
  ['effect', (d, w2, c2) => { d.effects[0].targetId = c2 }],
  ['task-instance', (d, w2, c2) => { d.tasks[0].instanceId = c2 }],
  ['task-conversation', d => { d.tasks[0].conversationId = d.conversations[6].id }],
  ['grant', (d, w2, c2) => { d.lifeGrants[0].instanceId = c2 }]
]) test('P1-07 跨世界拒绝 ' + field, () => {
  const d = seed('second', rich()); change(d, d.worlds[1].id, d.instances[5].id); fails(d, 'CROSS_WORLD_REFERENCE')
})
test('P1-08 保留新数据所有字段及安全扩展，不截断或套v4归一化', () => {
  const d = rich(); d.cardVersions[0].rawData = { extensions: { unknown: ['测试', 2, null] } }
  const roundtrip = validateKanataData(JSON.parse(JSON.stringify(d)))
  assert.deepEqual(roundtrip, d); assert.notEqual(roundtrip.memories[0], d.memories[0])
})
test('P1-09 JSON恶意输入拒绝且不调用getter；无敏感输入回显', () => {
  let getterCalled = false
  const d = seed()
  Object.defineProperty(d, 'private', { enumerable: true, get() { getterCalled = true; throw new Error('do not read') } })
  fails(d, 'INVALID_JSON_PROPERTY'); assert.equal(getterCalled, false)
  const cycle = seed(); cycle.extra = cycle; fails(cycle, 'CYCLIC_JSON')
  const runtimeObject = seed(); runtimeObject.extra = new Date(0); fails(runtimeObject, 'INVALID_JSON_OBJECT')
  const invalidNumber = seed(); invalidNumber.extra = Infinity; fails(invalidNumber, 'INVALID_JSON_NUMBER')
  const bad = seed(); bad.messages.push({ id: 'private-input-must-not-leak' })
  assert.throws(() => validateKanataData(bad), e => !e.message.includes('private-input-must-not-leak'))
})
test('P1-10 验证预设版本、身份、重复角色、孤儿/重复关系和私有知识', () => {
  const p = copy(preset); p.characters.push(copy(p.characters[0]))
  assert.throws(() => validateWorldPreset(p), /DUPLICATE_PRESET_CHARACTER/)
  assert.throws(() => validateWorldPreset({ ...preset, version: 2 }), /UNSUPPORTED_PRESET_VERSION/)
  const orphan = copy(preset); orphan.relationships[0].toKey = 'not-a-character'
  assert.throws(() => validateWorldPreset(orphan), /INVALID_PRESET_RELATIONSHIP/)
  const duplicate = copy(preset); duplicate.relationships.push(copy(duplicate.relationships[0]))
  assert.throws(() => validateWorldPreset(duplicate), /DUPLICATE_PRESET_RELATIONSHIP/)
  const privateLore = copy(preset); privateLore.lorebook[0].visibility = 'private'
  assert.throws(() => validateWorldPreset(privateLore), /INVALID_PRESET_KNOWLEDGE/)
  assert.throws(() => instantiateWorldPreset(createEmptyKanataData('user-local'), preset, { ...options('first'), idFactory: () => 'collision' }), /DUPLICATE_ID/)
})
test('P1-11 三权限独立，不通过字段耦合暗中授予其他权限', () => {
  const d = rich(); d.lifeGrants[0] = { ...d.lifeGrants[0], read: false, remember: true, share: false }
  assert.deepEqual(validateKanataData(d).lifeGrants, d.lifeGrants)
})


test('P1-R1 自查：卡版本缺原文、关系维度缺字段和重复模板卡必须拒绝', () => {
  const missingRaw = rich(); delete missingRaw.cardVersions[0].rawData
  fails(missingRaw, 'MISSING_CARD_RAW_DATA')
  const dimensions = rich(); delete dimensions.relationships[0].dimensions.trust
  fails(dimensions, 'INVALID_RELATIONSHIP_DIMENSION')
  const duplicates = rich(), card = copy(duplicates.cards[0]), v = copy(duplicates.cardVersions[0])
  duplicates.cards.push({ ...card, id: 'duplicate-card', currentVersionId: 'duplicate-version' })
  duplicates.cardVersions.push({ ...v, id: 'duplicate-version', cardId: 'duplicate-card' })
  fails(duplicates, 'DUPLICATE_PRESET_CARD_KEY')
})
test('P1-R1 自查：任务角色必须在目标会话内，稀疏数组不可补null后冒充原文', () => {
  const d = rich(); d.tasks[0].kind = 'reply'; d.tasks[0].instanceId = d.instances[1].id
  fails(d, 'TASK_SPEAKER_NOT_PARTICIPANT')
  const sparse = seed(), a = new Array(1); a.custom = 'hole'
  sparse.cardVersions[0].rawData = a
  fails(sparse, 'INVALID_JSON_ARRAY')
})

test('P1-R2 预设结构：五人都有提示词层次，私有条目仅归属本角色', () => {
  const d = seed()
  for (const character of preset.characters) assert.deepEqual(new Set(character.definition.promptPriority), new Set(['worldRules', 'core', 'worldIdentity', 'knowledge', 'style']))
  for (const c of d.instances) {
    const privateEntries = d.lorebookEntries.filter(l => l.scope === 'character' && l.ownerId === c.id)
    assert.ok(privateEntries.length > 0)
    assert.ok(privateEntries.every(l => l.visibility === 'private' && l.knownBy.length === 1 && l.knownBy[0] === c.id))
  }
  const invalid = copy(preset); delete invalid.characters[0].definition.promptPriority
  assert.throws(() => validateWorldPreset(invalid), /INVALID_COLLECTION/)
})
test('P1-R2 归档卡不会因再次创建预设世界被静默重新启用', () => {
  const d = seed(); d.cards[0].archived = true
  assert.throws(() => seed('second', d), /ARCHIVED_PRESET_CARD/)
  assert.equal(d.worlds.length, 1); assert.equal(d.cards[0].archived, true)
})
