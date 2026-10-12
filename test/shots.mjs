/**
 * 模型出图台（纯 Node CPU 光栅化，无需浏览器 / WebGL）
 *
 * 每个模型渲 4 个正交视图拼成 2×2 一张图：正视(+Z) / 右侧(+X) / 背面(-Z) / 轴测。
 * 同时输出逐像素构件 ID，据此统计「四个视图都露不了面的构件」—— 白做或被整只包住。
 *
 * 用法：node test/shots.mjs [分组] [类型]
 *   例：node test/shots.mjs house             只渲 house 组
 *       node test/shots.mjs house cape_cod    只渲一个
 */
import * as THREE from 'three';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { LIB, defaultsFor, buildAsset } from '../src/assets.js';

const OUT = path.resolve('shots');
const TILE = 470, PAD = 7;
const SHEET = TILE * 2 + PAD * 3;
const BG = [231, 234, 238];
// [dx, dy, dz, 视图名] = 相机看向物体的方向
const VIEWS = [[0, 0, 1, '正视 +Z'], [1, 0, 0, '右侧 +X'], [0, 0, -1, '背面 -Z'], [1, 0.66, 1, '轴测']];

// ---------- 把整模展平成世界空间三角形 ----------
function collect(root) {
  root.updateMatrixWorld(true);
  const meshes = [];
  let nTri = 0;
  root.traverse((o) => {
    if (!o.isMesh || o.visible === false || !o.geometry?.attributes?.position) return;
    const idx = o.geometry.index, pos = o.geometry.attributes.position;
    const c = idx ? idx.count : pos.count;
    meshes.push({ o, count: c });
    nTri += (c / 3) * (o.isInstancedMesh ? o.count : 1);
  });
  const P = new Float32Array(nTri * 9);
  const C = new Uint8Array(nTri * 3);
  const M = new Int32Array(nTri);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const im = new THREE.Matrix4();
  let k = 0, meshId = 0;
  const names = [];
  for (const rec of meshes) {
    const { o, count } = rec;
    const geo = o.geometry, idx = geo.index, pos = geo.attributes.position;
    const mt = (Array.isArray(o.material) ? o.material[0] : o.material) || {};
    const col = mt.color || { r: 0.75, g: 0.75, b: 0.75 };
    const cr = Math.round(255 * Math.min(1, col.r ?? 0.75));
    const cg = Math.round(255 * Math.min(1, col.g ?? 0.75));
    const cb = Math.round(255 * Math.min(1, col.b ?? 0.75));
    const inst = o.isInstancedMesh ? o.count : 1;
    for (let s = 0; s < inst; s++) {
      if (o.isInstancedMesh) { o.getMatrixAt(s, im); im.premultiply(o.matrixWorld); } else im.copy(o.matrixWorld);
      names.push({ id: meshId, inst: s, hex: '#' + (col.getHexString?.() ?? '------') });
      const myId = meshId++;
      for (let i = 0; i < count; i += 3) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(im);
        b.fromBufferAttribute(pos, i1).applyMatrix4(im);
        c.fromBufferAttribute(pos, i2).applyMatrix4(im);
        const t = k * 9;
        P[t] = a.x; P[t + 1] = a.y; P[t + 2] = a.z;
        P[t + 3] = b.x; P[t + 4] = b.y; P[t + 5] = b.z;
        P[t + 6] = c.x; P[t + 7] = c.y; P[t + 8] = c.z;
        C[k * 3] = cr; C[k * 3 + 1] = cg; C[k * 3 + 2] = cb;
        M[k] = myId; k++;
      }
    }
  }
  return { P, C, M, n: nTri, nMesh: meshId, names };
}

