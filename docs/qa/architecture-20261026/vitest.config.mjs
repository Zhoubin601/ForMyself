import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['docs/qa/architecture-20261026/storage-faults.spec.js'],
    environment: 'node',
    clearMocks: true
  }
})
