import type { Cloud } from "./cloud";

/**
 * Turns a scan into geometry: the furniture as plain blocks, and a flat
 * picture of each wall. Works in the room frame, in metres: origin at a floor
 * corner, X along the first wall, Y up.
 *
 * A scan only records surfaces that the camera saw, so two rules fill in the
 * rest. Where the floor is visible, nothing stands there. Where nothing is
 * visible between a piece of furniture's face and the wall behind it, the
 * furniture is taken to carry on to the wall.
 */

export type Plan = [number, number][];

export type SurveyBlock = {
  /** Footprint: the corner nearest the origin, and its size. */
  x: number;
  z: number;
  w: number;
  d: number;
  bottom: number;
  top: number;
  /** Average colour of its top, as #rrggbb. */
  color: string;
  kind: "bed" | "desk" | "tall" | "low" | "unit";
  label: string;
  /** True when the floor shows underneath, as with a desk or a table. */
  open: boolean;
};

export type Survey = { blocks: SurveyBlock[] };

export type RoomPoints = {
  count: number;
  /** x, y, z in room metres. */
  xyz: Float32Array;
  rgb: Uint8Array;
  opacity: Float32Array;
  radius: Float32Array;
};

const CELL = 0.04;
const MIN_OPACITY = 0.25;
const WALL_SKIN = 0.07;

/** Moves a scan into the room frame, dropping everything well outside it. */
export function toRoomPoints(
  cloud: Cloud,
  matrix: number[],
  plan: Plan,
  heightM: number,
): RoomPoints {
  const m = matrix;
  const scale = Math.hypot(m[0], m[1], m[2]);
  const xs = plan.map((c) => c[0]);
  const zs = plan.map((c) => c[1]);
  const pad = 0.6;
  const [x0, x1] = [Math.min(...xs) - pad, Math.max(...xs) + pad];
  const [z0, z1] = [Math.min(...zs) - pad, Math.max(...zs) + pad];
  const xyz = new Float32Array(cloud.count * 3);
  const rgb = new Uint8Array(cloud.count * 3);
  const opacity = new Float32Array(cloud.count);
  const radius = new Float32Array(cloud.count);
  let k = 0;
  for (let i = 0; i < cloud.count; i++) {
    const px = cloud.positions[i * 3];
    const py = cloud.positions[i * 3 + 1];
    const pz = cloud.positions[i * 3 + 2];
    const x = m[0] * px + m[4] * py + m[8] * pz + m[12];
    const y = m[1] * px + m[5] * py + m[9] * pz + m[13];
    const z = m[2] * px + m[6] * py + m[10] * pz + m[14];
    if (x < x0 || x > x1 || z < z0 || z > z1 || y < -pad || y > heightM + pad) continue;
    xyz[k * 3] = x;
    xyz[k * 3 + 1] = y;
    xyz[k * 3 + 2] = z;
    rgb[k * 3] = cloud.colors[i * 3];
    rgb[k * 3 + 1] = cloud.colors[i * 3 + 1];
    rgb[k * 3 + 2] = cloud.colors[i * 3 + 2];
    opacity[k] = cloud.opacities[i];
    radius[k] = cloud.radii[i] * scale;
    k++;
  }
  return {
    count: k,
    xyz: xyz.subarray(0, k * 3),
    rgb: rgb.subarray(0, k * 3),
    opacity: opacity.subarray(0, k),
    radius: radius.subarray(0, k),
  };
}

/** The frame of wall `i`: where it starts, which way it runs, and its inward normal. */
export function wallFrame(plan: Plan, i: number) {
  const a = plan[i];
  const b = plan[(i + 1) % plan.length];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const right: [number, number] = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  // Corners run clockwise from above, so the room is to the left of each edge.
  const normal: [number, number] = [-right[1], right[0]];
  return { origin: a, right, normal, length };
}

/** How far inside the plan a point is: negative when it's outside. */
function insideBy(plan: Plan, x: number, z: number): number {
  let least = Infinity;
  for (let i = 0; i < plan.length; i++) {
    const f = wallFrame(plan, i);
    const d = (x - f.origin[0]) * f.normal[0] + (z - f.origin[1]) * f.normal[1];
    if (d < least) least = d;
  }
  return least;
}

const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");

// ---------------------------------------------------------------- furniture

type Grid = { nx: number; nz: number; x0: number; z0: number };

