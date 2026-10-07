import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Го: первые шаги',
        short_name: 'Го',
        description: 'Короткие задачи по Го на доске 9×9 для начинающих',
        lang: 'ru',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#e2b866',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // The KataGo worker bundles TensorFlow.js.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Network weights and WASM binaries: downloaded once, then kept offline.
            urlPattern: ({ url }) => /\.(gz|wasm)$/.test(url.pathname) || url.pathname.includes('/models/'),
            handler: 'CacheFirst',
            options: { cacheName: 'katago', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2020' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
