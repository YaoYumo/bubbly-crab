import * as THREE from 'three';
globalThis.THREE = THREE;
globalThis.__noBake = 1;
const A = await import('../src/assets.js');
const lib = A.LIB || A.default;
const types = process.argv.slice(2);
const GAP = 0.03;
for (const g of lib) {
  for (const it of g.items) {
    if (types.length && !types.includes(it.type)) continue;
    let root; try { root = A.buildAsset(it, A.defaultsFor(it)); } catch { continue; }
    root.updateMatrixWorld(true);
    const boxes = [];
    root.traverse(o => {
      if (o.isMesh && o.geometry.attributes.position) {
        const b = new THREE.Box3().setFromObject(o);
        if (b.isEmpty() || !Number.isFinite(b.min.x)) return;
        boxes.push({ b, name: o.userData.marker || o.geometry.type, o });
      }
    });
    // union-find with expanded overlap
    const n = boxes.length;
    const par = Array.from({ length: n }, (_, i) => i);
    const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = boxes[i].b, c = boxes[j].b;
      const ox = Math.min(a.max.x, c.max.x) - Math.max(a.min.x, c.min.x);
      const oy = Math.min(a.max.y, c.max.y) - Math.max(a.min.y, c.min.y);
      const oz = Math.min(a.max.z, c.max.z) - Math.max(a.min.z, c.min.z);
      if (ox >= -GAP && oy >= -GAP && oz >= -GAP) { const ri = find(i), rj = find(j); if (ri !== rj) par[ri] = rj; }
    }
    const groups = new Map();
    for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
    if (groups.size > 1) {
      const sizes = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
      const main = sizes[0];
      console.log(`## ${g.id}:${it.type} 连通分量=${groups.size}`);
      for (const [r, idx] of sizes.slice(1)) {
        const bb = new THREE.Box3();
        for (const i of idx) bb.union(boxes[i].b);
        const s = bb.getSize(new THREE.Vector3());
        console.log(`   浮空 ${idx.length} 件 size=${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)} center=${bb.getCenter(new THREE.Vector3()).toArray().map(v => v.toFixed(2)).join(',')} 例:${boxes[idx[0]].name}`);
      }
    }
  }
}
console.log('scan done');