/** Largest rectangle of set cells, by the row-by-row histogram method. */
function largestRectangle(mask: Uint8Array, nx: number, nz: number) {
  const heights = new Int32Array(nx);
  let best = { area: 0, ix: 0, iz: 0, w: 0, d: 0 };
  const stack: number[] = [];
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) heights[ix] = mask[iz * nx + ix] ? heights[ix] + 1 : 0;
    stack.length = 0;
    for (let ix = 0; ix <= nx; ix++) {
      const h = ix < nx ? heights[ix] : 0;
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const tall = heights[stack.pop()!];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = ix - left;
        // Thin slivers aren't furniture, however long they are.
        if (tall * width > best.area && Math.min(tall, width) >= 4) {
          best = { area: tall * width, ix: left, iz: iz - tall + 1, w: width, d: tall };
        }
      }
      stack.push(ix);
    }
  }
  return best;
}

function nameBlock(w: number, d: number, top: number, open: boolean): Pick<SurveyBlock, "kind" | "label"> {
  const long = Math.max(w, d);
  const short = Math.min(w, d);
  if (top >= 0.35 && top <= 0.8 && long >= 1.7 && short >= 0.7 && short <= 1.7) {
    return { kind: "bed", label: "Bed" };
  }
  if (top >= 1.5) return { kind: "tall", label: short >= 0.45 ? "Wardrobe" : "Tall unit" };
  if (top >= 0.62 && top <= 0.85 && (open || long >= 0.9)) return { kind: "desk", label: "Desk" };
  if (top < 0.62) return { kind: "low", label: long < 0.7 ? "Bedside" : "Low unit" };
  return { kind: "unit", label: top <= 1.2 ? "Drawers" : "Unit" };
}

