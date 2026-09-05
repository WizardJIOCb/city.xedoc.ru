import { defineConfig } from 'vite';
import { cp, mkdir } from 'node:fs/promises';
import { createGeoHandler } from './server/geo-server.mjs';

export default defineConfig({
  server: { watch: { ignored: ['**/work/**', '**/tests/**'] } },
  optimizeDeps: { include: ['leaflet', 'osmtogeojson', 'polygon-clipping', 'three/addons/utils/BufferGeometryUtils.js'] },
  plugins: [{
  name: 'real-map-api',
  configureServer(server) {
    const handler = createGeoHandler();
    server.middlewares.use((req, res, next) => { if (req.url?.startsWith('/api/geo/')) void handler(req, res); else next(); });
  },
  configurePreviewServer(server) {
    const handler = createGeoHandler();
    server.middlewares.use((req, res, next) => { if (req.url?.startsWith('/api/geo/')) void handler(req, res); else next(); });
  },
  async closeBundle() { await mkdir('dist/.server', { recursive: true }); await cp('server/geo-server.mjs', 'dist/.server/geo-server.mjs'); },
}] });
