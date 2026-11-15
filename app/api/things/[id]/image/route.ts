import { revalidatePath } from "next/cache";
import { hasSession } from "@/lib/auth";
import { replaceShownImage, UnsupportedImageError } from "@/lib/content/media";
import { getContent } from "@/lib/content/store";

/** Saves the straightened, cropped picture of a thing, cut in the browser. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;
  const item = getContent(id);
  if (!item || item.kind !== "thing") return new Response(null, { status: 404 });
  try {
    await replaceShownImage(id, Buffer.from(await request.arrayBuffer()));
  } catch (error) {
    if (error instanceof UnsupportedImageError) {
      return Response.json({ error: error.message }, { status: 415 });
    }
    throw error;
  }
  revalidatePath("/", "layout");
  return Response.json({ ok: true });
}
