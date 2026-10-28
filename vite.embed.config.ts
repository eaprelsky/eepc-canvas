import { defineConfig } from 'vite';

// Builds a single self-contained IIFE bundle exposing window.EepcCanvas,
// so any web app can embed the editor with one <script> tag.
export default defineConfig({
  build: {
    outDir: 'dist-embed',
    lib: {
      entry: 'src/embed.ts',
      name: 'EepcCanvas',
      formats: ['iife'],
      fileName: () => 'eepc-canvas.js',
    },
  },
});
