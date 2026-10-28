import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { assertKanataSyntheticDevice } from '../scripts/kanata-device-guard.mjs'

test('native driver accepts task manifest only with the exact AVD, path, serial and synthetic flag', () => {
  const root = resolve('synthetic-root'), serial = 'emulator-5580'
  const manifest = { name: 'KanataP2Synthetic34', serial, syntheticOnly: true,
    avdPath: resolve(root, '.kanata-device.local/avds/KanataP2Synthetic34.avd') }
  for (const newline of ['\n', '\r\n', '\r\r\n']) {
    assert.doesNotThrow(() => assertKanataSyntheticDevice(manifest, root, manifest.name + newline + 'OK', serial))
  }
  assert.doesNotThrow(() => assertKanataSyntheticDevice({ ...manifest, avdPath: resolve(root, '.kanata-device.local/avds/KanataP2Synthetic34-20261028-150000.avd') }, root, manifest.name, serial))
  assert.throws(() => assertKanataSyntheticDevice({ ...manifest, avdPath: resolve(root, '.kanata-device.local/avds/Pixel_6_Pro.avd') }, root, manifest.name, serial))
  for (const altered of [{ syntheticOnly: false }, { avdPath: resolve('another-avd') }, { serial: 'emulator-5554' }, { name: 'Pixel_6_Pro' }]) {
    assert.throws(() => assertKanataSyntheticDevice({ ...manifest, ...altered }, root, manifest.name, serial))
  }
  assert.throws(() => assertKanataSyntheticDevice(manifest, root, 'Pixel_6_Pro\nOK', serial))
  assert.throws(() => assertKanataSyntheticDevice(manifest, root, manifest.name, 'physical-device'))
})
