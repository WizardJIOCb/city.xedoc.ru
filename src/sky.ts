import * as T from 'three';
import { SUN_DIRECTION } from './sun-rays';

export class Sky extends T.Mesh<T.SphereGeometry, T.ShaderMaterial> {
  sunDirection = SUN_DIRECTION.clone();
  constructor() {
    super(new T.SphereGeometry(4000, 32, 20), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false,
      uniforms: { uNight: { value: 0 }, uSunVisible: { value: 1 }, uSunDirection: { value: SUN_DIRECTION.clone() } },
      vertexShader: 'varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 vDirection;uniform float uNight,uSunVisible;uniform vec3 uSunDirection;
        void main(){
          vec3 dir=normalize(vDirection);float h=max(0.,dir.y);
          vec3 day=mix(vec3(.32,.55,.66),vec3(.11,.28,.46),pow(h,.65));
          vec3 night=mix(vec3(.17,.22,.34),vec3(.035,.07,.15),h);
          vec3 sky=mix(day,night,uNight);
          float alignment=max(0.,dot(dir,uSunDirection));
          float disk=smoothstep(cos(.018),cos(.014),alignment);
          float halo=pow(alignment,90.)*.18+pow(alignment,12.)*.025;
          float daylight=pow(1.-uNight,1.4)*uSunVisible;
          vec3 warmth=mix(vec3(1.,.74,.38),vec3(1.,.35,.08),min(1.,uNight/.38)*.55);
          sky+=warmth*(disk*6.+halo)*daylight;
          gl_FragColor=vec4(sky,1.);
        }`
    }));
    this.name = 'atmosphere'; this.userData.sunOccluder = false; this.renderOrder = -1000;
  }

  update(cameraPosition: T.Vector3, night: number, visibleSun: boolean) {
    this.position.copy(cameraPosition);
    this.sunDirection.copy(SUN_DIRECTION); this.sunDirection.y = .16 - .12 * Math.min(1, night / .38); this.sunDirection.normalize();
    this.material.uniforms.uSunDirection.value.copy(this.sunDirection);
    this.material.uniforms.uNight.value = night;
    this.material.uniforms.uSunVisible.value = visibleSun ? 1 : 0;
  }
}
