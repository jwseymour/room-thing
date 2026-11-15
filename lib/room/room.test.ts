import { describe, expect, it } from "vitest";
import {
  heldOutError,
  modelDistanceMm,
  pointInPolygon,
  rectInPolygon,
  rectsOverlap,
} from "./geometry";
import {
  coverCrop,
  orientationFor,
  PRINT_SIZES,
  printDimensions,
  printQuality,
} from "./print";
import {
  defaultRoom,
  MOUNTS,
  rectPolygon,
  roomDocumentSchema,
  type Fixture,
  type Measurement,
  type Surface,
} from "./schema";
import { snapRect } from "./snap";
import {
  defaultMount,
  findFreeSpot,
  validatePlacement,
  wallCoverage,
  type PlacedRect,
} from "./validate";

const wall: Surface = {
  id: "w",
  name: "Wall",
  kind: "wall",
  polygon: rectPolygon(3000, 2500),
  pose: null,
  allowedMounts: ["removable_strip", "removable_hook"],
  source: "tape",
};

const fixture = (over: Partial<Fixture> = {}): Fixture => ({
  id: "f",
  surfaceId: "w",
  kind: "radiator",
  rect: { u: 1000, v: 100, w: 800, h: 600 },
  keepClearMm: 100,
  label: "Radiator",
  source: "tape",
  ...over,
});

const item = (over: Partial<PlacedRect> = {}): PlacedRect => ({
  id: "p",
  rect: { u: 100, v: 1400, w: 297, h: 210 },
  mount: "removable_strip",
  ...over,
});

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("mounting rules", () => {
  it("rejects every mount a surface doesn't allow", () => {
    const allowed = new Set(wall.allowedMounts);
    for (const mount of MOUNTS.filter((m) => !allowed.has(m))) {
      const issues = validatePlacement(item({ mount }), wall, [], []);
      expect(codes(issues)).toContain("forbidden_mount");
      expect(issues.find((i) => i.code === "forbidden_mount")?.severity).toBe(
        "error",
      );
    }
  });

  it("accepts every mount a surface allows", () => {
    for (const mount of wall.allowedMounts) {
      expect(validatePlacement(item({ mount }), wall, [], [])).toEqual([]);
    }
  });

  it("never allows pins outside the pin board in the default room", () => {
    for (const surface of defaultRoom().surfaces) {
      const pinsAllowed = surface.allowedMounts.includes("pin");
      expect(pinsAllowed).toBe(surface.id === "pinboard");
    }
  });

  it("only offers a mount the surface allows", () => {
    expect(wall.allowedMounts).toContain(defaultMount(wall));
    expect(defaultMount({ ...wall, allowedMounts: [] })).toBeNull();
  });
});

describe("placement checks", () => {
  it("flags items off the surface", () => {
    const rect = { u: 2900, v: 1000, w: 297, h: 210 };
    expect(codes(validatePlacement(item({ rect }), wall, [], []))).toContain(
      "off_the_surface",
    );
  });

  it("allows an item flush with the wall's edge", () => {
    const rect = { u: 0, v: 0, w: 297, h: 210 };
    expect(validatePlacement(item({ rect }), wall, [], [])).toEqual([]);
  });

  it("respects a fixture's keep-clear zone, not just its outline", () => {
    const justInsideZone = { u: 1000, v: 750, w: 297, h: 210 };
    const issues = validatePlacement(
      item({ rect: justInsideZone }),
      wall,
      [fixture()],
      [],
    );
    expect(codes(issues)).toContain("blocks_fixture");

    const clearOfZone = { u: 1000, v: 800, w: 297, h: 210 };
    expect(
      validatePlacement(item({ rect: clearOfZone }), wall, [fixture()], []),
    ).toEqual([]);
  });

  it("ignores fixtures on other surfaces", () => {
    const elsewhere = fixture({
      surfaceId: "other",
      rect: { u: 100, v: 1400, w: 297, h: 210 },
    });
    expect(validatePlacement(item(), wall, [elsewhere], [])).toEqual([]);
  });

  it("treats furniture as a warning rather than a rule", () => {
    const desk = fixture({
      kind: "furniture",
      label: "Desk",
      rect: { u: 0, v: 0, w: 1200, h: 1500 },
      keepClearMm: 0,
    });
    const [issue] = validatePlacement(item(), wall, [desk], []);
    expect(issue.code).toBe("behind_furniture");
    expect(issue.severity).toBe("warning");
  });

  it("warns about overlaps but not about an item against itself", () => {
    const placement = item();
    expect(validatePlacement(placement, wall, [], [placement])).toEqual([]);
    expect(
      codes(
        validatePlacement(placement, wall, [], [{ ...placement, id: "q" }]),
      ),
    ).toEqual(["overlaps_item"]);
  });
});

