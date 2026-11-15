/**
 * Finds the room in a scan: which way is up, where the floor, ceiling and four
 * main walls are, and the transform that puts the scan into the room's own
 * frame. Works on the splats' centre points only, so it runs in the browser on
 * whatever file the scanning app produced.
 *
 * Room frame, in metres: origin at a floor corner, X and Z along the walls,
 * Y up. The room model's floor plan uses the same X, and Z as its `y`.
 */

export type UpAxis = "y+" | "y-" | "z+" | "z-";

export type RoomFit = {
  /** Scan to room, as a column-major 4×4 for `THREE.Matrix4.fromArray`. */
  matrix: number[];
  up: UpAxis;
  widthM: number;
  depthM: number;
  heightM: number;
  /**
   * How clearly each surface stood out, from 0 to 1. Low values mean the fit
   * is a guess and should be checked by eye.
   */
  confidence: { floor: number; ceiling: number; walls: number };
};

const BIN_M = 0.02;
const MAX_POINTS = 250_000;

/** Rotates a scan point so that the scan's up axis becomes +Y. */
function uprighter(up: UpAxis): (x: number, y: number, z: number) => [number, number, number] {
  if (up === "y+") return (x, y, z) => [x, y, z];
  if (up === "y-") return (x, y, z) => [x, -y, -z];
  if (up === "z+") return (x, y, z) => [x, z, -y];
  return (x, y, z) => [x, -z, y];
}

