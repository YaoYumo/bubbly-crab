import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { releaseCandidate } from './ai-scene-catalog.js';
// Own scene/camera/renderer only. No App constructor, world registry, undo or autosave.
export class AIScenePreview {
  constructor(host) {
    this.host = host;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x171d29);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(640, 360);
    this.renderer.domElement.setAttribute('aria-label', '独立候选场景预览');
    host.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xddeeff, 0x6b685a, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(40, 80, 30);
    this.scene.add(sun);
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.owned = [];
    this.clones = [];
    this.resize = new ResizeObserver(() => this.render());
    this.resize.observe(host);
  }
  clear() {
    for (const root of this.owned) releaseCandidate(root);
    for (const root of this.clones) root.removeFromParent();
    this.owned = [];
    this.clones = [];
  }
  show(draft) {
    this.clear();
    this.draft = draft;
    for (const root of draft.roots.values()) {
      const copy = root;
      this.clones.push(copy);
      this.content.add(copy);
    }
    const removed = new Set(draft.changes.removed),
      changed = new Set(draft.changes.modified);
    for (const [id, box] of [...draft.sourceBoxes].slice(0, 1000))
      if (!removed.has(id) && !changed.has(id) && !box.isEmpty()) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(...box.getSize(new THREE.Vector3()).toArray()),
          new THREE.MeshBasicMaterial({
            color: 0x586777,
            wireframe: true,
            transparent: true,
            opacity: 0.35,
          }),
        );
        mesh.position.copy(box.getCenter(new THREE.Vector3()));
        this.content.add(mesh);
        this.owned.push(mesh);
      }
    for (const o of draft.document.objects.filter(
      (o) => o.type === 'road_brush' && draft.changes.added.includes(o.id),
    )) {
      const pts = o.points.map((p) => new THREE.Vector3(...p));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xf1bb67 }),
      );
      this.content.add(line);
      this.owned.push(line);
    }
    for (const shot of draft.document.shots.filter((s) =>
      s.id.startsWith(draft.plan.id + '-camera-'),
    )) {
      const matrix = new THREE.Matrix4().compose(
          new THREE.Vector3(...shot.pos),
          new THREE.Quaternion(...shot.quat),
          new THREE.Vector3(1, 1, 1),
        ),
        pts = (shot.mover?.keys || []).map((k) =>
          new THREE.Vector3(...k.p).applyMatrix4(matrix),
        );
      if (pts.length > 1) {
        const path = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0x82edac }),
        );
        this.content.add(path);
        this.owned.push(path);
      }
    }
    const [x, z] = draft.plan.bounds.center,
      [w, d] = draft.plan.bounds.size;
    const boundary = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        [
          [x - w / 2, 0, z - d / 2],
          [x + w / 2, 0, z - d / 2],
          [x + w / 2, 0, z + d / 2],
          [x - w / 2, 0, z + d / 2],
        ].map((p) => new THREE.Vector3(...p)),
      ),
      new THREE.LineBasicMaterial({ color: 0x62c9cc }),
    );
    this.content.add(boundary);
    this.owned.push(boundary);
    this.perspective();
  }
  perspective() {
    if (!this.draft) return;
    const {
        center: [x, z],
        size,
      } = this.draft.plan.bounds,
      r = Math.max(...size);
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(x + r * 0.75, r * 0.65, z + r * 0.75);
    this.controls.target.set(x, 0, z);
    this.controls.update();
    this.render();
  }
  top() {
    if (!this.draft) return;
    const {
      center: [x, z],
      size,
    } = this.draft.plan.bounds;
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(x, Math.max(...size) * 1.4, z);
    this.controls.target.set(x, 0, z);
    this.controls.update();
    this.render();
  }
  render() {
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(240, Math.min(420, w * 0.55));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.clear();
    this.resize.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
