import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it, vi } from "vitest";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "room-sheets-test-"));
vi.stubEnv("DATA_DIR", dataDir);

const { packSheets, sheetRect } = await import("./sheets");
const { renderSheets } = await import("./sheet-pdf");
const { largestSharpSize } = await import("./print");
const { ingestImage } = await import("../content/media");
const { addText, getContent } = await import("../content/store");

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const rects = (n: number, w: number, h: number) =>
  Array.from({ length: n }, (_, i) => ({ id: String(i), w, h }));

function expectTidy(sheets: ReturnType<typeof packSheets>) {
  for (const sheet of sheets) {
    for (const a of sheet) {
      expect(a.x).toBeGreaterThanOrEqual(-0.01);
      expect(a.y).toBeGreaterThanOrEqual(-0.01);
      expect(a.x + a.w).toBeLessThanOrEqual(210.01);
      expect(a.y + a.h).toBeLessThanOrEqual(297.01);
      for (const b of sheet) {
        if (a === b) continue;
        const apart =
          a.x + a.w <= b.x + 0.01 || b.x + b.w <= a.x + 0.01 ||
          a.y + a.h <= b.y + 0.01 || b.y + b.h <= a.y + 0.01;
        expect(apart).toBe(true);
      }
    }
  }
}

describe("laying prints out on A4", () => {
  it("fits two A5s, or four postcards, on one sheet", () => {
    const a5 = packSheets(rects(2, 148, 210));
    expect(a5).toHaveLength(1);
    expectTidy(a5);
    const a6 = packSheets(rects(4, 105, 148));
    expect(a6).toHaveLength(1);
    expectTidy(a6);
  });

  it("gives a full A4 its own sheet and starts a new one when full", () => {
    expect(packSheets(rects(3, 210, 297))).toHaveLength(3);
    const five = packSheets(rects(5, 105, 148));
    expect(five).toHaveLength(2);
    expectTidy(five);
  });

  it("packs a mix without overlap and loses nothing", () => {
    const mix = [
      ...rects(3, 152, 102),
      { id: "a", w: 148, h: 210 },
      { id: "b", w: 200, h: 200 },
      { id: "c", w: 178, h: 127 },
      { id: "d", w: 90.5, h: 148 },
    ];
    const sheets = packSheets(mix);
    expectTidy(sheets);
    expect(sheets.flat()).toHaveLength(mix.length);
  });

  it("turns two postcards to share the space under a wide picture", () => {
    const sheets = packSheets([
      { id: "p", w: 193, h: 148 },
      { id: "q1", w: 148, h: 105 },
      { id: "q2", w: 148, h: 105 },
    ]);
    expect(sheets).toHaveLength(1);
    expectTidy(sheets);
  });

  it("centres what's on the sheet", () => {
    const [[only]] = packSheets([{ id: "x", w: 100, h: 100 }]);
    expect(only.x).toBeCloseTo(55);
    expect(only.y).toBeCloseTo(98.5);
  });

  it("refuses something bigger than the sheet", () => {
    expect(() => packSheets([{ id: "x", w: 300, h: 300 }])).toThrow();
  });
});

describe("how big a print comes out", () => {
  const wide = { kind: "photo", widthPx: 3000, heightPx: 1000 };
  it("keeps a picture's shape when shown whole, and fills the size when cropped", () => {
    expect(sheetRect(wide, "a5", "whole")).toEqual({ w: 210, h: 70 });
    expect(sheetRect(wide, "a5", "fill")).toEqual({ w: 210, h: 148 });
    expect(sheetRect({ kind: "photo", widthPx: 1000, heightPx: 2000 }, "a5", "whole")).toEqual({ w: 105, h: 210 });
  });

  it("sets a quote landscape at the full size", () => {
    expect(sheetRect({ kind: "quote", widthPx: null, heightPx: null }, "postcard", "whole")).toEqual({ w: 148, h: 105 });
  });

  it("knows the largest size a picture stays sharp at", () => {
    expect(largestSharpSize(3000, 2000)?.id).toBe("a4");
    expect(largestSharpSize(1300, 900)?.id).toBe("a5");
    expect(largestSharpSize(400, 300)).toBeNull();
  });
});

describe("the PDF", () => {
  it("holds every item, on the right number of A4 pages", async () => {
    const make = (colour: string, w: number, h: number) =>
      sharp({ create: { width: w, height: h, channels: 4, background: colour } }).png().toBuffer();
    const photos = await Promise.all([
      ingestImage(await make("#c33", 900, 600), "red.png", "upload"),
      ingestImage(await make("#3c3", 600, 900), "green.png", "upload"),
      ingestImage(await make("#33c", 800, 800), "blue.png", "upload"),
    ]);
    const quote = addText({ kind: "quote", body: "A line is a dot that went for a walk.", attribution: "Paul Klee", source: "find" });
    const chosen = [
      ...photos.map((p) => ({ item: getContent(p.id)!, sizeId: "a5" })),
      { item: getContent(quote)!, sizeId: "postcard" },
    ];

    const { pdf, sheets } = await renderSheets(chosen, "whole");
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text.match(/\/Type \/Page /g)).toHaveLength(sheets);
    expect(text.match(/\/Subtype \/Image/g)).toHaveLength(4);
    expect(text).toContain("/MediaBox [0 0 595.28 841.89]");

    // The cross-reference table must point at each object, or readers reject the file.
    const start = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe("xref");
    const offsets = [...text.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offsets.forEach((offset, index) => {
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
  });
});
