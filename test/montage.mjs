// 全库出图拼接成联系表（视觉总览用）：node test/montage.mjs [每页数量=36]
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('shots');
const PER = +(process.argv[2] || 36);
const COLS = 6;
const TW = 240, TH = 240, LAB = 14;

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8, W = 0, H = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { W = data.readUInt32BE(0); H = data.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = W * 3 + 1;
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    if (raw[y * stride] !== 0) throw new Error('unsupported filter');
    rgb.set(raw.subarray(y * stride + 1, y * stride + 1 + W * 3), y * W * 3);
  }
  return { W, H, rgb };
}
const crcT = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function png(W, H, rgb) {
  const raw = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.png') && !f.startsWith('montage')).sort();
const items = files.map((f) => ({ name: f.replace('.png', ''), img: decodePNG(fs.readFileSync(path.join(OUT, f))) }));

const rows = Math.ceil(PER / COLS);
const PW = COLS * TW, PH = rows * (TH + LAB);
for (let p = 0; p * PER < items.length; p++) {
  const sheet = new Uint8Array(PW * PH * 3).fill(250);
  const put = (x, y, r, g, b) => { const i = (y * PW + x) * 3; sheet[i] = r; sheet[i + 1] = g; sheet[i + 2] = b; };
  const labels = [];
  const slice = items.slice(p * PER, (p + 1) * PER);
  slice.forEach((it, n) => {
    const x0 = (n % COLS) * TW, y0 = Math.floor(n / COLS) * (TH + LAB);
    const { img } = it;
    const sx = img.W / TW, sy = img.H / TH;
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      const s = ((Math.min(img.H - 1, (y * sy) | 0) * img.W + Math.min(img.W - 1, (x * sx) | 0)) * 3);
      put(x0 + x, y0 + y, img.rgb[s], img.rgb[s + 1], img.rgb[s + 2]);
    }
    for (let x = 0; x < TW; x++) for (let y = TH; y < TH + LAB; y++) put(x0 + x, y0 + y, 40, 44, 52);
    labels.push(`  [${n % COLS},${Math.floor(n / COLS)}] ${it.name}`);
  });
  fs.writeFileSync(path.join(OUT, `montage_${p}.png`), png(PW, PH, sheet));
  console.log(`montage_${p}.png (${slice.length}):`);
  console.log(labels.join('\n'));
}