// ---------- 正交光栅化 ----------
function render(T, box, dir, W, H) {
  const zA = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const xA = new THREE.Vector3().crossVectors(up, zA);
  if (xA.lengthSq() < 1e-6) xA.set(1, 0, 0);
  xA.normalize();
  const yA = new THREE.Vector3().crossVectors(zA, xA).normalize();
  const ctr = box.getCenter(new THREE.Vector3());

  const v = new THREE.Vector3();
  let mx = 1e-4, my = 1e-4;
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(ctr);
    mx = Math.max(mx, Math.abs(v.dot(xA))); my = Math.max(my, Math.abs(v.dot(yA)));
  }
  const s = 0.90 * Math.min(W / 2 / mx, H / 2 / my);

  const rgb = new Uint8Array(W * H * 3), id = new Int32Array(W * H).fill(-1);
  for (let i = 0; i < W * H; i++) { rgb[i * 3] = BG[0]; rgb[i * 3 + 1] = BG[1]; rgb[i * 3 + 2] = BG[2]; }
  const zb = new Float32Array(W * H).fill(-Infinity);

  const L = new THREE.Vector3(-0.42, 0.84, 0.34).normalize();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const px = new Float64Array(3), py = new Float64Array(3), pz = new Float64Array(3);
  const P = T.P, C = T.C, M = T.M;

  for (let t = 0; t < T.n; t++) {
    const o = t * 9;
    for (let j = 0; j < 3; j++) {
      const q = o + j * 3;
      v.set(P[q], P[q + 1], P[q + 2]).sub(ctr);
      px[j] = W / 2 + v.dot(xA) * s;
      py[j] = H / 2 - v.dot(yA) * s;
      pz[j] = v.dot(zA);
    }
    const x0 = Math.max(0, Math.floor(Math.min(px[0], px[1], px[2])));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(px[0], px[1], px[2])));
    const y0 = Math.max(0, Math.floor(Math.min(py[0], py[1], py[2])));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(py[0], py[1], py[2])));
    if (x0 > x1 || y0 > y1) continue;

    e1.set(P[o + 3] - P[o], P[o + 4] - P[o + 1], P[o + 5] - P[o + 2]);
    e2.set(P[o + 6] - P[o], P[o + 7] - P[o + 1], P[o + 8] - P[o + 2]);
    nrm.crossVectors(e1, e2);
    if (nrm.lengthSq() < 1e-18) continue;
    nrm.normalize();

    const area = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0]);
    if (area > -1e-9 && area < 1e-9) continue;

    let sh = 0.30 + 0.56 * Math.abs(nrm.dot(L)) + 0.20 * (0.5 + 0.5 * nrm.y);
    if (sh < 0.12) sh = 0.12; else if (sh > 1.12) sh = 1.12;
    const cr = Math.min(255, C[t * 3] * sh), cg = Math.min(255, C[t * 3 + 1] * sh), cb = Math.min(255, C[t * 3 + 2] * sh);
    const mid = M[t];

    for (let y = y0; y <= y1; y++) {
      const fy = y + 0.5, row = y * W;
      for (let x = x0; x <= x1; x++) {
        const fx = x + 0.5;
        const w0 = (px[1] - fx) * (py[2] - fy) - (px[2] - fx) * (py[1] - fy);
        const w1 = (px[2] - fx) * (py[0] - fy) - (px[0] - fx) * (py[2] - fy);
        const w2 = (px[0] - fx) * (py[1] - fy) - (px[1] - fx) * (py[0] - fy);
        if (!((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))) continue;
        const z = (w0 * pz[0] + w1 * pz[1] + w2 * pz[2]) / area;
        const i = row + x;
        if (z <= zb[i]) continue;
        zb[i] = z;
        rgb[i * 3] = cr; rgb[i * 3 + 1] = cg; rgb[i * 3 + 2] = cb;
        id[i] = mid;
      }
    }
  }

  // 地面参照线：底面四边（判断漂浮）
  const gy = box.min.y;
  const cs = [[box.min.x, box.min.z], [box.max.x, box.min.z], [box.max.x, box.max.z], [box.min.x, box.max.z]];
  const pr = ([X, Z]) => { v.set(X, gy, Z).sub(ctr); return [W / 2 + v.dot(xA) * s, H / 2 - v.dot(yA) * s]; };
  for (let i = 0; i < 4; i++) line(rgb, W, H, pr(cs[i]), pr(cs[(i + 1) % 4]), [116, 130, 148]);
  return { rgb, id };
}

function line(buf, W, H, p, q, col) {
  const [x0, y0] = p, [x1, y1] = q;
  const n = Math.max(2, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n);
    for (let d = -1; d <= 1; d++) for (let e = -1; e <= 1; e++) {
      const xx = x + d, yy = y + e;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const k = (yy * W + xx) * 3;
      buf[k] = col[0]; buf[k + 1] = col[1]; buf[k + 2] = col[2];
    }
  }
}

