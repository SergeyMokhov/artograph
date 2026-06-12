import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build: inlines all JS/CSS into dist/index.html so the app can
// be opened directly via file:// (no server) or dropped on any static host.
export default defineConfig({
  // Relative asset URLs so the page works from file:// and under a
  // subpath like https://<user>.github.io/artograph/.
  base: './',
  plugins: [viteSingleFile()],
});
