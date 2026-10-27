import assert from 'node:assert/strict'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, '../../..')
const manualPath = '架构接口与Agent开发说明书.md'
const reportPath = resolve(directory, 'verification-v2.json')
const documents = [manualPath, 'AGENTS.md', 'README.md', 'HANDOFF.md', 'memory-bank/development-context.md']
const results = { date: '2026-10-27', scope: 'Root manual relocation and documentation validation only; no business or device tests', documents, linksChecked: 0, javascriptExamplesChecked: 0, exampleLocalImportsChecked: 0, sourceSymbolsChecked: 0 }
const read = path => readFile(resolve(root, path), 'utf8')

for (const path of documents) {
  const content = await read(path)
  assert.ok(content.trim(), `Empty document: ${path}`)
  assert.equal((content.match(/^```/gm) || []).length % 2, 0, `Unbalanced code fences: ${path}`)
  for (const match of content.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '')
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue
    const localPath = decodeURIComponent(target.split('#')[0])
    const targetPath = resolve(dirname(resolve(root, path)), localPath)
    // This report is created only after every other check has succeeded.
    if (targetPath !== reportPath) {
      assert.ok((await stat(targetPath)).isFile(), `Broken link: ${path} -> ${target}`)
    }
    results.linksChecked += 1
  }
  for (const match of content.matchAll(/^```js\s*\n([\s\S]*?)^```/gm)) {
    const check = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: match[1], encoding: 'utf8', cwd: root })
    assert.equal(check.status, 0, `Invalid JS example in ${path}: ${check.stderr}`)
    for (const specifier of match[1].matchAll(/(?:from\s+|import\()\s*['"](\.[^'"]+)['"]/g)) {
      assert.ok((await stat(resolve(dirname(resolve(root, path)), specifier[1]))).isFile(), `Broken example import: ${path} -> ${specifier[1]}`)
      results.exampleLocalImportsChecked += 1
    }
    results.javascriptExamplesChecked += 1
  }
}

const symbols = {
  'src/application/moduleRegistry.js': ['createModuleRegistry', 'BACKUP_TYPE_OPTIONS'],
  'src/application/moduleLifecycle.js': ['createModuleLifecycle', 'createListenerScope'],
  'src/application/appNavigation.js': ['createAppNavigation', 'openModuleSettings', 'openGeneralSettingsSection'],
  'src/application/settingsModels.js': ['projectSettingsModel', 'SETTINGS_SECTION_FIELDS'],
  'src/platform/storage/preferences.js': ['createPreferenceStorage'],
  'src/platform/storage/preferenceRepository.js': ['createPreferenceRepository'],
  'src/platform/storage/storePersistence.js': ['createStorePersistence', 'assertReady', 'assertLoaded', 'canAutosave', 'retrySave', 'parseStoredJson'],
  'src/application/backupRegistry.js': ['createBackupRegistry', 'restoreAll', 'exportAll', 'singleExport', 'singleImport'],
  'src/application/restoreCoordinator.js': ['createRestoreCoordinator', 'retrySynchronization'],
  'src/application/fullBackupRuntime.js': ['createFullBackupRuntime', 'createFullBackupSnapshot', 'applyFullBackupSnapshot'],
  'src/services/fullBackup.js': ['FULL_BACKUP_VERSION = 12', 'buildFullBackupFromParts', 'fullBackupParts'],
  'src/application/protectedModules.js': ['createProtectedModuleRegistry', 'suspendPersistence'],
  'src/stores/protectedAccess.js': ['ensureModule', 'ensureModules', 'runOperation', 'reencryptors'],
  'src/platform/ai/client.js': ['createAIClient', 'streamAIChat', 'askAI'],
  'src/shared/date.js': ['formatLocalDate', 'parseLocalDate', 'addDays'],
  'src/features/todo/todoRepository.js': ['createTodoRepository', 'expectedRevision', 'attempt < 8'],
  'src/services/backNavigation.js': ['registerBackHandler', 'handled !== false']
}
for (const [path, names] of Object.entries(symbols)) {
  const source = await read(path)
  for (const name of names) {
    assert.ok(source.includes(name), `Documented symbol no longer found: ${path}: ${name}`)
    results.sourceSymbolsChecked += 1
  }
}

const ignoreProbes = [manualPath, 'output/manual-check-probe.apk', 'output/manual-check-probe.md', 'raw/manual-check-probe.json']
const ignoredResult = spawnSync('git', ['-c', 'core.quotepath=false', 'check-ignore', '--no-index', '--stdin'], { input: ignoreProbes.join('\n') + '\n', encoding: 'utf8', cwd: root })
assert.ok([0, 1].includes(ignoredResult.status), ignoredResult.stderr)
const ignored = new Set(ignoredResult.stdout.trim().split(/\r?\n/).filter(Boolean))
assert.equal(ignored.has(manualPath), false, 'Manual must be eligible for version control')
for (const path of ignoreProbes.slice(1)) assert.ok(ignored.has(path), `Generated/private file must remain ignored: ${path}`)
results.ignoreRules = { manualEligibleForTracking: true, otherOutputIgnored: true, rawIgnored: true, createdProbeFiles: false }
results.sourceSymbolCheckScope = 'Presence and manually reviewed signatures; not a runtime behavior test'
results.businessTestsRerun = false
results.deviceOperations = false
results.status = 'passed'
await writeFile(reportPath, JSON.stringify(results, null, 2) + '\n')
assert.ok((await stat(reportPath)).isFile())
console.log(JSON.stringify(results, null, 2))
