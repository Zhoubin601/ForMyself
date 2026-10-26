import test from 'node:test'
import assert from 'node:assert/strict'
import { patchPreferencesSource, patchPreferencesPlugin } from '../scripts/patch-capacitor-preferences.mjs'

test('Preferences durability patch returns commit status and is idempotent', () => {
  const source = 'public void set(String key, String value) {\n        executeOperation(op);\n}\npublic void remove(String key) {\n        executeOperation(op);\n}\npublic void clear() {\n        executeOperation(op);\n}\nprivate void executeOperation() {\n        editor.apply();\n}'
  const result = patchPreferencesSource(source)
  assert.match(result, /public boolean set/); assert.match(result, /return executeOperation/)
  assert.match(result, /return editor.commit\(\)/); assert.doesNotMatch(result, /editor.apply/)
  assert.equal(patchPreferencesSource(result), result)
})
test('Preferences bridge rejects failed disk commits for set, remove and clear', () => {
  const source = ['        preferences.set(key, value);', '        preferences.remove(key);', '        preferences.clear();'].join('\n')
  const result = patchPreferencesPlugin(source)
  assert.equal((result.match(/call.reject/g) || []).length, 3)
  assert.equal(patchPreferencesPlugin(result), result)
  assert.throws(() => patchPreferencesPlugin('unsupported'), /Unsupported/)
  assert.throws(() => patchPreferencesSource('unsupported'), /Unsupported/)
})
