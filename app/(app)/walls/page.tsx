import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { surfaceBounds } from "@/lib/room/geometry";
import { printDimensions } from "@/lib/room/print";
import { MOUNT_LABELS } from "@/lib/room/schema";
import { activePlacements, getRoom } from "@/lib/room/store";

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

export default async function WallsPage() {
  await requireSession();

  const { doc } = getRoom();
  const placements = activePlacements();

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-3xl">Walls</h1>
        <Link href="/room" className="btn">
          3D room
        </Link>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {doc.surfaces.map((surface) => {
          const { w, h } = surfaceBounds(surface);
          const items = placements.filter((p) => p.surfaceId === surface.id);
          const fixtures = doc.fixtures.filter(
            (f) => f.surfaceId === surface.id,
          );
          return (
            <li key={surface.id}>
              <Link
                href={`/walls/${surface.id}`}
                className="block rounded-lg border border-line bg-card p-3"
              >
                <svg
                  viewBox={`0 0 ${w} ${h}`}
                  aria-hidden
                  className="mx-auto mb-2 block h-36 w-full"
                >
                  <rect width={w} height={h} fill="var(--paper)" />
                  {fixtures.map((f) => (
                    <rect
                      key={f.id}
                      x={f.rect.u}
                      y={h - f.rect.v - f.rect.h}
                      width={f.rect.w}
                      height={f.rect.h}
                      fill="var(--line)"
                    />
                  ))}
                  {items.map((item) => {
                    const size = printDimensions(
                      item.printSizeId,
                      item.orientation,
                    );
                    return (
                      <rect
                        key={item.id}
                        x={item.u}
                        y={h - item.v - size.h}
                        width={size.w}
                        height={size.h}
                        fill="var(--accent)"
                      />
                    );
                  })}
                </svg>
                <span className="block font-medium">{surface.name}</span>
                <span className="block text-sm text-muted">
                  {items.length} {items.length === 1 ? "item" : "items"} ·{" "}
                  {surface.allowedMounts.map((m) => MOUNT_LABELS[m]).join(", ")}
                </span>
                {surface.source === "estimate" && (
                  <span className="chip mt-1">Estimated size</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
