import * as T from 'three';
import type { City } from './world';

export const SEA_LEVEL = -2;
export type Basin = { x: number; z: number; radius: number; depth: number };
export type WavePlan = { x: number; z: number; dx: number; dz: number; radius: number; height: number };

export function basinDepth(basin: Basin, x: number, z: number) {
  const distance = Math.hypot(x - basin.x, z - basin.z) / basin.radius;
  return basin.depth * (1 - T.MathUtils.smoothstep(distance, .2, 1));
}

// Choose the nearest shoreline, including the smaller islands. The wave still
// stays inside the selected circle, even when that circle is far inland.
export function planWave(city: City, x: number, z: number, power: number): WavePlan {
  let dx = 0, dz = -1, found = false;
  const onLand = city.baseTerrainHeight(x, z) !== null;
  for (let distance = 24; distance <= city.worldRadius * 2 && !found; distance += 32) {
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, sx = Math.cos(a), sz = Math.sin(a);
      const land = city.baseTerrainHeight(x + sx * distance, z + sz * distance) !== null;
      if (land !== onLand) { dx = sx * (onLand ? -1 : 1); dz = sz * (onLand ? -1 : 1); found = true; break; }
    }
  }
  return { x, z, dx, dz, radius: 160 * Math.sqrt(power), height: 27 + 16 * power };
}

export const WAVE_DURATION = 15;
export function waveEnvelope(age: number) {
  return T.MathUtils.smoothstep(age, 0, 1.8) * (1 - T.MathUtils.smoothstep(age, WAVE_DURATION - 3, WAVE_DURATION));
}
export function waveFront(plan: WavePlan, age: number) {
  return plan.radius * (-.88 + 1.76 * T.MathUtils.clamp(age / WAVE_DURATION, 0, 1));
}
export function waveHeight(plan: WavePlan, age: number, x: number, z: number) {
  const px = x - plan.x, pz = z - plan.z;
  if (px * px + pz * pz >= plan.radius * plan.radius || age <= 0 || age >= WAVE_DURATION) return 0;
  const across = px * plan.dz - pz * plan.dx, along = px * plan.dx + pz * plan.dz;
  const footprint = 1 - T.MathUtils.smoothstep(Math.hypot(px, pz) / plan.radius, .78, 1);
  const local = along - waveFront(plan, age);
  const width = plan.radius * (local > 0 ? .095 : .24);
  const crest = Math.exp(-Math.pow(local / width, 2));
  const ridges = 1 + Math.sin(across * .065 + age * 1.7) * .055 + Math.sin(across * .14 - age * 2.1) * .025;
  return plan.height * crest * footprint * ridges * waveEnvelope(age);
}

export class TsunamiWave extends T.Mesh<T.PlaneGeometry, T.ShaderMaterial> {
  constructor(public plan: WavePlan) {
    const geometry = new T.PlaneGeometry(plan.radius * 2, plan.radius * 1.05, 80, 48);
    geometry.rotateX(-Math.PI / 2);
    const material = new T.ShaderMaterial({
      transparent: true, depthWrite: false, side: T.DoubleSide, allowOverride: false,
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uHeight: { value: plan.height }, uVisible: { value: 1 } },
      vertexShader: `varying vec3 vWorld;varying float vHeight;
        void main(){vec4 p=modelMatrix*vec4(position,1.);vWorld=p.xyz;vHeight=position.y+2.;gl_Position=projectionMatrix*viewMatrix*p;}`,
      fragmentShader: `varying vec3 vWorld;varying float vHeight;uniform float uTime,uNight,uHeight,uVisible;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        void main(){
          if(uVisible<.5||vHeight<.08)discard;
          vec3 n=normalize(cross(dFdx(vWorld),dFdy(vWorld)));if(!gl_FrontFacing)n=-n;
          vec3 view=normalize(cameraPosition-vWorld);
          float fresnel=pow(1.-abs(dot(n,view)),3.);
          float turbulence=noise(vWorld.xz*.19+vec2(uTime*.7,-uTime*1.3));
          float streak=noise(vWorld.xz*vec2(.08,.36)+uTime*.55);
          float crest=smoothstep(.62,.9,vHeight/uHeight);
          float foam=smoothstep(.46,.8,turbulence*.65+streak*.35+crest*.25)*(.08+crest*.92);
          vec3 color=mix(vec3(.018,.18,.23),vec3(.09,.55,.57),clamp(vHeight/uHeight+fresnel*.4,0.,1.));
          color+=pow(max(0.,dot(reflect(normalize(vec3(.6,-.8,.3)),n),view)),48.)*.45;
          color=mix(color,vec3(.75,.94,.91),foam*.93);
          color*=mix(vec3(1.),vec3(.32,.43,.63),uNight*.85);
          gl_FragColor=vec4(color,smoothstep(.08,2.,vHeight)*.94);
        }`
    });
    super(geometry, material); this.frustumCulled = false; this.renderOrder = 2; this.userData.sunOccluder = false;
    this.onBeforeRender = (_r, scene) => { material.uniforms.uVisible.value = scene.overrideMaterial ? 0 : 1; };
  }
  update(age: number, night: number) {
    const p = this.plan, front = waveFront(p, age), vertices = this.geometry.attributes.position;
    this.position.set(p.dx * front, 0, p.dz * front);
    this.rotation.y = Math.atan2(p.dx, p.dz);
    for (let i = 0; i < vertices.count; i++) {
      const across = vertices.getX(i), along = vertices.getZ(i);
      const x = p.x + p.dx * (front + along) + p.dz * across, z = p.z + p.dz * (front + along) - p.dx * across;
      vertices.setY(i, SEA_LEVEL + waveHeight(p, age, x, z));
    }
    vertices.needsUpdate = true;
    this.material.uniforms.uTime.value = age; this.material.uniforms.uNight.value = night;
  }
}