function findBlocks(points: RoomPoints, plan: Plan, heightM: number): SurveyBlock[] {
  const xs = plan.map((c) => c[0]);
  const zs = plan.map((c) => c[1]);
  const grid: Grid = {
    x0: Math.min(...xs),
    z0: Math.min(...zs),
    nx: Math.ceil((Math.max(...xs) - Math.min(...xs)) / CELL),
    nz: Math.ceil((Math.max(...zs) - Math.min(...zs)) / CELL),
  };
  const { nx, nz } = grid;
  const ny = Math.ceil(heightM / CELL);
  const cells = nx * nz;
  const counts = new Uint16Array(cells * ny);
  const floorHits = new Uint8Array(cells);
  const inside = new Uint8Array(cells);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = grid.x0 + (ix + 0.5) * CELL;
      const z = grid.z0 + (iz + 0.5) * CELL;
      inside[iz * nx + ix] = insideBy(plan, x, z) > -CELL / 2 ? 1 : 0;
    }
  }

  const { xyz, opacity } = points;
  for (let i = 0; i < points.count; i++) {
    if (opacity[i] < MIN_OPACITY) continue;
    const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
    const ix = Math.floor((x - grid.x0) / CELL);
    const iz = Math.floor((z - grid.z0) / CELL);
    if (ix < 0 || ix >= nx || iz < 0 || iz >= nz) continue;
    const cell = iz * nx + ix;
    if (!inside[cell]) continue;
    // The walls themselves, and what's flat against them, aren't furniture.
    // Nor is the foot of a wall the floor: counting it as floor would say
    // the strip behind a wardrobe had been seen clear.
    if (insideBy(plan, x, z) < WALL_SKIN) continue;
    if (y > -0.08 && y < 0.07) {
      if (floorHits[cell] < 255) floorHits[cell]++;
      continue;
    }
    // Leave out the ceiling and anything fixed just under it.
    if (y < 0.07 || y > heightM - 0.06) continue;
    const iy = Math.min(ny - 1, Math.floor(y / CELL));
    const at = cell * ny + iy;
    if (counts[at] < 65535) counts[at]++;
  }

  // How densely this scan covers a surface it saw well, taken from the floor.
  // A phone scan puts a dozen splats in each cell; a sparse one, one or two.
  // Every threshold below is a share of that, so both are read the same way.
  const seen = Array.from(floorHits).filter((c) => c > 0).sort((a, b) => a - b);
  const typical = seen.length ? seen[seen.length >> 1] : 4;
  const solid = Math.max(1, Math.round(typical / 5));
  const floorNeeds = Math.max(1, Math.round(typical / 4));

  // One or two stray splats at floor level don't make it floor.
  const floorSeen = new Uint8Array(cells);
  for (let cell = 0; cell < cells; cell++) floorSeen[cell] = floorHits[cell] >= floorNeeds ? 1 : 0;

  // Each column's top: the highest solid level, ignoring stray specks.
  const top = new Float32Array(cells);
  for (let cell = 0; cell < cells; cell++) {
    if (!inside[cell]) continue;
    const base = cell * ny;
    let lowest = -1;
    for (let iy = 0; iy < ny; iy++) if (counts[base + iy] >= solid) { lowest = iy; break; }
    if (lowest < 0) continue;
    // Something hanging with nothing beneath it, like a lampshade, a
    // curtain's top or a coat on a hook, isn't furniture.
    // The hidden-space rule below puts back the insides of tall furniture,
    // where only the top was seen.
    if (lowest * CELL > 0.9) continue;
    for (let iy = ny - 1; iy >= 0; iy--) {
      const c = counts[base + iy];
      // In a dense scan a lone speck needs something under it to count.
      if (c > solid || (c >= solid && (solid === 1 || (iy > 0 && counts[base + iy - 1] >= 1)))) {
        top[cell] = (iy + 1) * CELL;
        break;
      }
    }
  }

  // Fill what the camera couldn't see: from each wall inwards, cells with
  // nothing in them that end at a furniture face take that face's height.
  const unknown = (cell: number) => inside[cell] && top[cell] === 0 && !floorSeen[cell];
  const reach = Math.round(0.9 / CELL);
  const filled = new Float32Array(cells);
  /** One line of cells from a wall inwards: the hidden cells, and the face they end at. */
  const hiddenRun = (start: number, step: number, length: number) => {
    let i = 0;
    while (i < length && !inside[start + i * step]) i++;
    const walked: number[] = [];
    for (; i < length && walked.length <= reach; i++) {
      const cell = start + i * step;
      if (unknown(cell)) {
        walked.push(cell);
        continue;
      }
      // The face is rarely one clean cell thick, so take the tallest of the
      // first few: a door's edge, then the carcass behind it.
      let face = top[cell];
      for (let k = 1; k <= 2 && i + k < length; k++) face = Math.max(face, top[start + (i + k) * step]);
      return walked.length && face >= 0.3 ? { walked, face } : null;
    }
    return null;
  };
  const sweep = (lines: number, startOf: (line: number) => number, step: number, length: number) => {
    const runs = Array.from({ length: lines }, (_, line) => hiddenRun(startOf(line), step, length));
    runs.forEach((run, line) => {
      if (!run) return;
      // Agree with the neighbouring lines, so one odd reading doesn't notch the block.
      const faces: number[] = [];
      for (let k = line - 2; k <= line + 2; k++) if (runs[k]) faces.push(runs[k]!.face);
      faces.sort((a, b) => a - b);
      const face = faces[faces.length >> 1];
      for (const cell of run.walked) filled[cell] = Math.max(filled[cell], face);
    });
  };
  sweep(nz, (iz) => iz * nx, 1, nx);
  sweep(nz, (iz) => iz * nx + nx - 1, -1, nx);
  sweep(nx, (ix) => ix, nx, nz);
  sweep(nx, (ix) => (nz - 1) * nx + ix, -nx, nz);
  for (let cell = 0; cell < cells; cell++) if (filled[cell] > 0) top[cell] = filled[cell];

  // Patch pinholes: a cell with nothing seen, ringed by furniture, is furniture.
  for (let round = 0; round < 2; round++) {
    const patch: [number, number][] = [];
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const cell = iz * nx + ix;
        if (!inside[cell] || top[cell] > 0) continue;
        const around: number[] = [];
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const jx = ix + dx, jz = iz + dz;
            if ((dx || dz) && jx >= 0 && jx < nx && jz >= 0 && jz < nz && top[jz * nx + jx] > 0) {
              around.push(top[jz * nx + jx]);
            }
          }
        }
        if (around.length >= 5) {
          around.sort((a, b) => a - b);
          patch.push([cell, around[around.length >> 1]]);
        }
      }
    }
    for (const [cell, value] of patch) top[cell] = value;
  }

  // Shave off anything thinner than about 20 cm: monitors, lamps, chair
  // backs, curtains. Cells outside the room count as solid so that furniture
  // against a wall keeps its full depth.
  const R = 2;
  const pass = (source: Float32Array, pick: (a: number, b: number) => number, outside: number) => {
    const out = new Float32Array(cells);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        if (!inside[iz * nx + ix]) continue;
        let value = source[iz * nx + ix];
        for (let dz = -R; dz <= R; dz++) {
          for (let dx = -R; dx <= R; dx++) {
            const jx = ix + dx, jz = iz + dz;
            const there =
              jx < 0 || jx >= nx || jz < 0 || jz >= nz || !inside[jz * nx + jx]
                ? outside
                : source[jz * nx + jx];
            value = pick(value, there);
          }
        }
        out[iz * nx + ix] = value;
      }
    }
    return out;
  };
  const opened = pass(pass(top, Math.min, Infinity), Math.max, 0);

  // Cut the height map into rectangles of even height, biggest first.
  const TOLERANCE = 0.1;
  const MIN_CELLS = Math.round(0.05 / (CELL * CELL));
  const taken = new Uint8Array(cells);
  const owner = new Int16Array(cells).fill(-1);
  const blocks: { ix: number; iz: number; w: number; d: number; top: number }[] = [];
  const mask = new Uint8Array(cells);
  for (let round = 0; round < 60; round++) {
    const levels = new Set<number>();
    for (let cell = 0; cell < cells; cell++) {
      if (!taken[cell] && opened[cell] >= 0.16) levels.add(Math.round(opened[cell] / CELL));
    }
    let best = { area: 0, ix: 0, iz: 0, w: 0, d: 0, level: 0 };
    for (const level of levels) {
      const at = level * CELL;
      for (let cell = 0; cell < cells; cell++) {
        mask[cell] = !taken[cell] && opened[cell] >= 0.16 && Math.abs(opened[cell] - at) <= TOLERANCE ? 1 : 0;
      }
      const found = largestRectangle(mask, nx, nz);
      if (found.area > best.area) best = { ...found, level: at };
    }
    if (best.area < MIN_CELLS) break;
    // Push each side out while most of the next row is still this piece:
    // clutter on a desk shouldn't cut the desk in two.
    const fits = (cell: number) =>
      !taken[cell] && opened[cell] >= 0.16 && Math.abs(opened[cell] - best.level) <= TOLERANCE * 1.5;
    for (let grew = true; grew; ) {
      grew = false;
      const sides: [number, number, number, number][] = [
        [best.ix - 1, best.iz, 1, best.d],
        [best.ix + best.w, best.iz, 1, best.d],
        [best.ix, best.iz - 1, best.w, 1],
        [best.ix, best.iz + best.d, best.w, 1],
      ];
      for (const [sx, sz, sw, sd] of sides) {
        if (sx < 0 || sz < 0 || sx + sw > nx || sz + sd > nz) continue;
        let good = 0;
        for (let iz = sz; iz < sz + sd; iz++) for (let ix = sx; ix < sx + sw; ix++) if (fits(iz * nx + ix)) good++;
        if (good / (sw * sd) < 0.6) continue;
        best.ix = Math.min(best.ix, sx);
        best.iz = Math.min(best.iz, sz);
        if (sw === 1) best.w++;
        else best.d++;
        grew = true;
        break;
      }
    }
    const heights: number[] = [];
    for (let iz = best.iz; iz < best.iz + best.d; iz++) {
      for (let ix = best.ix; ix < best.ix + best.w; ix++) {
        const cell = iz * nx + ix;
        if (!taken[cell] && fits(cell)) heights.push(opened[cell]);
        if (taken[cell]) continue;
        taken[cell] = 1;
        owner[cell] = blocks.length;
      }
    }
    heights.sort((a, b) => a - b);
    blocks.push({ ix: best.ix, iz: best.iz, w: best.w, d: best.d, top: heights[heights.length >> 1] });
  }

  // Colour each block from its top, and see whether the floor shows beneath.
  const sums = blocks.map(() => ({ r: 0, g: 0, b: 0, n: 0, floor: 0 }));
  for (let cell = 0; cell < cells; cell++) {
    if (owner[cell] >= 0 && floorSeen[cell]) sums[owner[cell]].floor++;
  }
  for (let i = 0; i < points.count; i++) {
    if (opacity[i] < MIN_OPACITY) continue;
    const ix = Math.floor((xyz[i * 3] - grid.x0) / CELL);
    const iz = Math.floor((xyz[i * 3 + 2] - grid.z0) / CELL);
    if (ix < 0 || ix >= nx || iz < 0 || iz >= nz) continue;
    const b = owner[iz * nx + ix];
    if (b < 0) continue;
    const y = xyz[i * 3 + 1];
    if (y > blocks[b].top + 0.06 || y < blocks[b].top - 0.3) continue;
    const s = sums[b];
    s.r += points.rgb[i * 3];
    s.g += points.rgb[i * 3 + 1];
    s.b += points.rgb[i * 3 + 2];
    s.n++;
  }

  return blocks.map((b, i) => {
    const s = sums[i];
    const w = b.w * CELL;
    const d = b.d * CELL;
    const open = b.top <= 1.1 && s.floor / (b.w * b.d) > 0.3;
    return {
      x: grid.x0 + b.ix * CELL,
      z: grid.z0 + b.iz * CELL,
      w,
      d,
      bottom: 0,
      top: b.top,
      color: s.n ? hex(s.r / s.n, s.g / s.n, s.b / s.n) : "#b8b2a6",
      open,
      ...nameBlock(w, d, b.top, open),
    };
  });
}

