import { RoomEditor } from "@/components/RoomEditor";
import { requireSession } from "@/lib/auth";
import { getRoom } from "@/lib/room/store";

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

export default async function RoomPage() {
  await requireSession();

  const { doc, version } = getRoom();
  return <RoomEditor initial={doc} version={version} />;
}
