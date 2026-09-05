import test from 'node:test';import assert from 'node:assert/strict';import*as T from'three';import{Batch}from'../src/world.ts';
test('growing city batches keep earlier geometry, colours and flood offsets',()=>{
 const group=new T.Group(),geometry=new T.BoxGeometry(),material=new T.MeshBasicMaterial();let offset=0;const batch=new Batch(group,geometry,material,2,true,()=>offset);
 for(let i=0;i<9;i++)batch.add(i,2,i*2,1,3,1,i%2?'red':'blue');assert.equal(batch.mesh.count,9);assert.equal(group.children.length,1);
 offset=-1;batch.refreshGround();const matrix=new T.Matrix4(),color=new T.Color();
 for(let i=0;i<9;i++){batch.mesh.getMatrixAt(i,matrix);batch.mesh.getColorAt(i,color);assert.equal(matrix.elements[12],i);assert.equal(matrix.elements[13],1);assert.equal(color.getHexString(),i%2?'ff0000':'0000ff');}
 batch.mesh.dispose();geometry.dispose();material.dispose();
});
