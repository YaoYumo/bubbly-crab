import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildAsset } from "./assets.js";
import { releaseCandidate } from "./ai-scene-catalog.js";
import { sampleBehavior, behaviorKeys } from "./behavior-program.js";
import { applyAbsoluteCharPose } from "./character.js";
// Standalone renderer and newly built actor; never samples the author's scene.
export class BehaviorPreview {
  constructor(host, draft, actor) {
    this.host = host;
    this.draft = draft;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x171d29);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 5000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(1);
    this.renderer.domElement.style.cssText =
      "width:100%;display:block;touch-action:none";
    this.renderer.domElement.setAttribute("aria-label", "独立多步骤行为预演");
    host.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener("change", () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xddeeff, 0x6b685a, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(10, 25, 15);
    this.scene.add(sun);
    this.content = new THREE.Group();
    this.scene.add(this.content);
    try {
      this.actor = buildAsset(
        actor.item,
        JSON.parse(JSON.stringify(actor.params)),
      );
      this.actor.scale.fromArray(draft.program.scale);
      this.content.add(this.actor);
      const points = behaviorKeys(draft.program).map((k) =>
        new THREE.Vector3(...k.p).add(new THREE.Vector3(0, 0.03, 0)),
      );
      this.content.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: 0x66e6bb }),
        ),
      );
      const bounds = new THREE.Box3().setFromPoints(points),
        size = bounds.getSize(new THREE.Vector3()),
        center = bounds.getCenter(new THREE.Vector3());
      this.center = center;
      const r = Math.max(7, size.x, size.z) + 4;
      const grid = new THREE.GridHelper(
        Math.min(120, r * 2),
        Math.min(80, Math.ceil(r * 2)),
        0x526981,
        0x293447,
      );
      grid.position.copy(center);
      grid.position.y = -0.02;
      this.content.add(grid);
      for (const b of draft.obstacles) {
        const sx = b.max[0] - b.min[0],
          sz = b.max[1] - b.min[1];
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(
            Math.max(0.01, sx),
            draft.program.request.height,
            Math.max(0.01, sz),
          ),
          new THREE.MeshBasicMaterial({
            color: 0x75849c,
            wireframe: true,
            transparent: true,
            opacity: 0.35,
          }),
        );
        m.position.set(
          (b.min[0] + b.max[0]) / 2,
          draft.program.request.height / 2,
          (b.min[1] + b.max[1]) / 2,
        );
        this.content.add(m);
      }
      this.camera.position.set(
        center.x + r * 0.7,
        r * 0.65,
        center.z + r * 0.8,
      );
      this.controls.target.copy(center);
      this.controls.update();
      this.at(0);
      this.resize = new ResizeObserver(() => this.render());
      this.resize.observe(host);
    } catch (e) {
      this.dispose();
      throw e;
    }
  }
  at(seconds) {
    const s = sampleBehavior(this.draft.program, seconds);
    this.actor.position.fromArray(s.p);
    this.actor.rotation.set(0, s.yaw, 0);
    applyAbsoluteCharPose(this.actor, s.anim, s.phase);
    this.render();
    return s;
  }
  render() {
    if (this.disposed) return;
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(200, Math.min(390, w * 0.58));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resize?.disconnect();
    this.controls?.dispose();
    releaseCandidate(this.content);
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer?.domElement.remove();
  }
}
