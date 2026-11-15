import { zipSync } from "fflate";
import { hasSession } from "@/lib/auth";
import { printFileNames, renderPrintFile } from "@/lib/room/print-files";
import { activePlacements } from "@/lib/room/store";

/**
 * Print-ready files in a zip, in a folder per size. By default that's only the
 * items not yet ordered, so a second order doesn't reprint the first. Add
 * `?all=1` for everything on the walls.
 */
export async function GET(request: Request) {
  if (!(await hasSession())) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const all = new URL(request.url).searchParams.has("all");
  const items = activePlacements().filter((p) => all || p.state === "planned");
  if (items.length === 0) {
    return Response.json({ error: "Nothing to print" }, { status: 404 });
  }

  const names = printFileNames(items);
  const files: Record<string, Uint8Array> = {};
  for (const [index, item] of items.entries()) {
    files[names[index]] = await renderPrintFile(item);
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
