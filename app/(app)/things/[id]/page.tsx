import Link from "next/link";
import { notFound } from "next/navigation";
import { ThingEditor } from "@/components/things/ThingEditor";
import { requireSession } from "@/lib/auth";
import { getContent } from "@/lib/content/store";
import { getRoom, placementOf } from "@/lib/room/store";

// Waits for live data instead of showing a placeholder. See lib/auth.ts.
export const instant = false;

export default async function ThingPage({ params }: PageProps<"/things/[id]">) {
  await requireSession();
  const { id } = await params;
  const thing = getContent(id);
  if (!thing || thing.kind !== "thing") notFound();

  const { doc } = getRoom();
  const placement = placementOf(thing.id);
  const walls = doc.surfaces.filter((s) => s.kind === "wall" && s.pose);

  return (
    <>
      <Link href="/things" className="eyebrow">
        ← Things
      </Link>
      <h1 className="mt-1 mb-4 text-2xl">{thing.title ?? "A new thing"}</h1>
      <ThingEditor
        key={`${thing.id}-${thing.imageRev}`}
        thing={{
          id: thing.id,
          title: thing.title,
          widthPx: thing.widthPx,
          heightPx: thing.heightPx,
          widthMm: thing.widthMm,
          heightMm: thing.heightMm,
          imageRev: thing.imageRev,
          fromScan: thing.source === "scan",
        }}
        where={
          placement
            ? {
                surfaceId: placement.surfaceId,
                wall: doc.surfaces.find((s) => s.id === placement.surfaceId)?.name ?? "a wall",
                up: placement.state === "up",
              }
            : null
        }
        walls={walls.map((w) => ({ id: w.id, name: w.name }))}
      />
    </>
  );
}
