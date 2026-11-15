import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { DATA_DIR } from "../config";
import { getDb } from "../db";
import { scans, type ScanAlignment } from "../db/schema";
import { getRoom, saveRoom } from "../room/store";
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

export function deleteScan(id: string): void {
  getDb().delete(scans).where(eq(scans.id, id)).run();
  discardScanTarget(id);
}
