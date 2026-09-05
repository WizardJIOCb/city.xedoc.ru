import test from 'node:test';import assert from 'node:assert/strict';import{union,intersection,difference}from'../src/real-clipping.ts';import{inPolygon,ringArea,segmentStrip}from'../src/real-geometry.ts';
const square=(x,z,r)=>[[x-r,z-r],[x+r,z-r],[x+r,z+r],[x-r,z+r],[x-r,z-r]];
test('regional clipping joins almost-coincident river banks without broken rings',()=>{
 const water=[segmentStrip([-800,-10020],[-800,-8900],24),segmentStrip([-800.000000000007,-9000],[-600,-8800],24),[square(-800,-9000,100)]];
 const region=[square(0,0,10000)],merged=intersection(union(water),region),land=difference(region,merged);
 assert.ok(merged.some(p=>inPolygon(-800,-9900,p)));assert.ok(!land.some(p=>inPolygon(-800,-9900,p)));assert.ok(land.some(p=>inPolygon(0,0,p)));
 for(const p of [...merged,...land])for(const r of p){assert.deepEqual(r[0],r.at(-1));assert.ok(r.every(v=>v.every(Number.isFinite)));}
});
test('integer polygon operations retain holes and land islands within holes',()=>{
 const polygon=[square(0,0,100),square(0,0,50)],result=union([polygon,[square(0,0,10)]]);
 assert.equal(result.length,2);assert.ok(result.some(p=>inPolygon(0,0,p)));assert.ok(!result.some(p=>inPolygon(25,0,p)));
 const area=result.reduce((s,p)=>s+ringArea(p[0])-p.slice(1).reduce((n,r)=>n+ringArea(r),0),0);assert.equal(area,30400);
});
