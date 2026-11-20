import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/pokemon-battle-draft-v2/',
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) } },
  // shared/ lives outside this package; allow the dev server to serve it.
  server: { fs: { allow: ['..'] } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], vrm: ['@pixiv/three-vrm'], react: ['react', 'react-dom'] },
      },
    },
  },
});
