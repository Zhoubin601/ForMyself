import assert from 'node:assert/strict'
import path from 'node:path'

const identityError = () => Object.assign(Error('M5_AVD_IDENTITY_UNCONFIRMED'), { code: 'M5_AVD_IDENTITY_UNCONFIRMED' })
const need = condition => { if (!condition) throw identityError() }
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string'
  && path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase()
// CIM exposes the same FILETIME at microsecond precision.
const sameStart = (a, b) => /^\d+$/.test(a) && /^\d+$/.test(b) && BigInt(a) / 10n === BigInt(b) / 10n

export function createRunnerGuard({ manifest, manifestPath, inspect, execute, now = Date.now }) {
  const { instanceId, root, avdHome, dataDirectory, avdName, serial, sdk, launcherPid, launcherStarted } = manifest
  let transportId
  function verify() {
    need(manifest.identityVersion === 1 && manifest.syntheticOnly === true
      && manifest.createdBy === 'M2 Windows/WHPX preflight'
      && typeof instanceId === 'string' && /^[a-f0-9]{32}$/.test(instanceId)
      && avdName === 'kanata_m5_' + instanceId && serial === 'emulator-5582' && manifest.api === 34
      && Number.isInteger(launcherPid) && launcherPid > 0 && /^\d+$/.test(launcherStarted)
      && Number.isSafeInteger(manifest.expiresAt) && now() < manifest.expiresAt
      && samePath(root, path.win32.dirname(manifestPath))
      && path.win32.basename(root) === 'kanata-m2-synthetic-' + instanceId.slice(0, 8)
      && samePath(avdHome, path.win32.join(root, 'avd'))
      && samePath(dataDirectory, path.win32.join(avdHome, avdName + '.avd'))
      && typeof sdk === 'string' && path.win32.isAbsolute(sdk))
    let live
    try { live = inspect() } catch { throw identityError() }
    need(live?.pid === launcherPid && sameStart(live.started, launcherStarted)
      && samePath(live.executable, path.win32.join(sdk, 'emulator', 'emulator.exe'))
      && samePath(live.dataDirectory, dataDirectory) && samePath(live.launchDataDirectory, dataDirectory)
      && live.launchAvd === avdName && live.launchPort === '5582' && live.avdName === avdName
      && live.serial === serial && live.api === 34 && live.booted === true
      && /^\d+$/.test(live.transportId) && (transportId === undefined || live.transportId === transportId))
    transportId = live.transportId
    return transportId
  }
  return { verify, command: (...args) => execute(verify(), ...args) }
}

export function qaPid(adb, pkg) {
  const result = adb('shell', 'ps', '-A', '-o', 'PID,NAME')
  const [header, ...rows] = result.split(/\r?\n/)
  assert.match(header, /^\s*PID\s+NAME\s*$/, 'M5_QA_PID_QUERY_INVALID')
  const processes = rows.filter(line => line.trim()).map(line => /^\s*(\d+)\s+(\S.*?)\s*$/.exec(line))
  assert.ok(processes.length > 0 && processes.every(Boolean), 'M5_QA_PID_QUERY_INVALID')
  const matched = processes.filter(row => row[2] === pkg)
  assert.ok(matched.length <= 1, 'M5_QA_PID_QUERY_AMBIGUOUS')
  return matched[0]?.[1] ?? null
}

export async function stopQa({ command, pid, pkg, delay, attempts = 16 }) {
  // The checked command throws on nonzero exit. A query error cannot look like an empty result.
  command('shell', 'am', 'force-stop', pkg)
  for (let i = 0; i < attempts; i++) {
    if (pid() === null) return { exit: 0, pidGone: true }
    if (i + 1 < attempts) await delay(250)
  }
  throw Error('M5_QA_PID_STILL_LIVE')
}

export async function withQaCleanup(action, cleanup) {
  let failed = false, original
  try { return await action() }
  catch (error) { failed = true; original = error; throw error }
  finally {
    try { await cleanup() }
    catch (error) {
      if (failed) throw new AggregateError([original, error], 'M5_QA_SCENARIO_AND_CLEANUP_FAILED')
      throw error
    }
  }
}
