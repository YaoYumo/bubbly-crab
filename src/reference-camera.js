import * as THREE from 'three';
export class ReferenceCamera {
  constructor(app, subjectId) {
    this.app = app; this.subject = app.byId(subjectId) || app.activeShot?.target || null; this.boxes = [];
    app.stage.scene.updateMatrixWorld(true);
    for (const o of app.objects) if (o.type !== 'fx' && o.root.visible) {
      const box = new THREE.Box3().setFromObject(o.root); if (box.isEmpty()) continue;
      this.boxes.push({ o, local: box.clone().applyMatrix4(o.root.matrixWorld.clone().invert()) });
    }
  }
  sample(index, fps, diagnose = true) {
    const a = this.app, cam = a.stage.view, rect = a.stage.exportRect; cam.updateMatrixWorld(true);
    const pos = cam.getWorldPosition(new THREE.Vector3()), q = cam.getWorldQuaternion(new THREE.Quaternion()), p = cam.projectionMatrix.elements;
    const frame = { index, time: index / fps, timestampUs: Math.round(index * 1e6 / fps), position: pos.toArray(), quaternion: q.toArray(), projectionMatrix: cam.projectionMatrix.toArray(), worldMatrix: cam.matrixWorld.toArray(), viewMatrix: cam.matrixWorldInverse.toArray(),
      near: cam.near, far: cam.far, vfovDegrees: cam.fov, hfovDegrees: THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect)),
      viewport: { x: Math.round((rect.W - rect.vw) / 2), y: Math.round((rect.H - rect.vh) / 2), width: rect.vw, height: rect.vh },
      intrinsics: { fx: p[0] * rect.vw / 2, fy: p[5] * rect.vh / 2, cx: rect.W / 2 - p[8] * rect.vw / 2, cy: rect.H / 2 + p[9] * rect.vh / 2, pixelOrigin: 'top-left', cameraAxes: 'OpenGL: +X right, +Y up, forward -Z' }, diagnosticSample: diagnose };
    if (!diagnose) return frame;
    frame.groundClearance = a.terrain?.enabled && Math.abs(pos.x) <= a.terrain.size / 2 && Math.abs(pos.z) <= a.terrain.size / 2 ? pos.y - a.terrain.heightAt(pos.x, pos.z) : (a.stage.ground.visible && Math.abs(pos.x) <= 600 && Math.abs(pos.z) <= 600 ? pos.y - a.stage.ground.position.y : null);
    frame.proximityIds = []; frame.proximityThreshold = Math.max(.25, cam.near);
    frame.collisionIds = []; const meshes = [], boxes = new Map();
    for (const { o, local } of this.boxes) if (o.root.visible) {
      o.root.updateWorldMatrix(true, true); const b = local.clone().applyMatrix4(o.root.matrixWorld); boxes.set(o, b);
      if (b.containsPoint(pos)) frame.collisionIds.push(o.id); else if (b.distanceToPoint(pos) < frame.proximityThreshold) frame.proximityIds.push(o.id); o.root.traverseVisible(n => { if (n.isMesh && !n.userData.pickIgnore) meshes.push(n); });
    }
    if (a.terrain?.enabled && a.terrain.mesh.visible) meshes.push(a.terrain.mesh);
    if (a.stage.ground.visible) meshes.push(a.stage.ground);
    const subject = this.subject, box = boxes.get(subject);
    if (subject && box) {
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const center = box.getCenter(new THREE.Vector3()), half = box.getSize(new THREE.Vector3()).multiplyScalar(.25);
      const points = [center, center.clone().add(new THREE.Vector3(half.x, half.y, 0)), center.clone().add(new THREE.Vector3(-half.x, half.y, 0)), center.clone().add(new THREE.Vector3(half.x, -half.y, 0)), center.clone().add(new THREE.Vector3(-half.x, -half.y, 0))];
      const own = new Set(); subject.root.traverse(n => own.add(n)); let visible = 0;
      for (const point of points) {
        if (!frustum.containsPoint(point)) continue;
        const dir = point.clone().sub(pos), ray = new THREE.Raycaster(pos, dir.clone().normalize(), cam.near, dir.length() + .1), hit = ray.intersectObjects(meshes, false)[0];
        if (hit && own.has(hit.object)) visible++;
      }
      frame.subject = { id: subject.id, inFrame: frustum.intersectsBox(box), visibleSamples: visible, testedSamples: 5 };
    }
    return frame;
  }
}