// ---------- PNG ----------
const crcT = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(W, H, rgb) {
  const raw = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 主流程 ----------
const only = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const sheet = new Uint8Array(SHEET * SHEET * 3);
const rows = [];
let done = 0;

for (const g of LIB) {
  if (only[0] && g.id !== only[0]) continue;
  for (const it of g.items) {
    if (only[1] && it.type !== only[1]) continue;
    let root;
    try { root = buildAsset(it, defaultsFor(it)); }
    catch (e) { console.log(`· 跳过 ${g.id}:${it.type}（${e.message}）`); continue; }
    const box = new THREE.Box3().setFromObject(root);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) { console.log(`· 跳过 ${g.id}:${it.type}（空模型）`); continue; }
    const T = collect(root);
    if (!T.n) continue;

    for (let i = 0; i < SHEET * SHEET; i++) { sheet[i * 3] = 245; sheet[i * 3 + 1] = 246; sheet[i * 3 + 2] = 248; }
    const seen = new Uint8Array(T.nMesh);
    let painted = 0;
    // 另渲俯视/仰视，只用于可见性统计（底面、顶面的构件不该被判成"看不见"）
    for (const d of [[0, 1, 0], [0, -1, 0]]) {
      const R = render(T, box, d, TILE >> 1, TILE >> 1);
      for (let i = 0; i < R.id.length; i++) { const m = R.id[i]; if (m >= 0) seen[m] = 1; }
    }
    for (let v = 0; v < 4; v++) {
      const R = render(T, box, VIEWS[v], TILE, TILE);
      const ox = PAD + (v % 2) * (TILE + PAD), oy = PAD + ((v / 2) | 0) * (TILE + PAD);
      for (let y = 0; y < TILE; y++) {
        const di = y * TILE * 3;
        sheet.set(R.rgb.subarray(di, di + TILE * 3), ((oy + y) * SHEET + ox) * 3);
      }
      for (let i = 0; i < TILE * TILE; i++) { const m = R.id[i]; if (m >= 0) { seen[m] = 1; painted++; } }
    }
    process.stdout.write('.');
    fs.writeFileSync(path.join(OUT, `${g.id}_${it.type}.png`), png(SHEET, SHEET, sheet));

    let blind = 0;
    for (let i = 0; i < T.nMesh; i++) if (!seen[i]) blind++;
    const sz = box.getSize(new THREE.Vector3());
    rows.push({
      k: `${g.id}:${it.type}`, nMesh: T.nMesh, blind, painted,
      size: [sz.x, sz.y, sz.z].map((x) => x.toFixed(1)).join('×'),
      y: box.min.y.toFixed(2),
    });
    done++;
  }
}

console.log(`\n出图 ${done} 张 → ${OUT}/`);
const bad = rows.filter((r) => r.blind > 0).sort((a, b) => b.blind - a.blind);
console.log(`\n四个视图都露不了面的构件（0 像素，多半白做或被整只包住）：`);
if (!bad.length) console.log('  （无）');
for (const r of bad.slice(0, 25)) console.log(`  ${r.k.padEnd(26)} 构件 ${String(r.nMesh).padStart(4)}，其中 ${String(r.blind).padStart(3)} 个看不见`);
fs.writeFileSync(path.join(OUT, '_report.json'), JSON.stringify(rows, null, 1));
writeGallery(rows);

