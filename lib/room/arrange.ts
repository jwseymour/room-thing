import type { Rect } from "./schema";

/**
 * Lays a set of things out on a wall as one tidy group: rows of similar
 * height, evenly spaced, centred on eye level in the biggest clear space
 * that will take them.
 */

export type ArrangeItem = { id: string; w: number; h: number };
export type Arranged = { id: string; u: number; v: number };

export const ARRANGE_GAP_MM = 50;
const EYE_LEVEL_MM = 1500;
const EDGE_MM = 40;

type Row = { items: ArrangeItem[]; width: number; height: number };

function rows(items: ArrangeItem[], maxWidth: number): Row[] {
  const out: Row[] = [];
  for (const item of items) {
    const row = out[out.length - 1];
    if (row && row.width + ARRANGE_GAP_MM + item.w <= maxWidth) {
      row.items.push(item);
      row.width += ARRANGE_GAP_MM + item.w;
      row.height = Math.max(row.height, item.h);
    } else {
      out.push({ items: [item], width: item.w, height: item.h });
    }
  }
  return out;
}

/** Fits as many items as it can into one clear rectangle. */
function fill(items: ArrangeItem[], space: Rect): { placed: Arranged[]; left: ArrangeItem[] } {
  const width = space.w - EDGE_MM * 2;
  const height = space.h - EDGE_MM * 2;
  const fitting = items.filter((i) => i.w <= width && i.h <= height);
  // Tallest first, so each row holds things of a similar height.
  const sorted = [...fitting].sort((a, b) => b.h - a.h || b.w - a.w);
  const made = rows(sorted, width);
  const kept: Row[] = [];
  let used = 0;
  for (const row of made) {
    const next = used + (kept.length ? ARRANGE_GAP_MM : 0) + row.height;
    if (next > height) break;
    kept.push(row);
    used = next;
  }
  // A group reads best a little wider than tall, so put the widest row in the middle.
  kept.sort((a, b) => a.width - b.width);
  const ordered: Row[] = [];
  kept.forEach((row, i) => (i % 2 ? ordered.unshift(row) : ordered.push(row)));

  // Centre the group on eye level, or as near as the space allows.
  const lowest = space.v + EDGE_MM;
  const highest = space.v + space.h - EDGE_MM - used;
  const bottom = Math.min(Math.max(EYE_LEVEL_MM - used / 2, lowest), highest);
  const placed: Arranged[] = [];
  let top = bottom + used;
  for (const row of ordered) {
    let u = space.u + (space.w - row.width) / 2;
    for (const item of row.items) {
      placed.push({
        id: item.id,
        u: Math.round(u),
        v: Math.round(top - row.height + (row.height - item.h) / 2),
      });
      u += item.w + ARRANGE_GAP_MM;
    }
    top -= row.height + ARRANGE_GAP_MM;
  }
  const done = new Set(placed.map((p) => p.id));
  return { placed, left: items.filter((i) => !done.has(i.id)) };
}

/**
 * Places items across a wall's clear spaces, best space first. A space is
 * better the more of it sits around eye level, where things get looked at.
 */
export function arrange(
  items: ArrangeItem[],
  free: Rect[],
): { placed: Arranged[]; left: ArrangeItem[] } {
  const score = (r: Rect) => {
    const band = Math.max(0, Math.min(r.v + r.h, 2000) - Math.max(r.v, 900));
    return r.w * band;
  };
  const spaces = [...free].sort((a, b) => score(b) - score(a));
  const placed: Arranged[] = [];
  const taken: Rect[] = [];
  let left = items;
  for (const space of spaces) {
    if (!left.length) break;
    // Free rectangles overlap each other; skip one that's been built on.
    const overlaps = taken.some(
      (t) => t.u < space.u + space.w && space.u < t.u + t.w && t.v < space.v + space.h && space.v < t.v + t.h,
    );
    if (overlaps || score(space) === 0) continue;
    const result = fill(left, space);
    if (!result.placed.length) continue;
    placed.push(...result.placed);
    taken.push(space);
    left = result.left;
  }
  return { placed, left };
}
