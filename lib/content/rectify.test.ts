import { describe, expect, it } from "vitest";
import { project, rectify, squareToQuad, straightSize } from "./rectify";

describe("straightening a photo", () => {
  const quad = [
    { x: 20, y: 10 },
    { x: 90, y: 25 },
    { x: 80, y: 95 },
    { x: 5, y: 70 },
  ];

  it("maps the corners of the picture onto the marked corners", () => {
    const m = squareToQuad(quad);
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    corners.forEach(([u, v], i) => {
      const p = project(m, u, v);
      expect(p.x).toBeCloseTo(quad[i].x, 6);
      expect(p.y).toBeCloseTo(quad[i].y, 6);
    });
  });

  it("leaves a square-on photo as it is", () => {
    const m = squareToQuad([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 0, y: 4 }]);
    expect(project(m, 0.5, 0.5)).toEqual({ x: 4, y: 2 });
  });

  it("sizes the result from the longer of each pair of edges, within a limit", () => {
    expect(straightSize([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 380, y: 300 }, { x: 20, y: 300 }])).toEqual({ width: 400, height: 301 });
    const capped = straightSize([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 2000 }, { x: 0, y: 2000 }], 1000);
    expect(capped).toEqual({ width: 1000, height: 500 });
  });

  it("cuts the marked part out of the photo", () => {
    // A 4 × 4 photo, red on the left half and blue on the right.
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) data.set(x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 4 + x) * 4);
    }
    const right = [{ x: 2, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 2, y: 4 }];
    const out = rectify({ data, width: 4, height: 4 }, right, { width: 2, height: 2 });
    expect(Array.from(out.slice(4, 8))).toEqual([0, 0, 255, 255]);
  });
});
