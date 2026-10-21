// webm-muxer 5.x stores the last frame's start as Segment Duration. Include
// the final frame's duration, including for a one-frame clip. Parse EBML IDs
// and sizes (never scan compressed payload bytes for a matching byte pattern).
export function setWebMDuration(buffer, milliseconds) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw Error('Invalid WebM duration');
  function element(at, end) {
    function vint(pos, id) {
      if (pos >= end || !bytes[pos]) throw Error('Invalid EBML variable integer');
      let length = 1, marker = 128;
      while (!(bytes[pos] & marker)) { marker >>= 1; length++; }
      if (pos + length > end || (id && length > 4)) throw Error('Truncated EBML element');
      let value = id ? bytes[pos] : bytes[pos] & (marker - 1);
      for (let i = 1; i < length; i++) value = value * 256 + bytes[pos + i];
      return { length, value };
    }
    const id = vint(at, true), size = vint(at + id.length, false), start = at + id.length + size.length;
    const next = start + size.value;
    if (!Number.isSafeInteger(next) || next > end) throw Error('Invalid EBML element size');
    return { id: id.value, start, end: next, size: size.value };
  }
  function find(start, end, wanted) {
    while (start < end) {
      const e = element(start, end);
      if (e.id === wanted) return e;
      start = e.end;
    }
    throw Error('WebM duration metadata missing');
  }
  const segment = find(0, bytes.length, 0x18538067);
  const info = find(segment.start, segment.end, 0x1549a966);
  const duration = find(info.start, info.end, 0x4489);
  if (duration.size !== 8) throw Error('Unsupported WebM duration representation');
  view.setFloat64(duration.start, milliseconds, false);
}
