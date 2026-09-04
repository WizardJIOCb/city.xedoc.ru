import * as T from 'three';
import { islandRadius } from './model.js';

// A single closed surface: the grass disk and the beach annulus only share
// edges. No buried top cap or raised road decals compete in the depth buffer.
export function createIslandTerrain(radius: number, phase: number) {
  const positions: number[] = [], colors: number[] = [];
  const grass = new T.Color('#71946a'), sand = new T.Color('#c6b88c');
  const top = .7, bottom = -9.3, segments = 64;
  const ring = (r: number, y: number) => Array.from({ length: segments }, (_, i) => {
    const angle = i / segments * Math.PI * 2, distance = islandRadius(angle, r, phase);
    return [Math.cos(angle) * distance, y, Math.sin(angle) * distance];
  });
  const inner = ring(radius - 14, top), outer = ring(radius, top), base = ring(radius + 12, bottom);
  const grassRings = Array.from({ length: 10 }, (_, i) => ring((radius - 14) * (i + 1) / 10, top));
  const triangle = (a: number[], b: number[], c: number[], color: T.Color) => {
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  };
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    triangle([0, top, 0], grassRings[0][next], grassRings[0][i], grass);
    for (let band = 1; band < grassRings.length; band++) {
      const inside = grassRings[band - 1], outside = grassRings[band];
      triangle(inside[i], outside[next], outside[i], grass); triangle(inside[i], inside[next], outside[next], grass);
    }
    triangle(inner[i], outer[next], outer[i], sand);
    triangle(inner[i], inner[next], outer[next], sand);
    triangle(outer[i], base[next], base[i], sand);
    triangle(outer[i], outer[next], base[next], sand);
    triangle([0, bottom, 0], base[i], base[next], sand);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aRoadSurface', new T.Float32BufferAttribute(positions.filter((_value, index) => index % 3 === 1).map(y => y === top ? 1 : 0), 1));
  geometry.computeVertexNormals();
  const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  material.onBeforeCompile = shader => {
    shader.uniforms.uRoadEnd = { value: radius * .75 };
    shader.uniforms.uRoadColor = { value: new T.Color('#a79e84') };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIslandPosition; attribute float aRoadSurface; varying float vRoadSurface;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIslandPosition=position; vRoadSurface=aRoadSurface;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIslandPosition; varying float vRoadSurface; uniform float uRoadEnd; uniform vec3 uRoadColor;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p=abs(vIslandPosition.xz);
        float distanceToRoad=min(max(p.x-uRoadEnd,p.y-4.5),max(p.x-4.5,p.y-uRoadEnd));
        float edge=max(fwidth(distanceToRoad),.01);
        float road=(1.-smoothstep(-edge,edge,distanceToRoad))*vRoadSurface;
        diffuseColor.rgb=mix(diffuseColor.rgb,uRoadColor,road);
      `);
  };
  const terrain = new T.Mesh(geometry, material);
  terrain.name = 'island-terrain'; terrain.receiveShadow = true; terrain.userData.terrainRadius = radius + 12;
  return terrain;
}
