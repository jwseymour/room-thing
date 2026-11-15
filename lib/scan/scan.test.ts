import { describe, expect, it } from "vitest";
import { surfaceBounds } from "../room/geometry";
import { defaultRoom, roomDocumentSchema } from "../room/schema";
import { adjustedFit, NO_ADJUSTMENT } from "./adjust";
import { applyMatrix, fitRoom } from "./fit";
import { applyBoxToRoom, rayToSurface, setPinBoard, surfaceFrame, surfacePoint } from "./frame";
import { SAMPLE_ROOM, sampleRoomSplats, splatCentres, writeSplatPly } from "./sample-room";

const splats = sampleRoomSplats(0.5);
const centres = splatCentres(splats);

describe("finding the room in a scan", () => {
  const fit = fitRoom(centres);
  const dims = [fit.widthM, fit.depthM].sort((a, b) => a - b);

  it("works out that the file is upside down", () => {
    expect(fit.up).toBe("y-");
  });

  it("measures the room to within 2 cm", () => {
    expect(dims[0]).toBeCloseTo(SAMPLE_ROOM.widthM, 1);
    expect(Math.abs(dims[0] - SAMPLE_ROOM.widthM)).toBeLessThan(0.02);
    expect(Math.abs(dims[1] - SAMPLE_ROOM.depthM)).toBeLessThan(0.02);
    expect(Math.abs(fit.heightM - SAMPLE_ROOM.heightM)).toBeLessThan(0.02);
  });

  it("puts every point inside the room, with the floor at zero", () => {
    let outside = 0;
    for (let i = 0; i < centres.length; i += 3) {
      const [x, y, z] = applyMatrix(fit.matrix, centres[i], centres[i + 1], centres[i + 2]);
      const slack = 0.04;
      if (
        x < -slack || x > fit.widthM + slack ||
        y < -slack || y > fit.heightM + slack ||
        z < -slack || z > fit.depthM + slack
      ) outside++;
    }
    expect(outside / (centres.length / 3)).toBeLessThan(0.002);
  });

  it("keeps the scan the right way round, not mirrored", () => {
    const m = fit.matrix;
    const det =
      m[0] * (m[5] * m[10] - m[9] * m[6]) -
      m[4] * (m[1] * m[10] - m[9] * m[2]) +
      m[8] * (m[1] * m[6] - m[5] * m[2]);
    expect(det).toBeCloseTo(1, 5);
  });

  it("reports that it's confident about a clean room", () => {
    expect(fit.confidence.floor).toBeGreaterThan(0.3);
    expect(fit.confidence.walls).toBeGreaterThan(0.1);
  });

  it("copes with clutter outside the walls, as seen through a window", () => {
    const extra = new Float32Array(centres.length + 3000);
    extra.set(centres);
    for (let i = 0; i < 1000; i++) {
      extra.set([9 + Math.sin(i) * 2, Math.cos(i * 1.3), 5 + Math.cos(i) * 3], centres.length + i * 3);
    }
    const noisy = fitRoom(extra);
    const d = [noisy.widthM, noisy.depthM].sort((a, b) => a - b);
    expect(Math.abs(d[0] - SAMPLE_ROOM.widthM)).toBeLessThan(0.03);
    expect(Math.abs(d[1] - SAMPLE_ROOM.depthM)).toBeLessThan(0.03);
  });
});

describe("sample scan file", () => {
  it("is a readable splat PLY of the right length", () => {
    const ply = writeSplatPly(splats.slice(0, 10));
    const text = ply.subarray(0, 400).toString("ascii");
    expect(text.startsWith("ply\nformat binary_little_endian 1.0\nelement vertex 10\n")).toBe(true);
    const headerEnd = ply.indexOf("end_header\n") + "end_header\n".length;
    expect(ply.length - headerEnd).toBe(10 * 14 * 4);
  });
});

