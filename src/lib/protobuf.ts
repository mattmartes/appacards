// Minimal protobuf reader for the few Anki messages we need.

export type PbValue = number | Uint8Array;

/** Decodes a message into field number -> values (repeated fields keep order).
 * Varints become numbers (exact up to 2^53); length-delimited fields stay raw
 * bytes; fixed32 fields are returned as float32. */
export function decodeMessage(buf: Uint8Array): Map<number, PbValue[]> {
  const out = new Map<number, PbValue[]>();
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 0;
  const varint = () => {
    let result = 0;
    let mul = 1;
    for (;;) {
      const b = buf[pos++];
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      mul *= 128;
    }
  };
  const add = (field: number, v: PbValue) => {
    const list = out.get(field);
    if (list) list.push(v);
    else out.set(field, [v]);
  };
  while (pos < buf.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    switch (key & 7) {
      case 0:
        add(field, varint());
        break;
      case 1:
        add(field, view.getFloat64(pos, true));
        pos += 8;
        break;
      case 2: {
        const len = varint();
        add(field, buf.subarray(pos, pos + len));
        pos += len;
        break;
      }
      case 5:
        add(field, view.getFloat32(pos, true));
        pos += 4;
        break;
      default:
        throw new Error('Unsupported protobuf wire type');
    }
  }
  return out;
}

const decoder = new TextDecoder();

export function pbString(m: Map<number, PbValue[]>, field: number): string {
  const v = m.get(field)?.[0];
  return v instanceof Uint8Array ? decoder.decode(v) : '';
}

export function pbNumber(m: Map<number, PbValue[]>, field: number): number | undefined {
  const v = m.get(field)?.[0];
  return typeof v === 'number' ? v : undefined;
}

export function pbMessage(m: Map<number, PbValue[]>, field: number): Map<number, PbValue[]> | undefined {
  const v = m.get(field)?.[0];
  return v instanceof Uint8Array ? decodeMessage(v) : undefined;
}

/** A repeated float field, packed or not. */
export function pbFloats(m: Map<number, PbValue[]>, field: number): number[] {
  const out: number[] = [];
  for (const v of m.get(field) ?? []) {
    if (typeof v === 'number') out.push(v);
    else {
      const view = new DataView(v.buffer, v.byteOffset, v.byteLength);
      for (let i = 0; i + 4 <= v.byteLength; i += 4) out.push(view.getFloat32(i, true));
    }
  }
  return out;
}
