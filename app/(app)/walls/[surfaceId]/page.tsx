import { notFound } from "next/navigation";
import { WallEditor, type TrayItem } from "@/components/WallEditor";
import { requireSession } from "@/lib/auth";
import { listContent } from "@/lib/content/store";
import { activePlacements, getRoom } from "@/lib/room/store";

const toTrayItem = ({
  id,
  kind,
  body,
  attribution,
  widthPx,
  heightPx,
}: TrayItem): TrayItem => ({ id, kind, body, attribution, widthPx, heightPx });

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

export default async function WallPage({
  params,
}: PageProps<"/walls/[surfaceId]">) {
  await requireSession();

  const { surfaceId } = await params;
  const { doc } = getRoom();
  const surface = doc.surfaces.find((s) => s.id === surfaceId);
  if (!surface) notFound();

  const placements = activePlacements(surface.id).map(
    ({ id, printSizeId, orientation, u, v, mount, content }) => ({
      id,
      printSizeId,
      orientation,
      u,
      v,
      mount,
      content: toTrayItem(content),
    }),
  );

  return (
    <WallEditor
      surface={surface}
      fixtures={doc.fixtures.filter((f) => f.surfaceId === surface.id)}
      initialPlacements={placements}
      tray={listContent("keep").map(toTrayItem)}
    />
  );
}
