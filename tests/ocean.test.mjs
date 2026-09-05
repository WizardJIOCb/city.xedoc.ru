import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';import { Ocean } from '../src/ocean.ts';
test('switching from a procedural island city to real terrain clears all six shoreline uniforms',()=>{
 const scene=new T.Scene(),ocean=new Ocean(scene,new T.PerspectiveCamera());
 const islands=Array.from({length:6},(_,i)=>({x:i*100,z:i*120,radius:80,phase:i}));
 ocean.update(1,0,{islands,ships:[],extent:600});assert.ok(ocean.material.uniforms.uIslands.value.every(v=>v.z===80));
 ocean.update(2,0,{islands:[],ships:[],extent:10000});assert.ok(ocean.material.uniforms.uIslands.value.every(v=>v.toArray().every(n=>n===0)));
 assert.ok(ocean.mesh.scale.x*10000>40000,'ocean covers the 20 km region and camera margin');
 ocean.update(3,0,{islands:islands.slice(0,2),ships:[],extent:600});assert.equal(ocean.material.uniforms.uIslands.value[0].z,80);assert.equal(ocean.material.uniforms.uIslands.value[2].z,0);assert.equal(ocean.mesh.scale.x,1);
 ocean.mesh.geometry.dispose();ocean.material.dispose();
});