describe("hand corrections", () => {
  const fit = fitRoom(centres);

  it("changes nothing when there are none", () => {
    const out = adjustedFit(fit, NO_ADJUSTMENT);
    out.matrix.forEach((value, i) => expect(value).toBeCloseTo(fit.matrix[i], 9));
    expect(out.w).toBeCloseTo(fit.widthM, 9);
  });

  it("moving the left wall out grows the room and shifts the origin", () => {
    const out = adjustedFit(fit, { ...NO_ADJUSTMENT, left: 0.1 });
    expect(out.w).toBeCloseTo(fit.widthM + 0.1, 9);
    const before = applyMatrix(fit.matrix, centres[0], centres[1], centres[2]);
    const after = applyMatrix(out.matrix, centres[0], centres[1], centres[2]);
    expect(after[0] - before[0]).toBeCloseTo(0.1, 6);
    expect(after[2]).toBeCloseTo(before[2], 6);
  });

  it("a tape measurement rescales the room and the scan together", () => {
    const out = adjustedFit(fit, { ...NO_ADJUSTMENT, tapeScale: 1.02 });
    expect(out.w).toBeCloseTo(fit.widthM * 1.02, 9);
    const before = applyMatrix(fit.matrix, centres[0], centres[1], centres[2]);
    const after = applyMatrix(out.matrix, centres[0], centres[1], centres[2]);
    expect(after[0]).toBeCloseTo(before[0] * 1.02, 6);
  });

  it("turning keeps the middle of the room where it was", () => {
    const out = adjustedFit(fit, { ...NO_ADJUSTMENT, turnDeg: 3 });
    // Find the scan point that maps to the room's centre, by inverting the fit
    // on a known point: use a real centre near the middle instead.
    let nearest = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < centres.length; i += 3) {
      const [x, , z] = applyMatrix(fit.matrix, centres[i], centres[i + 1], centres[i + 2]);
      const distance = Math.hypot(x - fit.widthM / 2, z - fit.depthM / 2);
      if (distance < bestDistance) { bestDistance = distance; nearest = i; }
    }
    const before = applyMatrix(fit.matrix, centres[nearest], centres[nearest + 1], centres[nearest + 2]);
    const after = applyMatrix(out.matrix, centres[nearest], centres[nearest + 1], centres[nearest + 2]);
    expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeLessThan(bestDistance * 0.06 + 1e-6);
  });
});

describe("walls from the scan", () => {
  const box = { widthMm: 3400, depthMm: 4200, heightMm: 2550 };
  const doc = applyBoxToRoom(defaultRoom(), box);
  const walls = doc.surfaces.filter((s) => s.kind === "wall");

  it("keeps existing wall ids and rules, and sizes them from the scan", () => {
    expect(walls.map((w) => w.id)).toEqual(["pinboard", "wall-b", "wall-c", "wall-d"]);
    expect(walls.map((w) => surfaceBounds(w).w)).toEqual([3400, 4200, 3400, 4200]);
    expect(walls.every((w) => w.source === "scan" && surfaceBounds(w).h === 2550)).toBe(true);
    expect(walls[0].allowedMounts).toContain("pin");
    expect(doc.surfaces.some((s) => s.id === "door-back")).toBe(true);
    expect(roomDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("places each wall so its corners meet its neighbours and it faces inwards", () => {
    walls.forEach((wall, i) => {
      const frame = surfaceFrame(wall)!;
      const end = surfacePoint(frame, surfaceBounds(wall).w, 0);
      const next = surfaceFrame(walls[(i + 1) % 4])!;
      expect(end[0]).toBeCloseTo(next.origin[0], 6);
      expect(end[2]).toBeCloseTo(next.origin[2], 6);
      // A step along the normal from the wall's middle lands inside the room.
      const mid = surfacePoint(frame, surfaceBounds(wall).w / 2, 1000, 0.5);
      expect(mid[0]).toBeGreaterThan(0);
      expect(mid[0]).toBeLessThan(3.4);
      expect(mid[2]).toBeGreaterThan(0);
      expect(mid[2]).toBeLessThan(4.2);
    });
  });

  it("turns a ray from inside the room into a position on the wall", () => {
    const frame = surfaceFrame(walls[0])!;
    // Standing in the middle, looking straight at wall A (which is at z = 0).
    const hit = rayToSurface(frame, [1.0, 1.5, 2.0], [0, 0, -1]);
    expect(hit?.u).toBeCloseTo(1000, 6);
    expect(hit?.v).toBeCloseTo(1500, 6);
    expect(hit?.distance).toBeCloseTo(2, 6);
    // From behind the wall there's nothing to hit.
    expect(rayToSurface(frame, [1.0, 1.5, -1], [0, 0, 1])).toBeNull();
  });

  it("moves the pin board to another wall, leaving only one", () => {
    const moved = setPinBoard(doc, "wall-c");
    const pinned = moved.surfaces.filter((s) => s.allowedMounts.includes("pin"));
    expect(pinned.map((s) => s.id)).toEqual(["wall-c"]);
    expect(moved.surfaces.find((s) => s.id === "pinboard")?.allowedMounts).toEqual([
      "removable_strip",
      "removable_hook",
    ]);
  });
});
