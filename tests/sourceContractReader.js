import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const sourceRoot = join(process.cwd(), 'src')

const readDirectory = directory => readdirSync(directory, { withFileTypes: true })
  .filter(entry => entry.isFile() && /\.(?:js|vue|css)$/.test(entry.name))
  .map(entry => readFileSync(join(directory, entry.name), 'utf8'))
  .join('\n')

export function readSourceContract(path) {
  const source = readFileSync(join(sourceRoot, path), 'utf8')
  if (path === 'App.vue') {
    return [
      source,
      readFileSync(join(sourceRoot, 'composables', 'useAppController.js'), 'utf8'),
      readFileSync(join(sourceRoot, 'styles', 'app.css'), 'utf8')
    ].join('\n')
  }
  if (path === 'components/SettingsView.vue') {
    return [
      source,
      readDirectory(join(sourceRoot, 'components', 'settings')),
      readDirectory(join(sourceRoot, 'composables', 'settings')),
      readFileSync(join(sourceRoot, 'styles', 'settings.css'), 'utf8')
    ].join('\n')
  }
  if (path === 'stores/settings.js') {
    return [source, readFileSync(join(sourceRoot, 'platform', 'storage', 'keys.js'), 'utf8')].join('\n')
  }
  return source
}
