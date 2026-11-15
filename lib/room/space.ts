import { surfaceFrame } from "../scan/frame";
import { inflate, surfaceBounds } from "./geometry";
import type { Block, Fixture, Rect, RoomDocument, Surface } from "./schema";

/**
 * Wall space: which parts of a wall are actually free to put things on, once
 * the door, the window, and the furniture standing against it are taken out.
 */

export type Obstacle = { rect: Rect; label: string; kind: Fixture["kind"] };

/** How close furniture has to stand to a wall to count as covering it. */
const AGAINST_WALL_MM = 150;

/** The part of a wall a piece of furniture hides, or null if it's elsewhere. */
export function blockShadow(block: Block, surface: Surface): Rect | null {
  const frame = surfaceFrame(surface);
  if (!frame) return null;
  const { w: wallWidth, h: wallHeight } = surfaceBounds(surface);
  const corners = [
    [block.x, block.y],
    [block.x + block.w, block.y],
    [block.x, block.y + block.d],
    [block.x + block.w, block.y + block.d],
  ];
  const ox = frame.origin[0] * 1000;
  const oz = frame.origin[2] * 1000;
  const along = corners.map(([x, y]) => (x - ox) * frame.right[0] + (y - oz) * frame.right[2]);
  const away = corners.map(([x, y]) => (x - ox) * frame.normal[0] + (y - oz) * frame.normal[2]);
  if (Math.min(...away) > AGAINST_WALL_MM || Math.max(...away) < -AGAINST_WALL_MM) return null;
  const u0 = Math.max(0, Math.min(...along));
  const u1 = Math.min(wallWidth, Math.max(...along));
  const v1 = Math.min(wallHeight, block.top);
  if (u1 - u0 < 20 || v1 - block.bottom < 20) return null;
  return { u: u0, v: block.bottom, w: u1 - u0, h: v1 - block.bottom };
}

/** Everything that takes up space on a wall, with its keep-clear margin. */
export function wallObstacles(doc: RoomDocument, surface: Surface): Obstacle[] {
  const fixed = doc.fixtures
    .filter((f) => f.surfaceId === surface.id)
    .map((f) => ({ rect: inflate(f.rect, f.keepClearMm), label: f.label || f.kind, kind: f.kind }));
  const furniture = doc.blocks.flatMap((block) => {
    const rect = blockShadow(block, surface);
    return rect ? [{ rect, label: block.label, kind: "furniture" as const }] : [];
  });
  return [...fixed, ...furniture];
}

/**
 * The largest clear rectangles on a wall: each one can't be made any bigger
 * without hitting something. Rectangles smaller than `minMm` either way are
 * left out, since nothing worth hanging fits in them.
 */
export function freeRects(
  bounds: { w: number; h: number },
  obstacles: Rect[],
  minMm = 150,
): Rect[] {
  const clip = (lo: number, hi: number, max: number) => [Math.max(0, lo), Math.min(max, hi)];
  const us = new Set([0, bounds.w]);
  const vs = new Set([0, bounds.h]);
  const boxes = obstacles
    .map((o) => {
      const [u0, u1] = clip(o.u, o.u + o.w, bounds.w);
      const [v0, v1] = clip(o.v, o.v + o.h, bounds.h);
      return { u0, u1, v0, v1 };
    })
    .filter((b) => b.u1 > b.u0 && b.v1 > b.v0);
  for (const b of boxes) {
    us.add(b.u0).add(b.u1);
    vs.add(b.v0).add(b.v1);
  }
  const U = [...us].sort((a, b) => a - b);
  const V = [...vs].sort((a, b) => a - b);
  const nu = U.length - 1;
  const nv = V.length - 1;
  // Which cells of the grid, drawn through every obstacle's edges, are blocked.
  const blocked = Array.from({ length: nu }, (_, i) =>
    Array.from({ length: nv }, (_, j) => {
      const cu = (U[i] + U[i + 1]) / 2;
      const cv = (V[j] + V[j + 1]) / 2;
      return boxes.some((b) => cu > b.u0 && cu < b.u1 && cv > b.v0 && cv < b.v1);
    }),
  );

  const found: Rect[] = [];
  for (let a = 0; a < nu; a++) {
    // Rows that are clear across every column from `a` to `b`.
    const clear = Array.from({ length: nv }, () => true);
    for (let b = a; b < nu; b++) {
      for (let j = 0; j < nv; j++) clear[j] &&= !blocked[b][j];
      for (let j = 0; j < nv; j++) {
        if (!clear[j]) continue;
        let end = j;
        while (end + 1 < nv && clear[end + 1]) end++;
        found.push({ u: U[a], v: V[j], w: U[b + 1] - U[a], h: V[end + 1] - V[j] });
        j = end;
      }
    }
  }
  const contains = (big: Rect, small: Rect) =>
    big.u <= small.u && big.v <= small.v &&
    big.u + big.w >= small.u + small.w && big.v + big.h >= small.v + small.h;
  return found
    .filter((r) => r.w >= minMm && r.h >= minMm)
    .filter((r, i, all) => !all.some((other, k) => k !== i && contains(other, r) && !(contains(r, other) && k > i)))
    .sort((a, b) => b.w * b.h - a.w * a.h);
}

