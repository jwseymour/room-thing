/**
 * A scan reduced to what the room survey needs: where each splat is, what
 * colour it is, and how solid it is. The browser fills this from the viewer;
 * the server reads it straight from a `.ply` file.
 */
export type Cloud = {
  count: number;
  /** x, y, z triples in the scan's own units. */
  positions: Float32Array;
  /** r, g, b triples, 0 to 255. */
  colors: Uint8Array;
  /** 0 to 1. */
  opacities: Float32Array;
  /** Rough radius of each splat in scan units, for drawing them. */
  radii: Float32Array;
};

const SH_C0 = 0.28209479177387814;

const TYPE_BYTES: Record<string, number> = {
  char: 1, uchar: 1, int8: 1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4,
  double: 8, float64: 8,
};

/**
 * Reads a Gaussian splat `.ply`, the format every scanning app can export.
 * Only binary little-endian files with float properties are understood, which
 * is what they all write. Returns null for anything else.
 */
export function readSplatPly(bytes: Uint8Array): Cloud | null {
  const headerEnd = findHeaderEnd(bytes);
  if (headerEnd < 0) return null;
  const header = new TextDecoder("ascii").decode(bytes.subarray(0, headerEnd));
  if (!header.startsWith("ply") || !header.includes("format binary_little_endian")) return null;

  let count = 0;
  let inVertex = false;
  let stride = 0;
  const offsets = new Map<string, number>();
  for (const line of header.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "element") {
      inVertex = parts[1] === "vertex";
      if (inVertex) count = Number(parts[2]);
    } else if (parts[0] === "property" && inVertex) {
      const size = TYPE_BYTES[parts[1]];
      if (!size) return null;
      if (parts[1] === "float" || parts[1] === "float32") offsets.set(parts[2], stride);
      stride += size;
    }
  }
  const need = ["x", "y", "z"];
  if (!count || need.some((k) => !offsets.has(k))) return null;
  if (bytes.byteLength < headerEnd + count * stride) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset + headerEnd, count * stride);
  const at = (name: string) => offsets.get(name);
  const [ox, oy, oz] = [at("x")!, at("y")!, at("z")!];
  const [or, og, ob] = [at("f_dc_0"), at("f_dc_1"), at("f_dc_2")];
  const oo = at("opacity");
  const os = [at("scale_0"), at("scale_1"), at("scale_2")];
  const radii = new Float32Array(count).fill(0.01);

  const positions = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 3).fill(160);
  const opacities = new Float32Array(count).fill(1);
  const channel = (v: number) => Math.max(0, Math.min(255, Math.round((0.5 + SH_C0 * v) * 255)));
  for (let i = 0; i < count; i++) {
    const row = i * stride;
    positions[i * 3] = view.getFloat32(row + ox, true);
    positions[i * 3 + 1] = view.getFloat32(row + oy, true);
    positions[i * 3 + 2] = view.getFloat32(row + oz, true);
    if (or !== undefined && og !== undefined && ob !== undefined) {
      colors[i * 3] = channel(view.getFloat32(row + or, true));
      colors[i * 3 + 1] = channel(view.getFloat32(row + og, true));
      colors[i * 3 + 2] = channel(view.getFloat32(row + ob, true));
    }
    if (oo !== undefined) opacities[i] = 1 / (1 + Math.exp(-view.getFloat32(row + oo, true)));
    if (os[0] !== undefined && os[1] !== undefined && os[2] !== undefined) {
      // Splats are flat discs more often than balls: the two larger axes say how big.
      const a = Math.exp(view.getFloat32(row + os[0], true));
      const b = Math.exp(view.getFloat32(row + os[1], true));
      const c = Math.exp(view.getFloat32(row + os[2], true));
      radii[i] = (a + b + c - Math.min(a, b, c)) / 2;
    }
  }
  return { count, positions, colors, opacities, radii };
}

function findHeaderEnd(bytes: Uint8Array): number {
  const marker = "end_header\n";
  const limit = Math.min(bytes.length - marker.length, 65536);
  outer: for (let i = 0; i < limit; i++) {
    for (let k = 0; k < marker.length; k++) {
      if (bytes[i + k] !== marker.charCodeAt(k)) continue outer;
    }
    return i + marker.length;
  }
  return -1;
}

/** A cloud holding only centres, for callers that have nothing else. */
export function cloudFromCentres(positions: Float32Array): Cloud {
  const count = Math.floor(positions.length / 3);
  return {
    count,
    positions,
    colors: new Uint8Array(count * 3).fill(160),
    opacities: new Float32Array(count).fill(1),
    radii: new Float32Array(count).fill(0.01),
  };
}
