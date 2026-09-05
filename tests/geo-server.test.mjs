import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REAL_MAP_SIZES } from '../server/map-limits.mjs';
import { createGeoHandler, parseArea, areaQuery } from '../server/geo-server.mjs';

async function setup(t, request) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'crush-geo-test-'));
  const handler = createGeoHandler({ cacheDir, request });
  const server = createServer((req, res) => void handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(cacheDir, { recursive: true, force: true }); });
  return { cacheDir, get: (path, init) => fetch(`http://127.0.0.1:${server.address().port}/api/geo/${path}`, init) };
}
const area = 'area?lat=55.7513&lon=37.6177&size=600';
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('map requests require finite bounded coordinates and one of the allowed sizes up to 20 km', () => {
  for (const query of ['', 'lat=&lon=1&size=600', 'lat=Infinity&lon=1&size=600', 'lat=81&lon=1&size=600', 'lat=0&lon=180&size=600', 'lat=0&lon=0&size=30000', 'lat=NaN&lon=0&size=600']) assert.throws(() => parseArea(new URLSearchParams(query)));
  assert.deepEqual(parseArea(new URLSearchParams('lat=55.7513123&lon=37.6177004&size=1200')), { lat:55.75131, lon:37.6177, size:1200 });
  const query=areaQuery({lat:0,lon:0,size:600}); assert.match(query, /timeout:60/); assert.match(query,/maxsize:268435456/); assert.match(query,/out geom/);
  for (const size of REAL_MAP_SIZES) assert.equal(parseArea(new URLSearchParams(`lat=55&lon=37&size=${size}`)).size,size);
  const region=areaQuery({lat:55,lon:37,size:20000}); assert.match(region,/convert cc_way/); assert.match(region,/::geom=geom\(\)/); assert.match(region,/relation\[building\]/); assert.doesNotMatch(region,/out center|out bb/);
});
test('map API health/config work without upstream; invalid methods and paths are rejected', async t => {
  const {get}=await setup(t,()=>assert.fail('unexpected provider call'));
  assert.deepEqual(await (await get('health')).json(),{ok:true}); assert.match((await (await get('config')).json()).tiles,/openstreetmap/);
  assert.equal((await get('health',{method:'POST'})).status,405); assert.equal((await get('unknown')).status,404);
  assert.equal((await get('area?lat=0&lon=0&size=999')).status,400); assert.equal((await get('search?q=a')).status,400);
});
test('same-area concurrent requests share one upstream operation and cached results survive new handlers', async t => {
  let calls=0, release; const gate=new Promise(r=>release=r);
  const {get,cacheDir}=await setup(t,async (url,init)=>{calls++; assert.equal(init.method,'POST'); assert.match(init.headers['User-Agent'],/CrushCity/); assert.ok(init.signal); await gate; return json({elements:[]});});
  const first=get(area), second=get(area); setTimeout(release,30);
  const [a,b]=await Promise.all([first,second]); assert.equal(a.status,200); assert.deepEqual(await a.json(),await b.json()); assert.equal(calls,1);
  assert.equal((await get(area)).status,200); assert.equal(calls,1); assert.equal((await readdir(cacheDir)).length,1);
  const fresh=createGeoHandler({cacheDir,request:()=>assert.fail('disk cache missed')});
  let status,result; await fresh({method:'GET',url:'/api/geo/'+area,headers:{},socket:{remoteAddress:'test'}},{writeHead:s=>status=s,end:s=>result=JSON.parse(s)});
  assert.equal(status,200);assert.equal(result.size,600);
});
test('distinct simultaneous areas are throttled instead of multiplying provider traffic', async t => {
  let calls=0, release, entered; const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const {get}=await setup(t,async()=>{calls++;entered();await gate;return json({elements:[]})});
  const first=get(area); await started;
  const other=await get('area?lat=50&lon=30&size=600'); assert.equal(other.status,503); assert.match((await other.json()).error,/Загрузка/);
  release(); assert.equal((await first).status,200); assert.equal(calls,1);
});
test('geocoding encodes explicit searches, produces safe strings and caches case-insensitively',async t=>{
  let calls=0;
  const {get}=await setup(t,async url=>{calls++;assert.equal(url.searchParams.get('q'),'Уфа');return json({features:[{geometry:{coordinates:[55.9,54.7]},properties:{name:'Уфа',state:'Башкортостан',country:'Россия'}}]})});
  const result=await (await get('search?q='+encodeURIComponent('Уфа'))).json(); assert.equal(result.results[0].name,'Уфа'); assert.equal(result.results[0].lat,54.7);
  assert.equal((await get('search?q='+encodeURIComponent('уфа'))).status,200); assert.equal(calls,1);
});

test('large maps limit concurrent transfers and release the slot after completion',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const {get}=await setup(t,async()=>{entered();await gate;return json({elements:[]})});
 const request='area?lat=55&lon=37&size=20000',first=get(request);await started;
 const blocked=await get(request);assert.equal(blocked.status,503);assert.match((await blocked.json()).error,/Большая карта/);
 assert.equal((await get('health')).status,200);release();assert.equal((await first).status,200);
 assert.equal((await get(request)).status,200);
});
test('partial, oversized, failed and timed-out upstream replies never become playable cached maps',async t=>{
  for(const reply of [()=>json({remark:'runtime error',elements:[]}),()=>new Response('',{status:429}),()=>new Response('{}',{headers:{'content-length':String(129*1024*1024)}}),()=>{throw new DOMException('timeout','TimeoutError')}]){
    const {get,cacheDir}=await setup(t,reply); const result=await get(area); assert.equal(result.status,503);assert.ok((await result.json()).error);assert.equal((await readdir(cacheDir)).length,0);
  }
});
test('streamed provider payload is bounded even without a Content-Length header',async t=>{
  const {get}=await setup(t,()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(129*1024*1024));controller.close()}})));
  const result=await get(area); assert.equal(result.status,503);assert.match((await result.json()).error,/Слишком много данных/);
});
test('per-client request quota is enforced without querying the provider',async t=>{
  const {get}=await setup(t,()=>assert.fail('invalid requests must not hit provider'));
  for(let i=0;i<30;i++)assert.equal((await get('search?q=a')).status,400);
  assert.equal((await get('search?q=a')).status,429);assert.equal((await get('health')).status,200);
});
