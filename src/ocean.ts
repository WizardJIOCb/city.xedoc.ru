import * as T from 'three';
import type { City } from './world';

export class Ocean {
  material: T.ShaderMaterial;
  mesh: T.Mesh;
  constructor(scene: T.Scene, camera: T.Camera) {
    this.material = new T.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uCamera: { value: camera.position }, uSunDirection: { value: new T.Vector3(-.48, .75, .55).normalize() }, uIslands: { value: Array.from({ length: 6 }, () => new T.Vector4(0, 0, 0, 0)) }, uShips: { value: Array.from({ length: 8 }, () => new T.Vector4(0, 0, 0, 0)) } },
      vertexShader: `uniform float uTime; varying vec3 vWorld;
        void main(){vec3 p=position; p.y+=sin(dot(p.xz,vec2(.022,.014))+uTime*.8)*.34+sin(dot(p.xz,vec2(-.011,.037))+uTime*1.13)*.19;vec4 w=modelMatrix*vec4(p,1.);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader: `uniform float uTime;uniform float uNight;uniform vec3 uCamera,uSunDirection;uniform vec4 uIslands[6];uniform vec4 uShips[8];varying vec3 vWorld;
        float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        float sea(vec2 p){vec2 w=p+vec2(uTime*.75,-uTime*.4);float h=0.;float amp=.5;for(int i=0;i<4;i++){h+=noise(w)*amp;w=mat2(1.62,1.18,-1.18,1.62)*w+vec2(17.3,29.1);amp*=.48;}return h;}
        void main(){vec2 p=vWorld.xz;float d=length(uCamera-vWorld);float fade=1.-smoothstep(900.,3900.,d);
          vec2 q=p*.027;float h=sea(q);float hx=sea(q+vec2(.045,0.))-sea(q-vec2(.045,0.));float hz=sea(q+vec2(0.,.045))-sea(q-vec2(0.,.045));
          vec3 n=normalize(vec3(-hx*2.1*fade,1.,-hz*2.1*fade));vec3 v=normalize(uCamera-vWorld);float f=pow(1.-max(0.,dot(n,v)),4.);
          float coast=10000.;for(int i=0;i<6;i++){if(uIslands[i].z>0.)coast=min(coast,length(p-uIslands[i].xy)-uIslands[i].z*(.92+sin(atan(p.y-uIslands[i].y,p.x-uIslands[i].x)*3.+uIslands[i].w)*.055+cos(atan(p.y-uIslands[i].y,p.x-uIslands[i].x)*5.-uIslands[i].w)*.025));}
          float shallow=exp(-max(0.,coast)*.022);vec3 deep=mix(vec3(.013,.12,.16),vec3(.035,.31,.32),shallow*.7);vec3 reflection=vec3(.34,.54,.62);
          vec3 color=mix(deep,reflection,f*.65);color+=(h-.48)*.024*fade;
          vec3 light=normalize(uSunDirection);float sun=pow(max(0.,dot(reflect(-light,n),v)),95.);color+=vec3(1.,.83,.55)*sun*.75;
          float foam=(1.-smoothstep(1.,14.,max(0.,coast)))*smoothstep(.45,.72,sea(p*.045+uTime*.22))*.3;
          for(int i=0;i<8;i++){vec4 ship=uShips[i];if(length(ship.zw)>.2){vec2 rel=p-ship.xy;float behind=-dot(rel,ship.zw);float across=abs(dot(rel,vec2(-ship.w,ship.z)));float wake=(1.-smoothstep(.3,2.8,abs(across-behind*.22)))*smoothstep(2.,10.,behind)*(1.-smoothstep(15.,82.,behind));foam+=wake*.28*(.6+.4*noise(p*.3-uTime));}}
          color=mix(color,vec3(.68,.85,.83),clamp(foam,0.,.48));color=mix(color,color*vec3(.22,.30,.47),uNight*.86);
          float fog=1.-exp(-d*.00022);color=mix(color,mix(vec3(.30,.46,.51),vec3(.035,.065,.12),uNight),fog);gl_FragColor=vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    });
    const geometry = new T.PlaneGeometry(10000, 10000, 180, 180); geometry.rotateX(-Math.PI / 2);
    this.mesh = new T.Mesh(geometry, this.material); this.mesh.position.y = -2; this.mesh.userData.sunOccluder = false; scene.add(this.mesh);
  }
  update(time: number, night: number, city: City, flood: number) {
    this.material.uniforms.uTime.value = time; this.material.uniforms.uNight.value = night; this.mesh.position.y = -2 + flood;
    city.islands.forEach((island, i) => this.material.uniforms.uIslands.value[i].set(island.x, island.z, island.radius, island.phase));
    this.material.uniforms.uShips.value.forEach((v: T.Vector4, i: number) => { const ship = city.ships[i]; if (!ship?.userData.alive) v.set(0, 0, 0, 0); else v.set(ship.position.x, ship.position.z, -Math.sin(ship.rotation.y), -Math.cos(ship.rotation.y)); });
  }
}
