import test from 'node:test';import assert from 'node:assert/strict';import{SurfaceIndex}from'../src/surface-index.ts';import{inPolygon}from'../src/real-geometry.ts';
test('indexed land queries match polygons including water holes, disjoint islands and cell boundaries',()=>{
 const square=(x,z,r)=>[[x-r,z-r],[x+r,z-r],[x+r,z+r],[x-r,z+r],[x-r,z-r]];
 const land=[[square(0,0,10000),square(0,0,300),square(600,-1000,150)],[square(12000,1000,200)]];
 const index=new SurfaceIndex(land);
 for(let x=-11000;x<=12500;x+=127)for(let z=-11000;z<=11000;z+=64)assert.equal(index.contains(x,z),land.some(p=>inPolygon(x,z,p)),`${x},${z}`);
});
