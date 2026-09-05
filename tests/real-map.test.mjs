import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { convertRealMap } from '../src/real-map.ts';
import { buildingHeight, clipLine, coastWater, inPolygon, project } from '../src/real-geometry.ts';
import { makeRoute, routePosition } from '../src/real-world.ts';
import { City } from '../src/world.ts';
import { Effects } from '../src/effects.ts';
import { Sound } from '../src/audio.ts';
import { SelfDestruct } from '../src/self-destruct.ts';

function fixture() {
  const lat=55,lon=37,geo=([x,z])=>({lon:lon+x/(111320*Math.cos(lat*Math.PI/180)),lat:lat-z/111320});
  const ring=(x,z,w)=>[[x-w,z-w],[x+w,z-w],[x+w,z+w],[x-w,z+w],[x-w,z-w]];
  const way=(id,points,tags)=>({type:'way',id,nodes:points.map((p,i)=>id*100+(i===points.length-1&&p[0]===points[0][0]&&p[1]===points[0][1]?0:i)),geometry:points.map(geo),tags});
  return {lat,lon,size:600,fetchedAt:'2026-09-05',osm:{elements:[
    way(1,[[-180,-120],[-100,-120],[-100,-100],[-160,-100],[-160,-40],[-180,-40],[-180,-120]],{building:'yes',height:'24'}),
    {type:'relation',id:2,tags:{type:'multipolygon',building:'apartments','building:levels':'6'},members:[{type:'way',ref:20,role:'outer',geometry:ring(20,0,55).map(geo)},{type:'way',ref:21,role:'inner',geometry:ring(20,0,25).map(geo)}]},
    way(3,ring(380,20,30),{building:'yes'}),
    way(4,[[-400,170],[400,170],[400,260],[-400,260],[-400,170]],{natural:'water'}),
    way(5,[[-350,100],[0,100],[200,-100],[350,-100]],{highway:'residential'}),
    way(6,ring(170,-200,50),{leisure:'park'}),
    way(7,[[0,150],[0,280]],{highway:'residential',bridge:'yes'}),
  ]}};
}
function setup() { const map=convertRealMap(fixture(),'Тестовый район'),scene=new T.Scene(),city=new City(scene,'REAL-TEST',10,'real',map),fx=new Effects(scene,city,new Sound()); return {map,scene,city,fx,dispose:()=>{fx.reset();city.dispose()}}; }

