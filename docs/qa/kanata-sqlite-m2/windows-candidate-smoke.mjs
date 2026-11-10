import assert from 'node:assert/strict'
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { setTimeout as delay } from 'node:timers/promises'
import { unwrapKey } from '../kanata-sqlite-m0/key-envelope.mjs'
import { m2Fixture, m2FixtureCommands, auditInspection, fixtureWrites, futureSchema } from '../../../tests/helpers/kanataSqliteM2Fixture.js'

const manifestPath = path.resolve(process.argv[2])
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const packageName = 'com.yubin.formyself.m2qa'
assert.equal(process.platform, 'win32')
assert.equal(manifest.syntheticOnly, true)
assert.equal(manifest.createdBy, 'M2 Windows/WHPX preflight')
assert.equal(manifest.avdName, 'kanata_m2_api34')
assert.equal(manifest.serial, 'emulator-5582')
assert.equal(path.resolve(manifest.root), path.dirname(manifestPath))
assert.match(path.basename(manifest.root), /^kanata-m2-synthetic-[a-f0-9]{8}$/)
const adb = (...args) => execFileSync(path.join(manifest.sdk, 'platform-tools', 'adb.exe'),
  ['-s', manifest.serial, ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 }).trim()
assert.equal(adb('emu', 'avd', 'name').split('\n')[0].trim(), manifest.avdName)
assert.equal(adb('shell', 'getprop', 'sys.boot_completed'), '1')
assert.equal(adb('shell', 'getprop', 'ro.build.version.sdk'), '34')
const allowedPackages = new Set([packageName, packageName + '.test', 'com.formyself.qa.m2probe'])
const userPackages = adb('shell', 'pm', 'list', 'packages', '-3').split(/\r?\n/).map(item => item.slice(8))
assert(userPackages.includes(packageName) && userPackages.every(item => allowedPackages.has(item)))

let pid
let port
let socket
async function attach() {
  pid = adb('shell', 'pidof', packageName)
  assert.match(pid, /^\d+$/)
  const name = 'webview_devtools_remote_' + pid
  assert(adb('shell', 'cat', '/proc/net/unix').split(/\r?\n/).some(line => line.endsWith('@' + name)))
  port = adb('forward', 'tcp:0', 'localabstract:' + name)
  assert.match(port, /^\d+$/)
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json()
  const page = targets.find(item => item.type === 'page' && item.title === 'M2_SQLCIPHER_SYNTHETIC')
  assert(page && page.url === 'https://localhost/')
  assert.equal(new URL(page.webSocketDebuggerUrl).host, '127.0.0.1:' + port)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  let timer
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('CDP_CONNECT_TIMEOUT')), 5000)
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
  } finally { clearTimeout(timer) }
  if (process.argv.includes('--mr1-fanout') || process.argv.includes('--mr1-verify') || process.argv.includes('--m4-completion')) {
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method !== 'Runtime.consoleAPICalled') return
      const [tag, payload] = message.params.args.map(arg=>arg.value)
      if (typeof tag === 'string' && tag.startsWith('MR1_')) console.log(tag, payload)
    })
    socket.send(JSON.stringify({ id: -1, method: 'Runtime.enable' }))
  }
  let id = 0
  return (expression, timeoutMs = 90000) => new Promise((resolve, reject) => {
    const request = ++id
    const timeout = setTimeout(() => {
      socket.removeEventListener('message', onMessage)
      reject(new Error('CDP_EVALUATION_TIMEOUT'))
    }, timeoutMs)
    function onMessage(event) {
      const reply = JSON.parse(event.data)
      if (reply.id !== request) return
      clearTimeout(timeout)
      socket.removeEventListener('message', onMessage)
      if (reply.error || reply.result.exceptionDetails) reject(new Error('CDP_EVALUATION_FAILED'))
      else resolve(reply.result.result.value)
    }
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify({ id: request, method: 'Runtime.evaluate', params: {
      expression, returnByValue: true, awaitPromise: true,
    } }))
  })
}
function detach() {
  socket?.close()
  socket = undefined
  if (port) adb('forward', '--remove', 'tcp:' + port)
  port = undefined
}

