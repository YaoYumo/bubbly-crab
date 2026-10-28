import { Unzlib } from 'fflate';

export const HEIGHT_LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, pixels: 4 * 1024 * 1024, side: 4096 });
const table = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
export function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
/** Decode PNG samples directly: no canvas, color management, gamma or 16→8 bit conversion.
 * Non-interlaced grayscale/RGB with optional fully opaque alpha, depth 8/16 only.
 * Bounded streaming inflate, CRC and Adler validation; unknown critical chunks fail closed.
 */
export async function decodeHeightPNG(input, { channel = 'red', checkpoint = pause } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > HEIGHT_LIMITS.bytes || !signature.every((v, i) => bytes[i] === v)) throw Error('请选择 16MB 内的 PNG 高度图');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), chunks = [];
  let at = 8, width, height, depth, color, channels, ended = false, idatEnded = false;
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at), start = at + 4, end = at + 8 + length;
    if (end + 4 > bytes.length) throw Error('PNG 数据截断');
    const type = String.fromCharCode(...bytes.subarray(start, start + 4));
    if (crc32(bytes.subarray(start, end)) !== view.getUint32(end)) throw Error('PNG 校验失败（CRC）');
    if (width === undefined && type !== 'IHDR') throw Error('PNG 缺少头信息');
    if (type === 'IHDR') {
      if (width !== undefined || length !== 13) throw Error('PNG 头信息无效');
      width = view.getUint32(at + 8); height = view.getUint32(at + 12); depth = bytes[at + 16]; color = bytes[at + 17];
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
      if (width < 2 || height < 2 || width > HEIGHT_LIMITS.side || height > HEIGHT_LIMITS.side || width * height > HEIGHT_LIMITS.pixels) throw Error('高度图需至少 2×2、最多 4096 单边且不超过 4194304 像素');
      if (![8, 16].includes(depth) || !channels || bytes[at + 18] || bytes[at + 19] || bytes[at + 20]) throw Error('高度图仅支持非交错的 8/16 位灰度或 RGB PNG，不支持调色板 / Adam7');
    } else if (type === 'IDAT') {
      if (idatEnded) throw Error('PNG IDAT 顺序无效');
      chunks.push(bytes.subarray(at + 8, end));
    } else if (type === 'IEND') {
      if (length || !chunks.length || end + 4 !== bytes.length) throw Error('PNG 结束信息无效');
      ended = true; break;
    } else {
      if (chunks.length) idatEnded = true;
      if (type === 'tRNS') throw Error('高度图不能含透明 / 缺失高程，请先导出不透明 PNG');
      if (!(bytes[start] & 32)) throw Error('高度图包含不支持的 PNG 块：' + type);
    }
    at = end + 4; await checkpoint();
  }
  if (!ended) throw Error('PNG 缺少结束块');
  const bpp = channels * (depth / 8), stride = width * bpp, expected = height * (stride + 1);
  const raw = new Uint8Array(expected); let written = 0, s1 = 1, s2 = 0;
  const inflate = new Unzlib((data) => {
    if (written + data.length > expected) throw Error('PNG 解压尺寸超过声明范围');
    raw.set(data, written); written += data.length;
    for (const b of data) { s1 = (s1 + b) % 65521; s2 = (s2 + s1) % 65521; }
  });
  for (let c = 0; c < chunks.length; c++) for (let i = 0; i < chunks[c].length; i += 1024) {
    inflate.push(chunks[c].subarray(i, i + 1024), c === chunks.length - 1 && i + 1024 >= chunks[c].length);
    if (i % 65536 === 0) await checkpoint();
  }
  // Zlib checksum may span separate IDAT chunks.
  const tail = [];
  for (let c = chunks.length - 1; c >= 0 && tail.length < 4; c--) for (let i = chunks[c].length - 1; i >= 0 && tail.length < 4; i--) tail.push(chunks[c][i]);
  const adler = ((s2 << 16) | s1) >>> 0, stored = ((tail[3] << 24) | (tail[2] << 16) | (tail[1] << 8) | tail[0]) >>> 0;
  if (written !== expected || adler !== stored) throw Error('PNG 解压长度或校验失败（Adler）');
  const data = new Float32Array(width * height), max = depth === 16 ? 65535 : 255;
  const sample = (offset) => depth === 16 ? (raw[offset] * 256 + raw[offset + 1]) / max : raw[offset] / max;
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1) + 1, prev = row - stride - 1, filter = raw[row - 1];
    if (filter > 4) throw Error('PNG 行过滤器无效');
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? raw[row + x - bpp] : 0, b = y ? raw[prev + x] : 0, c = y && x >= bpp ? raw[prev + x - bpp] : 0;
      let predict = 0;
      if (filter === 1) predict = a; else if (filter === 2) predict = b; else if (filter === 3) predict = (a + b) >>> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); predict = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw[row + x] = (raw[row + x] + predict) & 255;
    }
    for (let x = 0; x < width; x++) {
      const p = row + x * bpp, step = depth / 8;
      if ((color === 4 || color === 6) && sample(p + (channels - 1) * step) !== 1) throw Error('高度图包含透明 / 缺失高程，请先导出不透明 PNG');
      const r = sample(p), g = channels >= 3 ? sample(p + step) : r, b = channels >= 3 ? sample(p + step * 2) : r;
      data[y * width + x] = channel === 'green' ? g : channel === 'blue' ? b : channel === 'luma' ? .2126 * r + .7152 * g + .0722 * b : r;
    }
    if (y % 16 === 0) await checkpoint();
  }
  return { data, width, height, depth, color, channel };
}
export function cleanHeightMapping(v = {}) {
  const num = (key, def, lo, hi) => typeof v[key] === 'number' && Number.isFinite(v[key]) ? Math.max(lo, Math.min(hi, v[key])) : def;
  return { size: num('size', 160, 40, 4096), n: Math.max(33, Math.min(513, Math.round(num('n', 129, 33, 513)))) | 1,
    base: num('base', 0, -5000, 5000), range: num('range', 30, 0, 5000), flipX: v.flipX === true, flipY: v.flipY === true, invert: v.invert === true };
}
export function sampleGrid(data, width, height, u, v) {
  const x = Math.max(0, Math.min(1, u)) * (width - 1), y = Math.max(0, Math.min(1, v)) * (height - 1);
  const i = Math.min(width - 2, Math.floor(x)), j = Math.min(height - 2, Math.floor(y)), fx = x - i, fy = y - j;
  return (data[j * width + i] * (1 - fx) + data[j * width + i + 1] * fx) * (1 - fy) + (data[(j + 1) * width + i] * (1 - fx) + data[(j + 1) * width + i + 1] * fx) * fy;
}
export async function mappedHeights(decoded, input, checkpoint = pause) {
  const p = cleanHeightMapping(input), h = new Float32Array(p.n * p.n);
  for (let j = 0; j < p.n; j++) {
    for (let i = 0; i < p.n; i++) {
      let value = sampleGrid(decoded.data, decoded.width, decoded.height, p.flipX ? 1 - i / (p.n - 1) : i / (p.n - 1), p.flipY ? 1 - j / (p.n - 1) : j / (p.n - 1));
      if (p.invert) value = 1 - value;
      h[j * p.n + i] = p.base + value * p.range;
    }
    if (j % 16 === 0) await checkpoint();
  }
  return { h, settings: p };
}
