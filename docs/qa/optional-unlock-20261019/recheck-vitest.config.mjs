import { defineConfig } from 'vitest/config'

export default defineConfig({ test: {
  include: ['docs/qa/optional-unlock-20261019/recheck.spec.js'],
  environment: 'jsdom', clearMocks: true
} })
