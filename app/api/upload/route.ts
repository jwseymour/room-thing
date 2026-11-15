import { hasSession } from "@/lib/auth";
import { ingestImage, UnsupportedImageError } from "@/lib/content/media";

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
    return Response.json(await ingestImage(bytes, file.name, "upload"));
  } catch (error) {
    if (error instanceof UnsupportedImageError) {
      return Response.json({ error: error.message }, { status: 415 });
    }
    throw error;
  }
}
