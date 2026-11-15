import { hasSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { ingestImage, replacePhoto, UnsupportedImageError } from "@/lib/content/media";
import { getContent } from "@/lib/content/store";

/**
 * Takes a photo of something you own: a poster, a print, a postcard. It sits
 * under /api/upload so that it stays out of the proxy, which cuts large
 * request bodies short.
 */
export async function POST(request: Request) {
  if (!(await hasSession())) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file sent" }, { status: 400 });
  }
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    // With `replace`, the photo is a better picture of a thing that's already here.
    const replace = form.get("replace");
    if (typeof replace === "string" && replace) {
      const item = getContent(replace);
      if (!item || item.kind !== "thing") return new Response(null, { status: 404 });
      await replacePhoto(item.id, bytes, file.name);
      revalidatePath("/", "layout");
      return Response.json({ id: item.id, duplicate: false });
    }
    return Response.json(await ingestImage(bytes, file.name, "upload", "thing"));
  } catch (error) {
    if (error instanceof UnsupportedImageError) {
      return Response.json({ error: error.message }, { status: 415 });
    }
    // The same photo is already another item's picture.
    if (error instanceof Error && /UNIQUE/.test(error.message)) {
      return Response.json({ error: "That photo is already in use." }, { status: 409 });
    }
    throw error;
  }
}
