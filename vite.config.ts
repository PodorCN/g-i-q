import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-research-api',
      configureServer(server) {
        server.middlewares.use('/api', (req, res, next) => {
          if (req.method !== 'GET') return next();
          const file = path.resolve('data/latest.json');
          if (!fs.existsSync(file)) {
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ error: 'Run npm run refresh to collect a snapshot.' }));
          }
          const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          if (req.url?.startsWith('/history'))
            return res.end(
              JSON.stringify({ snapshots: [{ id: snapshot.id, asOf: snapshot.asOf }] }),
            );
          if (req.url?.startsWith('/snapshot')) return res.end(JSON.stringify(snapshot));
          return next();
        });
      },
    },
  ],
  server: { host: '0.0.0.0', port: 5173 },
  build: { outDir: 'dist', sourcemap: true },
});
