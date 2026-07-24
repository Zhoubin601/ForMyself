import { reactive } from 'vue'

const defaultDialog = () => ({
  open: false,
  kind: 'alert',
  tone: 'info',
  title: '',
  message: '',
  confirmText: '知道了',
  cancelText: '取消',
  destructive: false,
  inputValue: '',
  inputPlaceholder: '',
  options: []
})

export const uiFeedbackState = reactive({
  dialog: defaultDialog(),
  toasts: []
})

let activeResolver = null
let toastId = 0

const inferTone = message => {
  const text = String(message || '')
  if (/失败|错误|损坏|不匹配|未通过|不能|不合理/.test(text)) return 'danger'
  if (/成功|完成|已保存|已安排|已添加|已删除|已部署|已关闭|已复制/.test(text)) return 'success'
  if (/未开启|请先|请输入|请选择|尚未|提醒|留意/.test(text)) return 'warning'
  return 'info'
}

const inferTitle = (tone, kind) => {
  if (kind === 'confirm') return tone === 'danger' ? '确认删除' : '请确认'
  if (kind === 'choice') return '请选择'
  if (kind === 'prompt') return '补充信息'
  if (tone === 'success') return '操作完成'
  if (tone === 'danger') return '操作未完成'
  if (tone === 'warning') return '需要留意'
  return '温馨提示'
}

const openDialog = options => new Promise(resolve => {
  if (activeResolver) activeResolver(null)
  activeResolver = resolve
  const tone = options.tone || inferTone(options.message)
  Object.assign(uiFeedbackState.dialog, defaultDialog(), {
    ...options,
    open: true,
    tone,
    title: options.title || inferTitle(tone, options.kind)
  })
})

export const appAlert = (message, options = {}) => openDialog({
  kind: 'alert',
  message,
  confirmText: '知道了',
  ...options
})

export const appConfirm = (message, options = {}) => openDialog({
  kind: 'confirm',
  message,
  confirmText: options.destructive ? '确认删除' : '确认',
  cancelText: '取消',
  ...options
})

export const appPrompt = (message, defaultValue = '', options = {}) => openDialog({
  kind: 'prompt',
  message,
  inputValue: String(defaultValue ?? ''),
  inputPlaceholder: options.placeholder || '',
  confirmText: '确定',
  cancelText: '取消',
  ...options
})

export const appChoose = (options = {}) => openDialog({
  kind: 'choice',
  message: options.message || '',
  options: options.options || [],
  cancelText: '取消',
  ...options
})

export const resolveFeedbackDialog = value => {
  const resolve = activeResolver
  activeResolver = null
  uiFeedbackState.dialog.open = false
  resolve?.(value)
}

export const appToast = (message, options = {}) => {
  const id = ++toastId
  const toast = {
    id,
    message: String(message),
    tone: options.tone || inferTone(message),
    duration: options.duration || 2400
  }
  uiFeedbackState.toasts.push(toast)
  window.setTimeout(() => dismissToast(id), toast.duration)
  return id
}

export const dismissToast = id => {
  const index = uiFeedbackState.toasts.findIndex(item => item.id === id)
  if (index >= 0) uiFeedbackState.toasts.splice(index, 1)
}
