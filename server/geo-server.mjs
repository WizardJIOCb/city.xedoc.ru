import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REAL_MAP_SIZES } from './map-limits.mjs';

const AGENT = 'CrushCity/0.5 (+https://city.xedoc.ru; https://github.com/WizardJIOCb/city.xedoc.ru)';
const MAX_BYTES = 128 * 1024 * 1024;
export function parseArea(params) {
  if (!['lat', 'lon', 'size'].every(key => params.has(key) && params.get(key).trim())) throw new Error('Укажите координаты и размер участка.');
  const lat = Number(params.get('lat')), lon = Number(params.get('lon')), size = Number(params.get('size'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 80 || Math.abs(lon) > 179.9 || !REAL_MAP_SIZES.includes(size)) throw new Error('Некорректные координаты или размер участка.');
  return { lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)), size };
}
export function areaQuery({ lat, lon, size }) {
  const dy = (size / 2 + 120) / 111320, dx = dy / Math.cos(lat * Math.PI / 180);
  const box = [lat - dy, lon - dx, lat + dy, lon + dx].map(n => n.toFixed(6)).join(',');
  const roads = size > 3000 ? '[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]' : '[highway]';
  const trees = size > 3000 ? '' : `node[natural=tree](${box});`;
  if (size > 1800) {
    // Derived ways retain every coordinate but omit node IDs and unused tags.
    // Relations stay in native OSM format to preserve multipolygon hole roles.
    const tags = ['building', 'height', 'building:levels', 'highway', 'width', 'lanes', 'bridge', 'layer', 'tunnel', 'natural', 'waterway', 'landuse', 'leisure'];
    return `[out:json][timeout:60][maxsize:268435456];(way[building](${box});way${roads}(${box});way[natural~"^(water|coastline|wood)$"](${box});way[waterway](${box});way[landuse~"^(forest|grass|meadow|recreation_ground)$"](${box});way[leisure~"^(park|garden)$"](${box}););convert cc_way ::id=id(),::geom=geom(),${tags.map(tag => `"${tag}"=t["${tag}"]`).join(',')};out geom;(relation[building](${box});relation[natural~"^(water|wood)$"](${box});relation[waterway=riverbank](${box});${trees});out geom;`;
  }
  return `[out:json][timeout:60][maxsize:268435456];(way[building](${box});relation[building](${box});way${roads}(${box});way[natural~"^(water|coastline|wood)$"](${box});relation[natural~"^(water|wood)$"](${box});way[waterway](${box});relation[waterway=riverbank](${box});way[landuse~"^(forest|grass|meadow|recreation_ground)$"](${box});way[leisure~"^(park|garden)$"](${box});${trees});out geom;`;
}

