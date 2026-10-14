// Minimal ZIP writer (stored, no compression), enough for 3MF packages.
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files) {
  const enc = new TextEncoder();
  const entries = Object.entries(files).map(([name, data]) => ({
    name: enc.encode(name),
    data: typeof data === "string" ? enc.encode(data) : data,
  }));
  const parts = [];
  const central = [];
  let offset = 0;
  const DATE = 0x0021; // 1980-01-01
  for (const e of entries) {
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, e.data.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, e.name.length, true);
    parts.push(new Uint8Array(local.buffer), e.name, e.data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(14, DATE, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, e.data.length, true);
    cen.setUint32(24, e.data.length, true);
    cen.setUint16(28, e.name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), e.name);
    offset += 30 + e.name.length + e.data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
