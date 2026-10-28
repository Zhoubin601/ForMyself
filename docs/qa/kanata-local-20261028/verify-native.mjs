// Only the newly-created KanataP2Synthetic34 AVD is eligible. No pm clear/uninstall/wipe.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { _android, chromium } from 'playwright-core'
import { assertKanataSyntheticDevice } from '../../../scripts/kanata-device-guard.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../..')
const execute = promisify(execFile), serial = 'emulator-5580', pkg = 'com.yubin.formyself'
const adb = resolve(process.env.ANDROID_HOME || 'E:/Android/Sdk', 'platform-tools/adb.exe')
const manifest = JSON.parse(await readFile(resolve(root, '.kanata-device.local/isolation.json'), 'utf8'))
const adbRun = async args => (await execute(adb, ['-s', serial, ...args], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim()
assertKanataSyntheticDevice(manifest, root, await adbRun(['emu', 'avd', 'name']), serial)
if (await adbRun(['shell', 'getprop', 'sys.boot_completed']) !== '1') throw Error('Device not booted')
const allDevices = await _android.devices(), device = allDevices.find(d => d.serial() === serial)
if (!device) throw Error('No matching task device')
device.setDefaultTimeout(60000)
const assets = await readdir(resolve(root, 'dist/assets'))
const harness = assets.find(f => f.startsWith('kanataQA-') && f.endsWith('.js'))
if (!harness) throw Error('Build the explicit QA variant first')
const results = { startedAt: new Date().toISOString(), serial, avd: manifest.name, pageErrors: [], checks: {}, samples: [], status: 'RUNNING' }
const resuming = process.env.KANATA_QA_RESUME === '1'
const previous = resuming ? JSON.parse(await readFile(resolve(directory, 'native-results.json'), 'utf8')) : null
if (previous) {
  if (previous.serial !== serial || previous.avd !== manifest.name || previous.checks['install-test-apk']?.status !== 'PASS') throw Error('No matching previous synthetic installation')
  results.checks = previous.checks
  results.attempts = [...(previous.attempts || []), { startedAt: previous.startedAt, error: previous.error, apkSha256: previous.apkSha256 }]
}
const connections = [], forwards = []
let page
const boundedCleanup = async action => {
  let timer
  try { await Promise.race([action(), new Promise(resolve => { timer = setTimeout(resolve, 5000) })]) }
  catch { /* preserve the original scenario result */ }
  finally { clearTimeout(timer) }
}
const save = () => writeFile(resolve(directory, 'native-results.json'), JSON.stringify(results, null, 2) + '\n')
const record = async (label, operation) => {
  if (resuming && results.checks[label]?.status === 'PASS' && !/(unlock|cold-reload)/.test(label)) return results.checks[label].result
  const started = Date.now()
  const value = await operation()
  results.checks[label] = { status: 'PASS', elapsedMs: Date.now() - started, result: value }
  console.log('PASS', label)
  await save()
  return value
}
const attachOnce = async () => {
  await adbRun(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
  await adbRun(['shell', 'wm', 'dismiss-keyguard'])
  await adbRun(['shell', 'am', 'start', '-n', pkg + '/.MainActivity'])
  const view = await device.webView({ pkg })
  const port = await adbRun(['forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + view.pid()])
  if (!/^\d+$/.test(port)) throw Error('Invalid forwarding port')
  forwards.push(port)
  const browser = await chromium.connectOverCDP('ws://127.0.0.1:' + port + '/devtools/browser', { timeout: 90000, noDefaults: true })
  connections.push(browser)
  const context = browser.contexts()[0]
  page = context.pages()[0] || await context.waitForEvent('page')
  page.setDefaultTimeout(60000)
  page.on('pageerror', e => results.pageErrors.push(e.message))
  // A synthetic key is persisted to check native credential durability; no external AI requests allowed.
  await page.route('https://api.deepseek.com/**', route => route.abort())
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('auth')?.isDataLoaded)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  return page
}
const attach = async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await attachOnce() }
    catch (error) {
      if (!/Target page, context or browser has been closed|socket hang up|ECONNRESET/.test(error.message) || attempt === 2) throw error
      ;(results.webViewAttachRetries ||= []).push({ attempt, message: error.message, at: new Date().toISOString() })
      await adbRun(['shell', 'am', 'force-stop', pkg])
      const deadline = Date.now() + 20000
      while (device.webViews().some(view => view.pkg() === pkg)) {
        if (Date.now() > deadline) throw Error('Stale WebView after transient connection failure')
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
  }
}
const invoke = async (action, input = {}) => page.evaluate(async ({ asset, action, input }) => {
  return (await import('/assets/' + asset)).run(action, input)
}, { asset: harness, action, input })
const cold = async () => {
  await adbRun(['shell', 'am', 'force-stop', pkg])
  const deadline = Date.now() + 20000
  while (device.webViews().some(view => view.pkg() === pkg)) {
    if (Date.now() > deadline) throw Error('Old WebView still present after force-stop')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return attach()
}
const tap = async name => {
  const button = page.getByRole('button', { name, exact: true })
  await button.waitFor({ state: 'visible' })
  await button.scrollIntoViewIfNeeded()
  // CDP dispatches the pointer to the actual Android WebView without installing a second Activity.
  await button.click()
}
try {
  results.environment = {
    android: await adbRun(['shell', 'getprop', 'ro.build.version.release']),
    api: await adbRun(['shell', 'getprop', 'ro.build.version.sdk']),
    webview: await adbRun(['shell', 'dumpsys', 'webviewupdate']),
    hardware: await adbRun(['shell', 'getprop', 'ro.product.model'])
  }
  const apk = resolve(root, 'android/app/build/outputs/apk/debug/app-debug.apk')
  results.apkSha256 = createHash('sha256').update(await readFile(apk)).digest('hex')
  // Existing installs are only permitted if marked by this exact driver in this exact fresh AVD.
  const installed = (await adbRun(['shell', 'pm', 'list', 'packages', pkg])).split(/\s+/).includes('package:' + pkg)
  if (installed) {
    if (!resuming || (previous.apkSha256 !== results.apkSha256 && process.env.KANATA_QA_UPGRADE !== '1')) throw Error('Prior installation requires an explicit matching-build resume or QA upgrade')
    // The first interrupted attempt may have installed before the app created its files directory.
    if (Object.keys(previous.checks).length > 1) {
      const marker = await adbRun(['shell', 'run-as ' + pkg + ' cat files/kanata-qa-isolation.txt'])
      if (marker !== 'KanataP2Synthetic34:20261028:new-empty-avd') throw Error('Unmarked existing app; refusing test')
    }
    if (previous.apkSha256 !== results.apkSha256) await adbRun(['install', '-r', '-t', apk])
  }
  await record('install-test-apk', () => adbRun(['install', '-t', apk]))
  await adbRun(['shell', 'run-as', pkg, 'mkdir', '-p', 'files'])
  await adbRun(['shell', "run-as " + pkg + " sh -c 'printf KanataP2Synthetic34:20261028:new-empty-avd > files/kanata-qa-isolation.txt'"])
  await adbRun(['shell', 'pm', 'grant', pkg, 'android.permission.POST_NOTIFICATIONS'])
  await attach()
  if (resuming && results.checks['prepare-native-synthetic-fixture'] && !results.checks['master-password-and-session-expiry']) {
    const blocked = await page.evaluate(() => Boolean(document.querySelector('.restore-recovery')))
    if (!blocked) await invoke('unlock')
  }
  await record('prepare-native-synthetic-fixture', () => invoke('prepare'))
  await record('cancel-zero-delete-zero-seed', async () => {
    await tap('开始准备彼方'); await tap('暂不准备')
    await page.getByText('已取消本次准备。', { exact: true }).waitFor()
    return invoke('cancel-check')
  })
  await record('cleanup-interruption', () => invoke('interrupt-cleanup'))
  await cold()
  await record('interrupted-cleanup-cold-unlock', () => invoke('unlock'))
  if (!resuming || !results.checks['cleanup-whitelist-and-idempotent-seed']) {
    const retry = page.getByRole('button', { name: '验证并重试准备', exact: true })
    await tap(await retry.isVisible() ? '验证并重试准备' : '开始准备彼方'); await tap('确认清理并准备')
    await page.getByText('世界已准备好', { exact: true }).waitFor()
  }
  await record('cleanup-whitelist-and-idempotent-seed', () => invoke('initialized-check'))
  await writeFile(resolve(directory, 'native-initialized.png'), await device.screenshot())
  await cold()
  await record('seed-cold-reload', () => invoke('unlock'))
  await record('native-file-faults-and-retry', () => invoke('repository-faults'))
  await record('backup-new-and-v1-v12', () => invoke('backup-roundtrip'))
  await record('backup-partial-write-compensation', () => invoke('backup-failure'))
  const failedRollback = await record('backup-rollback-failure-barrier', () => invoke('backup-failure', { persistent: true }))
  await cold()
  await record('cold-rollback-failure-recovery', () => invoke('recover-journal', failedRollback))
  for (const committed of [false, true]) {
    const prepared = await record('prepare-recovery-' + committed, () => invoke('prepare-journal', { committed }))
    await cold()
    await record('cold-encrypted-recovery-' + committed, () => invoke('recover-journal', prepared))
  }
  await record('master-password-failure-compensation', () => invoke('password-compensation'))
  await cold()
  await record('compensated-password-cold-reload', () => invoke('unlock'))
  await record('master-password-and-session-expiry', () => invoke('password'))
  await cold()
  await record('new-password-cold-reload', () => invoke('unlock', { changed: true }))
  await record('native-background-expiry', async () => {
    await adbRun(['shell', 'input', 'keyevent', 'KEYCODE_HOME'])
    await page.waitForFunction(() => {
      const stores = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
      return stores.get('kanata').snapshot === null && stores.get('auth').savedMasterPwd === ''
    }, null, { polling: 100 })
    await adbRun(['shell', 'am', 'start', '-n', pkg + '/.MainActivity'])
    return invoke('unlock', { changed: true })
  })
  await record('optional-unlock-setting', () => invoke('optional-set'))
  await cold()
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('weight')?.isDataLoaded)
  await record('optional-entry-keeps-plaintext-unloaded', () => invoke('optional-check'))
  await record('optional-protected-cancel-and-verify', async () => {
    await invoke('optional-open'); await tap('取消')
    await invoke('optional-check')
    await invoke('optional-open')
    await page.locator('.feedback-input').fill('Synthetic-Kanata-local-changed')
    await tap('验证')
    await page.getByText('世界已准备好', { exact: true }).waitFor()
    return invoke('optional-ready')
  })
  results.samples = await record('native-1k-10k-growth', () => invoke('growth'))
  results.memoryAfterGrowth = await adbRun(['shell', 'dumpsys', 'meminfo', pkg])
  if (results.pageErrors.length) throw Error('WebView page errors')
  results.status = 'PASS'
} catch (error) {
  results.status = 'FAIL'; results.error = error.message; process.exitCode = 1
  if (page) {
    results.visibleText = await page.locator('body').innerText().catch(() => '')
    await writeFile(resolve(directory, 'native-failure.png'), await device.screenshot().catch(() => Buffer.from([])))
  }
  console.error(error)
} finally {
  results.finishedAt = new Date().toISOString(); await save()
  for (const browser of connections) await boundedCleanup(() => browser.close())
  for (const port of forwards) await adbRun(['forward', '--remove', 'tcp:' + port]).catch(() => {})
  await boundedCleanup(() => device.close())
  process.exit(results.status === 'PASS' ? 0 : 1)
}
