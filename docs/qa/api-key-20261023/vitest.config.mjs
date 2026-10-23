import { defineConfig } from 'vitest/config'

export default defineConfig({ test: {
  include: ['docs/qa/api-key-20261023/diagnosis.spec.js'],
  environment: 'jsdom', clearMocks: true
} })
