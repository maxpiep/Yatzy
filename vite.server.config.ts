import { defineConfig } from 'vite';

// Baut den eigenen Kniffel-Club-Server (server/index.ts) als Node-ESM-Bundle nach dist-server/.
export default defineConfig({
  build: {
    ssr: 'server/index.ts',
    outDir: 'dist-server',
    target: 'node20',
    emptyOutDir: true,
    sourcemap: true,
  },
});
