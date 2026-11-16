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
const {
  addText,
  alreadyKept,
  decide,
  describeFound,
  inboxBatch,
  listTray,
  setPrinted,
  statusCounts,
  undoDecision,
} = await import("./content/store");
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
const { currentScan, newScanTarget, recordScan, saveAlignment } = await import(
  "./scan/store"
);
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

describe("the tray of things to print", () => {
  it("holds what's kept until it's printed", () => {
    const kept = addText({ kind: "quote", body: "Kept for the tray.", attribution: null, source: "find" });
    const unsure = addText({ kind: "quote", body: "Only a maybe.", attribution: null, source: "find" });
    decide(kept, "keep");
    decide(unsure, "maybe");
    const inTray = () => listTray().map((item) => item.id);
    expect(inTray()).toContain(kept);
    expect(inTray()).not.toContain(unsure);

    setPrinted([kept], true);
    expect(inTray()).not.toContain(kept);
    setPrinted([kept], false);
    expect(inTray()).toContain(kept);
  });

  it("knows a found picture or line when it sees it again", async () => {
    const saved = await ingestImage(await photo("#445566"), "found.jpg", "upload");
    describeFound(saved.id, {
      title: "Found",
      attribution: null,
      sourceUrl: "https://example.org/found",
      foundRef: "commons:File:Found.jpg",
    });
    const line = addText({ kind: "quote", body: "Seen before.", attribution: null, source: "find" });

    expect(alreadyKept(["commons:File:Found.jpg", "met:1"], ["Seen before.", "Never seen."])).toEqual({
      "commons:File:Found.jpg": saved.id,
      "Seen before.": line,
    });
    expect(alreadyKept([], [])).toEqual({});
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

describe("scans", () => {
  it("lines a scan up and rebuilds the walls, keeping what's planned on them", () => {
    const contentId = addText({
      kind: "quote",
      body: "Stays put",
      attribution: null,
      source: "upload",
    });
    const placed = addPlacement(placementInput(contentId));

    const target = newScanTarget("ply");
    fs.writeFileSync(target.file, "ply");
    const scan = recordScan({ id: target.id, filename: "room.ply", fileType: "ply", bytes: 3 });
    expect(currentScan()?.id).toBe(scan.id);
    expect(currentScan()?.alignment).toBeNull();

    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    saveAlignment(
      scan.id,
      { matrix: identity, up: "y-", tapeScale: 1 },
      { widthMm: 3400, depthMm: 4200, heightMm: 2550 },
      false,
    );

    const saved = currentScan();
    expect(saved?.alignment?.up).toBe("y-");
    expect(saved?.tapeCheckedAt).toBeNull();
    const wallB = getRoom().doc.surfaces.find((s) => s.id === "wall-b");
    expect(wallB?.source).toBe("scan");
    expect(wallB?.pose).toEqual({ x: 3400, y: 0, yawDeg: 90 });
    expect(activePlacements("wall-b").some((p) => p.id === placed)).toBe(true);

    saveAlignment(
      scan.id,
      { matrix: identity, up: "y-", tapeScale: 1.01 },
      { widthMm: 3434, depthMm: 4242, heightMm: 2575 },
      true,
    );
    expect(currentScan()?.tapeCheckedAt).not.toBeNull();
  });
});

describe("building the room from a scan", () => {
  it("measures the walls, finds the furniture, and draws each wall", async () => {
    const { surveyScan } = await import("./scan/ingest");
    const { sampleRoomSplats, writeSplatPly } = await import("./scan/sample-room");
    const { wallImagePath } = await import("./scan/store");
    const target = newScanTarget("ply");
    const ply = writeSplatPly(sampleRoomSplats(0.6));
    fs.writeFileSync(target.file, ply);
    const scan = recordScan({ id: target.id, filename: "sample.ply", fileType: "ply", bytes: ply.length });

    expect(await surveyScan(scan.id)).toBe(true);

    const { doc } = getRoom();
    const walls = doc.surfaces.filter((s) => s.kind === "wall" && s.pose);
    expect(walls).toHaveLength(4);
    // The walls keep their ids, so what was planned on them is still there.
    expect(walls.map((w) => w.id)).toEqual(["pinboard", "wall-b", "wall-c", "wall-d"]);
    expect(doc.ceilingMm).toBeGreaterThan(2500);
    expect(doc.blocks.map((b) => b.kind).sort()).toEqual(["bed", "desk", "tall"]);
    expect(doc.blocks.every((b) => b.source === "scan")).toBe(true);
    for (const wall of walls) expect(fs.existsSync(wallImagePath(scan.id, wall.id))).toBe(true);
    expect(currentScan()?.alignment?.ceilingSeen).toBe(true);
  });

  it("leaves a file it can't read to be lined up by hand", async () => {
    const { surveyScan } = await import("./scan/ingest");
    const target = newScanTarget("ply");
    fs.writeFileSync(target.file, "ply");
    const scan = recordScan({ id: target.id, filename: "broken.ply", fileType: "ply", bytes: 3 });
    expect(await surveyScan(scan.id)).toBe(false);
    const spz = recordScan({ id: newScanTarget("spz").id, filename: "room.spz", fileType: "spz", bytes: 3 });
    expect(await surveyScan(spz.id)).toBe(false);
  });

  it("corrects the whole room from one wall measured with a tape", async () => {
    const { applyTapeMeasure, deleteScan } = await import("./scan/store");
    // Drop the unreadable scans from the test above, so the sample is current again.
    for (let scan = currentScan(); scan && !scan.alignment; scan = currentScan()) deleteScan(scan.id);
    const before = getRoom().doc;
    const wall = before.surfaces.find((s) => s.id === "wall-b")!;
    const width = Math.max(...wall.polygon.map((p) => p.u));
    const placed = activePlacements("wall-b")[0];

    const k = applyTapeMeasure("wall-b", Math.round(width * 1.02));

    expect(k).toBeCloseTo(1.02, 3);
    const after = getRoom().doc;
    expect(after.ceilingMm).toBe(Math.round(before.ceilingMm * k));
    expect(after.blocks[0].w).toBe(Math.round(before.blocks[0].w * k));
    expect(after.surfaces.find((s) => s.id === "wall-b")?.source).toBe("tape");
    // The picture moves with the wall, but keeps its own size.
    const moved = activePlacements("wall-b").find((p) => p.id === placed.id)!;
    expect(moved.u).toBe(Math.round(placed.u * k));
    expect(moved.printSizeId).toBe(placed.printSizeId);
    expect(currentScan()?.tapeCheckedAt).not.toBeNull();
    expect(currentScan()?.alignment?.tapeScale).toBeCloseTo(1.02, 3);
    expect(() => applyTapeMeasure("wall-b", width * 2)).toThrow(/too far/);
  });
});

describe("things you already own", () => {
  it("are kept from the start, stay out of sorting and printing, and hang at their own size", async () => {
    const { listContent, listThings, updateThing } = await import("./content/store");
    const { printPlacements, placementOf } = await import("./room/store");
    const { replaceShownImage } = await import("./content/media");
    const { id } = await ingestImage(await photo("#aa3311"), "poster.jpg", "upload", "thing");

    expect(listThings().map((t) => t.id)).toContain(id);
    expect(listContent().some((c) => c.id === id)).toBe(false);
    expect(inboxBatch(50).some((c) => c.id === id)).toBe(false);

    updateThing(id, { title: "Poster", widthMm: 500, heightMm: 700 });
    const placement = addPlacement({
      ...placementInput(id),
      printSizeId: "own",
      orientation: "portrait",
      widthMm: 500,
      heightMm: 700,
      state: "up",
    });
    expect(placementOf(id)?.id).toBe(placement);
    expect(placementOf(id)?.state).toBe("up");
    expect(printPlacements().some((p) => p.id === placement)).toBe(false);
    // Marking prints as ordered leaves it alone: it's already on the wall.
    markOrdered();
    expect(placementOf(id)?.state).toBe("up");

    // Cutting the picture down changes what's shown, and its shape.
    const cut = await sharp({ create: { width: 100, height: 140, channels: 3, background: "#aa3311" } }).jpeg().toBuffer();
    await replaceShownImage(id, cut);
    const thing = listThings().find((t) => t.id === id)!;
    expect([thing.widthPx, thing.heightPx, thing.imageRev]).toEqual([100, 140, 1]);
    expect(fs.existsSync(variantPath(id, "original"))).toBe(true);
  });
});
