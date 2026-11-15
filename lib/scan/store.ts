import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { DATA_DIR } from "../config";
import { getDb } from "../db";
import { scans, wallPlacements, type ScanAlignment } from "../db/schema";
import { activePlacements, getRoom, saveRoom } from "../room/store";
import { applyBoxToRoom, type RoomBox } from "./frame";

export type Scan = typeof scans.$inferSelect;

/** File types the viewer can read. */
export const SCAN_TYPES = ["spz", "ply", "splat", "ksplat", "sog", "rad"] as const;

export function scanTypeOf(filename: string): string | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return (SCAN_TYPES as readonly string[]).includes(ext) ? ext : null;
}

function scanDir(id: string): string {
  return path.join(DATA_DIR, "scans", id);
}

export function scanFilePath(scan: Pick<Scan, "id" | "fileType">): string {
  return path.join(scanDir(scan.id), `scan.${scan.fileType}`);
}

export function wallImagePath(scanId: string, surfaceId: string): string {
  // Surface ids come from the room document, so keep them to safe characters.
  const safe = surfaceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(scanDir(scanId), "walls", `${safe}.webp`);
}

/** Reserves an id and a folder. The caller writes the file, then calls `recordScan`. */
export function newScanTarget(fileType: string): { id: string; file: string } {
  const id = randomUUID();
  fs.mkdirSync(scanDir(id), { recursive: true });
  return { id, file: scanFilePath({ id, fileType }) };
}

export function recordScan(input: {
  id: string;
  filename: string;
  fileType: string;
  bytes: number;
  sample?: boolean;
}): Scan {
  const room = getRoom();
  getDb()
    .insert(scans)
    .values({ ...input, roomId: room.id, sample: input.sample ?? false })
    .run();
  return getScan(input.id)!;
}

export function discardScanTarget(id: string): void {
  fs.rmSync(scanDir(id), { recursive: true, force: true });
}

export function getScan(id: string): Scan | undefined {
  return getDb().select().from(scans).where(eq(scans.id, id)).get();
}

/** The scan in use: the newest one for the room. */
export function currentScan(): Scan | undefined {
  const room = getRoom();
  return getDb()
    .select()
    .from(scans)
    .where(eq(scans.roomId, room.id))
    .orderBy(desc(scans.createdAt))
    .limit(1)
    .get();
}

/**
 * Stores where the room is in the scan, and rebuilds the room's walls to
 * match. `tapeChecked` records that a tape measure confirmed the scale.
 */
export function saveAlignment(
  scanId: string,
  alignment: ScanAlignment,
  box: RoomBox,
  tapeChecked: boolean,
): void {
  const scan = getScan(scanId);
  if (!scan) throw new Error(`Unknown scan: ${scanId}`);
  saveRoom(applyBoxToRoom(getRoom().doc, box));
  getDb()
    .update(scans)
    .set({
      alignment,
      tapeCheckedAt: tapeChecked ? new Date() : scan.tapeCheckedAt,
    })
    .where(eq(scans.id, scanId))
    .run();
}

/**
 * Corrects the whole room's scale from one wall measured with a tape. A scan
 * gets shapes right but can be a percent or two out in size, and that error
 * is the same everywhere, so one honest measurement fixes all of it.
 */
export function applyTapeMeasure(surfaceId: string, realWidthMm: number): number {
  const { doc } = getRoom();
  const surface = doc.surfaces.find((s) => s.id === surfaceId);
  const scan = currentScan();
  if (!surface || !surface.pose) throw new Error(`Unknown wall: ${surfaceId}`);
  const scanned = Math.max(...surface.polygon.map((p) => p.u));
  const k = realWidthMm / scanned;
  if (!(k > 0.8 && k < 1.25)) {
    throw new Error("That's too far from the scan to be a correction.");
  }
  const scaled = new Set(doc.surfaces.filter((s) => s.pose).map((s) => s.id));
  const r = (value: number) => Math.round(value * k);
  saveRoom({
    ...doc,
    ceilingMm: r(doc.ceilingMm),
    surfaces: doc.surfaces.map((s) =>
      s.pose
        ? {
            ...s,
            polygon: s.polygon.map((p) => ({ u: r(p.u), v: r(p.v) })),
            pose: { ...s.pose, x: r(s.pose.x), y: r(s.pose.y) },
            source: "tape" as const,
          }
        : s,
    ),
    fixtures: doc.fixtures.map((f) =>
      scaled.has(f.surfaceId)
        ? { ...f, rect: { u: r(f.rect.u), v: r(f.rect.v), w: r(f.rect.w), h: r(f.rect.h) } }
        : f,
    ),
    blocks: doc.blocks.map((b) => ({
      ...b, x: r(b.x), y: r(b.y), w: r(b.w), d: r(b.d), bottom: r(b.bottom), top: r(b.top),
    })),
  });
  const db = getDb();
  // Things keep their own size; only where they sit on the wall moves.
  for (const p of activePlacements()) {
    if (!scaled.has(p.surfaceId)) continue;
    db.update(wallPlacements).set({ u: r(p.u), v: r(p.v) }).where(eq(wallPlacements.id, p.id)).run();
  }
  if (scan?.alignment) {
    const matrix = scan.alignment.matrix.map((value, i) => (i % 4 === 3 ? value : value * k));
    db.update(scans)
      .set({
        alignment: { ...scan.alignment, matrix, tapeScale: scan.alignment.tapeScale * k },
        tapeCheckedAt: new Date(),
      })
      .where(eq(scans.id, scan.id))
      .run();
  }
  return k;
}

export function deleteScan(id: string): void {
  getDb().delete(scans).where(eq(scans.id, id)).run();
  discardScanTarget(id);
}
