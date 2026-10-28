import * as THREE from "three";
import { cleanPrimitiveParts, DEFAULT_PARTS } from "./primitive-model-spec.js";
export function buildPrimitiveModel(params = {}) {
  const parts = cleanPrimitiveParts(params.parts ?? DEFAULT_PARTS),
    root = new THREE.Group();
  for (const p of parts) {
    const geometry =
      p.shape === "box"
        ? new THREE.BoxGeometry(1, 1, 1)
        : p.shape === "sphere"
          ? new THREE.SphereGeometry(0.5, 16, 12)
          : p.shape === "cylinder"
            ? new THREE.CylinderGeometry(0.5, 0.5, 1, 16)
            : p.shape === "cone"
              ? new THREE.ConeGeometry(0.5, 1, 16)
              : p.shape === "capsule"
                ? new THREE.CapsuleGeometry(0.25, 0.5, 4, 12)
                : new THREE.TorusGeometry(0.35, 0.15, 8, 20);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: p.color,
        roughness: 0.72,
        metalness: 0.04,
      }),
    );
    mesh.name = p.name;
    mesh.position.fromArray(p.pos);
    mesh.rotation.set(...p.rot);
    mesh.scale.fromArray(p.size);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  root.userData.primitiveModel = true;
  return root;
}
export const PRIMITIVE_GROUP = {
  id: "generated",
  cat: "AI粗模",
  items: [
    {
      type: "ai_primitive",
      name: "AI组合粗模",
      icon: "props",
      build: buildPrimitiveModel,
      params: [
        {
          k: "parts",
          l: "AI部件结构",
          t: "primitive-model",
          def: DEFAULT_PARTS,
        },
      ],
    },
  ],
};
