import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'chrome',
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
  },
  projects: [
    { name: '360x640', use: { viewport: { width: 360, height: 640 } } },
    { name: '390x844', use: { viewport: { width: 390, height: 844 } } },
    { name: '430x932', use: { viewport: { width: 430, height: 932 } } },
  ],
});
