import { redirect } from "next/navigation";
import { AlignScreen } from "@/components/scan/AlignScreen";
import { requireSession } from "@/lib/auth";
import { getRoom } from "@/lib/room/store";
import { currentScan } from "@/lib/scan/store";

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

export default async function AlignPage() {
  await requireSession();
  const scan = currentScan();
  if (!scan) redirect("/room/scan");

  return (
    <AlignScreen
      key={scan.id}
      scan={{ id: scan.id, fileType: scan.fileType, filename: scan.filename }}
      doc={getRoom().doc}
      savedTapeScale={scan.alignment?.tapeScale ?? 1}
    />
  );
}
