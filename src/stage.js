// ---------------------------------------------------------------------------
// Stage：渲染器 / 场景 / 视口相机 / 变换手柄 / 拾取 / 网格 / 天空 / 预览取景框
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import { PickSpatialIndex, resolvePick } from './pick-spatial-index.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { clamp, el, snap } from './util.js';
import { makeEnvTexture, setAnisotropy, setTexForce, applyDetail, texOn } from './detail.js';

export const ASPECTS = {
  fit: { l: '充满视口', v: 0 },
  '1.85': { l: '1.85 : 1 学院比例', v: 1.85 },
  '2.39': { l: '2.39 : 1 变形宽幅', v: 2.39 },
  '16:9': { l: '16 : 9 横屏', v: 16 / 9 },
  '4:3': { l: '4 : 3 复古', v: 4 / 3 },
  '9:16': { l: '9 : 16 竖屏', v: 9 / 16 },
  '1:1': { l: '1 : 1 方形', v: 1 },
  '2.76': { l: '2.76 : 1 超宽幅', v: 2.76 },
};

/* 变形宽银幕后处理：水平光晕拉丝 + 蓝色横向色差 */
const AnamorphicShader = {
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0.6 },
    flareStrength: { value: 0.4 },
    chromatic: { value: 0.003 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float flareStrength;
    uniform float chromatic;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float brightness = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      // 水平拉丝光晕
      vec2 uvL = vUv - vec2(0.015 * strength, 0.0);
      vec2 uvR = vUv + vec2(0.015 * strength, 0.0);
      vec4 colorL = texture2D(tDiffuse, uvL);
      vec4 colorR = texture2D(tDiffuse, uvR);
      float flare = smoothstep(0.3, 1.0, brightness) * flareStrength;
      color.rgb += (colorL.rgb + colorR.rgb) * 0.5 * flare;
      // 蓝色横向色差
      float r = texture2D(tDiffuse, vUv + vec2(chromatic, 0.0)).r;
      float b = texture2D(tDiffuse, vUv - vec2(chromatic, 0.0)).b;
      color.r = mix(color.r, r, 0.5);
      color.b = mix(color.b, b, 0.5);
      gl_FragColor = color;
    }
  `,
};

// ---------------------------------------------------------------------------
// PreviewCamControls：预览模式下直接操控相机（旋转 + 推拉）
// ---------------------------------------------------------------------------
class PreviewCamControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.enabled = false;
    this.focus = new THREE.Vector3(0, 2, 0);
    this.rotateSpeed = 0.008;
    this.zoomSpeed = 1.5;

    this._dragging = false;
    this._prevX = 0;
    this._prevY = 0;
    this.interacted = false;

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onWheel = this._onWheel.bind(this);

    domElement.addEventListener('pointerdown', this._onDown);
    domElement.addEventListener('pointermove', this._onMove);
    domElement.addEventListener('pointerup', this._onUp);
    domElement.addEventListener('pointerleave', this._onUp);
    domElement.addEventListener('wheel', this._onWheel, { passive: false });
  }

  activate() { this.enabled = true; this.interacted = false; }
  deactivate() { this.enabled = false; this._dragging = false; }

  _onDown(e) {
    if (!this.enabled || e.button !== 0) return;
    this._dragging = true;
    this._prevX = e.clientX;
    this._prevY = e.clientY;
    this.interacted = true;
    this.domElement.setPointerCapture(e.pointerId);
  }

  _onMove(e) {
    if (!this.enabled || !this._dragging) return;
    const dx = e.clientX - this._prevX;
    const dy = e.clientY - this._prevY;
    this._prevX = e.clientX;
    this._prevY = e.clientY;

    const offset = this.camera.position.clone().sub(this.focus);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta -= dx * this.rotateSpeed;
    sph.phi -= dy * this.rotateSpeed;
    sph.phi = THREE.MathUtils.clamp(sph.phi, 0.05, Math.PI - 0.05);
    offset.setFromSpherical(sph);
    this.camera.position.copy(this.focus).add(offset);
    this.camera.lookAt(this.focus);
  }

  _onUp(e) {
    if (!this._dragging) return;
    this._dragging = false;
    try { this.domElement.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  _onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.interacted = true;
    const offset = this.camera.position.clone().sub(this.focus);
    const dist = offset.length();
    const factor = e.deltaY > 0 ? 1.08 : 1 / 1.08;
    const newDist = THREE.MathUtils.clamp(dist * factor, 0.3, 2000);
    offset.normalize().multiplyScalar(newDist);
    this.camera.position.copy(this.focus).add(offset);
  }

  dispose() {
    this.domElement.removeEventListener('pointerdown', this._onDown);
    this.domElement.removeEventListener('pointermove', this._onMove);
    this.domElement.removeEventListener('pointerup', this._onUp);
    this.domElement.removeEventListener('pointerleave', this._onUp);
    this.domElement.removeEventListener('wheel', this._onWheel);
  }
}

export class Stage {
  constructor(host) {
    this.host = host;
    this.w = Math.max(2, host.clientWidth);
    this.h = Math.max(2, host.clientHeight);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.w, this.h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0a0c10, 1);
    setAnisotropy(this.renderer.capabilities.getMaxAnisotropy?.() || 4);   // 斜视角下的贴图清晰度
    this.envRT = null;
    host.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    this.canvas.tabIndex = 0;
    this.canvas.style.outline = 'none';
    this.canvas.style.display = 'block';

    this.scene = new THREE.Scene();
    this.scene.environmentIntensity = 0.8;
    this.world = new THREE.Group();          // 所有用户内容
    this.world.name = 'world';
    this.scene.add(this.world);
    this.helperLayer = new THREE.Group();     // 不渲染进导出的辅助物体
    this.helperLayer.name = 'helpers';
    this.scene.add(this.helperLayer);

    // near/far 直接决定斜看地面时的深度精度：0.08/6000 会让贴花与地形随帧闪烁
    this.view = new THREE.PerspectiveCamera(46, this.w / this.h, 0.2, 3000);
    this.view.position.set(20, 13, 26);

    // 后处理合成器（景深等效果）
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.view);
    this.composer.addPass(this.renderPass);
    this.bokehPass = new BokehPass(this.scene, this.view, {
      focus: 8.0,
      aperture: 0.025,
      maxblur: 0.01
    });
    this.composer.addPass(this.bokehPass);
    this.anamorphicPass = new ShaderPass(AnamorphicShader);
    this.anamorphicPass.enabled = false;
    this.composer.addPass(this.anamorphicPass);
    this.composer.addPass(new OutputPass());
    this.useComposer = false;  // 是否使用后处理（景深开启时）
    this.anamorphicEnabled = false;  // 变形宽银幕效果

    this.orbit = new OrbitControls(this.view, this.canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.09;
    this.orbit.enablePan = true;
    this.orbit.panSpeed = 3.0;
    this.orbit.zoomSpeed = 2.0;
    this.orbit.target.set(0, 2.2, 0);
    this.orbit.maxDistance = 900;
    this.orbit.minDistance = 0.4;
    this.orbit.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    this.orbit.update();

    this.tc = new TransformControls(this.view, this.canvas);
    this.tc.setSize(0.82);
    this.tc.setTranslationSnap(null);
    const helper = this.tc.getHelper ? this.tc.getHelper() : this.tc;
    helper.renderOrder = 900;
    this.scene.add(helper);
    this.tcHelper = helper;
    this.tc.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value && !this.preview;
      this.dragging = !!e.value;
      if (e.value) this.bus?.emit('transform-start', this.tc.object);
      else this.bus?.emit('transform-end');
    });
    this.tc.addEventListener('objectChange', () => this.bus?.emit('transform-change', this.tc.object));

    // --- 地面 + 网格 -------------------------------------------------------
    this.groundMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.98, metalness: 0.0, envMapIntensity: 0.22 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.035;      // 在地形面之下，避免与地形共面闪烁
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';
    this.ground.userData.ground = true;
    this.scene.add(this.ground);
    this.refreshGroundDetail();               // 地面（无地形时）也吃一层沥青骨料
    this.bus0 = null;

    this.gridFine = new THREE.GridHelper(240, 240, 0x39424f, 0x2a3038);
    this.gridFine.position.y = -0.012;
    this.gridFine.material.transparent = true;
    this.gridFine.material.opacity = 0.55;
    this.scene.add(this.gridFine);
    this.gridCoarse = new THREE.GridHelper(240, 24, 0x4d5a6b, 0x3b4552);
    this.gridCoarse.position.y = -0.006;
    this.gridCoarse.material.transparent = true;
    this.gridCoarse.material.opacity = 0.8;
    this.scene.add(this.gridCoarse);

    // --- 天空穹顶 ----------------------------------------------------------
    this.skyUniforms = {
      topColor: { value: new THREE.Color(0x8fb6dd) },
      midColor: { value: new THREE.Color(0xc9d8e6) },
      bottomColor: { value: new THREE.Color(0x2b3038) },
      sunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() },
      sunColor: { value: new THREE.Color(0xfff2d8) },
      sunSize: { value: 0.99935 },
      sunPower: { value: 90 },
      glow: { value: 0.55 },
      groundAlbedo: { value: 0.22 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(2600, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.skyUniforms,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vDir;
          uniform vec3 topColor, midColor, bottomColor, sunDir, sunColor;
          uniform float sunSize, sunPower, glow, groundAlbedo;
          void main(){
            vec3 d = normalize(vDir);
            float h = d.y * 0.5 + 0.5;
            vec3 col = mix(bottomColor, midColor, smoothstep(0.30, 0.503, h));
            col = mix(col, topColor, smoothstep(0.497, 0.95, h));
            float sd = max(dot(d, normalize(sunDir)), 0.0);
            float disc = smoothstep(sunSize, sunSize + 0.0004, sd);
            col += sunColor * disc * 3.0;
            col += sunColor * pow(sd, 12.0) * glow * 0.55;
            col += sunColor * pow(sd, 2.2) * glow * 0.10;
            if (d.y < 0.0) col = mix(col, col * groundAlbedo + vec3(0.02), clamp(-d.y * 6.0, 0.0, 1.0));
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      })
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.scene.add(this.sky);

    // --- 选中高亮 ----------------------------------------------------------
    this.selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffb547);
    this.selBox.visible = false;
    this.selBox.material.depthTest = false;
    this.selBox.material.transparent = true;
    this.scene.add(this.selBox);
    this.selRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false })
    );
    this.selRing.rotation.x = -Math.PI / 2;
    this.selRing.visible = false;
    this.selRing.renderOrder = 800;
    this.scene.add(this.selRing);

    this.raycaster = new THREE.Raycaster();
    this.pickIndex = new PickSpatialIndex(this);
    this.pointer = new THREE.Vector2();
    this.selected = null;
    this.gizmoMode = 'translate';
    this.snapStep = 0.25;
    this.rotateSnap = THREE.MathUtils.degToRad(15);
    this.preview = false;
    this.aspect = 0;
    this.thirds = true;
    this.perfMode = false;
    this._matSwap = new Map();
    this._box = new THREE.Box3();
    this._tmp = new THREE.Vector3();

    this.spaceHeld = false;
    this.previewControls = new PreviewCamControls(this.view, this.canvas);

    this._makeOverlays();
    this._bindPointer();
    this._bindSpaceKey();
    this.setEnv(true);                       // 程序化环境反射（无外部 HDR）
    this.bus = null;
    window.addEventListener('resize', () => this.resize());
  }

  _makeOverlays() {
    this.frame = el('div', { class: 'frame-mask' });
    this.frame.innerHTML =
      '<div class="fb fb-t"></div><div class="fb fb-b"></div>' +
      '<div class="box"><div class="g-v g1"></div><div class="g-v g2"></div><div class="g-h g3"></div><div class="g-h g4"></div>' +
      '<div class="sa"></div><div class="cx"></div></div>';
    this.host.appendChild(this.frame);
    this.frameBox = this.frame.querySelector('.box');
    this.setOverlay();
  }

  setOverlay() {
    const c = this.w / this.h;
    const t = this.aspect || c;
    let bw, bh;
    if (t > c) { bw = 100; bh = (c / t) * 100; }
    else { bh = 100; bw = (t / c) * 100; }
    this.frameBox.style.width = bw.toFixed(4) + '%';
    this.frameBox.style.height = bh.toFixed(4) + '%';
    this.frame.classList.toggle('on', this.preview && !!this.aspect);
    this.frame.classList.toggle('thirds', this.thirds);
    // 变形宽银幕效果：2.39 或 2.76 画幅时自动启用
    const isAnamorphic = Math.abs(t - 2.39) < 0.01 || Math.abs(t - 2.76) < 0.01;
    if (this.anamorphicEnabled !== isAnamorphic) {
      this.anamorphicEnabled = isAnamorphic;
      this.anamorphicPass.enabled = isAnamorphic;
    }
    // 供导出复现取景
    this._letterbox = { bw, bh };
  }

  resize() {
    this.w = Math.max(2, this.host.clientWidth);
    this.h = Math.max(2, this.host.clientHeight);
    this.renderer.setSize(this.w, this.h);
    this.view.aspect = this.w / this.h;
    this.view.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(this.w, this.h);
    this.setOverlay();
  }

  _bindPointer() {
    const c = this.canvas;
    let down = null;
    const toNdc = (ev) => {
      const r = c.getBoundingClientRect();
      this.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      return this.pointer;
    };
    c.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      down = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    });
    c.addEventListener('pointerup', (ev) => {
      if (!down || ev.button !== 0) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      const quick = performance.now() - down.t < 550;
      down = null;
      if (moved > 5 || !quick) return;
      if (this.dragging) return;
      toNdc(ev);
      const hit = this.pick(ev.shiftKey ? null : this.pickFilter);
      this.bus?.emit('click', { hit, ev, ndc: this.pointer.clone() });
    });
    c.addEventListener('pointermove', (ev) => {
      toNdc(ev);
      this.bus?.emit('hover', { ndc: this.pointer.clone() });
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // 拖放模型资源
    c.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    c.addEventListener('drop', (e) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('text/asset') || e.dataTransfer.getData('text/plain');
      if (!type) return;
      toNdc(e);
      const p = this.groundPoint();
      this.bus?.emit('drop', { type, point: p, ndc: this.pointer.clone() });
    });
  }

  _bindSpaceKey() {
    const onDown = (e) => {
      if (e.key !== ' ') return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (!this.spaceHeld) {
        this.spaceHeld = true;
        this.orbit.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      }
    };
    const onUp = (e) => {
      if (e.key !== ' ') return;
      this.spaceHeld = false;
      this.orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
  }

  groundPoint(y = 0) {
    this.raycaster.setFromCamera(this.pointer, this.view);
    const o = this.raycaster.ray.origin.clone();
    const d = this.raycaster.ray.direction;
    if (Math.abs(d.y) < 1e-5) return o.add(d.multiplyScalar(50));
    const t = (y - o.y) / d.y;
    return o.add(d.clone().multiplyScalar(Math.max(t, 0.1)));
  }

  /** 射线拾取场景物体；excludeKind 可过滤 */
  pick() {
    this.raycaster.setFromCamera(this.pointer, this.view);
    return resolvePick(this, this.pickIndex.intersections(this.raycaster));
  }

  setSelected(so) {
    this.selected = so || null;
    if (!so) {
      this.selBox.visible = false;
      this.selRing.visible = false;
      if (this.tc.object && this.tc.object.userData?.so) this.tc.detach();
      return;
    }
    if (so.motion?.behavior || so.motion?.behaviorError) { this.tc.detach(); return; }
    this.tc.attach(so.root);
  }

  setGizmo(mode, space) {
    this.tc.setMode(mode);
    if (space && this.tc.setSpace) this.tc.setSpace(space);
    this.gizmoMode = mode;
    this.bus?.emit('gizmo', mode);
  }
  setSnap(step) {
    this.snapStep = step;
    this.tc.setTranslationSnap(step > 0 ? step : null);
    this.tc.setRotationSnap(step > 0 ? this.rotateSnap : null);
    this.tc.setScaleSnap(step > 0 ? step : null);
  }

  setPerspective() {
    if (this.view.isOrthographicCamera) {
      const pos = this.view.position.clone();
      const target = this.orbit.target.clone();
      this.view = new THREE.PerspectiveCamera(46, this.w / this.h, 0.2, 3000);
      this.view.position.copy(pos);
      this.orbit.object = this.view;
      this.orbit.target.copy(target);
      this.orbit.update();
      this.tc.camera = this.view;
    }
    this.orbit.enabled = true;
    this.orbit.enableRotate = true;
  }

  setOrthoTop() {
    const target = this.orbit.target.clone();
    const dist = this.orbit.getDistance?.() || 30;
    this.view = new THREE.OrthographicCamera(-dist, dist, dist * 0.6, -dist * 0.6, 0.1, 3000);
    this.view.position.set(target.x, target.y + 50, target.z);
    this.view.lookAt(target);
    this.orbit.object = this.view;
    this.orbit.target.copy(target);
    this.orbit.enableRotate = false;
    this.orbit.update();
    this.tc.camera = this.view;
  }

  setPathPreview() {
    this.setPerspective();
    this.orbit.enabled = false;
  }

  /** 内存优先：关闭灯光，所有材质换成无光照版本 */
  /** 地面显隐（星际/虚空场景用），同时决定是否参与拾取 */
  setGroundVisible(v) {
    this.groundWanted = !!v;
    this.ground.visible = this.groundWanted;
    this.syncGrid();
  }
  /** 地面高度：地形开启时要压到地形容器的最低点以下，否则平地会在山谷处「顶穿」地形 */
  setGroundY(y) {
    this.groundBaseY = Number.isFinite(y) ? y : -0.035;
    if (this.ground) this.ground.position.y = this.groundBaseY;
    if (this.gridFine) this.gridFine.position.y = this.groundBaseY + 0.023;
    if (this.gridCoarse) this.gridCoarse.position.y = this.groundBaseY + 0.029;
  }
  /** 网格显隐：优先使用贴合地形的绘制网格；旧平面网格只作兼容回退。 */
  setGridVisible(v) { this.gridWanted = !!v; this.syncGrid(); this.bus?.emit('road-planning'); }
  /** 程序化环境贴图：把天穹烘焙成 128×64 的小图再 PMREM —— 金属 / 玻璃 / 水面立刻有高光与环境色，
   *  不需要任何外部 HDR（保持「单文件 + 省内存」）。
   *  注意：`scene.environment` 在「有 ↔ 无」之间切换会让全场材质重新编译（大场景一次就是几百 ms），
   *  所以刷新时先建好新的、换上去、再释放旧的；改色还要合并成一次。 */
  setEnv(on) {
    const want = !!on;
    this.envOn = want;
    if (this.environmentProvider?.active) { this.environmentProvider.restoreEnvironment(); return; }
    if (want) {
      if (this.envRT) { this.scene.environment = this.envRT.texture; this.view.invalidate?.(); }   // 内存优先退出后要把引用挂回去
      else this._rebuildEnv();
    } else if (this.envRT) {
      this.scene.environment = null; this.view.invalidate?.();
    }
  }
  _rebuildEnv() {
    if (this.environmentProvider?.active) { this.environmentProvider.restoreEnvironment(); return; }
    try {
      const pm = new THREE.PMREMGenerator(this.renderer);
      const src = makeEnvTexture(this._envCols || {});
      const rt = pm.fromEquirectangular(src);
      src.dispose(); pm.dispose();
      const old = this.envRT;
      this.envRT = rt;
      this.scene.environment = rt.texture;
      if (old) old.dispose();
      this.envOn = true;
    } catch (e) { console.warn('env map 生成失败：' + (e && e.message ? e.message : e)); }
    this.view.invalidate?.();
  }
  setEnvIntensity(v) { this.scene.environmentIntensity = clamp(+v || 0, 0, 2); this.view.invalidate?.(); }
  /** 地面材质外观（沥青贴图 + 环境反射）：切精度 / 关贴图 / 切内存优先后都要重挂一次 */
  refreshGroundDetail() {
    if (!this.groundMat || !this.ground) return;
    const g = this.ground, m = this.groundMat;
    m.userData.detail = 'asphalt';
    delete m.userData.detMat; delete g.userData.detDone; delete g.geometry.userData.detFit;
    if (!texOn()) { m.map = m.normalMap = m.roughnessMap = null; m.normalScale = null; m.envMapIntensity = 0.22; m.needsUpdate = true; }
    else applyDetail(g, { nrmScale: 0.3 });     // 大面积地面：浮雕调低，否则远处看成噪声
    this.view.invalidate?.();
  }
  /** 环境贴图颜色跟着氛围预设走（白天 / 黄昏 / 夜景的反射不一样）；
   *  140 ms 内的连续改色只重建一次（拖滑块 / 载入模板时不会每帧重编译全场材质） */
  setEnvColors(c = {}) {
    const key = [c.sky || '-', c.sun || '-', c.ground || '-'].join('|');
    if (key === this._envKey) return;
    this._envKey = key;
    this._envCols = c;
    if (this.envOn === false) return;
    if (this._envTimer) clearTimeout(this._envTimer);
    this._envTimer = setTimeout(() => { this._envTimer = 0; this._rebuildEnv(); }, 140);
  }
  syncGrid() {
    if (this.drawingGrid) {
      this.gridFine.visible = this.gridCoarse.visible = false;
      if (this.gridWanted) this.prepareDrawingGrid?.();
      this.drawingGrid.visible = !!this.gridWanted && !this.preview;
      return true;
    }
    const blocked = !!(this.gridBlocked && this.gridBlocked());
    const on = !!this.gridWanted && !blocked;
    for (const g of [this.gridFine, this.gridCoarse]) if (g) g.visible = on;
    return !blocked;
  }
  setGroundColor(hex) {
    if (!this.groundMat) return;
    const c = new THREE.Color(hex || '#151a21');
    this.groundMat.color.copy(c);
  }

  setPerfMode(on) {
    if (on === this.perfMode) return;
    this.perfMode = on;
    setTexForce(on ? false : null);                       // 内存优先：不生成/不挂表面贴图
    if (this.envRT || !on) this.setEnv(!on);                     // 环境反射一并撤掉
    if (this.appearance) {
      this.appearance.applyAll();
      this.bus?.emit('perf', on);
      return;
    }
    if (on) {
      this.world.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        const src = o.material;
        if (!src || Array.isArray(src) || src.isPoints || src.isLine || src.isSprite) return;
        const flat = new THREE.MeshBasicMaterial({
          color: src.color ? src.color.clone() : new THREE.Color(0x9aa3ad),
          map: src.map || null,
          wireframe: false,
          toneMapped: true,
        });
        this._matSwap.set(o, src);
        o.material = flat;
      });
    } else {
      for (const [o, m] of this._matSwap) o.material = m;
      this._matSwap.clear();
    }
    this.bus?.emit('perf', on);
  }

  applyViewAspect(camAspect, fovTarget) {
    // 预览时锁定水平视角：按容器比例换算垂直 FOV，保证与导出画面一致
    this.view.aspect = camAspect;
    this.view.fov = fovTarget;
    this.view.updateProjectionMatrix();
  }

  /** 只统计「可见」物件的包围盒。three 的 Box3.setFromObject 连隐藏子物件一起算，
   *  于是一扇 1.8 m 的门会因为一根隐藏的贴地大平面被撑出几十米的选中圈 / 线框。 */
  _boxVisible(root, out) {
    out.makeEmpty();
    if (!root) return out;
    root.updateWorldMatrix(true, true);
    const tmp = this._tmpBox || (this._tmpBox = new THREE.Box3());
    root.traverse((o) => {
      if (!o.visible) return;
      if (!o.isMesh && !o.isInstancedMesh) return;
      if (o.isInstancedMesh) {
        if (!o.boundingBox) o.computeBoundingBox();
        if (o.boundingBox && !o.boundingBox.isEmpty()) { out.union(tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld)); return; }
      }
      const geo = o.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) return;
      if (!geo.boundingBox) geo.computeBoundingBox();
      if (!geo.boundingBox || geo.boundingBox.isEmpty()) return;
      out.union(tmp.copy(geo.boundingBox).applyMatrix4(o.matrixWorld));
    });
    return out;
  }

  render() {
    if (!this.preview) {
      this.orbit.update();
    }
    if (this.selected) {
      this._boxVisible(this.selected.root, this._box);
      if (this._box.isEmpty()) this._box.setFromObject(this.selected.root);
      if (!this._box.isEmpty()) {
        this.selBox.box.copy(this._box);
        this.selBox.visible = true;
        this.selRing.visible = true;
        const s = clamp(Math.max(this._box.max.x - this._box.min.x, this._box.max.z - this._box.min.z) * 0.62, 0.4, 40);
        this.selRing.position.set((this._box.min.x + this._box.max.x) / 2, this._box.min.y + 0.02, (this._box.min.z + this._box.max.z) / 2);
        this.selRing.scale.setScalar(s);
      }
    }
    const cam = this.view;
    this.effects?.prepare();
    const usePostProcessing = (this.useComposer && this.bokehPass) || this.anamorphicEnabled || !!this.effects?.pass;
    const priorTarget = this.renderer.getRenderTarget();
    const priorFace = this.renderer.getActiveCubeFace(), priorMip = this.renderer.getActiveMipmapLevel();
    try {
      this.effects?.begin(cam);
      if (usePostProcessing) {
        this.syncPostSize();
        this.renderPass.camera = cam;
        if (this.bokehPass) {
          this.bokehPass.camera = cam;
          const bokehUniforms = this.bokehPass.uniforms;
          if (this.dofParams) {
            bokehUniforms['focus'].value = this.dofParams.focus || 8.0;
            bokehUniforms['aperture'].value = this.dofParams.aperture || 0.025;
            bokehUniforms['maxblur'].value = this.dofParams.maxblur || 0.01;
          }
          bokehUniforms['nearClip'].value = cam.near;
          bokehUniforms['farClip'].value = cam.far;
          bokehUniforms['aspect'].value = cam.aspect;
          this.bokehPass.enabled = this.useComposer;
        }
        this.composer.render();
      } else {
        this.renderer.render(this.scene, cam);
      }
    } catch (error) {
      // A failing post pass must not leave an offscreen framebuffer bound when
      // the next frame switches back to direct rendering (e.g. Bloom disabled).
      this.renderer.setRenderTarget(priorTarget, priorFace, priorMip);
      throw error;
    } finally { this.effects?.end(); }
  }

  syncPostSize() {
    const size = this.postSize || this.renderer.getSize(new THREE.Vector2());
    const ratio = this.postSize ? 1 : this.renderer.getPixelRatio();
    if(this._postWidth!==size.x || this._postHeight!==size.y || this._postRatio!==ratio) {
      this.composer.setPixelRatio(ratio);
      this.composer.setSize(size.x,size.y);
      this._postWidth=size.x;this._postHeight=size.y;this._postRatio=ratio;
    }
  }

  /** 设置景深参数 */
  setDofEnabled(enabled, params = {}) {
    this.useComposer = enabled;
    this.dofParams = params;
  }

  /** 画幅 t 在画布 c 中的水平占比（>1 表示上下留黑边） */
  frameFit(t) {
    const c = this.w / Math.max(1, this.h);
    if (!t || t >= c) return { k: 1, m: t ? c / t : 1, c };
    return { k: t / c, m: 1, c };
  }
  /** 预览取景用：把画幅比例换算成 three 需要的垂直 fov（画布可为任意形状） */
  framingAspect(t) {
    if (this.exportRect) return { canvasAspect: this.exportRect.vw / this.exportRect.vh, eff: this.exportRect.vw / this.exportRect.vh };
    const f = this.frameFit(t);
    return { canvasAspect: f.c, eff: Math.max(0.25, f.c * f.k) };
  }
  /** 在画布上按 frameFit 渲染（黑边由 clear 产生），导出时用，保证与预览逐像素一致 */
  renderFramed(rect) {
    const r = this.renderer;
    if (!rect || (rect.k >= 0.999 && rect.m >= 0.999)) { r.setScissorTest(false); r.setViewport(0, 0, rect ? rect.W : this.w, rect ? rect.H : this.h); this.render(); return; }
    const vw = Math.max(1, Math.round(rect.W * rect.k)), vh = Math.max(1, Math.round(rect.H * rect.m));
    const ox = Math.round((rect.W - vw) / 2), oy = Math.round((rect.H - vh) / 2);
    r.setScissorTest(false);
    r.setViewport(0, 0, rect.W, rect.H);
    r.setScissor(0, 0, rect.W, rect.H);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.setViewport(ox, oy, vw, vh);
    r.setScissor(ox, oy, vw, vh);
    r.setScissorTest(true);
    // Composer passes reset render targets/viewports. Render into an inner-size
    // target, then copy already tone-mapped output into the letterbox viewport.
    const post = this.useComposer || this.anamorphicEnabled ||
      (this.effects?.bloom.enabled && this.effects.bloom.strength > 0 && !this.perfMode);
    const screen = this.composer.renderToScreen;
    try {
      if(post) { this.postSize=new THREE.Vector2(vw,vh);this.composer.renderToScreen=false; }
      this.render();
      if(post) {
        if(!this._frameCopy) this._frameCopy=new FullScreenQuad(new THREE.ShaderMaterial({
          uniforms:THREE.UniformsUtils.clone(CopyShader.uniforms),vertexShader:CopyShader.vertexShader,
          fragmentShader:CopyShader.fragmentShader,depthTest:false,depthWrite:false,toneMapped:false,
        }));
        r.setRenderTarget(null);r.setViewport(ox,oy,vw,vh);r.setScissor(ox,oy,vw,vh);r.setScissorTest(true);
        this._frameCopy.material.uniforms.tDiffuse.value=this.composer.readBuffer.texture;
        this._frameCopy.render(r);
      }
    } finally {
      this.postSize=null;this.composer.renderToScreen=screen;
      r.setScissorTest(false);r.setScissor(0,0,rect.W,rect.H);r.setViewport(0,0,rect.W,rect.H);
      // Keep inner-sized targets between video frames. The next ordinary
      // render synchronizes them to the restored canvas, without per-frame reallocations.
    }
  }
  snapV(v) {
    return snap(v, this.snapStep);
  }
}
