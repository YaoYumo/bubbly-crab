import * as THREE from 'three';
import { unzlibSync } from 'fflate';
import { PAGODA_BYTES, PAGODA_INFO } from './geometry.js';
export { PAGODA_INFO };
let pagodaBuffer;
export function createPagodaGeometry() {
  if (!pagodaBuffer) {
    const packed = Uint8Array.from(atob(PAGODA_BYTES), c=>c.charCodeAt(0));
    const raw = unzlibSync(packed);
    if(raw.byteLength !== PAGODA_INFO.rawBytes)throw Error('Pagoda内置模型数据不完整');
    pagodaBuffer = raw.slice().buffer;
  }
  const geo = new THREE.BufferGeometry();
  for(const [name,a] of Object.entries(PAGODA_INFO.attributes)) {
    // Each placed object owns its attributes: rebuild/disposal must never damage copies.
    const array = new Float32Array(pagodaBuffer,a.offset,a.length).slice();
    geo.setAttribute(name,new THREE.BufferAttribute(array,a.itemSize));
  }
  geo.computeBoundingBox();geo.computeBoundingSphere();
  return geo;
}
export function buildPagoda(params = {}) {
  const height = Number.isFinite(Number(params.height)) ? THREE.MathUtils.clamp(Number(params.height),1,120) : PAGODA_INFO.sourceBounds.size[1];
  const color = typeof params.color === 'string' && /^#[0-9a-f]{6}$/i.test(params.color) ? params.color : '#c4c6c8';
  const root = new THREE.Group(); root.name = 'Pagoda 宝塔';
  const material = new THREE.MeshStandardMaterial({color,roughness:.82,metalness:0});
  material.name = 'Pagoda 中性灰（原文件未提供材质）';
  const mesh = new THREE.Mesh(createPagodaGeometry(),material);
  mesh.name='Pagoda static mesh';mesh.scale.setScalar(height/PAGODA_INFO.sourceBounds.size[1]);
  mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
  root.userData.userModel = { id:'pagoda-v1',source:'Pagoda.gltf',sourceSHA256:PAGODA_INFO.sourceSHA256,materialMissing:true,unitAssumption:'source unit interpreted as meter',staticMerged:true };
  return root;
}