describe("clutter", () => {
  it("warns once a wall is more than 30% covered", () => {
    const sparse = wallCoverage(wall, [], [item()]);
    expect(sparse.issue).toBeNull();

    const packed = wallCoverage(
      wall,
      [],
      [item({ rect: { u: 0, v: 0, w: 2000, h: 1500 } })],
    );
    expect(packed.coverage).toBeCloseTo(0.4);
    expect(packed.issue?.code).toBe("wall_too_busy");
  });
});

describe("finding a free spot", () => {
  const size = { w: 297, h: 210 };

  it("starts at the wall's centre, near eye level", () => {
    const spot = findFreeSpot(size, wall, [], []);
    expect(Math.abs(spot.u + size.w / 2 - 1500)).toBeLessThanOrEqual(50);
    expect(Math.abs(spot.v + size.h / 2 - 1500)).toBeLessThanOrEqual(50);
  });

  it("gives a spot that passes every check, with a window in the way", () => {
    const window = fixture({
      kind: "window",
      label: "Window",
      rect: { u: 900, v: 900, w: 1200, h: 1200 },
    });
    const spot = findFreeSpot(size, wall, [window], []);
    const issues = validatePlacement(
      item({ rect: { ...spot, ...size } }),
      wall,
      [window],
      [],
    );
    expect(issues).toEqual([]);
  });

  it("places successive items without overlapping", () => {
    const placed: PlacedRect[] = [];
    for (let i = 0; i < 6; i += 1) {
      const spot = findFreeSpot(size, wall, [], placed);
      const next = item({ id: `p${i}`, rect: { ...spot, ...size } });
      expect(validatePlacement(next, wall, [], placed)).toEqual([]);
      placed.push(next);
    }
  });
});

describe("snapping", () => {
  const wallSize = { w: 3000, h: 2500 };
  const rect = (u: number, v: number) => ({ u, v, w: 200, h: 100 });

  it("snaps to a 5 mm grid when nothing is close", () => {
    const snapped = snapRect(rect(403, 702), [], wallSize);
    expect([snapped.u, snapped.v]).toEqual([405, 700]);
    expect(snapped.guides).toEqual({ us: [], vs: [] });
  });

  it("lines up with a neighbour's edge and shows a guide", () => {
    const snapped = snapRect(rect(508, 300), [rect(500, 900)], wallSize);
    expect(snapped.u).toBe(500);
    expect(snapped.guides.us).toEqual([500]);
  });

  it("centres on the wall", () => {
    const snapped = snapRect(rect(1405, 300), [], wallSize);
    expect(snapped.u + 100).toBe(1500);
  });

  it("never drags past the wall's edge", () => {
    const snapped = snapRect(rect(2950, -40), [], wallSize);
    expect(snapped.u).toBe(2800);
    expect(snapped.v).toBe(0);
  });
});

describe("polygons", () => {
  it("handles a sloped ceiling", () => {
    const sloped = [
      { u: 0, v: 0 },
      { u: 3000, v: 0 },
      { u: 3000, v: 1500 },
      { u: 0, v: 2500 },
    ];
    expect(pointInPolygon({ u: 500, v: 2000 }, sloped)).toBe(true);
    expect(pointInPolygon({ u: 2500, v: 2000 }, sloped)).toBe(false);
    expect(rectInPolygon({ u: 2000, v: 1800, w: 900, h: 300 }, sloped)).toBe(
      false,
    );
  });

  it("doesn't count touching rectangles as overlapping", () => {
    const a = { u: 0, v: 0, w: 100, h: 100 };
    expect(rectsOverlap(a, { u: 100, v: 0, w: 100, h: 100 })).toBe(false);
    expect(rectsOverlap(a, { u: 99, v: 0, w: 100, h: 100 })).toBe(true);
  });
});

