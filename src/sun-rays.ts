import * as T from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const SUN_DIRECTION = new T.Vector3(-.78, .16, -.60).normalize();
const vertexShader = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';

// Trace towards the sun through a small silhouette buffer. Keeping this pass
// independent of SSAO lets the switch work at every graphics quality level.
export class SunRaysPass extends Pass {
  mask = new T.WebGLRenderTarget(1, 1);
  shafts = new T.WebGLRenderTarget(1, 1, { depthBuffer: false });
  black = new T.MeshBasicMaterial({ color: 0x000000, fog: false });
  scatter = new T.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { uMask: { value: this.mask.texture }, uSun: { value: new T.Vector2() }, uStrength: { value: 0 }, uAspect: { value: 1 } },
    vertexShader,
    fragmentShader: `varying vec2 vUv;uniform sampler2D uMask;uniform vec2 uSun;uniform float uStrength,uAspect;
      float lightAt(vec2 p){if(p.x<0.||p.x>1.||p.y<0.||p.y>1.)return 1.;return texture2D(uMask,p).r;}
      void main(){
        vec2 delta=(uSun-vUv)/32.;vec2 p=vUv;float light=0.,weight=1.,total=0.;
        for(int i=0;i<32;i++){p+=delta;light+=lightAt(p)*weight;total+=weight;weight*=.963;}
        vec2 d=(vUv-uSun)*vec2(uAspect,1.);
        float radial=exp(-length(d)*.85);
        float source=lightAt(uSun);
        float rays=max(0.,light/total-.25)*radial*source*uStrength*.18;
        gl_FragColor=vec4(vec3(rays),1.);
      }`
  });
  composite = new T.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { tDiffuse: { value: null }, uRays: { value: this.shafts.texture }, uColor: { value: new T.Color('#ffd39a') } },
    vertexShader,
    fragmentShader: 'varying vec2 vUv;uniform sampler2D tDiffuse,uRays;uniform vec3 uColor;void main(){vec4 c=texture2D(tDiffuse,vUv);gl_FragColor=vec4(c.rgb+texture2D(uRays,vUv).r*uColor,c.a);}'
  });
  quad = new FullScreenQuad(this.scatter);
  daylight = 1;
  direction = SUN_DIRECTION.clone();
  private projected = new T.Vector3();
  private forward = new T.Vector3();
  private white = new T.Color(0xffffff);
  private clearColor = new T.Color();
  private width = 1;
  private height = 1;
  private maxSize = 768;

  constructor(public scene: T.Scene, public camera: T.PerspectiveCamera) { super(); }

  setQuality(quality: string) {
    this.maxSize = quality === 'high' ? 768 : quality === 'medium' ? 512 : 320;
    this.setSize(this.width, this.height);
  }

  override setSize(width: number, height: number) {
    this.width = width; this.height = height;
    const scale = Math.min(.5, this.maxSize / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    this.mask.setSize(w, h); this.shafts.setSize(w, h);
    this.scatter.uniforms.uAspect.value = width / height;
  }

  override render(renderer: T.WebGLRenderer, writeBuffer: T.WebGLRenderTarget, readBuffer: T.WebGLRenderTarget) {
    this.camera.getWorldDirection(this.forward);
    const facing = T.MathUtils.smoothstep(this.forward.dot(this.direction), 0, .3);
    this.projected.copy(this.direction).multiplyScalar(4000).add(this.camera.position).project(this.camera);
    const offscreen = Math.max(Math.abs(this.projected.x), Math.abs(this.projected.y));
    const strength = this.daylight * facing * (1 - T.MathUtils.smoothstep(offscreen, 2.5, 5));
    this.scatter.uniforms.uSun.value.set(this.projected.x * .5 + .5, this.projected.y * .5 + .5);
    this.scatter.uniforms.uStrength.value = strength;
    if (strength > .001) {
      const hidden: T.Object3D[] = [], background = this.scene.background, override = this.scene.overrideMaterial;
      const autoClear = renderer.autoClear, shadowUpdate = renderer.shadowMap.autoUpdate;
      renderer.getClearColor(this.clearColor); const clearAlpha = renderer.getClearAlpha();
      // Atmosphere, water and transparent effects admit light; solid buildings,
      // terrain, vehicles and trees form the silhouettes that split the shafts.
      this.scene.traverse(object => {
        const material = (object as T.Mesh).material;
        if (object.visible && (object.userData.sunOccluder === false || object instanceof T.Points || object instanceof T.Line ||
          material && (Array.isArray(material) ? material.every(m => m.transparent) : material.transparent))) {
          object.visible = false; hidden.push(object);
        }
      });
      try {
        this.scene.background = this.white; this.scene.overrideMaterial = this.black;
        renderer.shadowMap.autoUpdate = false; renderer.autoClear = true;
        renderer.setRenderTarget(this.mask); renderer.setClearColor(0xffffff, 1); renderer.clear(); renderer.render(this.scene, this.camera);
      } finally {
        this.scene.background = background; this.scene.overrideMaterial = override;
        for (const object of hidden) object.visible = true;
        renderer.autoClear = autoClear; renderer.shadowMap.autoUpdate = shadowUpdate; renderer.setClearColor(this.clearColor, clearAlpha);
      }
      this.quad.material = this.scatter; renderer.setRenderTarget(this.shafts); this.quad.render(renderer);
    } else {
      renderer.getClearColor(this.clearColor); const alpha = renderer.getClearAlpha();
      renderer.setRenderTarget(this.shafts); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.setClearColor(this.clearColor, alpha);
    }
    this.composite.uniforms.tDiffuse.value = readBuffer.texture;
    this.quad.material = this.composite; renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(renderer);
  }

  override dispose() { this.mask.dispose(); this.shafts.dispose(); this.black.dispose(); this.scatter.dispose(); this.composite.dispose(); this.quad.dispose(); }
}
