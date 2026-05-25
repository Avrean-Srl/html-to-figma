import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Browser mode (Playwright + Chromium) is required for parser tests because
// getComputedStyle, layout calc, and font metrics only work in a real
// browser. jsdom returns synthetic values that hide real bugs.
// See DECISIONS.md D2.
//
// Mapper tests will eventually run in Node with a mocked figma global —
// we'll split via projects/workspace when that arrives. For now everything
// runs in the browser.

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
      screenshotFailures: false
    },
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx']
  }
})
