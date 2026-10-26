// @ts-check
/** @param {import('./contracts').ModuleDescriptor[]} modules */
export function createModuleRegistry(modules) {
  /** @type {Map<string, Readonly<import('./contracts').ModuleDescriptor & { cache: boolean }>>} */
  const byId = new Map()
  for (const module of modules) {
    if (!module.id || byId.has(module.id) || !module.title || typeof module.loadView !== 'function') throw new Error('INVALID_MODULE_DESCRIPTOR')
    if ((module.settings && typeof module.settings !== 'string') || (module.access && module.cache && !module.name)) throw new Error('INVALID_MODULE_CAPABILITY')
    if (module.access && module.access !== 'protected') throw new Error('INVALID_MODULE_ACCESS')
    byId.set(module.id, Object.freeze({ cache: !module.access, ...module }))
  }
  const list = Object.freeze([...byId.values()])
  return Object.freeze({ list, get: (/** @type {string} */ id) => byId.get(id), has: (/** @type {string} */ id) => byId.has(id),
    settings: new Set(list.filter(m => m.settings).map(m => m.id)),
    menu: (/** @type {{warmHomeEnabled?: boolean}} */ context) => list.filter(m => !m.enabled || m.enabled(context)).map(m => ({ id: m.id, label: m.label || m.title, meta: m.meta, icon: m.icon })) })
}

export const moduleRegistry = createModuleRegistry([
  { id: 'home', title: '首页总览', meta: '今天', icon: 'House', name: 'HomeView', loadView: () => import('../components/HomeView.vue'),
    bindings: c => ({ chatUnreadCount: c.chatUnreadCount, showBiometricSetup: c.showBiometricSetup, isEnablingBiometric: c.isEnablingBiometric, onEnableBiometric: c.enableBiometricUnlock, onDismissBiometric: c.dismissBiometricSetup }) },
  { id: 'reports', title: '月度报告', meta: '回顾', icon: 'ChartNoAxesColumn', name: 'MonthlyReportView', loadView: () => import('../components/MonthlyReportView.vue') },
  { id: 'debts', backup: { id: 'savings', label: '省钱数据', prefix: 'Savings' }, title: '我的省钱计划', label: '省钱计划', meta: '目标', icon: 'Wallet', name: 'DebtListView', settings: '管理计划分组、目标回顾提醒与 AI 个性化鼓励。', loadView: () => import('../features/savings/DebtListView.vue') },
  { id: 'weight', backup: { id: 'weight', label: '体重数据', prefix: 'Weight' }, title: '体重记录', meta: '健康', icon: 'Scale', name: 'WeightView', settings: '管理健康参数、变化提醒与每日记录提醒。', loadView: () => import('../features/weight/WeightView.vue') },
  { id: 'mood', backup: { id: 'mood', label: '心情数据', prefix: 'Mood' }, title: '心情日记', meta: '感受', icon: 'Heart', name: 'MoodView', settings: '管理心情等级、自定义标签与每日关怀提醒。', loadView: () => import('../features/mood/MoodView.vue') },
  { id: 'chat', backup: { id: 'chat', label: '温馨小家数据', prefix: 'WarmHome' }, title: '温馨小家', meta: '陪伴', icon: 'HouseHeart', name: 'ChatView', access: 'protected', cache: true, settings: '管理女朋友名字、记忆和聊天数据。', enabled: c => c.warmHomeEnabled !== false,
    loadView: () => import('../features/chat/ChatView.vue'), bindings: c => ({ isVisible: c.isVisible }) },
  { id: 'todo', backup: { id: 'todos', label: '每日待办数据', prefix: 'Todos' }, title: '每日待办', meta: '计划', icon: 'ListChecks', name: 'TodoView', loadView: () => import('../features/todo/TodoView.vue') },
  { id: 'schedule', backup: { id: 'schedules', label: '日程数据', prefix: 'Schedules' }, title: '日程提醒', meta: '安排', icon: 'CalendarDays', name: 'ScheduleView', settings: '管理日程标签、颜色和分类规则。', loadView: () => import('../features/schedule/ScheduleView.vue') },
  { id: 'passwords', backup: { id: 'passwords', label: '密码库数据', prefix: 'Passwords' }, title: '我的密码库', label: '密码库', meta: '安全', icon: 'LockKeyhole', name: 'PasswordVaultView', access: 'protected', settings: '管理密码分类；主密码仍在通用配置中管理。', loadView: () => import('../features/vault/PasswordVaultView.vue') },
  { id: 'settings', title: '通用配置', meta: '设置', icon: 'SlidersHorizontal', name: 'SettingsView', cache: false, loadView: () => import('../components/SettingsView.vue') }
])

export const BACKUP_TYPE_OPTIONS = Object.freeze([{ value: 'full', label: '完整数据（全部数据与设置）' },
  ...moduleRegistry.list.flatMap(m => m.backup ? [{ value: m.backup.id, label: m.backup.label }] : [])])
