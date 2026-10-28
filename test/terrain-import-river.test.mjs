import assert from 'node:assert/strict';
import { zlibSync } from 'fflate';
import { crc32, decodeHeightPNG, mappedHeights, cleanHeightMapping } from '../src/terrain-import.js';
import { cleanRiver, carveRiver, riverStrip } from '../src/terrain-river.js';
const tick = async () => {};
const chunk = (name, data) => { const out = new Uint8Array(data.length + 12), v = new DataView(out.buffer); v.setUint32(0, data.length); out.set([...name].map((c) => c.charCodeAt(0)), 4); out.set(data, 8); v.setUint32(out.length - 4, crc32(out.subarray(4, -4))); return out; };
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
export function fixturePNG({ width = 3, height = 3, depth = 16, color = 0, filter = 0, values = null, emptyTail = false } = {}) {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color], bpp = channels * depth / 8, stride = width * bpp;
  const header = new Uint8Array(13), hv = new DataView(header.buffer); hv.setUint32(0, width); hv.setUint32(4, height); header[8] = depth; header[9] = color;
  const source = new Uint8Array(stride * height);
  for (let i = 0; i < width * height * channels; i++) { const v = values?.[i] ?? Math.round(i * (depth === 16 ? 65535 : 255) / Math.max(1, width * height * channels - 1)); if (depth === 16) { source[i * 2] = v >>> 8; source[i * 2 + 1] = v & 255; } else source[i] = v; }
  const raw = new Uint8Array((stride + 1) * height);
  for (let j = 0; j < height; j++) {
    raw[j * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const at = j * stride + x, a = x >= bpp ? source[at - bpp] : 0, b = j ? source[at - stride] : 0, c = j && x >= bpp ? source[at - stride - bpp] : 0;
      let predict = 0;
      if (filter === 1) predict = a; if (filter === 2) predict = b; if (filter === 3) predict = (a + b) >>> 1;
      if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); predict = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw[j * (stride + 1) + x + 1] = (source[at] - predict) & 255;
    }
  }
  return concat(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', header), chunk('IDAT', zlibSync(raw)), ...(emptyTail ? [chunk('IDAT', new Uint8Array())] : []), chunk('IEND', new Uint8Array()));
}
for (const depth of [8, 16]) for (let filter = 0; filter < 5; filter++) {
  const d = await decodeHeightPNG(fixturePNG({ depth, filter }), { checkpoint: tick });
  assert.equal(d.data[0], 0); assert.equal(d.data.at(-1), 1); assert.ok(Math.abs(d.data[4] - .5) < 1 / 255);
}
const d = await decodeHeightPNG(fixturePNG({ values: [10000, 10001, 65535, 0, 32768, 65535, 0, 0, 65535] }), { checkpoint: tick });
assert.ok(d.data[1] > d.data[0]); assert.ok(d.data[1] - d.data[0] < 1 / 255, '16-bit precision lost');
const mapped = await mappedHeights(d, { n: 33, size: 100, base: -2, range: 4 }, tick);
assert.ok(Math.abs(mapped.h[0] - (-2 + 4 * 10000 / 65535)) < 1e-6); assert.equal(mapped.h[32], 2); assert.equal(mapped.h[32 * 33], -2);
const flipped = await mappedHeights(d, { n: 33, flipX: true, base: 3, range: 2 }, tick); assert.equal(flipped.h[0], 5);
const inverse = await mappedHeights(d, { n: 33, flipY: true, invert: true, range: 2 }, tick); assert.equal(inverse.h[0], 2);
assert.equal(cleanHeightMapping({ n: 512, size: NaN, base: Infinity }).n, 513);
assert.equal((await decodeHeightPNG(fixturePNG({ emptyTail: true }), { checkpoint: tick })).data.length, 9);
// Recompute chunk CRC after corrupting zlib checksum / declared dimensions.
const adlerBad = fixturePNG(); const adlerView = new DataView(adlerBad.buffer); const idatStart = 33, idatEnd = idatStart + 8 + adlerView.getUint32(idatStart);
adlerBad[idatEnd - 1] ^= 1; adlerView.setUint32(idatEnd, crc32(adlerBad.subarray(idatStart + 4, idatEnd)));
await assert.rejects(decodeHeightPNG(adlerBad, { checkpoint: tick }), /Adler/);
const mismatch = fixturePNG(); const mismatchView = new DataView(mismatch.buffer); mismatchView.setUint32(16, 2); mismatchView.setUint32(29, crc32(mismatch.subarray(12, 29)));
await assert.rejects(decodeHeightPNG(mismatch, { checkpoint: tick }), /超过|长度/);
const interlaced = fixturePNG(); interlaced[28] = 1; new DataView(interlaced.buffer).setUint32(29, crc32(interlaced.subarray(12, 29)));
await assert.rejects(decodeHeightPNG(interlaced, { checkpoint: tick }), /Adam7/);
const tooWide = fixturePNG(); new DataView(tooWide.buffer).setUint32(16, 4097); new DataView(tooWide.buffer).setUint32(29, crc32(tooWide.subarray(12, 29)));
await assert.rejects(decodeHeightPNG(tooWide, { checkpoint: tick }), /最多/);
const broken = fixturePNG(); broken[broken.length - 5] ^= 1; await assert.rejects(decodeHeightPNG(broken, { checkpoint: tick }), /CRC/);
await assert.rejects(decodeHeightPNG(fixturePNG().subarray(0, 40), { checkpoint: tick }), /截断|结束/);
await assert.rejects(decodeHeightPNG(fixturePNG({ width: 1 }), { checkpoint: tick }), /至少/);
await assert.rejects(decodeHeightPNG(fixturePNG({ color: 4 }), { checkpoint: tick }), /透明/);
const rgb = await decodeHeightPNG(fixturePNG({ color: 2, depth: 8, values: Array.from({ length: 27 }, (_, i) => i % 3 === 1 ? 255 : 0) }), { channel: 'green', checkpoint: tick }); assert.ok(rgb.data.every((v) => v === 1));
await assert.rejects(decodeHeightPNG(fixturePNG(), { checkpoint: async () => { throw Error('cancel'); } }), /cancel/);
const river = { id: 'river-1', points: [[-30, 0, 0], [30, 0, 0]], width: 8, depth: 3, bank: 5 };
assert.throws(() => cleanRiver({ ...river, points: [[0, NaN, 0], [10, 0, 0]] }), /无效/);
assert.throws(() => cleanRiver({ ...river, points: [[-10, 0, -10], [10, 0, 10], [-10, 0, 10], [10, 0, -10]] }), /自交/);
assert.throws(() => cleanRiver({ ...river, points: [[0, 0, 0], [0, 0, 0]] }), /相距/);
assert.throws(() => cleanRiver(river, 40), /边界/);
const before = new Float32Array(65 * 65).fill(2), result = await carveRiver(before, 65, 80, 2, river, tick);
assert.ok(before.every((v) => v === 2)); assert.ok(result.changed > 0); assert.equal(Math.min(...result.h) * 2, -3); assert.equal(result.h[0], 2);
assert.ok(result.h.every((v, i) => v <= before[i]));
const again = await carveRiver(result.h, 65, 80, 2, river, tick); assert.ok(Math.abs(again.h[32 * 65 + 32] - result.h[32 * 65 + 32]) < 1e-6, 'repeat carve deepened core');
await assert.rejects(carveRiver(before, 65, 80, 1, river, async () => { throw Error('cancel'); }), /cancel/); assert.ok(before.every((v) => v === 2));
const strip = riverStrip(river, 80); assert.equal(strip.positions.length, 12); assert.equal(strip.indices.length, 6); assert.ok(strip.positions.every(Number.isFinite));
assert.ok(strip.positions[2] > 0 && strip.positions[5] < 0);
assert.throws(() => riverStrip({ ...river, points: [[-30, 0, 0], [0, 0, 0], [-29, 0, .1]] }, 80), /过尖/);
console.log('PASS PNG 8/16-bit five filters/CRC/Adler/precision/orientation/channels/opaque-alpha/cancel; bounded mapping; river validation/self-crossing, finite miter strip, lower-only/world-depth/source immutability/repeat-core/cancel');