/** The same obstacles as fixtures, for the placement rules that expect those. */
export function obstacleFixtures(doc: RoomDocument, surface: Surface): Fixture[] {
  const fixed = doc.fixtures.filter((f) => f.surfaceId === surface.id);
  const furniture = doc.blocks.flatMap((block): Fixture[] => {
    const rect = blockShadow(block, surface);
    if (!rect) return [];
    return [{
      id: `behind-${block.id}`,
      surfaceId: surface.id,
      kind: "furniture",
      rect,
      keepClearMm: 0,
      label: block.label.toLowerCase(),
      source: block.source,
    }];
  });
  return [...fixed, ...furniture];
}

/**
 * The clear part of a wall as rectangles that don't overlap, for shading it.
 * (`freeRects` answers a different question: the biggest spaces, which do.)
 */
export function freeRegion(bounds: { w: number; h: number }, obstacles: Rect[]): Rect[] {
  const us = new Set([0, bounds.w]);
  const vs = new Set([0, bounds.h]);
  const boxes = obstacles
    .map((o) => ({
      u0: Math.max(0, o.u), u1: Math.min(bounds.w, o.u + o.w),
      v0: Math.max(0, o.v), v1: Math.min(bounds.h, o.v + o.h),
    }))
    .filter((b) => b.u1 > b.u0 && b.v1 > b.v0);
  for (const b of boxes) {
    us.add(b.u0).add(b.u1);
    vs.add(b.v0).add(b.v1);
  }
  const U = [...us].sort((a, b) => a - b);
  const V = [...vs].sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let j = 0; j < V.length - 1; j++) {
    const cv = (V[j] + V[j + 1]) / 2;
    let start: number | null = null;
    for (let i = 0; i <= U.length - 1; i++) {
      const clear =
        i < U.length - 1 &&
        !boxes.some((b) => (U[i] + U[i + 1]) / 2 > b.u0 && (U[i] + U[i + 1]) / 2 < b.u1 && cv > b.v0 && cv < b.v1);
      if (clear && start === null) start = U[i];
      if (!clear && start !== null) {
        const run = { u: start, v: V[j], w: U[i] - start, h: V[j + 1] - V[j] };
        // Join onto the strip below when it spans exactly the same width.
        const below = out.find((r) => r.u === run.u && r.w === run.w && Math.abs(r.v + r.h - run.v) < 0.5);
        if (below) below.h += run.h;
        else out.push(run);
        start = null;
      }
    }
  }
  return out;
}

export type WallSpace = {
  obstacles: Obstacle[];
  free: Rect[];
  region: Rect[];
  /** Clear area as a share of the whole wall, from 0 to 1. */
  freeShare: number;
  freeAreaM2: number;
};

export function wallSpace(doc: RoomDocument, surface: Surface, extra: Rect[] = []): WallSpace {
  const bounds = surfaceBounds(surface);
  const obstacles = wallObstacles(doc, surface);
  const rects = [...obstacles.map((o) => o.rect), ...extra];
  const free = freeRects(bounds, rects);
  // Area by sampling a 25 mm grid: simple, and exact enough to quote in m².
  const STEP = 25;
  let clear = 0;
  let total = 0;
  for (let u = STEP / 2; u < bounds.w; u += STEP) {
    for (let v = STEP / 2; v < bounds.h; v += STEP) {
      total++;
      if (!rects.some((r) => u > r.u && u < r.u + r.w && v > r.v && v < r.v + r.h)) clear++;
    }
  }
  return {
    obstacles,
    free,
    region: freeRegion(bounds, rects),
    freeShare: total ? clear / total : 0,
    freeAreaM2: (clear * STEP * STEP) / 1e6,
  };
}
