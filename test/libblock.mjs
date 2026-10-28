/**
 * 门窗遮挡 / 被埋检查器（射线求交版）
 *
 * 1) 找出所有玻璃（userData.role='glass'）和门扇（role='doorleaf'）
 * 2) 外法线：优先用所属 winUnit / doorUnit 组件自身的世界 +Z（约定「+Z = 墙外法线」）
 * 3) 在面板外表面撒 5×5 个采样点，从外侧朝里打射线：
 *      第一个命中的物体若不属于本门窗组件 → 该点被挡
 *    遮挡率 = 被挡点数 / 总点数
 * 4) 另判「被埋」：面板中心落在别的件 bbox 内部，且那件的三向尺寸都比面板大
 *
 * 用法：node test/libblock.mjs [分组] [类型]
 */
import * as THREE from 'three';
import { LIB, defaultsFor, buildAsset } from '../src/assets.js';

const V = () => new THREE.Vector3();
const r2 = (v) => Math.round(v * 100) / 100;

function pieces(root) {
  root.updateMatrixWorld(true);
  const out = [];
  const m4 = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m4);
        out.push({ box: g.boundingBox.clone().applyMatrix4(m4).applyMatrix4(o.matrixWorld), mesh: o, inst: i });
      }
    } else {
      out.push({ box: g.boundingBox.clone().applyMatrix4(o.matrixWorld), mesh: o, inst: -1 });
    }
  });
  return out;
}

/** 往上找到所属门窗组件（winUnit / doorUnit 打的 role 标记） */
const unitOf = (o) => {
  let c = o;
  while (c) { const r = c.userData && c.userData.role; if (r === 'window' || r === 'door') return c; c = c.parent; }
  return null;
};
const matName = (m) => (m ? '#' + m.color.getHexString() : '?');

