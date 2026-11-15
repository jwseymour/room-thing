import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { getDb } from "../db";
import { scans } from "../db/schema";
import type { Block, RoomDocument } from "../room/schema";
import { getRoom, saveRoom } from "../room/store";
import { readSplatPly } from "./cloud";
import { fitRoom } from "./fit";
import { applyPlanToRoom } from "./frame";
import { getScan, scanFilePath, wallImagePath } from "./store";
import { drawWall, surveyRoom, toRoomPoints, type SurveyBlock } from "./survey";

const toBlock = (b: SurveyBlock, i: number): Block => ({
  id: `block-${i + 1}`,
  label: b.label,
  kind: b.kind,
  x: Math.round(b.x * 1000),
  y: Math.round(b.z * 1000),
  w: Math.round(b.w * 1000),
  d: Math.round(b.d * 1000),
  bottom: Math.round(b.bottom * 1000),
  top: Math.round(b.top * 1000),
  color: b.color,
  open: b.open,
  source: "scan",
});

/**
 * Reads a scan and builds the room from it: where the walls are, how big
 * they are, what furniture stands where, and a flat picture of each wall.
 * Returns false for a file it can't read, which the viewer can still line up
 * by hand.
 */
export async function surveyScan(scanId: string): Promise<boolean> {
  const scan = getScan(scanId);
  if (!scan || scan.fileType !== "ply") return false;
  const cloud = readSplatPly(new Uint8Array(fs.readFileSync(scanFilePath(scan))));
  if (!cloud || cloud.count < 5000) return false;

  const fit = fitRoom(cloud.positions);
  if (fit.widthM < 1 || fit.depthM < 1 || fit.heightM < 1.5) return false;
  const points = toRoomPoints(cloud, fit.matrix, fit.plan, fit.heightM);
  const survey = surveyRoom(points, fit.plan, fit.heightM);

  const before = getRoom().doc;
  const corners = fit.plan.map(([x, z]) => [x * 1000, z * 1000] as [number, number]);
  const doc: RoomDocument = {
    ...applyPlanToRoom(before, corners, fit.heightM * 1000),
    // A new scan is the room as it stands now, so its furniture replaces the old.
    blocks: survey.blocks.map(toBlock),
  };
  const saved = saveRoom(doc);

  const walls = saved.doc.surfaces.filter((s) => s.kind === "wall" && s.pose);
  for (let i = 0; i < Math.min(walls.length, fit.plan.length); i++) {
    // Only what's on the wall or set into it, not the furniture in front.
    const image = drawWall(points, fit.plan, fit.heightM, i, 0.07);
    const file = wallImagePath(scanId, walls[i].id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await sharp(Buffer.from(image.rgba), {
      raw: { width: image.width, height: image.height, channels: 4 },
    })
      .webp({ quality: 80 })
      .toFile(file);
  }

  getDb()
    .update(scans)
    .set({
      alignment: { matrix: fit.matrix, up: fit.up, tapeScale: 1, ceilingSeen: fit.ceilingSeen },
    })
    .where(eq(scans.id, scanId))
    .run();
  return true;
}
