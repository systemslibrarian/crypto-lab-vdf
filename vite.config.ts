/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Served from a GitHub Pages project subpath; keep this in sync with the repo name.
export default defineConfig({
  base: '/crypto-lab-vdf/',
  test: {
    // Playwright specs live in e2e/ and must not be collected by vitest.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
