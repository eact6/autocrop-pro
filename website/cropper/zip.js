const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

/**
 * @param {Uint8Array} buf
 */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

/**
 * Uncompressed ZIP (STORE). Avoids extra CDN deps.
 * @param {{ name: string, blob: Blob }[]} entries
 * @returns {Promise<Blob>}
 */
export async function buildZip(entries) {
  const encoder = new TextEncoder();
  const chunks = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name.replace(/\\/g, "/"));
    const data = new Uint8Array(await entry.blob.arrayBuffer());
    const crc = crc32(data);
    const size = data.length;

    const local = [
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ];
    const localSize = 30 + nameBytes.length + size;
    chunks.push(...local);

    const central = [
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ];
    centrals.push({ parts: central, size: 46 + nameBytes.length });
    offset += localSize;
  }

  let centralSize = 0;
  for (const c of centrals) {
    chunks.push(...c.parts);
    centralSize += c.size;
  }

  chunks.push(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  );

  return new Blob(chunks, { type: "application/zip" });
}
