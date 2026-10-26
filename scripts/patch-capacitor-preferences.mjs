import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export function patchPreferencesSource(source) {
  if (source.includes('return editor.commit();')) return source
  if (!source.includes('        editor.apply();')) throw new Error('Unsupported Preferences source; durability patch not applied')
  for (const name of ['set(String key, String value)', 'remove(String key)', 'clear()']) {
    source = source.replace(`public void ${name}`, `public boolean ${name}`)
  }
  source = source.replaceAll('        executeOperation(', '        return executeOperation(')
  return source.replace('private void executeOperation', 'private boolean executeOperation').replace('        editor.apply();', '        return editor.commit();')
}
export function patchPreferencesPlugin(source) {
  for (const invocation of ['preferences.set(key, value)', 'preferences.remove(key)', 'preferences.clear()']) {
    const replacement = `if (!${invocation}) {\n            call.reject("Failed to persist preferences");\n            return;\n        }`
    if (source.includes(replacement)) continue
    const original = `        ${invocation};`
    if (!source.includes(original)) throw new Error('Unsupported PreferencesPlugin source; durability patch not applied')
    source = source.replace(original, `        ${replacement}`)
  }
  return source
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = new URL('../node_modules/@capacitor/preferences/android/src/main/java/com/capacitorjs/plugins/preferences/', import.meta.url)
  for (const [name, patch] of [['Preferences.java', patchPreferencesSource], ['PreferencesPlugin.java', patchPreferencesPlugin]]) {
    const path = new URL(name, directory)
    const original = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n')
    const updated = patch(original)
    if (updated !== original) await writeFile(path, updated)
  }
  console.log('Preferences durable writes patch verified.')
}
