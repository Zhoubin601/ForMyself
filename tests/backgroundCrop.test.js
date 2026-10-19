import assert from 'node:assert/strict'
import test from 'node:test'
import { backgroundCropAroundPoint, backgroundCropRect, cropOutputSize } from '../src/services/backgroundCrop.js'
import { normalizeComponentTransparency } from '../src/services/componentAppearance.js'
import { buildFullBackupSnapshot, normalizeFullBackupSnapshot } from '../src/services/fullBackup.js'

test('裁剪适配横图、竖图、极端长图；缩放与边缘拖动不会超出原图', () => {
  for (const [width, height] of [[4000, 2000], [2000, 4000], [8000, 100], [100, 8000]]) {
    for (const aspect of [390 / 844, 1280 / 900]) for (const zoom of [1, 1.5, 3]) for (const x of [0, 50, 100]) for (const y of [0, 50, 100]) {
      const rect = backgroundCropRect(width, height, aspect, zoom, x, y)
      assert.ok(rect.x >= 0 && rect.y >= 0)
      assert.ok(rect.x + rect.width <= width + 1e-7 && rect.y + rect.height <= height + 1e-7)
      assert.ok(Math.abs(rect.width / rect.height - aspect) < 1e-7)
      const output = cropOutputSize(rect)
      assert.ok(output.width > 0 && output.height > 0 && Math.max(output.width, output.height) <= 2560)
      assert.ok(output.width <= rect.width + 1 && output.height <= rect.height + 1)
    }
  }
  assert.deepEqual(backgroundCropRect(4000, 2000, 1, 1, 100, 0), { x: 2000, y: 0, width: 2000, height: 2000 })
  assert.throws(() => backgroundCropRect(0, 2, 1), /INVALID_IMAGE_SIZE/)
})

test('透明度保留两端、修正异常值，完整备份往返兼容旧备份', () => {
  for (const value of [0, 40, 100]) {
    const full = buildFullBackupSnapshot({ settings: { componentTransparency: value } })
    assert.equal(normalizeFullBackupSnapshot(JSON.parse(JSON.stringify(full))).settings.componentTransparency, value)
  }
  assert.equal(normalizeComponentTransparency(-2), 0)
  assert.equal(normalizeComponentTransparency(200), 100)
  for (const value of [undefined, null, '', false, 'broken']) assert.equal(normalizeComponentTransparency(value), 40)
  const full = buildFullBackupSnapshot({})
  delete full.settings.componentTransparency
  assert.equal(normalizeFullBackupSnapshot(full).settings.componentTransparency, 40)
})

test('双指缩放以手势中心为锚点，可平移且缩到边缘不会留白', () => {
  const initial = backgroundCropRect(4000, 3000, .5, 1.5, 50, 50)
  const center = { x: .4, y: .6 }
  const anchor = { x: initial.x + center.x * initial.width, y: initial.y + center.y * initial.height }
  const nextCenter = { x: .55, y: .4 }
  const next = backgroundCropAroundPoint(4000, 3000, .5, 2, anchor, nextCenter)
  const rect = backgroundCropRect(4000, 3000, .5, next.zoom, next.x, next.y)
  assert.ok(Math.abs(rect.x + nextCenter.x * rect.width - anchor.x) < 1e-6)
  assert.ok(Math.abs(rect.y + nextCenter.y * rect.height - anchor.y) < 1e-6)
  for (const zoom of [.01, 10]) {
    const state = backgroundCropAroundPoint(4000, 3000, .5, zoom, anchor, { x: -1, y: 2 })
    assert.ok(state.zoom >= 1 && state.zoom <= 3)
    const clamped = backgroundCropRect(4000, 3000, .5, state.zoom, state.x, state.y)
    assert.ok(clamped.x >= 0 && clamped.y >= 0 && clamped.x + clamped.width <= 4000 && clamped.y + clamped.height <= 3000)
  }
})
