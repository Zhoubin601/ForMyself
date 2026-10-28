import { createAIClient } from '../platform/ai/client.js'
import { useSettingsStore } from '../stores/settings.js'

export const { askAI, streamAIChat, completeChat } = createAIClient(() => useSettingsStore())
