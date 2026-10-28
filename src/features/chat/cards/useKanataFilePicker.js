import { onBeforeUnmount, ref } from 'vue'
import { withNativeActivityGuard } from '../../../services/nativeActivityGuard.js'

// A native chooser may background the app. Guard only the chooser's own lifetime;
// disposal/cancel resolves it and never retains the selected private File object.
export function useKanataFilePicker() {
  const input = ref(null)
  let pending = null
  const finish = file => {
    const resolve = pending; pending = null
    if (input.value) input.value.value = ''
    resolve?.(file)
  }
  const choose = () => withNativeActivityGuard(() => new Promise(resolve => {
    finish(null); pending = resolve
    if (input.value) input.value.click()
    else finish(null)
  }))
  const onChange = event => finish(event.target.files?.[0] || null)
  const onCancel = () => finish(null)
  onBeforeUnmount(() => finish(null))
  return { input, choose, onChange, onCancel }
}
