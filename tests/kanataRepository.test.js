import assert from 'node:assert/strict'
import test from 'node:test'
import CryptoJS from 'crypto-js'
import { createHash } from 'node:crypto'
import preset from '../src/features/chat/presets/abydos.v1.json' with { type: 'json' }
import { createEmptyKanataData } from '../src/features/chat/domain/kanataCore.js'
import { instantiateWorldPreset } from '../src/features/chat/domain/presetCore.js'
import { createKanataRepository, encryptKanataData, decryptKanataData, KANATA_DATA_PATH as MAIN,
  KANATA_TEMP_PATH as TEMP, KANATA_BACKUP_PATH as BACKUP, KANATA_RECOVERY_KEY as KEY } from '../src/features/chat/storage/kanataRepository.js'

const PASSWORD = 'synthetic-repository-password'
const otherPassword = 'synthetic-changed-password'
const fixture = name => {
  const data = instantiateWorldPreset(createEmptyKanataData('user-local'), preset, {
    initializationKey: 'first', now: 1000, timeZone: 'Asia/Shanghai',
    idFactory: (kind, source) => kind + '-' + createHash('sha256').update(source).digest('hex').slice(0, 20)
  })
  data.worlds[0].name = name
  return data
}
const code = expected => error => error.code === expected
const missing = () => Object.assign(new Error('File does not exist.'), { code: 'ENOENT' })
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const harness = () => {
  const files = new Map(), values = new Map(), calls = [], failures = new Map(), delays = new Map()
  const hit = async (operation, path) => {
    calls.push([operation, path])
    const key = operation + ':' + path
    if (delays.has(key)) { const gate = delays.get(key); delays.delete(key); await gate.promise }
    if (failures.has(key)) {
      const failure = failures.get(key)
      if (failure.times > 0) { failure.times--; throw Object.assign(new Error('synthetic driver failure'), { code: failure.code }) }
    }
  }
  const filesystem = {
    async stat({ path }) { await hit('stat', path); if (!files.has(path)) throw missing(); return { type: 'file' } },
    async readFile({ path }) { await hit('read', path); if (!files.has(path)) throw missing(); return { data: files.get(path) } },
    async writeFile({ path, data }) { await hit('write', path); files.set(path, data) },
    async mkdir({ path }) { await hit('mkdir', path) },
    async deleteFile({ path }) { await hit('delete', path); if (!files.has(path)) throw missing(); files.delete(path) },
    async rename({ from, to }) { await hit('rename', from); if (!files.has(from)) throw missing(); files.set(to, files.get(from)); files.delete(from) }
  }
  const journal = {
    async get({ key }) { await hit('get', key); return { value: values.get(key) ?? null } },
    async set({ key, value }) { await hit('set', key); values.set(key, value) },
    async remove({ key }) { await hit('remove', key); values.delete(key) }
  }
  return {
    files, values, calls, delays, filesystem, journal,
    fail(operation, path, times = 1, errorCode = 'INJECTED_FAILURE') { failures.set(operation + ':' + path, { times, code: errorCode }) },
    repository: () => createKanataRepository({ filesystem, journal, directory: 'DATA' })
  }
}
const journalRecord = (ciphertext, baseFingerprint = '') => JSON.stringify({ type: 'kanata-recovery', version: 1, baseFingerprint, ciphertext })
const fingerprint = value => CryptoJS.SHA256(value).toString()

