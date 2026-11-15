import fs from "node:fs/promises";
import { hasSession } from "@/lib/auth";
import { VARIANTS, variantPath, type Variant } from "@/lib/content/media";
import { getContent } from "@/lib/content/store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; variant: string }> },
) {
  if (!(await hasSession())) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id, variant } = await params;
  const item = getContent(id);
  if (!item || !VARIANTS.includes(variant as Variant)) {
    return new Response(null, { status: 404 });
  }

  const bytes = await fs.readFile(variantPath(id, variant as Variant));
  return new Response(bytes, {
    headers: {
      "Content-Type":
        variant === "original" ? (item.mimeType ?? "image/jpeg") : "image/webp",
      // A photo never changes under its id, so the browser can keep it.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
