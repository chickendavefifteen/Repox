import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Plugin: copy data/ into public/data/ before build so GitHub Pages serves it
function copyDataPlugin() {
  return {
    name: 'copy-data',
    buildStart() {
      const src = resolve(__dirname, 'data');
      const dest = resolve(__dirname, 'public', 'data');
      if (existsSync(src)) {
        mkdirSync(dest, { recursive: true });
        cpSync(src, dest, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyDataPlugin()],

  // Base URL for GitHub Pages:
  // - In CI, VITE_BASE_PATH is set to /<repo-name>/ by the deploy workflow
  // - Locally it defaults to '/' so `npm run dev` just works
  base: process.env.VITE_BASE_PATH || '/',

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },

  // Serve data/ JSON files at /data/ during development
  publicDir: 'public',
});
