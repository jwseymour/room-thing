import fs from "node:fs";
import { hasSession } from "@/lib/auth";
import { sampleRoomSplats, writeSplatPly } from "@/lib/scan/sample-room";
import { surveyScan } from "@/lib/scan/ingest";
import { newScanTarget, recordScan } from "@/lib/scan/store";

/** Adds the made-up sample room as a scan, for trying the app before scanning. */
export async function POST() {
  if (!(await hasSession())) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const target = newScanTarget("ply");
  const ply = writeSplatPly(sampleRoomSplats());
  fs.writeFileSync(target.file, ply);
  const scan = recordScan({
    id: target.id,
    filename: "Sample room.ply",
    fileType: "ply",
    bytes: ply.length,
    sample: true,
  });
  return Response.json({ id: scan.id, surveyed: await surveyScan(scan.id) });
}
