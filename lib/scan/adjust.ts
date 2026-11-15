import type { RoomFit } from "./fit";

/**
 * Hand corrections on top of the automatic fit. Wall and floor offsets are in
 * metres, positive meaning "move outwards, making the room bigger".
 */
export type Adjustment = {
  left: number;
  right: number;
  near: number;
  far: number;
  floor: number;
  ceiling: number;
  /** Extra turn about the room's centre, in degrees. */
  turnDeg: number;
  /** From a tape measure: real distance divided by scanned distance. */
  tapeScale: number;
};

export const NO_ADJUSTMENT: Adjustment = {
  left: 0, right: 0, near: 0, far: 0, floor: 0, ceiling: 0, turnDeg: 0, tapeScale: 1,
};

type Mat = number[];

/** a · b for column-major 4×4 matrices. */
function multiply(a: Mat, b: Mat): Mat {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    }
  }
  return out;
}

const translate = (x: number, y: number, z: number): Mat =>
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

const scale = (k: number): Mat =>
  [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1];

function turnY(deg: number): Mat {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  // Matches the fit: x' = x cos + z sin, z' = -x sin + z cos.
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

/** The final scan-to-room matrix and room size, in metres. */
export function adjustedFit(
  fit: RoomFit,
  a: Adjustment,
): { matrix: number[]; w: number; d: number; h: number } {
  const cx = fit.widthM / 2;
  const cz = fit.depthM / 2;
  let m = fit.matrix;
  // Turn about the middle of the room, so the walls stay roughly in place.
  m = multiply(translate(-cx, 0, -cz), m);
  m = multiply(turnY(a.turnDeg), m);
  m = multiply(translate(cx, 0, cz), m);
  // Moving the left, near or floor surface outwards shifts the origin with it.
  m = multiply(translate(a.left, a.floor, a.near), m);
  m = multiply(scale(a.tapeScale), m);
  return {
    matrix: m,
    w: (fit.widthM + a.left + a.right) * a.tapeScale,
    d: (fit.depthM + a.near + a.far) * a.tapeScale,
    h: (fit.heightM + a.floor + a.ceiling) * a.tapeScale,
  };
}