test('P2-R01 missing显式返回null；加载前和空密码拒绝写，无创建默认世界', async () => {
  const h = harness(), r = h.repository()
  await assert.rejects(r.write(fixture('first'), PASSWORD), code('KANATA_NOT_LOADED'))
  await assert.rejects(r.read(''), code('KANATA_PASSWORD_REQUIRED'))
  assert.equal((await r.read(PASSWORD)).status, 'missing')
  assert.equal((await r.read(PASSWORD)).data, null)
  assert.equal(h.files.size, 0); assert.equal(h.values.size, 0)
  assert.equal(h.calls.filter(([operation]) => ['write', 'set', 'delete', 'remove', 'rename'].includes(operation)).length, 0)
})
test('P2-R02 独立命名空间主密码加密往返，旧聊天/其他模块字节不变', async () => {
  const h = harness(), legacy = 'formyself/warm-home-v1.enc'
  h.files.set(legacy, 'synthetic legacy bytes'); h.files.set('other-module', 'synthetic other bytes')
  h.values.set('my_chat_recovery_encrypted_v1', 'synthetic old journal')
  const r = h.repository(); await r.read(PASSWORD); await r.write(fixture('新彼方合成资料'), PASSWORD); await r.flush()
  assert.equal(h.files.get(MAIN).includes('新彼方合成资料'), false)
  assert.deepEqual(decryptKanataData(h.files.get(MAIN), PASSWORD), fixture('新彼方合成资料'))
  assert.equal(h.files.get(legacy), 'synthetic legacy bytes'); assert.equal(h.files.get('other-module'), 'synthetic other bytes')
  assert.equal(h.values.get('my_chat_recovery_encrypted_v1'), 'synthetic old journal')
  const loaded = await h.repository().read(PASSWORD)
  assert.equal(loaded.status, 'ready'); assert.deepEqual(loaded.data, fixture('新彼方合成资料'))
  assert.equal(r.getState().saveError, ''); assert.equal(r.getState().hasPendingSave, false)
})
test('P2-R03 错密、合法密文内坏JSON、未来版本拒绝且原字节零写入', async () => {
  for (const [ciphertext, password, expected] of [
    [encryptKanataData(fixture('first'), PASSWORD), otherPassword, 'KANATA_DECRYPT_FAILED'],
    [CryptoJS.AES.encrypt('{invalid-json', PASSWORD).toString(), PASSWORD, 'KANATA_DATA_CORRUPTED'],
    [CryptoJS.AES.encrypt(JSON.stringify({ type: 'kanata-data', version: 999 }), PASSWORD).toString(), PASSWORD, 'UNSUPPORTED_KANATA_VERSION']
  ]) {
    const h = harness(); h.files.set(MAIN, ciphertext)
    const r = h.repository(); await assert.rejects(r.read(password), code(expected))
    assert.equal(r.getState().loaded, false); assert.equal(r.getState().loadError, expected)
    assert.equal(h.files.get(MAIN), ciphertext); assert.equal(h.values.size, 0)
    assert.equal(h.calls.filter(([op]) => ['write', 'set', 'remove', 'delete', 'rename'].includes(op)).length, 0)
  }
})
test('P2-R04 存在但全部坏文件不能返回missing；仅坏备份也明确失败', async () => {
  const h = harness(); for (const path of [MAIN, BACKUP, TEMP]) h.files.set(path, 'broken-' + path)
  const r = h.repository(); await assert.rejects(r.read(PASSWORD), code('KANATA_ALL_COPIES_INVALID'))
  assert.equal(r.getState().loaded, false); assert.equal(h.files.size, 3)
  const backupOnly = harness(); backupOnly.files.set(BACKUP, 'broken-backup')
  await assert.rejects(backupOnly.repository().read(PASSWORD), code('KANATA_DECRYPT_FAILED'))
})
test('P2-R05 驱动读取/存在性错误不当不存在，不用备份掩盖权限错误', async () => {
  for (const operation of ['stat', 'read']) {
    const h = harness(); h.files.set(MAIN, encryptKanataData(fixture('first'), PASSWORD))
    h.files.set(BACKUP, encryptKanataData(fixture('backup'), PASSWORD)); h.fail(operation, MAIN, 1, 'EACCES')
    await assert.rejects(h.repository().read(PASSWORD), code('KANATA_FILE_READ_FAILED'))
    assert.equal(h.calls.filter(([op]) => ['write', 'set', 'rename'].includes(op)).length, 0)
  }
  const h = harness(); h.fail('get', KEY)
  await assert.rejects(h.repository().read(PASSWORD), code('KANATA_RECOVERY_READ_FAILED'))
})
test('P2-R06 主文件损坏从备份只读恢复；首次中断从tmp只读恢复', async () => {
  const h = harness(), r = h.repository(); await r.read(PASSWORD)
  await r.write(fixture('first'), PASSWORD); await r.write(fixture('second'), PASSWORD)
  h.files.set(MAIN, 'broken-primary')
  const recovered = await h.repository().read(PASSWORD)
  assert.equal(recovered.status, 'recovered'); assert.equal(recovered.data.worlds[0].name, 'first')
  assert.equal(h.files.get(MAIN), 'broken-primary')
  const tempOnly = harness(); tempOnly.files.set(TEMP, encryptKanataData(fixture('temporary'), PASSWORD))
  assert.equal((await tempOnly.repository().read(PASSWORD)).data.worlds[0].name, 'temporary')
  assert.equal(tempOnly.files.has(MAIN), false)
})
test('P2-R07 未来版本主文件不被旧备份或恢复副本降级覆盖', async () => {
  const h = harness(), future = CryptoJS.AES.encrypt(JSON.stringify({ type: 'kanata-data', version: 2 }), PASSWORD).toString()
  h.files.set(MAIN, future); h.files.set(BACKUP, encryptKanataData(fixture('old'), PASSWORD))
  h.values.set(KEY, journalRecord(encryptKanataData(fixture('older'), PASSWORD)))
  const r = h.repository(); await assert.rejects(r.read(PASSWORD), code('UNSUPPORTED_KANATA_VERSION'))
  await assert.rejects(r.flush(), code('KANATA_NOT_LOADED')); await assert.rejects(r.retry(), code('KANATA_NOT_LOADED'))
  assert.equal(h.files.get(MAIN), future)
})
test('P2-R08 写失败保留最新密文；重建仓库/重新读回后恢复且flush可重试', async () => {
  const h = harness(), r = h.repository(); await r.read(PASSWORD); await r.write(fixture('stable'), PASSWORD)
  h.fail('write', TEMP, 2)
  await assert.rejects(r.write(fixture('first-unsaved'), PASSWORD), code('KANATA_SAVE_FAILED'))
  await assert.rejects(r.write(fixture('latest-unsaved'), PASSWORD), code('KANATA_SAVE_FAILED'))
  assert.equal(r.getState().hasPendingSave, true); assert.equal(r.getState().recoveryAvailable, true)
  const record = h.values.get(KEY)
  assert.equal(record.includes('latest-unsaved'), false); assert.equal(record.includes(PASSWORD), false)
  const fresh = h.repository(), loaded = await fresh.read(PASSWORD)
  assert.equal(loaded.status, 'recovered'); assert.equal(loaded.data.worlds[0].name, 'latest-unsaved')
  await fresh.flush(); assert.equal(fresh.getState().hasPendingSave, false)
  assert.equal((await h.repository().read(PASSWORD)).data.worlds[0].name, 'latest-unsaved')
})
test('P2-R09 持久介质全失败仅进程内密文，原始主文件不变；持续失败flush必须reject', async () => {
  const h = harness(), r = h.repository(); await r.read(PASSWORD); await r.write(fixture('stable'), PASSWORD)
  const stable = h.files.get(MAIN)
  h.fail('set', KEY, 3); h.fail('write', TEMP, 3)
  await assert.rejects(r.write(fixture('latest'), PASSWORD), code('KANATA_SAVE_FAILED'))
  await assert.rejects(r.flush(), code('KANATA_SAVE_FAILED'))
  assert.equal(r.getState().recoveryAvailable, false); assert.equal(h.files.get(MAIN), stable)
  await assert.rejects(r.release(), code('KANATA_PENDING_SAVE'))
  assert.equal(r.getState().loaded, false)
  // A new instance cannot recover a copy that never reached persistent storage.
  assert.equal((await h.repository().read(PASSWORD)).data.worlds[0].name, 'stable')
})
test('P2-R10 tmp到主文件rename失败自动恢复原主文件并保留密文重试', async () => {
  const h = harness(), r = h.repository(); await r.read(PASSWORD); await r.write(fixture('stable'), PASSWORD)
  const stable = h.files.get(MAIN); h.fail('rename', TEMP)
  await assert.rejects(r.write(fixture('next'), PASSWORD), code('KANATA_SAVE_FAILED'))
  assert.equal(h.files.get(MAIN), stable); assert.equal(r.getState().hasPendingSave, true)
  await r.flush(); assert.equal((await h.repository().read(PASSWORD)).data.worlds[0].name, 'next')
})
test('P2-R11 旧journal清理失败不能覆盖较新主文件，read不擅自清日志', async () => {
  const h = harness(), stale = encryptKanataData(fixture('stale'), PASSWORD), newer = encryptKanataData(fixture('newer'), PASSWORD)
  h.files.set(MAIN, newer); const record = journalRecord(stale, fingerprint(encryptKanataData(fixture('old-base'), PASSWORD)))
  h.values.set(KEY, record)
  const r = h.repository(), loaded = await r.read(PASSWORD)
  assert.equal(loaded.data.worlds[0].name, 'newer'); assert.equal(loaded.status, 'ready')
  assert.equal(h.values.get(KEY), record)
  h.fail('remove', KEY); await r.write(fixture('newest'), PASSWORD)
  assert.equal((await h.repository().read(PASSWORD)).data.worlds[0].name, 'newest')
})
test('P2-R12 journal坏JSON、形状/未来版本严格拒绝，即便主文件有效也不初始化覆盖', async () => {
  for (const [value, expected] of [
    ['{broken', 'KANATA_RECOVERY_CORRUPTED'],
    [JSON.stringify({type: 'kanata-recovery', version: 999}), 'UNSUPPORTED_KANATA_RECOVERY_VERSION'],
    [JSON.stringify({type: 'kanata-recovery', version: 1, ciphertext: 'x', baseFingerprint: 'not-a-digest'}), 'KANATA_RECOVERY_CORRUPTED']
  ]) {
    const h = harness(); h.values.set(KEY, value); h.files.set(MAIN, encryptKanataData(fixture('valid'), PASSWORD))
    await assert.rejects(h.repository().read(PASSWORD), code(expected))
    assert.equal(h.values.get(KEY), value)
  }
})
test('P2-R13 read不会用磁盘旧值覆盖尚未保存pending，release失败后重新认证可恢复', async () => {
  const h = harness(), r = h.repository(); await r.read(PASSWORD); await r.write(fixture('stable'), PASSWORD)
  h.fail('write', TEMP)
  await assert.rejects(r.write(fixture('pending'), PASSWORD))
  const loaded = await r.read(PASSWORD)
  assert.equal(loaded.data.worlds[0].name, 'pending')
  await r.flush(); await r.release()
  assert.equal(r.getState().loaded, false)
  await assert.rejects(r.write(fixture('locked-change'), PASSWORD), code('KANATA_NOT_LOADED'))
})
test('P2-R14 已开始写入仅保留密文，调用后修改传入对象不改变待写内容', async () => {
  const h = harness(), r = h.repository(); await r.read(PASSWORD)
  const data = fixture('original'), gate = defer(); h.delays.set('write:' + TEMP, gate)
  const write = r.write(data, PASSWORD)
  data.worlds[0].name = 'changed-after-call'
  gate.resolve(); await write
  assert.equal((await h.repository().read(PASSWORD)).data.worlds[0].name, 'original')
  const allStored = [...h.files.values(), ...h.values.values()].join()
  assert.equal(allStored.includes('original'), false); assert.equal(allStored.includes(PASSWORD), false)
})
test('P2-R15 reencrypt成功可用新密码、错旧密码拒绝；失败可用旧密码补偿', async () => {
  const h = harness(), r = h.repository(), data = fixture('stable'); await r.read(PASSWORD); await r.write(data, PASSWORD)
  await r.reencrypt(data, otherPassword)
  assert.deepEqual(decryptKanataData(h.files.get(MAIN), otherPassword), data)
  assert.throws(() => decryptKanataData(h.files.get(MAIN), PASSWORD), code('KANATA_DECRYPT_FAILED'))
  h.fail('write', TEMP)
  await assert.rejects(r.reencrypt(data, PASSWORD), code('KANATA_SAVE_FAILED'))
  // Upper-level master-password transaction can compensate after a partial failure.
  await r.reencrypt(data, otherPassword)
  assert.deepEqual((await h.repository().read(otherPassword)).data, data)
})
test('P2-R16 release期间迟到read不得重新置loaded或返回明文', async () => {
  const h = harness(), r = h.repository(), gate = defer()
  h.files.set(MAIN, encryptKanataData(fixture('stable'), PASSWORD)); h.delays.set('get:' + KEY, gate)
  const reading = r.read(PASSWORD), rejection = assert.rejects(reading, code('KANATA_READ_CANCELLED'))
  await Promise.resolve()
  const released = r.release(); assert.equal(r.getState().loaded, false)
  gate.resolve(); await rejection; await released
  assert.equal(r.getState().loaded, false)
})
test('P2-R17 并发写入串行结算，失败后仍保存最新候选', async () => {
  const h = harness(), r = h.repository(); await r.read(PASSWORD)
  h.fail('write', TEMP)
  const first = r.write(fixture('first'), PASSWORD), last = r.write(fixture('last'), PASSWORD)
  await assert.rejects(first, code('KANATA_SAVE_FAILED')); await last; await r.flush()
  assert.equal((await h.repository().read(PASSWORD)).data.worlds[0].name, 'last')
  assert.equal(r.getState().hasPendingSave, false)
})

