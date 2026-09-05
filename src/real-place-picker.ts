import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { el } from './ui';
import type { RealMap, MapResponse } from './real-geometry';

type Place = { lat: number; lon: number; name: string; detail: string };
export class RealPlacePicker {
  private map: L.Map;
  private marker: L.CircleMarker;
  private area: L.Rectangle;
  private place: Place = { lat: 55.7513, lon: 37.6177, name: 'Москва', detail: '' };
  private controller?: AbortController;
  private searchController?: AbortController;
  private worker?: Worker;
  private busy = false;
  constructor(private onBuild: (map: RealMap) => Promise<boolean>) {
    this.map = L.map('real-map-picker', { center: [this.place.lat, this.place.lon], zoom: 15, minZoom: 2, maxZoom: 18, worldCopyJump: true });
    this.marker = L.circleMarker([this.place.lat, this.place.lon], { radius: 5, color: '#fff2d6', fillColor: '#e89559', fillOpacity: 1, weight: 2 }).addTo(this.map);
    this.area = L.rectangle([[0, 0], [0, 0]], { color: '#ec9f5e', fillColor: '#ffb474', fillOpacity: .14, weight: 2, interactive: false }).addTo(this.map);
    void fetch('/api/geo/config').then(r => r.ok ? r.json() : Promise.reject()).then(config => {
      L.tileLayer(config.tiles, { maxZoom: 19, keepBuffer: 0, updateWhenIdle: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(this.map).on('tileerror', () => this.message('Фон карты временно недоступен. Можно ввести координаты и построить участок.', true));
    }).catch(() => this.message('Не удалось загрузить фон карты. Можно указать координаты или обновить страницу.', true));
    this.map.on('click', event => { if (!this.busy) this.choose({ lat: event.latlng.lat, lon: event.latlng.wrap().lng, name: 'Выбранное место', detail: '' }, false); });
    el<HTMLSelectElement>('real-map-size').onchange = () => this.updateArea();
    el('real-search-form').onsubmit = event => { event.preventDefault(); void this.search(); };
    el('real-coordinates-form').onsubmit = event => {
      event.preventDefault(); const lat = Number(el<HTMLInputElement>('real-lat').value), lon = Number(el<HTMLInputElement>('real-lon').value);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 80 || Math.abs(lon) > 179.9) { this.message('Широта: от −80 до 80. Долгота: от −179,9 до 179,9.', true); return; }
      this.choose({ lat, lon, name: 'Выбранные координаты', detail: '' });
    };
    el('real-build').onclick = () => void this.build();
    el<HTMLDialogElement>('real-map-dialog').addEventListener('close', () => { this.controller?.abort(); this.searchController?.abort(); this.worker?.terminate(); this.worker = undefined; this.setBusy(false); });
    this.choose(this.place); this.setBusy(false);
  }
  open() { el<HTMLDialogElement>('real-map-dialog').showModal(); requestAnimationFrame(() => { this.map.invalidateSize(); this.updateArea(); }); }
  private message(text: string, error = false) { const status = el('real-map-message'); status.textContent = text; status.classList.toggle('error', error); }
  private choose(place: Place, pan = true) {
    this.place = place; el<HTMLInputElement>('real-lat').value = place.lat.toFixed(5); el<HTMLInputElement>('real-lon').value = place.lon.toFixed(5);
    el('real-place-name').textContent = place.name; this.marker.setLatLng([place.lat, place.lon]); this.updateArea();
    if (pan) this.map.setView([place.lat, place.lon], 15); this.message('Оранжевая рамка — граница игрового участка. Нажмите на карту, чтобы передвинуть её.');
  }
  private updateArea() {
    const size = Number(el<HTMLSelectElement>('real-map-size').value), dy = size / 2 / 111320, dx = dy / Math.cos(this.place.lat * Math.PI / 180);
    this.area.setBounds([[this.place.lat - dy, this.place.lon - dx], [this.place.lat + dy, this.place.lon + dx]]);
  }
  private async search() {
    this.searchController?.abort(); const controller = this.searchController = new AbortController();
    const q = el<HTMLInputElement>('real-search').value.trim(); if (q.length < 3) { this.message('Введите хотя бы 3 символа названия.', true); return; }
    this.message('Ищем место…'); el('real-search-results').replaceChildren();
    try {
      const response = await fetch('/api/geo/search?' + new URLSearchParams({ q }), { signal: controller.signal }); const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (controller.signal.aborted) return;
      for (const place of data.results as Place[]) {
        const button = document.createElement('button'), name = document.createElement('strong'), detail = document.createElement('small'); button.type = 'button'; name.textContent = place.name; detail.textContent = place.detail;
        button.append(name, detail); button.onclick = () => { this.choose(place); el('real-search-results').replaceChildren(); }; el('real-search-results').append(button);
      }
      this.message(data.results.length ? 'Выберите подходящее место из списка.' : 'Ничего не найдено. Уточните название или введите координаты.', !data.results.length);
    } catch (error) { if (!controller.signal.aborted) this.message(error instanceof Error ? error.message : 'Поиск недоступен.', true); }
  }
  private setBusy(value: boolean) {
    this.busy = value;
    if (value) el('real-search-results').replaceChildren();
    for (const id of ['real-build', 'real-map-size', 'real-search', 'real-lat', 'real-lon', 'real-search-button', 'real-coordinate-button']) (el(id) as HTMLButtonElement).disabled = value;
    el('real-build').textContent = value ? 'Загружаем и строим…' : 'Построить в игре';
  }
  private async build() {
    if (this.busy) return; this.setBusy(true); this.searchController?.abort();
    const controller = this.controller = new AbortController(), place = { ...this.place };
    this.message('Загружаем здания, улицы и водоёмы. Это может занять до 35 секунд…');
    try {
      const params = new URLSearchParams({ lat: String(place.lat), lon: String(place.lon), size: el<HTMLSelectElement>('real-map-size').value });
      const response = await fetch('/api/geo/area?' + params, { signal: controller.signal }); const data: MapResponse & { error?: string } = await response.json(); if (!response.ok) throw new Error(data.error);
      if (controller.signal.aborted) return;
      this.message('Данные получены. Собираем кварталы и контуры зданий…');
      const worker = this.worker = new Worker(new URL('./real-map.worker.ts', import.meta.url), { type: 'module' });
      const map = await new Promise<RealMap>((resolve, reject) => {
        worker.onmessage = event => event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.map);
        worker.onerror = () => reject(new Error('Не удалось обработать карту. Попробуйте меньший участок.'));
        controller.signal.addEventListener('abort', () => reject(new DOMException('Отменено', 'AbortError')), { once: true }); worker.postMessage({ data, name: place.name });
      });
      worker.terminate(); this.worker = undefined; if (controller.signal.aborted) return;
      if (!await this.onBuild(map)) throw new Error('Не удалось построить участок. Выберите меньший размер.');
      el<HTMLDialogElement>('real-map-dialog').close();
    } catch (error) { if (!controller.signal.aborted) this.message(error instanceof Error ? error.message : 'Не удалось построить участок.', true); }
    finally { if (this.controller === controller) { this.worker?.terminate(); this.worker = undefined; this.setBusy(false); } }
  }
}
