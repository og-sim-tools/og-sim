import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileApi } from './src/server/vite-plugin';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), fileApi(root)],
  root: 'src/ui',
  // Relative asset paths: the built site works from any folder, e.g. https://<user>.github.io/<repo>/.
  base: './',
  publicDir: false,
  server: { port: 5173, strictPort: false, host: '127.0.0.1' },
  preview: { port: 4173, strictPort: false, host: '127.0.0.1' },
  // The engine, React and the bundled game data make one ~900 kB script (~330 kB gzipped); that's expected.
  build: { outDir: '../../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