async function fetchJSON(url, init = {}, request = fetch) {
  const response = await request(url, { ...init, headers: { 'User-Agent': AGENT, ...init.headers }, signal: AbortSignal.timeout(75000) });
  if (!response.ok) throw new Error(`Источник карты временно недоступен (HTTP ${response.status}). Попробуйте позже или выберите меньший участок.`);
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Слишком много данных. Выберите меньший участок.');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) throw new Error('Слишком много данных. Выберите меньший участок.'); chunks.push(value); } }
  catch (error) { await reader.cancel(); throw error; }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createGeoHandler({ cacheDir = process.env.GEO_CACHE_DIR || resolve('work/geo-cache'), request = fetch,
  overpass = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  geocoder = process.env.GEOCODER_URL || 'https://photon.komoot.io/api/' } = {}) {
  const pending = new Map(), requests = new Map(); let nextSearch = 0, nextArea = 0, busyArea = false, largeTransfer = false;
  async function cached(key, ttl, load) {
    const file = join(cacheDir, createHash('sha256').update(key).digest('hex') + '.json');
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      try { const cached = JSON.parse(await readFile(file, 'utf8')); if (Date.now() - cached.at < ttl) return cached.value; } catch { /* Cache misses are normal. */ }
      const value = await load(); await mkdir(cacheDir, { recursive: true });
      await writeFile(file, JSON.stringify({ at: Date.now(), value }));
      const files = await readdir(cacheDir); const entries = (await Promise.all(files.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => { try { return { name, ...(await stat(join(cacheDir, name))) }; } catch { return null; } }))).filter(Boolean);
      entries.sort((a, b) => b.mtimeMs - a.mtimeMs); let bytes = 0;
      for (let i = 0; i < entries.length; i++) { bytes += entries[i].size; if (i >= 100 || bytes > 128 * 1024 * 1024) await unlink(join(cacheDir, entries[i].name)).catch(() => {}); }
      return value;
    })(); pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  return async function handle(req, res) {
    const send = (status, value, cache = 'no-store') => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    if (req.method !== 'GET') return send(405, { error: 'Разрешены только GET-запросы.' });
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    if (route === '/api/geo/health') return send(200, { ok: true });
    if (route === '/api/geo/config') return send(200, { tiles: process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' }, 'public, max-age=300');
    if (!['/api/geo/search', '/api/geo/area'].includes(route)) return send(404, { error: 'Неизвестный запрос.' });
    const now = Date.now(), ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
    for (const [key, value] of requests) if (now - value.at > 60000) requests.delete(key);
    const quota = requests.get(ip) || { at: now, count: 0 }; requests.set(ip, quota);
    if (++quota.count > 30 || requests.size > 5000) return send(429, { error: 'Слишком много запросов. Подождите минуту.' });
    try {
      if (route.endsWith('/search')) {
        const q = url.searchParams.get('q')?.trim(); if (!q || q.length < 3 || q.length > 100) return send(400, { error: 'Введите от 3 до 100 символов.' });
        const result = await cached(`search:${q.toLowerCase()}`, 86400000, async () => {
          if (Date.now() < nextSearch) throw new Error('Поиск занят. Повторите через пару секунд.');
          nextSearch = Date.now() + 1200;
          const upstream = new URL(geocoder); upstream.searchParams.set('q', q); upstream.searchParams.set('limit', '6');
          const data = await fetchJSON(upstream, {}, request);
          return { results: (data.features ?? []).filter(f => f.geometry?.coordinates?.length >= 2).map(f => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], name: String(f.properties?.name || q), detail: [...new Set([f.properties?.city, f.properties?.state, f.properties?.country].filter(Boolean))].join(', ') })) };
        }); return send(200, result, 'public, max-age=3600');
      }
      let area; try { area = parseArea(url.searchParams); } catch (error) { return send(400, { error: error.message }); }
      if (area.size > 3000) {
        if (largeTransfer) return send(503, { error: 'Большая карта уже загружается. Повторите через несколько секунд.' });
        largeTransfer = true; let released = false; const release = () => { if (!released) { released = true; largeTransfer = false; } };
        res.once('finish', release); res.once('close', release);
      }
      const result = await cached(`area:${area.size > 1800 ? 'v2' : 'v1'}:${area.lat}:${area.lon}:${area.size}`, 7 * 86400000, async () => {
        if (busyArea || Date.now() < nextArea) throw new Error('Загрузка карты уже идёт. Повторите через несколько секунд.');
        busyArea = true; nextArea = Date.now() + 4000;
        try {
          const data = await fetchJSON(overpass, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: areaQuery(area) }) }, request);
          if (data.remark || !Array.isArray(data.elements)) throw new Error('Источник не успел собрать карту. Выберите меньший участок или попробуйте позже.');
          return { ...area, osm: data, fetchedAt: new Date().toISOString() };
        } finally { busyArea = false; }
      }); return send(200, result, 'public, max-age=3600');
    } catch (error) { return send(503, { error: error.name === 'TimeoutError' ? 'Источник карты не ответил вовремя. Попробуйте позже.' : error.message || 'Не удалось загрузить карту.' }); }
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const handler = createGeoHandler(); createServer((req, res) => { void handler(req, res); }).listen(Number(process.env.PORT || 5190), '127.0.0.1', () => console.log('Crush City map API ready'));
}
