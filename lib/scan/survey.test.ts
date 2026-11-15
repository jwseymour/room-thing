import { describe, expect, it } from "vitest";
import { readSplatPly } from "./cloud";
import { fitRoom } from "./fit";
import { SAMPLE_ROOM, sampleRoomSplats, writeSplatPly } from "./sample-room";
import { drawWall, surveyRoom, toRoomPoints, wallFrame } from "./survey";

const ply = writeSplatPly(sampleRoomSplats(0.6));
const cloud = readSplatPly(new Uint8Array(ply))!;
const fit = fitRoom(cloud.positions);
const points = toRoomPoints(cloud, fit.matrix, fit.plan, fit.heightM);
const { blocks } = surveyRoom(points, fit.plan, fit.heightM);

describe("reading a scan file", () => {
  it("gets every splat's place, colour and size", () => {
    expect(cloud.count).toBeGreaterThan(20_000);
    expect(cloud.opacities[0]).toBeGreaterThan(0.99);
    expect(cloud.radii[0]).toBeGreaterThan(0.01);
    // The sample's floorboards are brown: more red than blue.
    let red = 0, blue = 0;
    for (let i = 0; i < cloud.count; i++) {
      red += cloud.colors[i * 3];
      blue += cloud.colors[i * 3 + 2];
    }
    expect(red).toBeGreaterThan(blue);
  });

  it("turns away anything that isn't a binary splat file", () => {
    expect(readSplatPly(new TextEncoder().encode("not a scan"))).toBeNull();
    expect(readSplatPly(new TextEncoder().encode("ply\nformat ascii 1.0\nend_header\n"))).toBeNull();
  });
});

describe("the room's outline", () => {
  it("has four corners that go round clockwise from the origin", () => {
    expect(fit.plan).toHaveLength(4);
    expect(fit.plan[0][0]).toBeCloseTo(0, 6);
    expect(fit.plan[0][1]).toBeCloseTo(0, 6);
    // Wall A runs along X, and every wall's normal points into the room.
    expect(fit.plan[1][1]).toBeCloseTo(0, 6);
    const middle = [fit.widthM / 2, fit.depthM / 2];
    fit.plan.forEach((_, i) => {
      const f = wallFrame(fit.plan, i);
      const inwards = (middle[0] - f.origin[0]) * f.normal[0] + (middle[1] - f.origin[1]) * f.normal[1];
      expect(inwards).toBeGreaterThan(0.5);
    });
  });

  it("keeps a square room square", () => {
    const sides = fit.plan.map((c, i) => {
      const n = fit.plan[(i + 1) % 4];
      return Math.hypot(n[0] - c[0], n[1] - c[1]);
    });
    const [short, long] = [Math.min(...sides), Math.max(...sides)];
    expect(Math.abs(short - SAMPLE_ROOM.widthM)).toBeLessThan(0.03);
    expect(Math.abs(long - SAMPLE_ROOM.depthM)).toBeLessThan(0.03);
    expect(fit.ceilingSeen).toBe(true);
  });

  it("ignores a far-off shell of splats standing in for the sky", () => {
    const shell = new Float32Array(cloud.positions.length + 3 * 4000);
    shell.set(cloud.positions);
    for (let i = 0; i < 4000; i++) {
      const a = i * 0.7, b = i * 0.13;
      shell.set([200 * Math.cos(a) * Math.cos(b), 200 * Math.sin(b), 200 * Math.sin(a) * Math.cos(b)], cloud.positions.length + i * 3);
    }
    const far = fitRoom(shell);
    expect(Math.abs(far.heightM - SAMPLE_ROOM.heightM)).toBeLessThan(0.03);
    expect(Math.abs(Math.min(far.widthM, far.depthM) - SAMPLE_ROOM.widthM)).toBeLessThan(0.03);
  });

  it("says so when the scan never caught the ceiling", () => {
    // Drop the top 15 cm of the room: the ceiling and nothing else.
    const kept: number[] = [];
    for (let i = 0; i < cloud.count; i++) {
      const [x, y, z] = [cloud.positions[i * 3], cloud.positions[i * 3 + 1], cloud.positions[i * 3 + 2]];
      const height = fit.matrix[1] * x + fit.matrix[5] * y + fit.matrix[9] * z + fit.matrix[13];
      if (height < fit.heightM - 0.15) kept.push(x, y, z);
    }
    const open = fitRoom(new Float32Array(kept));
    expect(open.ceilingSeen).toBe(false);
    expect(open.heightM).toBeGreaterThan(SAMPLE_ROOM.heightM - 0.25);
  });
});

describe("finding the furniture", () => {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.09;

  it("finds the bed, the wardrobe and the desk, and nothing else", () => {
    expect(blocks.map((b) => b.kind).sort()).toEqual(["bed", "desk", "tall"]);
  });

  it("measures the bed, taking it to run on to the walls it stands against", () => {
    const bed = blocks.find((b) => b.kind === "bed")!;
    // 2.0 × 0.95, plus the 10 cm and 5 cm gaps to the walls that nothing saw into.
    expect(near(Math.max(bed.w, bed.d), 2.1)).toBe(true);
    expect(near(Math.min(bed.w, bed.d), 1.0)).toBe(true);
    expect(near(bed.top, 0.5)).toBe(true);
    expect(bed.open).toBe(false);
  });

  it("fills in the wardrobe behind its doors, right back to the wall", () => {
    const wardrobe = blocks.find((b) => b.kind === "tall")!;
    expect(near(wardrobe.top, 1.95)).toBe(true);
    // 0.6 deep plus the 5 cm it stands off the wall, which nothing can see into.
    expect(Math.min(wardrobe.w, wardrobe.d)).toBeGreaterThan(0.55);
    expect(Math.max(wardrobe.w, wardrobe.d)).toBeGreaterThan(0.9);
  });

  it("sees that the desk is open underneath", () => {
    const desk = blocks.find((b) => b.kind === "desk")!;
    expect(desk.open).toBe(true);
    expect(near(desk.top, 0.74)).toBe(true);
  });

  it("colours each piece from the scan", () => {
    const bed = blocks.find((b) => b.kind === "bed")!;
    // The sample's bed is blue.
    const [r, , b] = [1, 3, 5].map((i) => parseInt(bed.color.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
  });
});

describe("a flat picture of a wall", () => {
  it("is the wall's size, and covered by the wall", () => {
    const image = drawWall(points, fit.plan, fit.heightM, 0, 0.07, 100);
    const f = wallFrame(fit.plan, 0);
    expect(image.width).toBe(Math.round(f.length * 100));
    expect(image.height).toBe(Math.round(fit.heightM * 100));
    let covered = 0;
    for (let i = 3; i < image.rgba.length; i += 4) if (image.rgba[i] > 128) covered++;
    expect(covered / (image.width * image.height)).toBeGreaterThan(0.9);
  });
});
