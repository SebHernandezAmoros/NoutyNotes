import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'tests/contracts/**/*.test.ts', 'tests/integration/**/*.test.ts'],
  },
});
