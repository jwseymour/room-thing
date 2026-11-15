/**
 * Straightening a photo of something flat. You mark its four corners, and
 * this works out the picture you'd have taken standing square in front of it.
 */

export type Corner = { x: number; y: number };

/**
 * The 3×3 matrix that carries the unit square onto four points, given in
 * order: top-left, top-right, bottom-right, bottom-left.
 */
export function squareToQuad(q: Corner[]): number[] {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, sx = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, sy = p0.y - p1.y + p2.y - p3.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = det ? (sx * dy2 - dx2 * sy) / det : 0;
  const h = det ? (dx1 * sy - sx * dy1) / det : 0;
  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1,
  ];
}

/** Where a point of the unit square lands in the photo. */
export function project(m: number[], u: number, v: number): Corner {
  const w = m[6] * u + m[7] * v + m[8];
  return { x: (m[0] * u + m[1] * v + m[2]) / w, y: (m[3] * u + m[4] * v + m[5]) / w };
}

/**
 * The size, in pixels, of the straightened picture. A photo taken at an
 * angle squashes the far edge, so each side is taken from the longer of the
 * two edges that should be equal.
 */
export function straightSize(q: Corner[], maxSide = 1800): { width: number; height: number } {
  const length = (a: Corner, b: Corner) => Math.hypot(a.x - b.x, a.y - b.y);
  const width = Math.max(length(q[0], q[1]), length(q[3], q[2]));
  const height = Math.max(length(q[0], q[3]), length(q[1], q[2]));
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Cuts the marked quadrilateral out of `source` and straightens it. Pixels
 * are RGBA rows, as a canvas gives them.
 */
export function rectify(
  source: { data: Uint8ClampedArray; width: number; height: number },
  quad: Corner[],
  out: { width: number; height: number },
): Uint8ClampedArray {
  const m = squareToQuad(quad);
  const result = new Uint8ClampedArray(out.width * out.height * 4);
  const { data, width, height } = source;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const p = project(m, (x + 0.5) / out.width, (y + 0.5) / out.height);
      const fx = Math.min(width - 1.001, Math.max(0, p.x - 0.5));
      const fy = Math.min(height - 1.001, Math.max(0, p.y - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const a = (y0 * width + x0) * 4;
      const b = a + 4;
      const c = a + width * 4;
      const d = c + 4;
      const at = (y * out.width + x) * 4;
      for (let k = 0; k < 3; k++) {
        result[at + k] =
          (data[a + k] * (1 - tx) + data[b + k] * tx) * (1 - ty) +
          (data[c + k] * (1 - tx) + data[d + k] * tx) * ty;
      }
      result[at + 3] = 255;
    }
  }
  return result;
}
