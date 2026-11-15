import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "room-test-"));
vi.stubEnv("DATA_DIR", dataDir);

const { getDb } = await import("./db");
const { content, roomVersions, signals } = await import("./db/schema");
const { ingestImage, variantPath, UnsupportedImageError } = await import(
  "./content/media"
);
const { addText, decide, inboxBatch, statusCounts, undoDecision } = await import(
  "./content/store"
);
const {
  activePlacements,
  addPlacement,
  getRoom,
  markOrdered,
  markSurfaceUp,
  removePlacement,
  saveRoom,
  setUp,
  updatePlacement,
} = await import("./room/store");
const { printFileNames, renderPrintFile } = await import("./room/print-files");

const photo = (colour: string) =>
  sharp({
    create: { width: 300, height: 200, channels: 3, background: colour },
  })
    .jpeg()
    .toBuffer();

const placementInput = (contentId: string) => ({
  surfaceId: "wall-b",
  contentId,
  printSizeId: "a4",
  orientation: "landscape" as const,
  u: 100,
  v: 1000,
  mount: "removable_strip" as const,
});

beforeAll(() => {
  getRoom();
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("mount rules on the server", () => {
  it("refuses a forbidden mount even if the interface is bypassed", () => {
    const id = addText({
      kind: "quote",
      body: "x",
      attribution: null,
      source: "upload",
    });
    expect(() =>
      addPlacement({ ...placementInput(id), mount: "pin" }),
    ).toThrow(/isn't allowed/);
    expect(activePlacements("wall-b")).toEqual([]);
  });

  it("refuses to change a placement to a forbidden mount", () => {
    const id = addText({
      kind: "quote",
      body: "y",
      attribution: null,
      source: "upload",
    });
    const placement = addPlacement(placementInput(id));
    expect(() => updatePlacement(placement, { mount: "pin" })).toThrow(
      /isn't allowed/,
    );
    removePlacement(placement);
  });

  it("allows pins on the pin board", () => {
    const id = addText({
      kind: "quote",
      body: "z",
      attribution: null,
      source: "upload",
    });
    const placement = addPlacement({
      ...placementInput(id),
      surfaceId: "pinboard",
      mount: "pin",
    });
    expect(activePlacements("pinboard").map((p) => p.id)).toContain(placement);
    removePlacement(placement);
  });
});

describe("placement history", () => {
  it("keeps removed items in the database for rotation", () => {
    const id = addText({
      kind: "quote",
      body: "history",
      attribution: null,
      source: "upload",
    });
    const placement = addPlacement(placementInput(id));
    removePlacement(placement);
    expect(activePlacements("wall-b").map((p) => p.id)).not.toContain(
      placement,
    );
    const types = getDb()
      .select({ type: signals.type })
      .from(signals)
      .where(eq(signals.contentId, id))
      .all()
      .map((s) => s.type);
    expect(types.sort()).toEqual(["placed", "removed"]);
  });
});

describe("sorting", () => {
  it("moves an item out of the inbox and records the reaction", () => {
    const id = addText({
      kind: "quote",
      body: "sort me",
      attribution: null,
      source: "upload",
    });
    const before = statusCounts();
    decide(id, "more_like_this");
    expect(statusCounts().keep).toBe(before.keep + 1);
    expect(statusCounts().inbox).toBe(before.inbox - 1);
    expect(inboxBatch(100).map((i) => i.id)).not.toContain(id);
  });

  it("records how long the item was looked at", () => {
    const id = addText({
      kind: "quote",
      body: "Lingered over",
      attribution: null,
      source: "upload",
    });
    decide(id, "keep", 4200);
    const signal = getDb()
      .select()
      .from(signals)
      .where(eq(signals.contentId, id))
      .get();
    expect(signal?.dwellMs).toBe(4200);
  });

  it("undo restores the item and removes the reaction", () => {
    const id = addText({
      kind: "quote",
      body: "oops",
      attribution: null,
      source: "upload",
    });
    decide(id, "no");
    undoDecision(id);

    const row = getDb().select().from(content).where(eq(content.id, id)).get();
    expect(row?.status).toBe("inbox");
    expect(row?.decidedAt).toBeNull();
    const left = getDb()
      .select()
      .from(signals)
      .where(eq(signals.contentId, id))
      .all();
    expect(left).toEqual([]);
  });

  it("undo leaves wall history in place", () => {
    const id = addText({
      kind: "quote",
      body: "placed",
      attribution: null,
      source: "upload",
    });
    decide(id, "keep");
    addPlacement(placementInput(id));
    undoDecision(id);
    const types = getDb()
      .select({ type: signals.type })
      .from(signals)
      .where(eq(signals.contentId, id))
      .all()
      .map((s) => s.type);
    expect(types).toEqual(["placed"]);
  });
});

describe("room versions", () => {
  it("keeps every saved version", () => {
    const start = getRoom();
    const saved = saveRoom({ ...start.doc, name: "Renamed" });
    expect(saved.version).toBe(start.version + 1);
    expect(getRoom().doc.name).toBe("Renamed");

    const versions = getDb()
      .select({ version: roomVersions.version })
      .from(roomVersions)
      .all();
    expect(versions.length).toBe(saved.version);
  });

  it("rejects an invalid room without changing the saved one", () => {
    const start = getRoom();
    expect(() => saveRoom({ ...start.doc, ceilingMm: -1 })).toThrow();
    expect(getRoom().version).toBe(start.version);
  });
});

describe("image ingest", () => {
  it("stores the original and both sizes", async () => {
    const { id } = await ingestImage(await photo("#336699"), "a.jpg", "upload");
    for (const variant of ["original", "thumb", "card"] as const) {
      expect(fs.statSync(variantPath(id, variant)).size).toBeGreaterThan(0);
    }
  });

  it("recognises the same file added twice", async () => {
    const bytes = await photo("#993366");
    const first = await ingestImage(bytes, "b.jpg", "upload");
    const second = await ingestImage(bytes, "copy.jpg", "shortcut");
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ id: first.id, duplicate: true });
  });

  it("records upright dimensions for a sideways photo", async () => {
    const bytes = await sharp(await photo("#669933"))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const { id } = await ingestImage(bytes, "c.jpg", "upload");
    const row = getDb().select().from(content).where(eq(content.id, id)).get();
    expect([row?.widthPx, row?.heightPx]).toEqual([200, 300]);
  });

  it("rejects something that isn't an image", async () => {
    await expect(
      ingestImage(Buffer.from("not a picture"), "d.jpg", "upload"),
    ).rejects.toBeInstanceOf(UnsupportedImageError);
  });

  // HEIC is what an iPhone saves. Only macOS can make and read one here.
  it.runIf(process.platform === "darwin")("converts a HEIC photo", async () => {
    const jpeg = path.join(dataDir, "heic-source.jpg");
    const heic = path.join(dataDir, "heic-source.heic");
    fs.writeFileSync(jpeg, await photo("#996633"));
    execFileSync("sips", ["-s", "format", "heic", jpeg, "--out", heic], {
      stdio: "ignore",
    });

    const { id } = await ingestImage(fs.readFileSync(heic), "e.heic", "upload");
    const row = getDb().select().from(content).where(eq(content.id, id)).get();
    expect(row?.mimeType).toBe("image/jpeg");
    expect([row?.widthPx, row?.heightPx]).toEqual([300, 200]);
    const thumb = await sharp(variantPath(id, "thumb")).metadata();
    expect(thumb.width).toBe(300);
  });
});

describe("print files", () => {
  it("crops the upright image and doesn't enlarge it", async () => {
    // Stored on its side: red on the left, blue on the right.
    const half = (colour: string) =>
      sharp({ create: { width: 150, height: 200, channels: 3, background: colour } })
        .png()
        .toBuffer();
    const sideways = await sharp({
      create: { width: 300, height: 200, channels: 3, background: "#000000" },
    })
      .composite([
        { input: await half("#ff0000"), left: 0, top: 0 },
        { input: await half("#0000ff"), left: 150, top: 0 },
      ])
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
      .toBuffer();
    const { id } = await ingestImage(sideways, "f.jpg", "upload");
    const row = getDb().select().from(content).where(eq(content.id, id)).get();

    const print = await renderPrintFile({
      printSizeId: "6x4",
      orientation: "portrait",
      content: row!,
    });
    const meta = await sharp(print).metadata();
    // Upright it's 200 × 300, already the print's 2:3 shape, and stays that size.
    expect(meta.width).toBe(200);
    expect(meta.height).toBeGreaterThanOrEqual(298);
    expect(meta.orientation ?? 1).toBe(1);

    const corner = async (image: Buffer, top: number) => {
      const { data } = await sharp(image)
        .extract({ left: 90, top, width: 20, height: 20 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      return data[0] > data[2] ? "red" : "blue";
    };
    const upright = await sharp(sideways).autoOrient().png().toBuffer();
    expect(await corner(print, 20)).toBe(await corner(upright, 20));
    expect(await corner(print, 260)).toBe(await corner(upright, 260));
    expect(await corner(print, 20)).not.toBe(await corner(print, 260));
  });
});

describe("print file names", () => {
  it("numbers within each size", () => {
    expect(
      printFileNames([
        { printSizeId: "a4" },
        { printSizeId: "6x4" },
        { printSizeId: "a4" },
      ]),
    ).toEqual(["a4/a4-01.jpg", "6x4/6x4-01.jpg", "a4/a4-02.jpg"]);
  });
});

describe("ordering and hanging", () => {
  const stateOf = (id: string) =>
    activePlacements().find((p) => p.id === id)?.state;

  it("moves an item from planned to ordered to up, and back down", () => {
    const contentId = addText({
      kind: "quote",
      body: "Up it goes",
      attribution: null,
      source: "upload",
    });
    const id = addPlacement(placementInput(contentId));
    expect(stateOf(id)).toBe("planned");

    markOrdered();
    expect(stateOf(id)).toBe("ordered");

    setUp(id, true);
    expect(stateOf(id)).toBe("up");

    // Ordering again must not pull a hung item back down.
    markOrdered();
    expect(stateOf(id)).toBe("up");

    setUp(id, false);
    expect(stateOf(id)).toBe("ordered");
  });

  it("marks a whole surface up without touching other surfaces", () => {
    const contentId = addText({
      kind: "quote",
      body: "Elsewhere",
      attribution: null,
      source: "upload",
    });
    const here = addPlacement(placementInput(contentId));
    const elsewhere = addPlacement({
      ...placementInput(contentId),
      surfaceId: "pinboard",
      mount: "pin",
    });

    expect(markSurfaceUp("wall-b")).toBeGreaterThan(0);
    expect(stateOf(here)).toBe("up");
    expect(stateOf(elsewhere)).toBe("planned");
  });

  it("can't bring a removed item back by marking it up", () => {
    const contentId = addText({
      kind: "quote",
      body: "Gone",
      attribution: null,
      source: "upload",
    });
    const id = addPlacement(placementInput(contentId));
    removePlacement(id);
    setUp(id, true);
    expect(stateOf(id)).toBeUndefined();
  });
});
