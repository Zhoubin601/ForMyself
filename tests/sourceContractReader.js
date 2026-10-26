import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const sourceRoot = join(process.cwd(), 'src')

const readDirectory = directory => readdirSync(directory, { withFileTypes: true })
  .filter(entry => entry.isFile() && /\.(?:js|vue|css)$/.test(entry.name))
  .map(entry => readFileSync(join(directory, entry.name), 'utf8'))
  .join('\n')

export function readSourceContract(path) {
  const relocated = { 'components/WeightView.vue': 'features/weight/WeightView.vue', 'components/DebtListView.vue': 'features/savings/DebtListView.vue',
    'components/PasswordVaultView.vue': 'features/vault/PasswordVaultView.vue', 'stores/weight.js': 'features/weight/weightStore.js',
    'stores/debt.js': 'features/savings/savingsStore.js', 'stores/passwordVault.js': 'features/vault/vaultStore.js',
    'services/aiEngine.js': 'platform/ai/client.js', 'features/chat/companionPrompts.js': 'application/companionContext.js' }
  const source = readFileSync(join(sourceRoot, relocated[path] || path), 'utf8')
  if (path === 'features/chat/ChatView.vue') return [source, readFileSync(join(sourceRoot, 'features/chat/chat.css'), 'utf8'),
    ...['ChatComposer.vue', 'ChatTimeline.vue', 'ChatMessageActions.vue'].map(name => readFileSync(join(sourceRoot, 'features/chat', name), 'utf8'))].join('\n')
  if (path === 'components/HomeView.vue') return [source, ...['home.css', 'HomeTodayCards.vue', 'HomeScheduleCard.vue'].map(name => readFileSync(join(sourceRoot, 'components', name), 'utf8'))].join('\n')
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