function writeGallery(rows) {
  const groups = [];
  for (const g of LIB) groups.push({ id: g.id, name: g.name || g.id });
  const data = rows.map((r) => {
    const [gid, ty] = r.k.split(':');
    return { g: gid, t: ty, f: `${gid}_${ty}.png`, n: r.nMesh, b: r.blind, s: r.size };
  });
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>模型库出图 ${data.length} 张</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f4f5f7;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1c2024}
header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid #dfe3e8;padding:12px 18px}
h1{margin:0 0 10px;font-size:17px;font-weight:600}
.bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
button{font:inherit;font-size:13px;padding:5px 11px;border:1px solid #d3d8de;background:#fff;border-radius:6px;cursor:pointer;color:#3d444d}
button:hover{border-color:#8a93a0}
button.on{background:#2f6fed;border-color:#2f6fed;color:#fff}
input{font:inherit;font-size:13px;padding:5px 10px;border:1px solid #d3d8de;border-radius:6px;width:190px}
.hint{margin-left:auto;font-size:12px;color:#6b7480}
main{padding:14px 18px 60px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(206px,1fr));gap:12px}
.card{background:#fff;border:1px solid #e3e7ec;border-radius:8px;overflow:hidden;cursor:zoom-in}
.card img{display:block;width:100%;aspect-ratio:1;object-fit:cover;background:#eef1f4}
.cap{padding:7px 9px;display:flex;align-items:baseline;gap:6px}
.cap b{font-weight:600;font-size:12.5px}
.grp{font-size:11px;color:#8a93a0;margin-left:auto;white-space:nowrap}
.badge{font-size:11px;color:#a8590d;background:#fdf1de;border:1px solid #f3ddb8;border-radius:4px;padding:0 4px}
#lb{position:fixed;inset:0;background:rgba(16,20,26,.9);display:none;place-items:center;z-index:20;cursor:zoom-out;padding:24px}
#lb.on{display:grid}
#lb img{max-width:min(96vw,900px);max-height:92vh;border-radius:6px;background:#fff}
#lb .t{position:fixed;top:14px;left:0;right:0;text-align:center;color:#e8ecf1;font-size:14px}
</style></head><body>
<header><h1>模型库出图 — ${data.length} 张（正视 / 右侧 / 背面 / 轴测）</h1>
<div class="bar"><span id="g"></span><input id="q" placeholder="搜索类型名…"><span class="hint" id="cnt"></span></div></header>
<main><div class="grid" id="grid"></div></main>
<div id="lb"><div class="t" id="lbt"></div><img id="lbi" alt=""></div>
<script>
const DATA=${JSON.stringify(data)}, GROUPS=${JSON.stringify(groups)};
let cur='', q='', shown=[], idx=0;
const gEl=document.getElementById('g'), grid=document.getElementById('grid'), cnt=document.getElementById('cnt');
const lb=document.getElementById('lb'), lbi=document.getElementById('lbi'), lbt=document.getElementById('lbt');
function draw(){
  shown=DATA.filter(d=>(!cur||d.g===cur)&&(!q||(d.g+':'+d.t).includes(q)));
  grid.innerHTML=shown.map((d,i)=>\`<div class="card" data-i="\${i}">
    <img src="\${d.f}" loading="lazy" alt="\${d.g}:\${d.t}">
    <div class="cap"><b>\${d.t}</b>\${d.b?\`<span class="badge" title="四视图+俯仰视都露不了面的构件数">\${d.b} 隐</span>\`:''}<span class="grp">\${d.g} · \${d.s}</span></div></div>\`).join('');
  cnt.textContent=shown.length+' 张';
}
function open(i){ if(i<0||i>=shown.length)return; idx=i; const d=shown[i];
  lbi.src=d.f; lbt.textContent=\`\${d.g}:\${d.t}　\${d.s} m　\${i+1} / \${shown.length}　← → 翻页，Esc 关闭\`; lb.classList.add('on'); }
gEl.innerHTML='<button data-g="" class="on">全部</button>'+GROUPS.map(g=>\`<button data-g="\${g.id}">\${g.name}</button>\`).join('');
gEl.onclick=e=>{const b=e.target.closest('button');if(!b)return;cur=b.dataset.g;
  [...gEl.children].forEach(x=>x.classList.toggle('on',x===b));draw();};
document.getElementById('q').oninput=e=>{q=e.target.value.trim();draw();};
grid.onclick=e=>{const c=e.target.closest('.card');if(c)open(+c.dataset.i);};
lb.onclick=e=>{if(e.target!==lbi)lb.classList.remove('on');};
document.onkeydown=e=>{
  if(!lb.classList.contains('on'))return;
  if(e.key==='Escape')lb.classList.remove('on');
  else if(e.key==='ArrowRight'){open(idx+1);e.preventDefault();}
  else if(e.key==='ArrowLeft'){open(idx-1);e.preventDefault();}
};
draw();
</script></body></html>`;
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  console.log(`画廊 → ${path.join(OUT, 'index.html')}`);
}

// ---------- ASCII 预览（让没有视觉能力的会话也能核对渲染）----------
if (process.argv.includes('--ascii')) {
  const RAMP = ' .:-=+*#%@';
  const want = only.slice(0, 2);
  for (const g of LIB) {
    if (want[0] && g.id !== want[0]) continue;
    for (const it of g.items) {
      if (want[1] && it.type !== want[1]) continue;
      let root; try { root = buildAsset(it, defaultsFor(it)); } catch { continue; }
      const box = new THREE.Box3().setFromObject(root);
      const T = collect(root);
      if (!T.n) continue;
      const CW = 76, CH = 34;                                  // 字符网格
      const proj = (dir) => {
        const R = render(T, box, dir, CW * 4, CH * 8);         // 超采样后按字符块平均
        const W = CW * 4, H = CH * 8, out = [];
        for (let cy = 0; cy < CH; cy++) {
          let s = '';
          for (let cx = 0; cx < CW; cx++) {
            let sum = 0, n = 0;
            for (let y = cy * 8; y < (cy + 1) * 8; y++) for (let x = cx * 4; x < (cx + 1) * 4; x++) {
              const i = (y * W + x) * 3;
              sum += (R.rgb[i] * 0.299 + R.rgb[i + 1] * 0.587 + R.rgb[i + 2] * 0.114); n++;
            }
            const lum = sum / n;
            const isBg = Math.abs(lum - (BG[0] * 0.299 + BG[1] * 0.587 + BG[2] * 0.114)) < 3;
            s += isBg ? ' ' : RAMP[Math.min(9, Math.max(0, Math.round((232 - lum) / 232 * 9)))];
          }
          out.push(s);
        }
        return out;
      };
      for (const v of VIEWS) {
        console.log(`\n=== ${g.id}:${it.type} — ${v[3]}`);
        for (const l of proj(v)) console.log('|' + l);
      }
    }
  }
}
