// Shared, dependency-light fixture builder for the model library and road accessories.
import * as THREE from "three";
import { M, shade } from "./mat.js";
import { seg } from "./detail.js";
export function buildStreetLamp({ poleHeight: h = 6 }) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, h, seg(10)),
    M.metal(0x444444, 0.5, 0.7),
  );
  pole.position.y = h / 2;
  g.add(pole);
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.1, 0.1),
    M.metal(0x444444, 0.5, 0.7),
  );
  arm.position.set(0.35, h - 0.05, 0);
  g.add(arm);
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xffeecc,
    roughness: 0.3,
    emissive: new THREE.Color(0xffeecc),
    emissiveIntensity: 1.5,
  });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.15), lampMat);
  head.position.set(0.7, h - 0.1, 0);
  g.add(head);
  g.userData.glow = [lampMat];
  shade(g);
  return g;
}
