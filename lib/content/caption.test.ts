import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { captionImage, captionLines } from "./caption";

describe("captioning a still", () => {
  it("breaks a long caption into subtitle-length lines", () => {
    expect(captionLines("All those moments will be lost in time, like tears in rain.")).toEqual([
      "All those moments will be lost in time, like",
      "tears in rain.",
    ]);
    expect(captionLines("  ")).toEqual([]);
  });

  it("draws light text along the bottom and leaves the top alone", async () => {
    const dark = await sharp({ create: { width: 1200, height: 675, channels: 3, background: "#101010" } })
      .jpeg()
      .toBuffer();
    const out = await captionImage(dark, "Time to die. <& done>");
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 675]);
    const brightest = async (top: number, height: number) =>
      // Cut the strip out first: stats() measures the whole input, whatever was extracted.
      (await sharp(await sharp(out).extract({ left: 0, top, width: 1200, height }).png().toBuffer()).stats())
        .channels[0].max;
    expect(await brightest(560, 115)).toBeGreaterThan(200);
    expect(await brightest(0, 400)).toBeLessThan(60);
  });
});
