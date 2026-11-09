import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { kanataSchemaAdapter } from '../../../src/features/chat/storage/sqlite/kanataSchemaAdapter.js'
import { migrateKanataSchema } from '../../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { createKanataMessageRepository } from '../../../src/features/chat/storage/sqlite/kanataMessageRepository.js'
import { createKanataConversationRepository } from '../../../src/features/chat/storage/sqlite/kanataConversationRepository.js'
import { KANATA_SCHEMA_MIGRATIONS } from '../../../src/features/chat/storage/sqlite/kanataSchema.js'
import { m2Fixture, m2FixtureCommands, auditInspection, fixtureWrites } from '../../../tests/helpers/kanataSqliteM2Fixture.js'

const directory = await fs.mkdtemp(path.resolve('work/m0/m1-r-cipher-m2-'))
const database = path.join(directory, 'synthetic.db')
const key = randomBytes(32)
const checks = []
const children = new Set()

async function connect(keyBytes) {
  const child = spawn(process.argv[2], ['-X', 'utf8', 'docs/qa/kanata-sqlite-m1-r/cipher-worker.py'], { stdio: ['pipe', 'pipe', 'pipe'] })
  children.add(child)
  const lines = createInterface({ input: child.stdout })
  const requests = []
  let dead = false
  const closed = new Promise(resolve => child.once('close', (code, signal) => {
    dead = true
    lines.close()
    children.delete(child)
    for (const request of requests.splice(0)) request.reject(new Error('QA_WORKER_CLOSED'))
    resolve({ code, signal })
  }))
  const failed = () => {
    for (const request of requests.splice(0)) request.reject(new Error('QA_WORKER_FAILED'))
  }
  child.on('error', failed)
  child.stdin.on('error', failed)
  child.stderr.resume()
  lines.on('line', line => {
    const request = requests.shift()
    const reply = JSON.parse(line)
    if (reply.ok) request.resolve(reply.value)
    else request.reject(new Error(reply.code))
  })
  const call = (operation, sql, parameters, extra) => new Promise((resolve, reject) => {
    if (dead) { reject(new Error('QA_WORKER_CLOSED')); return }
    requests.push({ resolve, reject })
    child.stdin.write(JSON.stringify({ operation, sql, parameters, ...extra }) + '\n')
  })
  const close = async () => { child.stdin.end(); await closed }
  let versions
  try { versions = await call('init', '', [], { path: database, key: keyBytes.toString('hex') }) }
  catch (error) { await close(); throw error }
  const tx = {
    query: (sql, params = []) => call('query', sql, params),
    execute: (sql, params = []) => call('write', sql, params),
  }
  const operation = {
    async transaction(action) {
      await tx.execute('BEGIN IMMEDIATE')
      try {
        const value = await action(tx)
        await tx.execute('COMMIT')
        return value
      } catch (error) {
        await tx.execute('ROLLBACK')
        throw error
      }
    },
  }
  return { versions, tx, operation, call, child, closed, close }
}

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fixture = m2Fixture()
const sample = fixture.messages[0]
const scope = { worldId: sample.worldId, conversationId: sample.conversationId }
let audit = 0
const tools = { id: () => 'host-m2-audit-' + ++audit, clock: () => 1300 }
let worker
const timeout = setTimeout(() => { for (const child of children) child.kill('SIGKILL') }, 120000)
try {
  worker = await connect(key)
  assert.equal((await migrateKanataSchema(kanataSchemaAdapter(worker.operation))).version, 3)
  await worker.operation.transaction(async tx => {
    for (const command of m2FixtureCommands(fixture)) await tx.execute(command.sql, command.parameters)
  })
  const wrong = randomBytes(32)
  try { await assert.rejects(connect(wrong), /QA_SQLCIPHER_FAILED/) }
  finally { wrong.fill(0) }
  assert.equal(await worker.call('plain-rejected'), true)
  checks.push('cipher-schema-wrong-key-and-plaintext-read-rejection')

  const repository = createKanataMessageRepository(worker.operation, tools)
  const rows = Array.from({ length: 50 }, (_, index) => ({
    ...sample, id: 'host-message-' + String(index).padStart(2, '0'), lifeSources: [], revision: 1, createdAt: 1001,
  }))
  await repository.insertBatch(rows)
  const recent = await repository.recent(scope)
  assert.equal(recent.messages.length, 50)
  assert.equal((await repository.older(scope, recent.cursor)).messages.length, 2)
  assert.equal((await repository.quote(scope, sample.id)).content, sample.content)
  assert.equal((await createKanataConversationRepository(worker.operation).get(scope)).id, scope.conversationId)
  await repository.setStatus(scope, rows[0].id, 1, 'stopped')
  await assert.rejects(repository.setStatus(scope, rows[0].id, 1, 'complete'), /REVISION_CONFLICT/)
  checks.push('repository-cas-quote-keyset')

  const faulted = createKanataMessageRepository({
    transaction: action => worker.operation.transaction(async tx => {
      const value = await action(tx)
      await tx.execute(fixtureWrites.deferredCommit, ['host-orphan', 'missing', 1, '{}', '{}', 'synthetic'])
      return value
    }),
  }, tools)
  await assert.rejects(faulted.revise(scope, sample.id, sample.revision, { content: '', deleted: true }), /QA_SQLCIPHER_FAILED/)
  assert.equal((await repository.get(scope, sample.id)).revision, sample.revision)
  checks.push('real-deferred-commit-rollback')

  const uncommitted = createKanataMessageRepository({
    transaction: async action => {
      await worker.tx.execute('BEGIN IMMEDIATE')
      return action(worker.tx)
    },
  }, tools)
  assert.equal((await uncommitted.revise(scope, sample.id, sample.revision, { content: '', deleted: true })).deleted, true)
  const killed = worker.child.kill('SIGKILL')
  assert.equal(killed, true)
  assert.equal((await worker.closed).signal, 'SIGKILL')
  worker = await connect(key)
  const reopened = createKanataMessageRepository(worker.operation, tools)
  assert.equal((await reopened.get(scope, sample.id)).revision, sample.revision)
  assert.equal((await worker.tx.query(auditInspection.memories, [scope.worldId]))[0].revision, 1)
  assert.equal((await worker.tx.query(auditInspection.messages, [scope.worldId])).length, 2)
  await reopened.revise(scope, sample.id, sample.revision, { content: '', deleted: true })
  assert.equal(await reopened.quote(scope, sample.id), null)
  const audits = await worker.tx.query(auditInspection.messages, [scope.worldId])
  const original = audits.find(row => row.id === 'message-audit-one')
  assert.equal(JSON.parse(original.previous_json).content, '（已删除的原始记录）')
  assert.deepEqual(JSON.parse(original.next_json).syntheticExtra, sample.syntheticExtra)
  assert.deepEqual(await worker.tx.query('PRAGMA foreign_key_check'), [])
  assert.deepEqual(await worker.tx.query('PRAGMA cipher_integrity_check'), [])
  assert.equal((await worker.tx.query('PRAGMA integrity_check'))[0].integrity_check, 'ok')
  checks.push('forced-process-termination-reopen-audit-derived-rollback-and-retry')
  console.log(JSON.stringify({
    status: 'PASS_HOST_REPOSITORY', ...worker.versions, host: process.platform, termination: 'Node child.kill(SIGKILL)',
    schemaSha256: fingerprint(KANATA_SCHEMA_MIGRATIONS), fixtureSha256: fingerprint(fixture), checks,
  }, null, 2))
} finally {
  clearTimeout(timeout)
  await worker?.close()
  key.fill(0)
  for (const child of children) child.kill('SIGKILL')
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 })
}
