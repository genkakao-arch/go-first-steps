import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  base: './',
  build: { target: 'es2020' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
