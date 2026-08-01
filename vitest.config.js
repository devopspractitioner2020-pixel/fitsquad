import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['{src,supabase,test}/**/*.{test,spec}.{js,jsx,ts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // The logic worth protecting: business rules, the edge-function
      // decisions, and the components that gate money-spending actions.
      include: [
        'src/lib/**',
        'src/components/**',
        'src/screens/**',
        'supabase/functions/**/logic.ts',
        'supabase/functions/**/prompt.ts',
      ],
      exclude: ['**/__tests__/**'],
    },
  },
})