export function surveyRoom(points: RoomPoints, plan: Plan, heightM: number): Survey {
  return { blocks: findBlocks(points, plan, heightM) };
}

// ------------------------------------------------------------------- images

export type Raster = { width: number; height: number; rgba: Uint8Array };

/**
 * A flat, head-on picture of one wall, drawn from the scan's splats. `depthM`
 * is how far into the room to include: a hand's width shows only what's on
 * the wall, a metre shows the furniture standing against it too.
 */
export function drawWall(
  points: RoomPoints,
  plan: Plan,
  heightM: number,
  wall: number,
  depthM: number,
  pxPerM = 400,
): Raster {
  const f = wallFrame(plan, wall);
  const width = Math.max(1, Math.round(f.length * pxPerM));
  const height = Math.max(1, Math.round(heightM * pxPerM));
  const { xyz, rgb, opacity, radius } = points;
  const picked: number[] = [];
  const depths = new Float32Array(points.count);
  for (let i = 0; i < points.count; i++) {
    if (opacity[i] < 0.1) continue;
    const dx = xyz[i * 3] - f.origin[0];
    const dz = xyz[i * 3 + 2] - f.origin[1];
    const depth = dx * f.normal[0] + dz * f.normal[1];
    if (depth < -0.4 || depth > depthM) continue;
    depths[i] = depth;
    picked.push(i);
  }
  // Furthest first, so nearer things are painted over the wall behind them.
  picked.sort((a, b) => depths[a] - depths[b]);

  const acc = new Float32Array(width * height * 4);
  for (const i of picked) {
    const dx = xyz[i * 3] - f.origin[0];
    const dz = xyz[i * 3 + 2] - f.origin[1];
    const cx = (dx * f.right[0] + dz * f.right[1]) * pxPerM;
    const cy = height - xyz[i * 3 + 1] * pxPerM;
    const r = Math.max(1.2, Math.min(radius[i] * 1.7, 0.2) * pxPerM);
    const alpha = Math.min(1, opacity[i] * 1.25);
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(height - 1, Math.ceil(cy + r));
    const rr = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const q = ((x - cx) * (x - cx) + (y - cy) * (y - cy)) / rr;
        if (q > 1) continue;
        // Soft-edged, like the splat it stands for.
        const a = alpha * (q < 0.5 ? 1 : 2 - 2 * q);
        const at = (y * width + x) * 4;
        acc[at] = acc[at] * (1 - a) + rgb[i * 3] * a;
        acc[at + 1] = acc[at + 1] * (1 - a) + rgb[i * 3 + 1] * a;
        acc[at + 2] = acc[at + 2] * (1 - a) + rgb[i * 3 + 2] * a;
        acc[at + 3] = acc[at + 3] + (1 - acc[at + 3]) * a;
      }
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = acc[p * 4];
    rgba[p * 4 + 1] = acc[p * 4 + 1];
    rgba[p * 4 + 2] = acc[p * 4 + 2];
    rgba[p * 4 + 3] = Math.round(Math.min(1, acc[p * 4 + 3]) * 255);
  }
  return { width, height, rgba };
}
