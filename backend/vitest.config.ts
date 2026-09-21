import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./vitest.global-setup.ts'],
    // Each test file gets its own database, so files can run in parallel.
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
