import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { hasSession } from "@/lib/auth";
import {
  discardScanTarget,
  newScanTarget,
  recordScan,
  scanTypeOf,
} from "@/lib/scan/store";

/**
 * Takes a scan file as the raw request body, with its name in `x-filename`.
 * Scans run from tens to hundreds of megabytes, so the body is streamed
 * straight to disk rather than held in memory.
 */
export async function PUT(request: Request) {
  if (!(await hasSession())) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const filename = decodeURIComponent(request.headers.get("x-filename") ?? "");
  const fileType = scanTypeOf(filename);
  if (!fileType) {
    return Response.json(
      { error: "That isn't a scan file. Export a .spz or .ply from the scanning app." },
      { status: 415 },
    );
  }
  if (!request.body) {
    return Response.json({ error: "No file sent" }, { status: 400 });
  }

  const target = newScanTarget(fileType);
  try {
    await pipeline(
      Readable.fromWeb(request.body as unknown as NodeWebStream),
      fs.createWriteStream(target.file),
    );
    const bytes = fs.statSync(target.file).size;
    if (bytes < 1024) throw new Error("empty");
    const scan = recordScan({ id: target.id, filename, fileType, bytes });
    return Response.json({ id: scan.id });
  } catch {
    discardScanTarget(target.id);
    return Response.json({ error: "The upload didn't finish. Try again." }, { status: 400 });
  }
}