test('projection keeps metres, east to +X and north to -Z; height fallbacks are deterministic',()=>{
  assert.deepEqual(project(37,55,37,55),[0,0]); assert.ok(Math.abs(project(37,55.001,37,55)[1]+111.32)<.001);
  assert.equal(buildingHeight({height:'100 ft'},'1').height,30.48); assert.equal(buildingHeight({'building:levels':'5'},'1').height,17.2);
  assert.equal(buildingHeight({height:'broken'},'1').knownHeight,false); assert.deepEqual(buildingHeight({building:'house'},'abc'),buildingHeight({building:'house'},'abc'));
});
test('OSM import preserves an L shape and a multipolygon courtyard, clips rivers/roads and excludes distant buildings',()=>{
  const map=convertRealMap(fixture(),'Тест'); assert.equal(map.buildings.length,2); assert.ok(map.buildings.some(b=>b.rings.length===2));
  assert.ok(map.buildings.find(b=>b.id==='way/1').rings[0].length>5); assert.equal(map.estimatedHeights,0);
  assert.ok(map.water.some(p=>inPolygon(0,200,p))); assert.ok(!map.land.some(p=>inPolygon(0,200,p)));
  assert.ok(map.land.some(p=>inPolygon(0,0,p))); assert.ok(map.parks.length>0);
  assert.ok(map.roads.flatMap(r=>r.points).every(p=>Math.abs(p[0])<=300.001&&Math.abs(p[1])<=300.001));
  assert.equal('osm' in map,false);
});
test('coastline closes the sea to the right and line clipping retains disconnected paths',()=>{
  const water=coastWater([[-400,0],[0,0],[400,0]],300); assert.ok(water.some(p=>inPolygon(0,100,p))); assert.ok(!water.some(p=>inPolygon(0,-100,p)));
  assert.deepEqual(clipLine([[-400,0],[400,0]],300),[[[-300,0],[300,0]]]);
  assert.equal(clipLine([[-400,-400],[-350,-350]],300).length,0);
});
test('real footprint render geometry, collision, terrain and traffic agree; courtyards stay open',()=>{
  const {city,map,dispose}=setup(); assert.equal(city.buildings.length,map.buildings.length); assert.equal(city.islands.length,0); assert.equal(city.airportSections.length,0);
  assert.ok(city.realBatch.mesh.isBatchedMesh); assert.equal(city.baseTerrainHeight(40,200),null); assert.equal(city.baseTerrainHeight(0,200),1); assert.equal(city.baseTerrainHeight(0,0),.7);
  assert.equal(city.collision.walkable(20,0,1),true,'courtyard interior'); assert.equal(city.collision.walkable(20,45,1),false,'courtyard wall');
  assert.equal(city.collision.sweep({x:20,y:100,z:0},{x:20,y:1,z:0},.4),null,'open courtyard has no invisible roof');
  assert.ok(city.collision.sweep({x:20,y:100,z:45},{x:20,y:1,z:45},.4),'actual roof catches debris');
  assert.ok(city.collision.sweep({x:-40,y:8,z:0},{x:100,y:8,z:0},.4),'fast fragments hit the exterior');
  assert.ok(city.traffic.length>0); const car=city.traffic[0]; city.update(.5,.5); const expected=routePosition(car.route,car.progress); assert.equal(car.x,expected.x); assert.equal(car.z,expected.z);
  dispose();
});
test('route travel follows bends, reverses at the end, and remains finite at large simulation times',()=>{
  const route=makeRoute([[0,0],[100,0],[100,100]]); assert.deepEqual(routePosition(route,150),{x:100,z:50,heading:0});
  assert.equal(routePosition(route,250).z,50); assert.ok(Number.isFinite(routePosition(route,1e8).x));
});
test('a real building collapses under bombs, leaves its actual footprint as rubble and rebuilds intact',()=>{
  const {city,map,scene,fx,dispose}=setup(), building=city.buildings.find(b=>b.footprint.length===2);
  fx.trigger('bomb',building.x,building.z,2); for(let t=.05;t<6;t+=.05){city.update(.05,t);fx.update(.05,t)}
  assert.equal(building.health,0); assert.ok(building.collapsed); assert.ok(fx.debris.length>0);
  assert.equal(city.collision.sweep({x:20,y:60,z:45},{x:20,y:10,z:45},.4),null);
  const matrix=new T.Matrix4();city.realBatch.mesh.getMatrixAt(building.parts[0].id,matrix); assert.ok(Math.abs(matrix.elements[5])<3);
  dispose(); const next=new City(scene,'REAL-TEST',10,'real',map); assert.ok(next.buildings.every(b=>b.health===100)); next.dispose();
});
test('local flooding deforms real ground and building instances together',()=>{
  const {city,fx,dispose}=setup(),b=city.buildings[0]; fx.trigger('flood',b.x,b.z,1);
  for(let t=.1;t<10;t+=.1){city.update(.1,t);fx.update(.1,t)}
  assert.ok(city.groundOffset(b.x,b.z)<-5); const matrix=new T.Matrix4();city.realBatch.mesh.getMatrixAt(b.parts[0].id,matrix);
  assert.ok(matrix.elements[13]<b.parts[0].y-5); assert.ok(b.health<100); dispose();
});

test('real terrain has interior vertices that sink under a local flood; bridge overlays disappear with their support',()=>{
  const {city,fx,dispose}=setup(); const dock=city.docks[0]; assert.ok(dock.ids.length>=3);
  city.damageDock(dock,1000,{x:dock.x,z:dock.z,radius:60,strength:500,impulse:true}); assert.equal(dock.alive,false);
  for(const id of dock.ids){const m=new T.Matrix4();city.solid.mesh.getMatrixAt(id,m);assert.equal(m.elements[0],0)}
  fx.trigger('flood',0,0,1);for(let t=.1;t<10;t+=.1){city.update(.1,t);fx.update(.1,t)}
  const land=city.group.children.find(o=>o.name==='real-terrain'),p=land.geometry.attributes.position;
  let lowered=0;for(let i=0;i<p.count;i++)if(Math.hypot(p.getX(i),p.getZ(i))<30&&p.getY(i)<-4)lowered++;
  assert.ok(lowered>0,'flood lowers the interior, not just the patch border');dispose();
});
test('self-destruct reaches every real building, road vehicle and park tree',()=>{
  const {city,fx,dispose}=setup(),mode=new SelfDestruct(city,fx);mode.start(10);
  for(let t=.1;t<20&&mode.active;t+=.1){city.update(.1,t);fx.update(.1,t);mode.update(.1)}
  assert.equal(mode.state,'complete');assert.equal(city.destroyed,city.buildings.length);assert.equal(mode.remainingTargets,0);dispose();
});