test('P2-R1 自查：改密后所有可恢复文件均不能再用旧密码解密', async () => {
  const h = harness(), r = h.repository(), data = fixture('change-password')
  await r.read(PASSWORD); await r.write(data, PASSWORD); await r.reencrypt(data, otherPassword)
  for (const path of [MAIN, BACKUP, TEMP]) {
    if (!h.files.has(path)) continue
    assert.throws(() => decryptKanataData(h.files.get(path), PASSWORD), code('KANATA_DECRYPT_FAILED'))
    assert.deepEqual(decryptKanataData(h.files.get(path), otherPassword), data)
  }
})
test('P2-R1 自查：备份重加密阶段中断仍留恢复任务，新实例必须完成全部副本', async () => {
  const h = harness(), r = h.repository(), data = fixture('change-password')
  await r.read(PASSWORD); await r.write(data, PASSWORD)
  h.fail('write', BACKUP)
  await assert.rejects(r.reencrypt(data, otherPassword), code('KANATA_SAVE_FAILED'))
  assert.equal(r.getState().hasPendingSave, true)
  const fresh = h.repository(), loaded = await fresh.read(otherPassword)
  assert.equal(loaded.status, 'recovered'); await fresh.flush()
  assert.throws(() => decryptKanataData(h.files.get(BACKUP), PASSWORD), code('KANATA_DECRYPT_FAILED'))
  assert.deepEqual(decryptKanataData(h.files.get(BACKUP), otherPassword), data)
})

