import Link from "next/link";
import { redirect } from "next/navigation";
import { RoomScreen, type RoomItem } from "@/components/scan/RoomScreen";
import { requireSession } from "@/lib/auth";
import { listContent } from "@/lib/content/store";
import { activePlacements, getRoom } from "@/lib/room/store";
import { currentScan } from "@/lib/scan/store";

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

const toItem = ({ id, kind, body, attribution, widthPx, heightPx }: RoomItem): RoomItem => ({
  id, kind, body, attribution, widthPx, heightPx,
});

export default async function RoomPage() {
  await requireSession();

  const scan = currentScan();
  if (!scan) {
    return (
      <div className="py-12 text-center">
        <h1 className="text-3xl">Your room, in 3D</h1>
        <p className="mx-auto mt-2 max-w-md text-muted">
          Scan the room with your phone and plan everything inside it: walk
          around, see it from your bed or your desk, and put pictures on the
          walls at their real size.
        </p>
        <Link href="/room/scan" className="btn btn-primary mt-6">
          Scan your room
        </Link>
      </div>
    );
  }
  if (!scan.alignment) redirect("/room/align");

  const { doc } = getRoom();
  const placements = activePlacements().map(
    ({ id, surfaceId, printSizeId, orientation, u, v, mount, content }) => ({
      id, surfaceId, printSizeId, orientation, u, v, mount, content: toItem(content),
    }),
  );

  return (
    <>
      <h1 className="mb-2 text-3xl">{doc.name}</h1>
      <RoomScreen
        key={`${scan.id}-${scan.alignment.matrix.join()}`}
        scan={{
          id: scan.id,
          fileType: scan.fileType,
          sample: scan.sample,
          tapeChecked: scan.tapeCheckedAt !== null,
        }}
        matrix={scan.alignment.matrix}
        doc={doc}
        initialPlacements={placements}
        tray={listContent("keep").map(toItem)}
      />
    </>
  );
}
