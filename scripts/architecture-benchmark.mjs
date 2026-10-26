import { performance } from 'node:perf_hooks'
import { writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildFullBackupSnapshot, normalizeFullBackupSnapshot } from '../src/services/fullBackup.js'
import { normalizeTodoData, getTodoDay } from '../src/features/todo/todoCore.js'

const sizes = [100, 10000]
const results = []
for (const size of sizes) {
  const weights = Array.from({ length: size }, (_, i) => ({ id: `w-${i}`, date: '2026-10-26', weight: 60 + i % 20, note: 'Synthetic benchmark' }))
  const tasks = Array.from({ length: size }, (_, i) => ({ id: `t-${i}`, title: `Synthetic ${i}`, startDate: '2026-10-01', recurrence: { type: 'daily' } }))
  const samples = []
  let jsonBytes = 0
  for (let run = 0; run < 4; run++) {
    globalThis.gc?.()
    const before = process.memoryUsage().heapUsed, start = performance.now()
    const encoded = JSON.stringify(buildFullBackupSnapshot({ weight: weights }))
    const restored = normalizeFullBackupSnapshot(JSON.parse(encoded))
    const todos = getTodoDay(normalizeTodoData({ tasks }), '2026-10-26')
    if (restored.data.weight.length !== size || todos.length !== size) throw new Error('BENCHMARK_DATA_LOSS')
    jsonBytes = Buffer.byteLength(encoded)
    if (run) samples.push({ ms: performance.now() - start, heapDeltaBytes: Math.max(0, process.memoryUsage().heapUsed - before) })
  }
  const median = key => [...samples].sort((a, b) => a[key] - b[key])[1][key]
  results.push({ size, jsonBytes, samples, medianMs: median('ms'), medianHeapDeltaBytes: median('heapDeltaBytes') })
}
const assets = readdirSync('dist/assets').filter(name => name.endsWith('.js'))
const bundleBytes = assets.reduce((sum, name) => sum + readFileSync(join('dist/assets', name)).byteLength, 0)
const report = { node: process.version, platform: process.platform, cpuArchitecture: process.arch,
  scope: 'Actual domain backup encode/decode and Todo generation; synthetic in-process data. Not native startup, disk durability or UI memory.',
  results, productionJavaScriptBytes: bundleBytes }
const destination = process.argv[2]
if (!destination) throw new Error('Expected report path')
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ destination, results: results.map(({ size, medianMs, medianHeapDeltaBytes }) => ({ size, medianMs, medianHeapDeltaBytes })), productionJavaScriptBytes: bundleBytes }))