test('P2-R2 Android missing code accepted; permission code never treated as missing by message', async () => {
  const android = harness()
  android.filesystem.stat = async () => { throw Object.assign(new Error('synthetic native missing'), { code: 'OS-PLUG-FILE-0008' }) }
  assert.equal((await android.repository().read(PASSWORD)).status, 'missing')
  const denied = harness()
  denied.filesystem.stat = async () => { throw Object.assign(new Error('File does not exist.'), { code: 'EACCES' }) }
  await assert.rejects(denied.repository().read(PASSWORD), code('KANATA_FILE_READ_FAILED'))
  assert.equal(denied.calls.filter(c => c[0] === 'write').length, 0)
})

test('P2-R21 real Web mkdir existing-directory message permits later saves; coded permission errors still fail', async () => {
  const h = harness(), r = h.repository()
  h.filesystem.mkdir = async () => { throw new Error('Current directory does already exist.') }
  await r.read(PASSWORD)
  await r.write(fixture('web existing directory'), PASSWORD)
  await r.flush()
  assert.equal((await h.repository().read(PASSWORD)).data.worlds[0].name, 'web existing directory')
  h.filesystem.mkdir = async () => { throw Object.assign(new Error('Directory already exists'), {code:'EACCES'}) }
  await assert.rejects(r.write(fixture('denied mkdir'), PASSWORD), code('KANATA_SAVE_FAILED'))
  assert.equal(decryptKanataData(h.files.get(MAIN), PASSWORD).worlds[0].name, 'web existing directory')
})

