import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname) } },
  esbuild: { jsx: 'automatic' },
  test: {
    maxWorkers: 4,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./tests/setup.ts'],
          globals: true,
        },
      },
      {
        extends: true,
        test: { name: 'postgresql', include: ['tests/integration/**/*.test.ts'] },
      },
    ],
  },
})
