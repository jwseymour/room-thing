import { zipSync } from "fflate";
import { hasSession } from "@/lib/auth";
import { printFileName, renderPrintFile } from "@/lib/room/print-files";
import { activePlacements } from "@/lib/room/store";

/** Every planned item as print-ready files in a zip, in a folder per size. */
export async function GET() {
  if (!(await hasSession())) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const items = activePlacements();
  const files: Record<string, Uint8Array> = {};
  for (const [index, item] of items.entries()) {
    files[printFileName(item, index)] = await renderPrintFile(item);
  }

  // JPEGs don't compress further, so store them as they are.
  const zip = zipSync(files, { level: 0 });
  return new Response(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="room-prints.zip"',
    },
  });
}
