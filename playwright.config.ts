import { defineConfig } from '@playwright/test';

// E2E_BASE_URL runs the suite against a deployed copy instead of the local preview.
const remote = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: remote ?? 'http://localhost:4173',
    channel: 'chrome',
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  },
  webServer: remote
    ? undefined
    : {
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