function check(item) {
  const root = buildAsset(item, defaultsFor(item));
  const all = pieces(root);
  const panels = all.filter((p) => {
    const mm = p.mesh.material;
    return (mm && mm.userData && mm.userData.role === 'glass') || p.mesh.userData.role === 'doorleaf';
  });
  if (!panels.length) return [];

  const ray = new THREE.Raycaster();
  const issues = [];
  // 起射距离：保证起点在整模之外，否则「整扇埋进墙里」的情况测不到墙
  const whole = new THREE.Box3();
  for (const p of all) whole.union(p.box);
  const D = 1.0 + whole.getSize(V()).length();
  ray.far = D + 0.6;

  for (const pan of panels) {
    const pb = pan.box, psz = pb.getSize(V());
    const axes = ['x', 'y', 'z'];
    const thin = axes.reduce((a, b) => (psz[a] <= psz[b] ? a : b));
    if (psz[thin] > 0.3) continue;

    const pc = pb.getCenter(V());
    const half = psz[thin] / 2;
    let n = null;
    const u = unitOf(pan.mesh);
    if (u) n = V().set(0, 0, 1).transformDirection(u.matrixWorld).normalize();
    if (!n || Math.abs(n[thin]) < 0.5) {
      // 裸玻璃盒（没挂 winUnit/doorUnit）：朝薄轴两侧各探 0.6m，哪边更空旷哪边是墙外
      const ctr = new THREE.Box3();
      for (const p of all) ctr.union(p.box);
      const cSign = Math.sign(pb.getCenter(V())[thin] - ctr.getCenter(V())[thin]) || 1;
      const probe = new THREE.Raycaster(); probe.far = 3.0;
      const base = pc.clone();
      const clear = (s) => {
        const dir = V(); dir[thin] = s;
        probe.set(base.clone().addScaledVector(dir, half + 0.02), dir);
        const h = probe.intersectObject(root, true)
          .filter((x) => x.object !== pan.mesh && !(unitOf(x.object) === u && u))[0];
        return h ? h.distance : probe.far;
      };
      const cp = clear(1), cm = clear(-1);
      const s = cp === cm ? cSign : (cp > cm ? 1 : -1);
      n = V(); n[thin] = s;
    }
    const outer = pc.clone().addScaledVector(n, half);

    // 平面内两个切向
    const t1 = axes.filter((a) => a !== thin);
    const uu = V(); uu[t1[0]] = 1; uu[t1[1]] = 0;
    const vv = V(); vv[t1[0]] = 0; vv[t1[1]] = 1;

    const N = 5;
    let blocked = 0, tot = 0, missed = 0;
    const blockers = new Map();
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const fx = ((i + 0.5) / N - 0.5) * psz[t1[0]] * 0.86;
      const fy = ((j + 0.5) / N - 0.5) * psz[t1[1]] * 0.86;
      // 从模型外侧远处朝面板打，第一个命中即「挡在它前面的东西」
      const pt = outer.clone().addScaledVector(uu, fx).addScaledVector(vv, fy).addScaledVector(n, D);
      ray.set(pt, n.clone().negate());
      const hits = ray.intersectObject(root, true);
      tot++;
      let first = null;
      for (const h of hits) {
        if (h.object === pan.mesh && (h.instanceId ?? -1) === pan.inst) { first = h; break; }   // 第一个打到面板 → 通
        if (unitOf(h.object) === u && u) continue;                                      // 同组件的窗棂/门芯板/窗套 → 不算挡
        first = h; break;                                                               // 打到别人 → 挡
      }
      if (!first) { missed++; continue; }
      if (first.distance < D - 2.5) continue;                                       // 2.5m 以外是对景，不算遮挡                                               // 射线没打到面板（面板朝向异常）
      if ((first.instanceId ?? -1) === pan.inst && first.object === pan.mesh) continue;
      const fb = first.object.geometry.boundingBox
        ? first.object.geometry.boundingBox.clone().applyMatrix4(first.object.matrixWorld).getSize(V()) : null;
      if (fb && Math.min(fb.x, fb.y, fb.z) < 0.06) continue;                         // 栏杆/窗棂这类细杆不算遮挡
      blocked++;
      const o = first.object;
      const sz = o.geometry.boundingBox ? o.geometry.boundingBox.clone()
        .applyMatrix4(o.matrixWorld).getSize(V()).toArray().map(r2).join('x') : '?';
      const ctr = o.matrixWorld ? V().setFromMatrixPosition(o.matrixWorld).toArray().map(r2).join(',') : '?';
      const key = matName(o.material) + '|' + sz + '|@' + ctr;
      blockers.set(key, (blockers.get(key) || 0) + 1);
    }
    const frac = blocked / Math.max(1, tot);
    const lost = missed / Math.max(1, tot);

    if (frac > 0.25 || lost > 0.6) {
      const top = [...blockers.entries()].sort((a, b) => b[1] - a[1])[0];
      issues.push({
        frac: r2(frac),
        panel: `${psz.x.toFixed(2)}x${psz.y.toFixed(2)}x${psz.z.toFixed(2)}@${pc.toArray().map(r2).join(',')}`,
        panelMat: matName(pan.mesh.material),
        blocker: lost > 0.6 ? `面板背朝外（${(lost * 100).toFixed(0)}% 采样点打不到面板本身）` : top[0],
        n: (top ? top[1] : 0),
      });
    }
  }
  const map = new Map();
  for (const i of issues) {
    const k = i.blocker + '|' + i.panelMat;
    if (!map.has(k)) map.set(k, { ...i, cnt: 1 });
    else { const m = map.get(k); m.cnt++; m.n += i.n; if (i.frac > m.frac) m.panel = i.panel, m.frac = i.frac; }
  }
  return [...map.values()];
}

const only = process.argv.slice(2);
let bad = 0, total = 0;
for (const g of LIB) {
  if (only[0] && g.id !== only[0]) continue;
  for (const it of g.items) {
    if (only[1] && it.type !== only[1]) continue;
    total++;
    let res;
    try { res = check(it); } catch (e) { console.log(`✗ ${g.id}:${it.type} 抛错: ${e.message}`); bad++; continue; }
    if (!res.length) continue;
    bad++;
    const shown = res.sort((a, b) => b.cnt - a.cnt).slice(0, 6);
    console.log(`✗ ${g.id}:${it.type}`);
    for (const i of shown)
      console.log(`   · 遮挡 ${(i.frac * 100).toFixed(0)}%${i.cnt > 1 ? ' ×' + i.cnt + ' 块' : ''}  门窗板 ${i.panel} ${i.panelMat}\n       ${i.blocker}`);
    if (res.length > 6) console.log(`   … 另有 ${res.length - 6} 组`);
  }
}
console.log(`\n检查 ${total} 个模型，${bad} 个有问题。`);