/** The same rotations as 3×3 rows, for building the matrix. */
const UP_ROWS: Record<UpAxis, number[][]> = {
  "y+": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  "y-": [[1, 0, 0], [0, -1, 0], [0, 0, -1]],
  "z+": [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
  "z-": [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
};

function percentile(sorted: Float32Array, p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

type Histogram = { start: number; counts: Float32Array };

function histogram(values: Float32Array, lo: number, hi: number): Histogram {
  const n = Math.max(1, Math.ceil((hi - lo) / BIN_M));
  const raw = new Float32Array(n);
  for (let i = 0; i < values.length; i++) {
    const b = Math.floor((values[i] - lo) / BIN_M);
    if (b >= 0 && b < n) raw[b]++;
  }
  // A light blur, so a surface split across two bins still reads as one peak.
  const counts = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    counts[i] = (raw[i - 1] ?? 0) * 0.5 + raw[i] + (raw[i + 1] ?? 0) * 0.5;
  }
  return { start: lo, counts };
}

/**
 * The outermost strong peak in a range. "Strong" is relative to the biggest
 * peak there, so a wardrobe in front of a wall doesn't win just by being
 * better scanned than the wall behind it.
 */
function outerPeak(
  h: Histogram,
  from: number,
  to: number,
  side: "low" | "high",
): { at: number; strength: number } {
  const a = Math.max(0, Math.floor((from - h.start) / BIN_M));
  const b = Math.min(h.counts.length - 1, Math.ceil((to - h.start) / BIN_M));
  let max = 0;
  for (let i = a; i <= b; i++) max = Math.max(max, h.counts[i]);
  const threshold = max * 0.35;
  const isPeak = (i: number) =>
    h.counts[i] >= threshold &&
    h.counts[i] >= (h.counts[i - 1] ?? 0) &&
    h.counts[i] >= (h.counts[i + 1] ?? 0);
  let index = side === "low" ? a : b;
  if (side === "low") {
    for (let i = a; i <= b; i++) if (isPeak(i)) { index = i; break; }
  } else {
    for (let i = b; i >= a; i--) if (isPeak(i)) { index = i; break; }
  }
  // Centre of mass around the peak, for better than one-bin precision.
  let sum = 0;
  let weight = 0;
  for (let i = index - 2; i <= index + 2; i++) {
    const c = h.counts[i] ?? 0;
    sum += c * (h.start + (i + 0.5) * BIN_M);
    weight += c;
  }
  let total = 0;
  for (let i = 0; i < h.counts.length; i++) total += h.counts[i];
  return {
    at: weight ? sum / weight : h.start + (index + 0.5) * BIN_M,
    // Share of all points that sit on this surface. A wall or floor of a
    // scanned room typically holds several percent of the points.
    strength: total ? Math.min(1, (weight / total) * 8) : 0,
  };
}

function fitWithUp(points: Float32Array, up: UpAxis) {
  const stride = Math.max(1, Math.floor(points.length / 3 / MAX_POINTS));
  const n = Math.floor(points.length / 3 / stride);
  const toUp = uprighter(up);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const zs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * stride * 3;
    const [x, y, z] = toUp(points[j], points[j + 1], points[j + 2]);
    xs[i] = x;
    ys[i] = y;
    zs[i] = z;
  }

  // Floor and ceiling: the strongest levels near the bottom and top.
  const sortedY = Float32Array.from(ys).sort();
  const yLo = percentile(sortedY, 0.01);
  const yHi = percentile(sortedY, 0.99);
  const ySpan = Math.max(yHi - yLo, 0.5);
  const yHist = histogram(ys, yLo - 0.2, yHi + 0.2);
  const floor = outerPeak(yHist, yLo - 0.2, yLo + ySpan * 0.5, "low");
  const ceiling = outerPeak(yHist, yHi - ySpan * 0.5, yHi + 0.2, "high");
  const height = ceiling.at - floor.at;

  // Walls are clearest above the furniture and below the ceiling.
  const bandLo = floor.at + height * 0.5;
  const bandHi = ceiling.at - height * 0.08;
  const band: number[] = [];
  let nearFloor = 0;
  let nearCeiling = 0;
  for (let i = 0; i < n; i++) {
    if (ys[i] > bandLo && ys[i] < bandHi) band.push(i);
    const fromFloor = ys[i] - floor.at;
    const fromCeiling = ceiling.at - ys[i];
    if (fromFloor > 0.15 && fromFloor < height * 0.35) nearFloor++;
    if (fromCeiling > 0.15 && fromCeiling < height * 0.35) nearCeiling++;
  }

  // Turn the room until its walls line up with the axes: that's the angle at
  // which the points pile most sharply into a few rows and columns.
  const peakiness = (theta: number) => {
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const bins = new Map<number, number>();
    const step = Math.max(1, Math.floor(band.length / 40_000));
    for (let k = 0; k < band.length; k += step) {
      const i = band[k];
      const rx = Math.floor((xs[i] * cos + zs[i] * sin) / 0.04);
      const rz = Math.floor((-xs[i] * sin + zs[i] * cos) / 0.04);
      bins.set(rx * 2, (bins.get(rx * 2) ?? 0) + 1);
      bins.set(rz * 2 + 1, (bins.get(rz * 2 + 1) ?? 0) + 1);
    }
    let score = 0;
    for (const c of bins.values()) score += c * c;
    return score;
  };
  const deg = Math.PI / 180;
  let yaw = 0;
  let best = -1;
  for (let d = 0; d < 90; d += 1) {
    const s = peakiness(d * deg);
    if (s > best) { best = s; yaw = d; }
  }
  for (let d = yaw - 1; d <= yaw + 1; d += 0.1) {
    const s = peakiness(d * deg);
    if (s > best) { best = s; yaw = d; }
  }
  const theta = yaw * deg;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const rx = new Float32Array(band.length);
  const rz = new Float32Array(band.length);
  band.forEach((i, k) => {
    rx[k] = xs[i] * cos + zs[i] * sin;
    rz[k] = -xs[i] * sin + zs[i] * cos;
  });
  // Search each half of the room for its wall. The threshold inside
  // `outerPeak` skips thin clutter beyond it, such as the view through a window.
  const wallPair = (values: Float32Array) => {
    const sorted = Float32Array.from(values).sort();
    const lo = percentile(sorted, 0.001);
    const hi = percentile(sorted, 0.999);
    const mid = percentile(sorted, 0.5);
    const h = histogram(values, lo - 0.3, hi + 0.3);
    return {
      min: outerPeak(h, lo - 0.3, mid, "low"),
      max: outerPeak(h, mid, hi + 0.3, "high"),
    };
  };
  const wx = band.length ? wallPair(rx) : { min: { at: 0, strength: 0 }, max: { at: 1, strength: 0 } };
  const wz = band.length ? wallPair(rz) : { min: { at: 0, strength: 0 }, max: { at: 1, strength: 0 } };

  // matrix = translate(-min) · rotateY(yaw) · upright
  const R = UP_ROWS[up];
  const rows = [
    [0, 1, 2].map((c) => cos * R[0][c] + sin * R[2][c]),
    [0, 1, 2].map((c) => R[1][c]),
    [0, 1, 2].map((c) => -sin * R[0][c] + cos * R[2][c]),
  ];
  const t = [-wx.min.at, -floor.at, -wz.min.at];
  const matrix = [
    rows[0][0], rows[1][0], rows[2][0], 0,
    rows[0][1], rows[1][1], rows[2][1], 0,
    rows[0][2], rows[1][2], rows[2][2], 0,
    t[0], t[1], t[2], 1,
  ];

  const fit: RoomFit = {
    matrix,
    up,
    widthM: wx.max.at - wx.min.at,
    depthM: wz.max.at - wz.min.at,
    heightM: height,
    confidence: {
      floor: floor.strength,
      ceiling: ceiling.strength,
      walls: Math.min(wx.min.strength, wx.max.strength, wz.min.strength, wz.max.strength),
    },
  };
  return { fit, nearFloor, nearCeiling };
}

const FLIPPED: Record<UpAxis, UpAxis> = { "y+": "y-", "y-": "y+", "z+": "z-", "z-": "z+" };

/**
 * `points` is x, y, z triples in the scan's own units, assumed to be metres
 * (true of LiDAR phones). Pass `up` to override the guess about which way is up.
 */
export function fitRoom(points: Float32Array, up?: UpAxis): RoomFit {
  if (up) return fitWithUp(points, up).fit;
  // Scanning apps write Y as the vertical axis, pointing either way. Furniture
  // sits on the floor, so the fuller half of the room is the bottom.
  const first = fitWithUp(points, "y+");
  if (first.nearFloor >= first.nearCeiling) return first.fit;
  return fitWithUp(points, FLIPPED[first.fit.up]).fit;
}

export const UP_AXES: UpAxis[] = ["y+", "y-", "z+", "z-"];

/** Applies a scan-to-room matrix to a point. */
export function applyMatrix(m: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}
