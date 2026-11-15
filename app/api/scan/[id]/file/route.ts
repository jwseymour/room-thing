import fs from "node:fs";
import { Readable } from "node:stream";
import { hasSession } from "@/lib/auth";
import { getScan, scanFilePath } from "@/lib/scan/store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await hasSession())) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const scan = getScan((await params).id);
  if (!scan || !fs.existsSync(scanFilePath(scan))) {
    return new Response(null, { status: 404 });
  }
  const stream = Readable.toWeb(fs.createReadStream(scanFilePath(scan)));
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(scan.bytes),
      // A scan never changes under its id, so the phone only downloads it once.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
