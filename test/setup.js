import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// The Supabase client is constructed at module load from import.meta.env.
// Provide values so importing src/lib/supabase.js never warns or throws.
process.env.VITE_SUPABASE_URL ??= 'https://test.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ??= 'test-anon-key'

// jsdom has no crypto.randomUUID in older versions, and no object URLs.
if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = { ...globalThis.crypto, randomUUID: () => 'test-uuid-0000' }
}
globalThis.URL.createObjectURL ??= () => 'blob:mock'
globalThis.URL.revokeObjectURL ??= () => {}

// Recharts measures its container; jsdom reports 0x0, which makes charts
// render nothing and emit width/height warnings. Give it a real box.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom does not implement scrollIntoView; components that call it after a
// tab change would otherwise throw in tests but work fine in a browser.
globalThis.Element.prototype.scrollIntoView ??= function scrollIntoView() {}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})
