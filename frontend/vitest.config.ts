import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Unit and smoke tests: jsdom + Testing Library + MSW (see src/test/setup.ts).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
})
