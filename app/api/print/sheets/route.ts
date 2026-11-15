import { hasSession } from "@/lib/auth";
import { getContent } from "@/lib/content/store";
import { renderSheets } from "@/lib/room/sheet-pdf";
import { isPaperSize } from "@/lib/room/sheets";

const MAX_ITEMS = 80;

/**
 * A PDF of A4 sheets to print on paper and cut out. Each `item` is
 * `<content id>:<size id>`. `mode=fill` crops pictures to fill their size;
 * otherwise each is shown whole.
 */
export async function GET(request: Request) {
  if (!(await hasSession())) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const mode = params.get("mode") === "fill" ? "fill" : "whole";
  const seen = new Set<string>();
  const chosen = [];
  for (const entry of params.getAll("item").slice(0, MAX_ITEMS)) {
    const [id, sizeId] = entry.split(":");
    if (!id || !sizeId || !isPaperSize(sizeId) || seen.has(id)) continue;
    const item = getContent(id);
    if (!item || item.kind === "thing") continue;
    seen.add(id);
    chosen.push({ item, sizeId });
  }
  if (chosen.length === 0) {
    return Response.json({ error: "Nothing to print" }, { status: 404 });
  }

  const { pdf } = await renderSheets(chosen, mode);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="room-sheets.pdf"',
    },
  });
}
