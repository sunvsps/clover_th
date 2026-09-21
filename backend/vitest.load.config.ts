import { defineConfig } from 'vitest/config';

// Load and soak tests: NOT part of `npm test`. Run with `npm run test:load` (SOAK_SECONDS=300 for the 5 minute soak).
export default defineConfig({
  test: {
    include: ['test/load/**/*.load.ts'],
    globalSetup: ['./vitest.global-setup.ts'],
    testTimeout: 15 * 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
