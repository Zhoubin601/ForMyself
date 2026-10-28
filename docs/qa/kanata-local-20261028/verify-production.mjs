import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _android, chromium } from 'playwright-core'
import { assertKanataSyntheticDevice } from '../../../scripts/kanata-device-guard.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../..')
const serial = 'emulator-5580', pkg = 'com.yubin.formyself', execute = promisify(execFile)
const adb = resolve(process.env.ANDROID_HOME || 'E:/Android/Sdk', 'platform-tools/adb.exe')
const run = async args => (await execute(adb, ['-s', serial, ...args], { timeout: 120000 })).stdout.trim()
const manifest = JSON.parse(await readFile(resolve(root, '.kanata-device.local/isolation.json'), 'utf8'))
assertKanataSyntheticDevice(manifest, root, await run(['emu', 'avd', 'name']), serial)
if (await run(['shell', 'run-as ' + pkg + ' cat files/kanata-qa-isolation.txt']) !== 'KanataP2Synthetic34:20261028:new-empty-avd') throw Error('Missing task marker')
const build = JSON.parse(await readFile(resolve(directory, 'production-build-verification.json'), 'utf8'))
if (build.status !== 'PASS' || build.qaHarnessAbsent !== true) throw Error('Production APK must be verified first')
const device = (await _android.devices()).find(d => d.serial() === serial)
if (!device) throw Error('Missing isolated task device')
const result = { startedAt: new Date().toISOString(), status: 'RUNNING', apkSha256: build.apkSha256 }
let browser, port
try {
  await run(['install', '-r', '-t', resolve(root, 'android/app/build/outputs/apk/debug/app-debug.apk')])
  await run(['shell', 'am', 'force-stop', pkg])
  const deadline = Date.now() + 20000
  while (device.webViews().some(v => v.pkg() === pkg)) {
    if (Date.now() > deadline) throw Error('Stale process before production smoke')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  await run(['shell', 'am', 'start', '-n', pkg + '/.MainActivity'])
  const view = await device.webView({ pkg })
  port = await run(['forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + view.pid()])
  browser = await chromium.connectOverCDP('ws://127.0.0.1:' + port + '/devtools/browser', { noDefaults: true, timeout: 60000 })
  const page = browser.contexts()[0].pages()[0]
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('auth')?.isDataLoaded)
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings')?.isDataLoaded)
  await page.route('https://api.deepseek.com/**', route => route.abort())
  result.state = await page.evaluate(async () => {
    const stores = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
    const auth = stores.get('auth'), access = stores.get('protectedAccess'), settings = stores.get('settings')
    if (!await auth.unlockWithPassword('Synthetic-Kanata-local-changed')) throw Error('Production cold unlock failed')
    if (!await access.ensureModules()) throw Error('Production protected reload failed')
    settings.switchView('chat')
    const d = stores.get('kanata').snapshot
    const observed = { worlds: d.worlds.length, instances: d.instances.length, messages: d.messages.length, memories: d.memories.length,
      events: d.events.length, remember: d.lifeGrants[0]?.remember, share: d.lifeGrants[0]?.share, configurationPreserved: settings.aiApiKey === 'synthetic-not-a-real-key' }
    if (d.instances.length !== 5 || d.worlds.length !== 1 || d.messages.length !== 2 || d.memories.length !== 1 || d.events.length !== 1 ||
      d.lifeGrants[0].remember !== false || d.lifeGrants[0].share !== false || settings.aiApiKey !== 'synthetic-not-a-real-key') throw Error('Production upgrade graph/config mismatch: ' + JSON.stringify(observed))
    return { worlds: d.worlds.length, instances: d.instances.length, messages: d.messages.length, memories: d.memories.length, events: d.events.length, configurationPreserved: true }
  })
  await page.getByText('世界已准备好', { exact: true }).waitFor()
  await writeFile(resolve(directory, 'production-native.png'), await device.screenshot())
  result.status = 'PASS'
} catch (error) { result.status = 'FAIL'; result.error = error.message; process.exitCode = 1 }
finally {
  result.finishedAt = new Date().toISOString()
  await writeFile(resolve(directory, 'production-native-results.json'), JSON.stringify(result, null, 2) + '\n')
  if (browser) await browser.close().catch(() => {})
  if (port) await run(['forward', '--remove', 'tcp:' + port]).catch(() => {})
  await device.close()
  console.log(JSON.stringify(result, null, 2))
}
