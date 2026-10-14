import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'src/client',
  // Vite 8 transforms with oxc; keep the esbuild key too for older toolchains.
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        tv: resolve(import.meta.dirname, 'src/client/index.html'),
        play: resolve(import.meta.dirname, 'src/client/play.html'),
      },
    },
  },
  test: {
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
