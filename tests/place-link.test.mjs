import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaceLink, parsePlaceLink, normalizePlace } from '../src/place-link.ts';

test('place links round-trip the selected coordinates, every area size, and Russian names', () => {
  for (const size of [600, 1200, 1800]) {
    const place = { lat:54.7261409, lon:55.947499, size, name:'Уфа · центр / парк + река & двор' };
    const url = new URL(createPlaceLink(place));
    assert.equal(url.origin,'https://city.xedoc.ru'); assert.equal(url.search,'');
    assert.deepEqual(parsePlaceLink(url.hash),{kind:'place',place:normalizePlace(place)});
    assert.equal(parsePlaceLink(url.hash).place.lat,54.72614); assert.equal(parsePlaceLink(url.hash).place.lon,55.9475);
  }
});
test('southern and western coordinates, equator and supported map boundaries remain valid', () => {
  for (const [lat,lon] of [[-33.8688,151.2093],[40.7128,-74.006],[0,0],[80,179.9],[-80,-179.9]]) {
    const place={lat,lon,size:600,name:'Место'};assert.deepEqual(parsePlaceLink(new URL(createPlaceLink(place)).hash),{kind:'place',place});
  }
});
test('unrelated fragments do not start an import; broken and ambiguous map links are rejected', () => {
  for(const hash of ['', '#', '#help'])assert.equal(parsePlaceLink(hash).kind,'none');
  for(const hash of ['#map=real','#map=other&v=1&lat=0&lon=0&size=600','#map=real&v=2&lat=0&lon=0&size=600','#map=real&v=1&lat=&lon=0&size=600','#map=real&v=1&lat=1&lat=2&lon=0&size=600','#map=real&v=1&lat=NaN&lon=0&size=600','#map=real&v=1&lat=Infinity&lon=0&size=600','#map=real&v=1&lat=81&lon=0&size=600','#map=real&v=1&lat=0&lon=180&size=600','#map=real&v=1&lat=0&lon=0&size=10000','#map=real&v=1&lat=0&lon=0&size=600&name='+ 'x'.repeat(2100)])assert.equal(parsePlaceLink(hash).kind,'invalid',hash);
});
test('names cannot inject extra URL parameters or replace the trusted destination', () => {
  const name='<img src=x onerror=alert(1)> &size=10000 #map=other https://example.com';
  const url=new URL(createPlaceLink({lat:0,lon:0,size:600,name})), result=parsePlaceLink(url.hash);
  assert.equal(url.hostname,'city.xedoc.ru');assert.equal(result.kind,'place');assert.equal(result.place.size,600);assert.equal(result.place.name,name);
  assert.equal(new URLSearchParams(url.hash.slice(1)).getAll('size').length,1);
});
test('names are bounded, control characters are removed and absent names have a usable fallback', () => {
  assert.equal(normalizePlace({lat:0,lon:0,size:600,name:'  \nУфа\u0000  '}).name,'Уфа');
  assert.equal(Array.from(normalizePlace({lat:0,lon:0,size:600,name:'🌍'.repeat(200)}).name).length,120);
  assert.equal(parsePlaceLink('#map=real&v=1&lat=0&lon=0&size=600').place.name,'Выбранное место');
});