describe("print quality", () => {
  it("has correct true dimensions for A4 in both orientations", () => {
    expect(printDimensions("a4", "landscape")).toEqual({ w: 297, h: 210 });
    expect(printDimensions("a4", "portrait")).toEqual({ w: 210, h: 297 });
  });

  it("lists every size long edge first", () => {
    for (const size of PRINT_SIZES) {
      expect(size.longMm).toBeGreaterThanOrEqual(size.shortMm);
    }
  });

  it("computes ppi from the tighter axis", () => {
    // 4032 px across 297 mm is about 345 ppi; 3024 px across 210 mm about 366.
    const { ppi, rating } = printQuality(4032, 3024, { w: 297, h: 210 });
    expect(ppi).toBe(345);
    expect(rating).toBe("good");
  });

  it("rates small images honestly", () => {
    expect(printQuality(800, 600, { w: 297, h: 210 }).rating).toBe("too_small");
    expect(printQuality(1600, 1200, { w: 297, h: 210 }).rating).toBe("soft");
  });

  it("reports how much a crop removes", () => {
    const square = printQuality(1000, 1000, { w: 200, h: 100 });
    expect(square.cropped).toBeCloseTo(0.5);
    expect(printQuality(2000, 1000, { w: 200, h: 100 }).cropped).toBeCloseTo(0);
  });

  it("crops to the print's aspect ratio, centred, within the image", () => {
    const crop = coverCrop(4032, 3024, { w: 297, h: 210 });
    expect(crop.width).toBe(4032);
    expect(crop.height).toBe(2851);
    expect(crop.top).toBe(86);
    expect(crop.top + crop.height).toBeLessThanOrEqual(3024);
  });

  it("picks orientation from the image", () => {
    expect(orientationFor(3024, 4032)).toBe("portrait");
    expect(orientationFor(4032, 3024)).toBe("landscape");
    expect(orientationFor(1000, 1000)).toBe("landscape");
  });
});

describe("accuracy checks", () => {
  const check = (over: Partial<Measurement>): Measurement => ({
    id: "m",
    surfaceId: "w",
    refA: { target: "wall", side: "left" },
    refB: { target: "f", side: "left" },
    tapeMm: 1000,
    heldOut: true,
    method: "tape",
    ...over,
  });
  const doc = {
    ...defaultRoom(),
    surfaces: [wall],
    fixtures: [fixture()],
  };

  it("derives model distances from edges", () => {
    expect(modelDistanceMm(check({}), doc)).toBe(1000);
    const height = check({
      refA: { target: "wall", side: "bottom" },
      refB: { target: "f", side: "top" },
    });
    expect(modelDistanceMm(height, doc)).toBe(700);
  });

  it("refuses to compare edges on different axes", () => {
    const mixed = check({ refB: { target: "f", side: "top" } });
    expect(modelDistanceMm(mixed, doc)).toBeNull();
  });

  it("reports the worst held-out error and ignores build measurements", () => {
    const report = heldOutError({
      ...doc,
      measurements: [
        check({ id: "a", tapeMm: 1012 }),
        check({ id: "b", tapeMm: 985 }),
        check({ id: "c", tapeMm: 1500, heldOut: false }),
      ],
    });
    expect(report).toEqual({ checks: 2, worstMm: 15 });
  });

  it("reports nothing until there's a check", () => {
    expect(heldOutError(doc)).toBeNull();
  });
});

describe("room document", () => {
  it("validates the default room", () => {
    expect(() => roomDocumentSchema.parse(defaultRoom())).not.toThrow();
  });

  it("marks every default size as an estimate, never a measurement", () => {
    for (const surface of defaultRoom().surfaces) {
      expect(surface.source).toBe("estimate");
    }
  });

  it("rejects a mount it doesn't know", () => {
    const room = defaultRoom();
    const bad = JSON.parse(JSON.stringify(room));
    bad.surfaces[0].allowedMounts = ["nails"];
    expect(() => roomDocumentSchema.parse(bad)).toThrow();
  });
});
