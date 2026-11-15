import { z } from "zod";
import { ingestImage, UnsupportedImageError } from "@/lib/content/media";
import { addText } from "@/lib/content/store";
import { safeEqual } from "@/lib/session-token";

const textCapture = z.object({
  kind: z.enum(["quote", "reminder"]).default("quote"),
  text: z.string().trim().min(1),
  attribution: z.string().trim().optional(),
});

/** For the iOS Shortcut: send JSON for text, or multipart with a `file` for an image. */
export async function POST(request: Request) {
  const expected = process.env.CAPTURE_TOKEN;
  const token = request.headers.get("x-capture-token");
  if (!expected || !token || !safeEqual(token, expected)) {
    return Response.json({ error: "Bad token" }, { status: 401 });
  }

  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "No file sent" }, { status: 400 });
    }
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      return Response.json(await ingestImage(bytes, file.name, "shortcut"));
    } catch (error) {
      if (error instanceof UnsupportedImageError) {
        return Response.json({ error: error.message }, { status: 415 });
      }
      throw error;
    }
  }

  const parsed = textCapture.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Send some text" }, { status: 400 });
  }
  const { kind, text, attribution } = parsed.data;
  const id = addText({
    kind,
    body: text,
    attribution: attribution || null,
    source: "shortcut",
  });
  return Response.json({ id });
}
