import fs from "node:fs";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RoomScreen, type RoomItem } from "@/components/room/RoomScreen";
import { requireSession } from "@/lib/auth";
import { listContent, listThings, type ContentItem } from "@/lib/content/store";
import { activePlacements, getRoom } from "@/lib/room/store";
import { surveyScan } from "@/lib/scan/ingest";
import { currentScan, wallImagePath } from "@/lib/scan/store";

// Waits for live data instead of showing a placeholder. See lib/auth.ts.
export const instant = false;

const toItem = (c: ContentItem): RoomItem => ({
  id: c.id,
  kind: c.kind,
  title: c.title,
  body: c.body,
  attribution: c.attribution,
  widthPx: c.widthPx,
  heightPx: c.heightPx,
  widthMm: c.widthMm,
  heightMm: c.heightMm,
  imageRev: c.imageRev,
});

export default async function RoomPage({ searchParams }: PageProps<"/room">) {
  await requireSession();
  const query = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

  let scan = currentScan();
  if (!scan) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-2xl">Your room, as geometry</h1>
        <p className="mx-auto mt-3 max-w-md text-muted">
          Scan the room with your phone. The app measures the walls, finds the
          furniture, and works out how much clear wall you have to play with.
        </p>
        <Link href="/room/scan" className="btn btn-primary mt-6">
          Scan your room
        </Link>
      </div>
    );
  }
  if (!scan.alignment) {
    // A scan that hasn't been read yet: build the room from it now. Files
    // this can't read are lined up by hand instead.
    if (!(await surveyScan(scan.id))) redirect("/room/align");
    scan = currentScan()!;
  }

  const { doc } = getRoom();
  const placements = activePlacements().map((p) => ({
    id: p.id,
    surfaceId: p.surfaceId,
    printSizeId: p.printSizeId,
    orientation: p.orientation,
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    u: p.u,
    v: p.v,
    mount: p.mount,
    up: p.state === "up",
    content: toItem(p.content),
  }));
  const wallImages = doc.surfaces
    .filter((s) => fs.existsSync(wallImagePath(scan.id, s.id)))
    .map((s) => s.id);
  const wall = one(query.wall);

  return (
    <RoomScreen
      key={`${scan.id}-${scan.alignment!.matrix.join()}`}
      scan={{
        id: scan.id,
        fileType: scan.fileType,
        matrix: scan.alignment!.matrix,
        ceilingSeen: scan.alignment!.ceilingSeen ?? true,
        tapeChecked: scan.tapeCheckedAt !== null,
      }}
      doc={doc}
      initialPlacements={placements}
      tray={[...listThings(), ...listContent("keep")].map(toItem)}
      wallImages={wallImages}
      start={{
        wall: wall && doc.surfaces.some((s) => s.id === wall) ? wall : null,
        place: one(query.place),
      }}
    />
  );
}
