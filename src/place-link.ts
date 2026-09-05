import { REAL_MAP_SIZES } from '../server/map-limits.mjs';
export type SharedPlace = { lat: number; lon: number; size: number; name: string };
export type PlaceLink = { kind: 'none' } | { kind: 'invalid' } | { kind: 'place'; place: SharedPlace };
const KEYS = ['map', 'v', 'lat', 'lon', 'size', 'name'];

export function normalizePlace(place: SharedPlace): SharedPlace {
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon) || Math.abs(place.lat) > 80 || Math.abs(place.lon) > 179.9 || !REAL_MAP_SIZES.includes(place.size)) throw new Error('Некорректные параметры участка.');
  const name = Array.from(place.name.replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, 120).join('') || 'Выбранное место';
  return { lat: Number(place.lat.toFixed(5)), lon: Number(place.lon.toFixed(5)), size: place.size, name };
}

export function createPlaceLink(place: SharedPlace) {
  const p = normalizePlace(place), url = new URL('https://city.xedoc.ru/');
  url.hash = new URLSearchParams({ map: 'real', v: '1', lat: p.lat.toFixed(5), lon: p.lon.toFixed(5), size: String(p.size), name: p.name }).toString();
  return url.href;
}

export function parsePlaceLink(hash: string): PlaceLink {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('map')) return { kind: 'none' };
  if (hash.length > 2048 || params.get('map') !== 'real' || params.get('v') !== '1' || KEYS.some(key => params.getAll(key).length > 1)) return { kind: 'invalid' };
  if (!['lat', 'lon', 'size'].every(key => params.has(key) && params.get(key)!.trim())) return { kind: 'invalid' };
  try { return { kind: 'place', place: normalizePlace({ lat: Number(params.get('lat')), lon: Number(params.get('lon')), size: Number(params.get('size')), name: params.get('name') || 'Выбранное место' }) }; }
  catch { return { kind: 'invalid' }; }
}