try {
  const bundle = await build({
    entryPoints: ['docs/qa/kanata-sqlite-m2/candidate-smoke.mjs'],
    bundle: true, write: false, format: 'esm', target: 'chrome113',
    define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
    loader: { '.css': 'text' },
    plugins: [{
      name: 'synthetic-vue-sfc',
      setup(api) {
        api.onLoad({ filter: /\.vue$/ }, async ({ path: file }) => {
          const source = await readFile(file, 'utf8')
          const { descriptor, errors } = parse(source, { filename: file })
          assert.equal(errors.length, 0)
          const script = compileScript(descriptor, { id: file, inlineTemplate: true, isProd: true })
          return { contents: script.content, loader: 'js', resolveDir: path.dirname(file) }
        })
      },
    }],
  })
  const initialize = evaluate => evaluate(`(async () => {
    const url = URL.createObjectURL(new Blob([${JSON.stringify(bundle.outputFiles[0].text)}], { type: 'text/javascript' }))
    try { await import(url); return typeof window.m2QaScenario === 'function' }
    finally { URL.revokeObjectURL(url) }
  })()`)
  console.log(JSON.stringify({ qaBundleSha256: createHash('sha256').update(bundle.outputFiles[0].contents).digest('hex') }))
  let evaluate = await attach()
  assert.equal(await initialize(evaluate), true)
  const bytes = randomBytes(32)
  let password
  try { password = JSON.stringify(bytes.toString('base64')) }
  finally { bytes.fill(0) }
  if (process.argv.includes('--mr2-grants')) {
    const fixture=m2Fixture()
    const sample=fixture.messages[0]
    const {worldId,conversationId}=sample
    const instanceId=fixture.instances.find(actor=>actor.worldId===worldId).id
    const input={scope:{worldId,conversationId,instanceId},sample,commands:m2FixtureCommands(fixture)}
    const result=await evaluate(`window.mr2QaWideGrantProof(${password}, ${JSON.stringify(input)})`,420000)
    console.log(JSON.stringify({mr2GrantProof:result},null,2))
    assert.equal(result.error,undefined)
    assert.match(result.health.cipher,/^4\.17\.0/)
    assert.deepEqual(result.samples.map(item=>item.size),[1000,10000])
  } else if (process.argv.includes('--mr1-fanout') || process.argv.includes('--mr1-verify')) {
    const verify=process.argv.includes('--mr1-verify')
    const fixture = m2Fixture()
    const { worldId } = fixture.messages[0]
    for (const size of [1000,10000]) {
      const scope={worldId,instanceId:fixture.instances.find(actor=>actor.worldId===worldId).id}
      const input = { scope,verify,commands:size===1000?m2FixtureCommands(fixture):undefined }
      const result = await evaluate(`window.mr1QaFanout(${password}, ${JSON.stringify(input)}, ${size})`, 420000)
      console.log(JSON.stringify({ mr1:result },null,2))
      assert.equal(result.error,undefined)
      assert.match(result.health.cipher,/^4\.17\.0/)
      if (!verify) {
        assert.equal(result.confirmed.revoked,size+1)
        continue
      }
      assert.equal(await evaluate(`window.mr1QaArmFanout(${password}, ${JSON.stringify(result.plan)}, ${size})`),'armed')
      const deadline=Date.now()+420000
      let state
      do {
        await delay(200)
        state=await evaluate('window.m2QaCrashState()')
      } while (state==='idle'&&Date.now()<deadline)
      assert.equal(state,'mr1-first-batch-uncommitted')
      const oldPid=pid
      adb('shell','run-as',packageName,'kill','-9',oldPid)
      await delay(300)
      assert.equal(adb('shell','pidof '+packageName+' || true'),'')
      detach()
      adb('shell','am','start','-W','-n',packageName+'/com.yubin.formyself.MainActivity')
      await delay(600)
      evaluate=await attach()
      assert.notEqual(pid,oldPid)
      assert.equal(await initialize(evaluate),true)
      const recovered=await evaluate(`window.mr1QaResumeFanout(${password}, ${JSON.stringify(scope)}, ${JSON.stringify(result.plan)}, ${size})`,420000)
      console.log(JSON.stringify({mr1Recovery:{oldPid,newPid:pid,...recovered}},null,2))
      assert.equal(recovered.error,undefined)
      assert.equal(recovered.confirmed.revoked,size+1)
    }
  } else if (process.argv.includes('--repository') || process.argv.includes('--full')) {
    const fixture = m2Fixture()
    const input = {
      commands: m2FixtureCommands(fixture), inspection: auditInspection, deferredCommit: fixtureWrites.deferredCommit,
      sample: fixture.messages[0], group: fixture.conversations.find(conversation => conversation.type === 'group'),
    }
    const result = await evaluate(`window.m2QaScenario(${password}, ${JSON.stringify(input)})`)
    console.log(JSON.stringify(result, null, 2))
    assert.equal(result.error, undefined)
    assert.equal(result.passed.length, 4)
    assert.match(result.health.cipher, /^4\.17\.0/)
    if (process.argv.includes('--full')) {
      const scope = { worldId: input.sample.worldId, conversationId: input.sample.conversationId }
      const envelope = JSON.parse(adb('shell', 'run-as', packageName, 'cat', 'no_backup/kanata-sqlite-v1/envelope.json'))
      const dek = await unwrapKey(JSON.parse(password), envelope)
      assert.equal(dek.length, 32)
      const kek = pbkdf2Sync(JSON.parse(password), Buffer.concat([
        Buffer.from('ForMyself/Kanata/KEK/v1\u0000'), Buffer.from(envelope.salt, 'base64'),
      ]), 600000, 32, 'sha256')
      const logs = adb('logcat', '-d', '--pid', pid)
      const prefs = adb('shell', `run-as ${packageName} sh -c 'if [ -d shared_prefs ]; then cat shared_prefs/*.xml 2>/dev/null || true; fi'`)
      const plainHeader = adb('exec-out', 'run-as', packageName, 'head', '-c', '16', 'no_backup/kanata-sqlite-v1/kanata.db')
      try {
        const secrets = [JSON.parse(password), Buffer.from(dek).toString('hex'), kek.toString('hex')]
        assert(secrets.every(secret => !logs.includes(secret) && !prefs.includes(secret)), 'Synthetic secret leaked')
        assert(!plainHeader.startsWith('SQLite format 3'), 'Plaintext database header')
      } finally { kek.fill(0) }
      dek.fill(0)
      assert.equal(await evaluate("window.m2QaChallenge('prepare')"), 'prepared')
      await delay(31000)
      assert.equal(await evaluate("window.m2QaChallenge('expired')"), 'expired-rejected')
      assert.equal(await evaluate("window.m2QaChallenge('prepare')"), 'prepared')
      assert.equal(await evaluate(`window.m2QaChallenge('lease', ${password})`), 'leased')
      adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
      await delay(1200)
      adb('shell', 'am', 'start', '-W', '-n', packageName + '/com.yubin.formyself.MainActivity')
      assert.equal(await evaluate("window.m2QaChallenge('revoked')"), 'background-lease-rejected')
      const oldPid = pid
      await evaluate(`window.m2QaArmCrash(${password}, ${JSON.stringify(scope)})`)
      let armed
      for (let attempt = 0; attempt < 30; attempt++) {
        armed = await evaluate('window.m2QaCrashState()')
        if (armed !== 'idle') break
        await delay(100)
      }
      assert.equal(armed, 'uncommitted-write-and-audit')
      adb('shell', 'run-as', packageName, 'kill', '-9', oldPid)
      await delay(300)
      assert.equal(adb('shell', 'pidof ' + packageName + ' || true'), '')
      detach()
      adb('shell', 'am', 'start', '-W', '-n', packageName + '/com.yubin.formyself.MainActivity')
      await delay(600)
      evaluate = await attach()
      assert.notEqual(pid, oldPid)
      assert.equal(await initialize(evaluate), true)
      const crash = await evaluate(`window.m2QaCheckCrash(${password}, ${JSON.stringify(scope)}, ${JSON.stringify(input.inspection.messages)})`)
      assert.deepEqual(crash, { status: 'complete', revision: 1, auditAbsent: true })
      console.log(JSON.stringify({
        envelope: 'PASS_M0_V1_CROSS_UNWRAP', challenge: 'PASS_EXPIRED_REJECTED', background: 'PASS_OLD_LEASE_REJECTED',
        plaintext: 'PASS_NO_PLAINTEXT_HEADER_OR_SYNTHETIC_SECRET_IN_PID_LOGS_AND_PREFERENCES',
        sigkill: { oldPid, newPid: pid, ...crash },
      }, null, 2))
      const { messages: _messages, ...metadata } = fixture
      const uiInput = {
        metadata, originalId: scope.conversationId, groupId: input.group.id,
        alternateId: fixture.conversations.find(item => item.worldId !== scope.worldId).id,
      }
      const ui = await evaluate(`window.m2QaUi(${password}, ${JSON.stringify(uiInput)})`)
      console.log(JSON.stringify(ui, null, 2))
      assert.equal(ui.error, undefined)
      assert.equal(ui.passed.length, 4)
      assert.equal(ui.realModelCalls, 0)
      if (process.argv.includes('--m4-growth')) {
        const growth = await evaluate(`window.m4QaGrowth(${password}, ${JSON.stringify({
          base: fixture.conversations.find(row => row.id === scope.conversationId),
          senderId: fixture.identities.find(row => row.worldId === scope.worldId).id,
        })})`, 300000)
        console.log(JSON.stringify({ m4: growth }, null, 2))
        assert.equal(growth.error, undefined)
        assert.equal(growth.samples.length, 2)
        assert.equal(growth.controlledModelCalls, 7)
        assert.deepEqual(growth.promptGrowth.map(sample=>sample.size),[1000,10000])
        assert(growth.promptGrowth.every(sample=>sample.recovered&&sample.arrayObjects===0&&sample.noQueriesAfterCancel===0))
        assert.equal(growth.revocationWhilePending, 'PASS')
        assert.equal(growth.realModelCalls, 0)
        const archive = await evaluate(`window.m4QaArchive(${password}, ${JSON.stringify({
          base:fixture.conversations.find(row=>row.id===scope.conversationId),
          senderId:fixture.identities.find(row=>row.worldId===scope.worldId).id,
        })})`)
        console.log(JSON.stringify({m4HistoryArchive:archive},null,2))
        assert.deepEqual(archive,{archivedCount:50,retainedRecent:200,quotePreserved:true})
        const actors = fixture.instances.filter(actor=>actor.worldId===scope.worldId).map(actor=>actor.id)
        const membership = process.argv.includes('--m4-completion') ? {
          actors, foreign:fixture.instances.find(actor=>actor.worldId!==scope.worldId).id, sample:input.sample,
          failCommitSql:fixtureWrites.deferredCommit,
        } : undefined
        const workspace = await evaluate(`window.m4QaWorkspace(${password}, ${JSON.stringify({
          membership,
          worldId: scope.worldId, worldName: fixture.worlds.find(row => row.id === scope.worldId).name,
          conversationId: scope.conversationId, actorId: fixture.instances.find(row => row.worldId === scope.worldId).id,
        })})`)
        console.log(JSON.stringify({ m4Workspace: workspace }, null, 2))
        assert.equal(workspace.error, undefined)
        assert.equal(workspace.passed.length, 2)
        if (membership) {
          assert.deepEqual(workspace.groupCases,['GROUP-01','GROUP-02','GROUP-03','GROUP-04','GROUP-05'])
          assert.equal(workspace.groupCommitFailure,'PASS')
          assert.equal(workspace.softDeletedHistory,'PASS')
          assert.equal(workspace.eventLedger,'PASS')
          assert.equal(workspace.memoryManagement,'PASS')
        }
      }
      const m3 = await evaluate(`window.m3QaScenario(${password}, ${JSON.stringify(fixture)}, ${JSON.stringify(fixtureWrites.deferredCommit)})`)
      console.log(JSON.stringify({ m3: m3.passed, ownerSwitch: m3.ownerSwitch, error: m3.error }, null, 2))
      assert.equal(m3.error, undefined)
      assert.equal(m3.ownerSwitch, 'PASS')
      assert.equal(m3.passed.length, 4)
      const m3OldPid = pid
      assert.equal(await evaluate(`window.m3QaArmWindow(${password}, ${JSON.stringify(m3.next)})`), 'armed')
      let m3State
      for (let attempt = 0; attempt < 80; attempt++) {
        m3State = await evaluate('window.m2QaCrashState()')
        if (m3State !== 'idle') break
        await delay(100)
      }
      assert.equal(m3State, 'uncommitted-write-and-audit')
      adb('shell', 'run-as', packageName, 'kill', '-9', m3OldPid)
      await delay(300)
      assert.equal(adb('shell', 'pidof ' + packageName + ' || true'), '')
      detach()
      adb('shell', 'am', 'start', '-W', '-n', packageName + '/com.yubin.formyself.MainActivity')
      await delay(600)
      evaluate = await attach()
      assert.notEqual(pid, m3OldPid)
      assert.equal(await initialize(evaluate), true)
      const m3Reopened = await evaluate(`window.m3QaReopenWindow(${password}, ${JSON.stringify(m3.next)})`)
      assert.deepEqual(m3Reopened, { before: m3.next.from, absent: true, eventCount: 1, after: m3.next.end })
      console.log(JSON.stringify({ m3Sigkill: { oldPid: m3OldPid, newPid: pid, ...m3Reopened } }, null, 2))
      if (process.argv.includes('--m4-completion')) {
        const actor = fixture.instances.find(item => item.worldId === scope.worldId)
        for (const size of [1000, 10000]) {
          const completion = await evaluate(`window.m4QaCompletion(${password}, ${JSON.stringify({ ...scope, instanceId: actor.id, senderId: fixture.identities.find(item=>item.worldId===scope.worldId).id })}, ${size})`, 420000)
          console.log(JSON.stringify({ m4Completion: completion }, null, 2))
          assert.equal(completion.error, undefined)
          assert.deepEqual(completion.samples.map(sample => sample.size), [size])
        }
      }
      const root = 'no_backup/kanata-sqlite-v1'
      adb('shell', 'run-as', packageName, 'mv', root + '/envelope.json', root + '/envelope.saved-for-qa')
      try {
        assert.equal(await evaluate("window.m2QaInventory('KANATA_SQLITE_INCOMPLETE_CREATION')"), 'KANATA_SQLITE_INCOMPLETE_CREATION')
      } finally { adb('shell', 'run-as', packageName, 'mv', root + '/envelope.saved-for-qa', root + '/envelope.json') }
      assert.equal(await evaluate(`window.m2QaFuture('mark', ${password}, ${JSON.stringify(futureSchema)})`), 'future-marked')
      const before = adb('shell', 'run-as', packageName, 'sha256sum', root + '/kanata.db')
      assert.equal(await evaluate(`window.m2QaFuture('verify', ${password})`), 'future-rejected')
      assert.equal(adb('shell', 'run-as', packageName, 'sha256sum', root + '/kanata.db'), before)
      adb('shell', `run-as ${packageName} sh -c 'mkdir -p files/formyself && touch files/formyself/kanata-v1.enc'`)
      assert.equal(await evaluate("window.m2QaInventory('KANATA_SQLITE_LEGACY_PRESENT')"), 'KANATA_SQLITE_LEGACY_PRESENT')
      console.log(JSON.stringify({ inventory: 'PASS_INCOMPLETE_AND_LEGACY_REJECTED', futureSchema: 'PASS_READ_ONLY_REJECTION' }, null, 2))
    }
  } else {
    const result = await evaluate(`(async () => {
    const steps = []
    try {
      const initial = await window.m2QaSmoke(${password}, true)
      steps.push({ createdAndMigrated: initial })
      const reopened = await window.m2QaSmoke(${password}, false)
      steps.push({ reopened })
      try { await window.m2QaSmoke(${password} + 'invalid', false) }
      catch (error) { steps.push({ wrongPasswordCode: error.code ?? error.message }) }
      return { steps }
    } catch (error) { return { steps, error: error.code ?? error.message } }
  })()`)
    console.log(JSON.stringify(result, null, 2))
    assert.equal(result.error, undefined)
    assert.match(result.steps[0]?.createdAndMigrated.cipher, /^4\.17\.0/)
    assert.deepEqual(result.steps[1].reopened, result.steps[0].createdAndMigrated)
    assert.equal(result.steps[2]?.wrongPasswordCode, 'KANATA_SQLITE_UNLOCK_FAILED')
  }
} finally {
  detach()
}
