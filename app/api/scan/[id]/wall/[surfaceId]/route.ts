import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { hasSession } from "@/lib/auth";
import { getScan, wallImagePath } from "@/lib/scan/store";

type Params = { params: Promise<{ id: string; surfaceId: string }> };

/** A flat, head-on picture of one wall, rendered from the scan. */
export async function GET(_request: Request, { params }: Params) {
  if (!(await hasSession())) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id, surfaceId } = await params;
  if (!getScan(id)) return new Response(null, { status: 404 });
  try {
    const bytes = await fs.readFile(wallImagePath(id, surfaceId));
    return new Response(bytes, {
      headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-cache" },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

/** The viewer renders each wall after the scan is lined up, and saves it here. */
export async function PUT(request: Request, { params }: Params) {
  if (!(await hasSession())) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id, surfaceId } = await params;
  if (!getScan(id)) return new Response(null, { status: 404 });
  try {
    const input = Buffer.from(await request.arrayBuffer());
    const webp = await sharp(input)
      .resize({ width: 2000, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const file = wallImagePath(id, surfaceId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, webp);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Not an image" }, { status: 415 });
  }
}
