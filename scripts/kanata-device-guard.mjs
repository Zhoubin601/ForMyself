import { resolve, dirname, basename } from 'node:path'

export function assertKanataSyntheticDevice(manifest, root, avdResponse, serial) {
  if (manifest?.name !== 'KanataP2Synthetic34' || manifest.serial !== serial || serial !== 'emulator-5580' ||
    manifest.syntheticOnly !== true || typeof manifest.avdPath !== 'string' || dirname(manifest.avdPath) !== resolve(root, '.kanata-device.local/avds') ||
    !/^KanataP2Synthetic34(?:-\d{8}-\d{6})?\.avd$/.test(basename(manifest.avdPath)) ||
    String(avdResponse).trim().split(/\s+/)[0] !== manifest.name) {
    throw Error('Kanata synthetic device identity mismatch')
  }
}
