import type { Rect } from "./schema";

export type Guides = { us: number[]; vs: number[] };

const GRID_MM = 5;
const SNAP_MM = 12;

function closestSnap(
  anchors: number[],
  targets: number[],
): { shift: number; at: number } | null {
  let best: { shift: number; at: number } | null = null;
  for (const anchor of anchors) {
    for (const target of targets) {
      const shift = target - anchor;
      if (Math.abs(shift) > SNAP_MM) continue;
      if (!best || Math.abs(shift) < Math.abs(best.shift)) {
        best = { shift, at: target };
      }
    }
  }
  return best;
}

const edges = (start: number, size: number) => [
  start,
  start + size / 2,
  start + size,
];

/**
 * Lines the dragged item up with its neighbours and the wall's centre, which is
 * most of what makes an arrangement look deliberate. Otherwise snaps to a 5 mm grid.
 */
export function snapRect(
  rect: Rect,
  others: Rect[],
  wall: { w: number; h: number },
): { u: number; v: number; guides: Guides } {
  const snapU = closestSnap(edges(rect.u, rect.w), [
    wall.w / 2,
    ...others.flatMap((o) => edges(o.u, o.w)),
  ]);
  const snapV = closestSnap(edges(rect.v, rect.h), [
    wall.h / 2,
    ...others.flatMap((o) => edges(o.v, o.h)),
  ]);

  const grid = (value: number) => Math.round(value / GRID_MM) * GRID_MM;
  const clamp = (value: number, max: number) =>
    Math.min(Math.max(value, 0), Math.max(max, 0));

  return {
    u: clamp(snapU ? rect.u + snapU.shift : grid(rect.u), wall.w - rect.w),
    v: clamp(snapV ? rect.v + snapV.shift : grid(rect.v), wall.h - rect.h),
    guides: { us: snapU ? [snapU.at] : [], vs: snapV ? [snapV.at] : [] },
  };
}
