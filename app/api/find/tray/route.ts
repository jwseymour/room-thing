import { hasSession } from "@/lib/auth";
import { listTray } from "@/lib/content/store";

export type TrayItem = { id: string; kind: string; label: string };

/** What's kept and not printed yet, for the bar along the bottom of Find. */
export async function GET() {
  if (!(await hasSession())) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const items: TrayItem[] = listTray().map((item) => ({
    id: item.id,
    kind: item.kind,
    label: item.title ?? item.body ?? item.filename ?? "Photo",
  }));
  return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
