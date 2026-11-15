import { describe, expect, it } from "vitest";
import { applyBoxToRoom } from "../scan/frame";
import { arrange, ARRANGE_GAP_MM } from "./arrange";
import { rectsOverlap } from "./geometry";
import { placementSize, sizesForAspect } from "./print";
import { defaultRoom, type Block, type RoomDocument } from "./schema";
import { blockShadow, freeRects, freeRegion, obstacleFixtures, wallSpace } from "./space";

const block = (id: string, x: number, y: number, w: number, d: number, top: number): Block => ({
  id, label: id, kind: "unit", x, y, w, d, bottom: 0, top, color: "#888888", open: false, source: "scan",
});

// A 4 × 3 m room, 2.4 m high. Wall 0 runs along the top of the plan.
const base = applyBoxToRoom(defaultRoom(), { widthMm: 4000, depthMm: 3000, heightMm: 2400 });
const room: RoomDocument = {
  ...base,
  blocks: [block("bed", 2000, 0, 2000, 900, 500), block("table", 1500, 1200, 800, 800, 750)],
  fixtures: [
    { id: "door", surfaceId: base.surfaces[0].id, kind: "door", rect: { u: 200, v: 0, w: 800, h: 2000 }, keepClearMm: 0, label: "Door", source: "scan" },
  ],
};
const [wallA, wallB, wallC] = room.surfaces;

describe("furniture against a wall", () => {
  it("hides the part of the wall behind it", () => {
    expect(blockShadow(room.blocks[0], wallA)).toEqual({ u: 2000, v: 0, w: 2000, h: 500 });
  });

  it("hides the next wall round too, where its end touches", () => {
    // Wall B runs down the right-hand side: the bed's end covers its first 900 mm.
    expect(blockShadow(room.blocks[0], wallB)).toEqual({ u: 0, v: 0, w: 900, h: 500 });
  });

  it("doesn't count when it stands in the middle of the room", () => {
    for (const wall of [wallA, wallB, wallC]) expect(blockShadow(room.blocks[1], wall)).toBeNull();
  });

  it("is passed to the placement rules as something a picture would sit behind", () => {
    const fixtures = obstacleFixtures(room, wallA);
    expect(fixtures.map((f) => f.kind).sort()).toEqual(["door", "furniture"]);
  });
});

describe("clear wall space", () => {
  const space = wallSpace(room, wallA);

  it("adds up to the wall less the door and the bed", () => {
    const expected = (4000 * 2400 - 800 * 2000 - 2000 * 500) / 1e6;
    expect(space.freeAreaM2).toBeCloseTo(expected, 1);
    expect(space.freeShare).toBeCloseTo(expected / 9.6, 2);
  });

  it("finds the biggest clear rectangle: right of the door, above the bed", () => {
    expect(space.free[0]).toEqual({ u: 1000, v: 500, w: 3000, h: 1900 });
  });

  it("never offers a space that overlaps something", () => {
    for (const rect of space.free) {
      for (const o of space.obstacles) expect(rectsOverlap(rect, o.rect)).toBe(false);
    }
  });

  it("shades the clear part without overlaps, and covers all of it", () => {
    const region = space.region;
    region.forEach((a, i) => region.forEach((b, k) => i < k && expect(rectsOverlap(a, b)).toBe(false)));
    const area = region.reduce((sum, r) => sum + r.w * r.h, 0) / 1e6;
    expect(area).toBeCloseTo(space.freeAreaM2, 1);
  });

  it("gives the whole wall when nothing's in the way", () => {
    expect(freeRects({ w: 1000, h: 2000 }, [])).toEqual([{ u: 0, v: 0, w: 1000, h: 2000 }]);
    expect(freeRegion({ w: 1000, h: 2000 }, [])).toEqual([{ u: 0, v: 0, w: 1000, h: 2000 }]);
  });

  it("leaves out slivers too small to hang anything in", () => {
    const free = freeRects({ w: 1000, h: 2000 }, [{ u: 100, v: 0, w: 900, h: 2000 }]);
    expect(free).toEqual([]);
  });
});

describe("arranging things on a wall", () => {
  const items = [
    { id: "poster", w: 420, h: 594 },
    { id: "print", w: 297, h: 210 },
    { id: "card-1", w: 148, h: 105 },
    { id: "card-2", w: 148, h: 105 },
  ];
  const space = { u: 1000, v: 500, w: 3000, h: 1900 };
  const { placed, left } = arrange(items, [space]);
  const rectOf = (id: string) => {
    const spot = placed.find((p) => p.id === id)!;
    const item = items.find((i) => i.id === id)!;
    return { u: spot.u, v: spot.v, w: item.w, h: item.h };
  };

  it("places everything that fits, inside the clear space", () => {
    expect(left).toEqual([]);
    for (const item of items) {
      const r = rectOf(item.id);
      expect(r.u).toBeGreaterThanOrEqual(space.u);
      expect(r.u + r.w).toBeLessThanOrEqual(space.u + space.w);
      expect(r.v).toBeGreaterThanOrEqual(space.v);
      expect(r.v + r.h).toBeLessThanOrEqual(space.v + space.h);
    }
  });

  it("keeps a gap between neighbours", () => {
    items.forEach((a, i) =>
      items.forEach((b, k) => {
        if (i >= k) return;
        const grown = { ...rectOf(a.id) };
        grown.u -= ARRANGE_GAP_MM - 1;
        grown.v -= ARRANGE_GAP_MM - 1;
        grown.w += (ARRANGE_GAP_MM - 1) * 2;
        grown.h += (ARRANGE_GAP_MM - 1) * 2;
        expect(rectsOverlap(grown, rectOf(b.id))).toBe(false);
      }),
    );
  });

  it("centres the group around eye level", () => {
    const rects = items.map((i) => rectOf(i.id));
    const bottom = Math.min(...rects.map((r) => r.v));
    const top = Math.max(...rects.map((r) => r.v + r.h));
    expect(Math.abs((bottom + top) / 2 - 1500)).toBeLessThan(60);
  });

  it("hands back what won't fit", () => {
    const tight = arrange(items, [{ u: 0, v: 1000, w: 400, h: 500 }]);
    expect(tight.left.map((i) => i.id)).toContain("poster");
    expect(tight.placed.length).toBeGreaterThan(0);
  });
});

describe("sizes of things", () => {
  it("uses a thing's own size, and a print's print size", () => {
    expect(placementSize({ printSizeId: "own", orientation: "portrait", widthMm: 500, heightMm: 700 })).toEqual({ w: 500, h: 700 });
    expect(placementSize({ printSizeId: "a4", orientation: "portrait" })).toEqual({ w: 210, h: 297 });
  });

  it("suggests the paper sizes that match a photo's shape, the right way up", () => {
    const portrait = sizesForAspect(210 / 297);
    expect(portrait.map((s) => s.label)).toContain("A4");
    expect(portrait.every((s) => s.h > s.w)).toBe(true);
    expect(sizesForAspect(1).length).toBe(0);
  });
});
