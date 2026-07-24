<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  dismissToast,
  resolveFeedbackDialog,
  uiFeedbackState
} from '../services/uiFeedback'

const inputRef = ref(null)
const dialog = computed(() => uiFeedbackState.dialog)
const isInputDialog = computed(() => dialog.value.kind === 'prompt')
const hasCancel = computed(() => ['confirm', 'prompt', 'choice'].includes(dialog.value.kind))

const confirmDialog = () => {
  if (isInputDialog.value) resolveFeedbackDialog(dialog.value.inputValue)
  else resolveFeedbackDialog(true)
}

const cancelDialog = () => resolveFeedbackDialog(
  dialog.value.kind === 'confirm' ? false : null
)

const chooseOption = value => resolveFeedbackDialog(value)

const handleKeydown = event => {
  if (!dialog.value.open) return
  if (event.key === 'Escape' && hasCancel.value) cancelDialog()
  if (event.key === 'Enter' && dialog.value.kind === 'prompt') confirmDialog()
}

watch(() => dialog.value.open, async open => {
  if (open && isInputDialog.value) {
    await nextTick()
    inputRef.value?.focus()
    inputRef.value?.select()
  }
})

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="feedback-fade">
      <div v-if="dialog.open" class="feedback-overlay" role="presentation">
        <section
          class="feedback-card"
          :class="[`tone-${dialog.tone}`, { 'is-choice': dialog.kind === 'choice' }]"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`feedback-title-${dialog.kind}`"
          @click.stop
        >
          <div class="feedback-icon" aria-hidden="true">
            <svg v-if="dialog.tone === 'success'" viewBox="0 0 24 24">
              <path d="m6.7 12.4 3.25 3.2 7.35-7.4" />
            </svg>
            <svg v-else-if="dialog.tone === 'danger'" viewBox="0 0 24 24">
              <path d="M12 7.2v5.6m0 3.4h.01M12 3.25 21 19H3L12 3.25Z" />
            </svg>
            <svg v-else-if="dialog.tone === 'warning'" viewBox="0 0 24 24">
              <path d="M12 7.4v5.2m0 3.3h.01M12 3.4a8.6 8.6 0 1 1 0 17.2 8.6 8.6 0 0 1 0-17.2Z" />
            </svg>
            <svg v-else viewBox="0 0 24 24">
              <path d="M12 10.8v5.4m0-8.5h.01M12 3.4a8.6 8.6 0 1 1 0 17.2 8.6 8.6 0 0 1 0-17.2Z" />
            </svg>
          </div>

          <div class="feedback-copy">
            <p class="feedback-eyebrow">ForMyself</p>
            <h2 :id="`feedback-title-${dialog.kind}`">{{ dialog.title }}</h2>
            <p v-if="dialog.message" class="feedback-message">{{ dialog.message }}</p>
          </div>

          <input
            v-if="isInputDialog"
            ref="inputRef"
            v-model="dialog.inputValue"
            class="feedback-input"
            :placeholder="dialog.inputPlaceholder"
          />

          <div v-if="dialog.kind === 'choice'" class="feedback-options">
            <button
              v-for="option in dialog.options"
              :key="option.value"
              type="button"
              class="feedback-option"
              @click="chooseOption(option.value)"
            >
              <span class="feedback-option-icon">{{ option.icon || '·' }}</span>
              <span>
                <strong>{{ option.label }}</strong>
                <small v-if="option.description">{{ option.description }}</small>
              </span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            </button>
          </div>

          <div v-else class="feedback-actions">
            <button
              v-if="hasCancel"
              type="button"
              class="feedback-button feedback-cancel"
              @click="cancelDialog"
            >
              {{ dialog.cancelText }}
            </button>
            <button
              type="button"
              class="feedback-button feedback-confirm"
              :class="{ destructive: dialog.destructive }"
              @click="confirmDialog"
            >
              {{ dialog.confirmText }}
            </button>
          </div>

          <button
            v-if="dialog.kind === 'choice'"
            type="button"
            class="feedback-choice-cancel"
            @click="cancelDialog"
          >
            {{ dialog.cancelText }}
          </button>
        </section>
      </div>
    </Transition>

    <div class="toast-viewport" aria-live="polite" aria-atomic="true">
      <TransitionGroup name="toast-slide">
        <button
          v-for="toast in uiFeedbackState.toasts"
          :key="toast.id"
          type="button"
          class="app-toast"
          :class="`tone-${toast.tone}`"
          @click="dismissToast(toast.id)"
        >
          <span class="toast-dot"></span>
          <span>{{ toast.message }}</span>
        </button>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.feedback-overlay {
  position: fixed;
  inset: 0;
  z-index: 20000;
  display: grid;
  place-items: center;
  padding: max(22px, env(safe-area-inset-top)) 22px max(22px, env(safe-area-inset-bottom));
  background: rgba(16, 21, 34, .38);
  backdrop-filter: blur(14px) saturate(120%);
  -webkit-backdrop-filter: blur(14px) saturate(120%);
}
.feedback-card {
  width: min(100%, 390px);
  overflow: hidden;
  padding: 26px 22px 18px;
  border: 1px solid rgba(255, 255, 255, .9);
  border-radius: 26px;
  background:
    radial-gradient(circle at 12% 0%, rgba(54, 132, 255, .11), transparent 34%),
    rgba(255, 255, 255, .97);
  box-shadow: 0 26px 70px rgba(20, 31, 54, .24), 0 2px 8px rgba(20, 31, 54, .08);
  color: var(--ink, #1d1d1f);
}
.feedback-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 18px;
  border-radius: 16px;
  background: rgba(0, 102, 204, .1);
  color: var(--primary, #0066cc);
  box-shadow: inset 0 0 0 1px rgba(0, 102, 204, .08);
}
.feedback-icon svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.tone-success .feedback-icon { color: #23895d; background: #eaf8f1; box-shadow: inset 0 0 0 1px rgba(35, 137, 93, .08); }
.tone-warning .feedback-icon { color: #b36b12; background: #fff5e5; box-shadow: inset 0 0 0 1px rgba(179, 107, 18, .08); }
.tone-danger .feedback-icon { color: #c44343; background: #fff0ef; box-shadow: inset 0 0 0 1px rgba(196, 67, 67, .08); }
.feedback-eyebrow { margin: 0 0 5px; color: var(--primary, #0066cc); font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
.feedback-copy h2 { margin: 0; font-size: 23px; line-height: 1.2; letter-spacing: -.35px; }
.feedback-message { margin: 11px 0 0; color: #63656b; font-size: 15px; line-height: 1.62; white-space: pre-line; }
.feedback-input {
  width: 100%;
  margin-top: 19px;
  padding: 13px 15px;
  border: 1px solid #dfe3eb;
  border-radius: 14px;
  outline: 0;
  background: #f7f8fb;
  color: inherit;
  font: inherit;
}
.feedback-input:focus { border-color: var(--primary, #0066cc); box-shadow: 0 0 0 3px rgba(0, 102, 204, .12); background: #fff; }
.feedback-actions { display: flex; gap: 10px; margin-top: 24px; }
.feedback-button {
  min-height: 46px;
  flex: 1;
  border: 0;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 650;
  cursor: pointer;
}
.feedback-cancel { background: #f0f2f6; color: #51545b; }
.feedback-confirm { background: linear-gradient(135deg, #0878e6, #0060bf); color: #fff; box-shadow: 0 8px 20px rgba(0, 102, 204, .22); }
.feedback-confirm.destructive { background: linear-gradient(135deg, #e05555, #bd3535); box-shadow: 0 8px 20px rgba(189, 53, 53, .2); }
.feedback-button:active, .feedback-option:active { transform: scale(.98); }
.feedback-card.is-choice { padding-bottom: 12px; }
.feedback-options { display: flex; flex-direction: column; gap: 8px; margin-top: 20px; }
.feedback-option {
  display: grid;
  grid-template-columns: 38px 1fr 20px;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px;
  border: 1px solid #e9ebf0;
  border-radius: 15px;
  background: #f8f9fb;
  color: inherit;
  text-align: left;
  transition: transform .16s, border-color .16s, background .16s;
}
.feedback-option-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; background: #eaf3ff; color: var(--primary, #0066cc); font-weight: 700; }
.feedback-option strong, .feedback-option small { display: block; }
.feedback-option strong { font-size: 14px; }
.feedback-option small { margin-top: 3px; color: #85878d; font-size: 12px; }
.feedback-option > svg { width: 18px; fill: none; stroke: #a0a2a8; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.feedback-choice-cancel { width: 100%; margin-top: 10px; padding: 11px; border: 0; background: transparent; color: #777a82; font-size: 14px; }
.toast-viewport {
  position: fixed;
  z-index: 21000;
  top: max(18px, calc(env(safe-area-inset-top) + 10px));
  left: 50%;
  display: flex;
  width: min(calc(100% - 32px), 420px);
  flex-direction: column;
  gap: 9px;
  transform: translateX(-50%);
  pointer-events: none;
}
.app-toast {
  display: flex;
  align-items: center;
  align-self: center;
  gap: 10px;
  max-width: 100%;
  padding: 12px 16px;
  border: 1px solid rgba(255,255,255,.78);
  border-radius: 999px;
  background: rgba(33, 38, 49, .92);
  box-shadow: 0 12px 30px rgba(9, 14, 24, .22);
  color: #fff;
  font-size: 14px;
  line-height: 1.35;
  pointer-events: auto;
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
.toast-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: #70b7ff; box-shadow: 0 0 0 4px rgba(112,183,255,.14); }
.app-toast.tone-success .toast-dot { background: #62daa1; box-shadow: 0 0 0 4px rgba(98,218,161,.14); }
.app-toast.tone-warning .toast-dot { background: #ffc268; box-shadow: 0 0 0 4px rgba(255,194,104,.14); }
.app-toast.tone-danger .toast-dot { background: #ff7979; box-shadow: 0 0 0 4px rgba(255,121,121,.14); }
.feedback-fade-enter-active, .feedback-fade-leave-active { transition: opacity .2s ease; }
.feedback-fade-enter-active .feedback-card, .feedback-fade-leave-active .feedback-card { transition: transform .24s cubic-bezier(.2,.8,.2,1), opacity .2s ease; }
.feedback-fade-enter-from, .feedback-fade-leave-to { opacity: 0; }
.feedback-fade-enter-from .feedback-card { opacity: 0; transform: translateY(16px) scale(.97); }
.feedback-fade-leave-to .feedback-card { opacity: 0; transform: translateY(8px) scale(.98); }
.toast-slide-enter-active, .toast-slide-leave-active { transition: all .25s ease; }
.toast-slide-enter-from, .toast-slide-leave-to { opacity: 0; transform: translateY(-12px) scale(.96); }
@media (prefers-reduced-motion: reduce) {
  .feedback-fade-enter-active, .feedback-fade-leave-active,
  .feedback-fade-enter-active .feedback-card, .feedback-fade-leave-active .feedback-card,
  .toast-slide-enter-active, .toast-slide-leave-active { transition-duration: .01ms; }
}
</style>
