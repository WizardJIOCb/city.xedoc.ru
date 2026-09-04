import * as T from 'three';

export const MEGA_FIREBALL_DURATION = 8;

// A dedicated volume keeps the blast visible at city scale and independent of
// the spark pool, which fills rapidly when buildings and cars break apart.
export class MegaFireball extends T.Mesh<T.BoxGeometry, T.ShaderMaterial> {
  constructor(public blastRadius: number) {
    super(new T.BoxGeometry(2, 2, 2), new T.ShaderMaterial({
      transparent: true, depthWrite: false, side: T.BackSide,
      uniforms: { uEye: { value: new T.Vector3() }, uClipMatrix: { value: new T.Matrix4() }, uAge: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: `varying vec3 vLocal;
        void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `
        varying vec3 vLocal;
        uniform vec3 uEye;
        uniform mat4 uClipMatrix;
        uniform float uAge,uOpacity;
        float hash(vec3 p){p=fract(p*.3183099+vec3(.17,.31,.73));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
        float noise(vec3 p){
          vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
        }
        float billows(vec3 p){return noise(p)*.57+noise(p*2.07+7.1)*.29+noise(p*4.13+13.7)*.14;}
        void main(){
          vec3 ray=normalize(vLocal-uEye);
          float b=dot(uEye,ray),c=dot(uEye,uEye)-1.,disc=b*b-c;
          if(disc<=0.)discard;
          float near=max(0.,-b-sqrt(disc)),far=-b+sqrt(disc);
          float stepSize=(far-near)/28.;
          float heat=1.-smoothstep(1.4,5.8,uAge);
          float firstHit=far;
          vec4 cloud=vec4(0.);
          for(int i=0;i<28;i++){
            vec3 p=uEye+ray*(near+(float(i)+.5)*stepSize);
            vec3 flow=p*3.4+vec3(uAge*.14,-uAge*.55,uAge*.11);
            float n=billows(flow);
            float envelope=1.-smoothstep(.58,.99,length(p)+(n-.5)*.28);
            float density=envelope*smoothstep(.23,.69,n)*3.5;
            if(density>.07)firstHit=min(firstHit,near+(float(i)+.5)*stepSize);
            float a=1.-exp(-density*stepSize*4.);
            float core=pow(max(0.,1.-length(p)),1.6);
            float detail=noise(flow*2.6+uAge*.2);
            float temperature=clamp(n*.55+detail*.32+core*.35,0.,1.);
            vec3 flame=mix(vec3(.65,.007,.0004),vec3(4.8,.65,.012),smoothstep(.32,.72,temperature));
            flame=mix(flame,vec3(7.,3.8,.95),smoothstep(.72,.99,temperature));
            vec3 smoke=mix(vec3(.075,.083,.085),vec3(.31,.29,.26),n+max(0.,p.y)*.16);
            vec3 color=mix(smoke,flame,heat*smoothstep(.28,.57,n+core*.2));
            cloud.rgb+=(1.-cloud.a)*color*a;
            cloud.a+=(1.-cloud.a)*a;
            if(cloud.a>.985)break;
          }
          if(cloud.a<.003)discard;
          // Write the volume's front depth, not the back of its bounding box.
          // Otherwise roads and water cut a rectangular hole through the fire.
          vec4 clip=uClipMatrix*vec4(uEye+ray*firstHit,1.);
          gl_FragDepth=clamp(clip.z/clip.w*.5+.5,0.,1.);
          gl_FragColor=vec4(cloud.rgb/max(cloud.a,.001),cloud.a*uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }));
    this.name = 'mega-fireball'; this.renderOrder = 3;
    this.onBeforeRender = (_renderer, _scene, camera) => {
      camera.getWorldPosition(this.material.uniforms.uEye.value);
      this.worldToLocal(this.material.uniforms.uEye.value);
      this.material.uniforms.uClipMatrix.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld);
    };
    this.update(0);
  }

  update(age: number) {
    const radius = this.blastRadius * (.035 + .66 * (1 - Math.exp(-age * 2.7)) + age * .015);
    this.scale.set(radius, radius * (.85 + Math.min(age, 4) * .04), radius);
    this.position.y = this.blastRadius * (.12 + Math.min(age, 5) * .13);
    this.rotation.y = age * .065;
    this.material.uniforms.uAge.value = age;
    this.material.uniforms.uOpacity.value = T.MathUtils.smoothstep(age, 0, .09) * (1 - T.MathUtils.smoothstep(age, 5.5, MEGA_FIREBALL_DURATION));
  }
}
