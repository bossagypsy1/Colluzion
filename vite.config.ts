import { defineConfig } from 'vite';

// Relative base so the build works from any path (GitHub Pages project URL, a
// Capacitor WebView, or a local file server) without reconfiguration.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    // mediabunny is most of the bundle; split it out once load time matters.
    chunkSizeWarningLimit: 800,
  },
  worker: {
    format: 'es',
  },
});
