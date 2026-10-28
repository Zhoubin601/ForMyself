// Explicit test-only second entry. npm run build never includes the native harness.
import { build } from 'vite'
import { resolve } from 'node:path'

await build({
  build: {
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        app: resolve('index.html'),
        kanataQA: resolve('docs/qa/kanata-local-20261028/native-harness.js')
      }
    }
  }
})
