export interface CompletionUsage { promptTokens: number; completionTokens: number; cacheHitTokens: number | null }
export interface CompletionAttempt {
  id: string; model: string; officialProvider: boolean; startedAt: number; finishedAt: number | null
  transport: 'stream' | 'json'; status: 'pending' | 'succeeded' | 'failed'
  errorCode: string; finishReason: string; usage: CompletionUsage | null
  estimatedInputTokens: number; estimatedOutputTokens: number
}
export interface CompletionOptions {
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  signal?: AbortSignal; stream?: boolean; maxTokens?: number; timeoutMs?: number
  onDelta?: (content: string) => void
  onAttempt: (attempt: CompletionAttempt) => Promise<unknown>
}
export interface CompletionRuntime { endpoint: string; apiKey: string; model: string }
