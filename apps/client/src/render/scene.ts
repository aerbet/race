import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Quality } from './quality';

/** Радиальное размытие к краям — «ощущение скорости» (только high). */
const RadialBlurShader = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
    void main(){
      vec2 c = vec2(0.5, 0.55); vec2 d = vUv - c; float l = length(d);
      float s = strength * smoothstep(0.15, 0.7, l);
      vec4 acc = vec4(0.0);
      for (int i = 0; i < 8; i++) { acc += texture2D(tDiffuse, vUv - d * s * float(i) / 8.0); }
      gl_FragColor = acc / 8.0;
    }`,
};

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private blurPass: ShaderPass | null = null;
  readonly moon: THREE.DirectionalLight;

  constructor(
    readonly container: HTMLElement,
    readonly quality: Quality,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: quality.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(quality.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      quality.drawDistance + 200,
    );
    const sky = new THREE.Color(0x0a0c1c);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(0x0b0e20, 60, quality.drawDistance);

    // Окружение для отражений на краске (дёшево: одна PMREM-текстура)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    this.scene.add(new THREE.HemisphereLight(0x6677bb, 0x221a14, 1.2));
    this.moon = new THREE.DirectionalLight(0xb8c6ff, 1.1);
    this.moon.position.set(-80, 140, 60);
    if (quality.shadows) {
      this.moon.castShadow = true;
      this.moon.shadow.mapSize.set(2048, 2048);
      const c = this.moon.shadow.camera;
      c.left = c.bottom = -60;
      c.right = c.top = 60;
      c.near = 1;
      c.far = 400;
      this.moon.shadow.bias = -0.0005;
    }
    this.scene.add(this.moon, this.moon.target);

    if (quality.bloom) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.setPixelRatio(quality.pixelRatio);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(
        new UnrealBloomPass(
          new THREE.Vector2(window.innerWidth, window.innerHeight),
          0.55,
          0.5,
          0.82,
        ),
      );
      if (quality.motionBlur) {
        this.blurPass = new ShaderPass(RadialBlurShader);
        this.composer.addPass(this.blurPass);
      }
      this.composer.addPass(new OutputPass());
    }

    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth,
      h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
  }

  /** Тень следует за машиной игрока. */
  followShadow(x: number, z: number): void {
    this.moon.position.set(x - 80, 140, z + 60);
    this.moon.target.position.set(x, 0, z);
  }

  setBlur(strength: number): void {
    if (this.blurPass) this.blurPass.uniforms.strength!.value = strength;
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