test('P2-R22 serialization tail exposes no plaintext result before or after release', async () => {
  const h = harness(); h.files.set(MAIN, encryptKanataData(fixture('private read result'), PASSWORD))
  const r = h.repository()
  assert.equal((await r.read(PASSWORD)).data.worlds[0].name, 'private read result')
  assert.equal(await r.wait(), undefined)
  await r.release()
  assert.equal(await r.wait(), undefined)
})

test('P2-R23 actual Android existing-directory code permits verified native-style saves, denied codes remain errors', async () => {
  const h = harness(), r = h.repository()
  h.filesystem.mkdir = async () => { throw Object.assign(new Error("Directory at 'formyself' already exists, cannot be overwritten."), { code: 'OS-PLUG-FILE-0010' }) }
  await r.read(PASSWORD)
  await r.write(fixture('android existing directory'), PASSWORD)
  await r.flush()
  assert.equal((await h.repository().read(PASSWORD)).data.worlds[0].name, 'android existing directory')
  h.filesystem.mkdir = async () => { throw Object.assign(new Error('Directory already exists'), { code: 'OS-PLUG-FILE-0007' }) }
  await assert.rejects(r.write(fixture('native denied mkdir'), PASSWORD), code('KANATA_SAVE_FAILED'))
  assert.equal(decryptKanataData(h.files.get(MAIN), PASSWORD).worlds[0].name, 'android existing directory')
})
