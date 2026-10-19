import assert from 'node:assert/strict'
import test from 'node:test'
import { backgroundEffectStyle, normalizeBackgroundEffects } from '../src/services/backgroundSettings.js'
import { buildFullBackupSnapshot, normalizeFullBackupSnapshot } from '../src/services/fullBackup.js'

test('解锁页与其他页独立归一化，0保留为清晰原图，异常值使用默认值', () => {
  const effects = normalizeBackgroundEffects({ lock: { blur: 0, fade: 0 }, pages: { blur: 70, fade: 35 } })
  assert.deepEqual(effects, { lock: { blur: 0, fade: 0 }, pages: { blur: 70, fade: 35 } })
  assert.deepEqual(backgroundEffectStyle(effects.lock), {
    backgroundColor: 'rgba(245, 245, 247, 0)', backdropFilter: 'blur(0px)', WebkitBackdropFilter: 'blur(0px)'
  })
  assert.equal(backgroundEffectStyle(effects.pages).backdropFilter, 'blur(28px)')
  assert.deepEqual(normalizeBackgroundEffects({ lock: { blur: -5, fade: 200 }, pages: { blur: 'bad', fade: null } }), {
    lock: { blur: 0, fade: 100 }, pages: { blur: 20, fade: 20 }
  })
})

test('完整备份保留独立效果和关闭状态，v10缺失字段恢复默认且不丢失原图', () => {
  const snapshot = buildFullBackupSnapshot({ settings: {
    customBg: 'data:image/png;base64,synthetic',
    warmHomeEnabled: false,
    backgroundEffects: { lock: { blur: 0, fade: 0 }, pages: { blur: 75, fade: 40 } }
  } })
  const restored = normalizeFullBackupSnapshot(JSON.parse(JSON.stringify(snapshot)))
  assert.equal(restored.settings.warmHomeEnabled, false)
  assert.deepEqual(restored.settings.backgroundEffects, snapshot.settings.backgroundEffects)
  const legacy = { ...snapshot, version: 10, settings: { customBg: snapshot.settings.customBg } }
  const old = normalizeFullBackupSnapshot(legacy)
  assert.equal(old.settings.warmHomeEnabled, true)
  assert.equal(old.settings.customBg, snapshot.settings.customBg)
  assert.deepEqual(old.settings.backgroundEffects, { lock: { blur: 20, fade: 20 }, pages: { blur: 20, fade: 20 } })
})
