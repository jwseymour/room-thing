import Link from "next/link";
import { ThingUploader } from "@/components/things/ThingUploader";
import { requireSession } from "@/lib/auth";
import { listThings } from "@/lib/content/store";
import { activePlacements, getRoom } from "@/lib/room/store";

// Waits for live data instead of showing a placeholder. See lib/auth.ts.
export const instant = false;

export default async function ThingsPage() {
  await requireSession();
  const things = listThings();
  const { doc } = getRoom();
  const placed = new Map(activePlacements().map((p) => [p.contentId, p]));
  const wallName = (id: string) => doc.surfaces.find((s) => s.id === id)?.name ?? "a wall";

  const groups = [
    {
      title: "Needs a size",
      hint: "Open each one to crop it and say how big it is.",
      items: things.filter((t) => !t.widthMm || !t.heightMm),
    },
    {
      title: "Not up yet",
      hint: "Ready to try on a wall.",
      items: things.filter((t) => t.widthMm && t.heightMm && !placed.has(t.id)),
    },
    {
      title: "On the walls",
      hint: null,
      items: things.filter((t) => t.widthMm && t.heightMm && placed.has(t.id)),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl">Things</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Posters, prints, postcards, anything flat you own. Photograph each
            one, whether it&apos;s already up or still in a drawer, and it
            becomes something you can place in the room at its real size.
          </p>
        </div>
        <ThingUploader />
      </div>

      {things.length === 0 && (
        <div className="sky mt-6 border border-ink p-8 text-center">
          <p className="mx-auto max-w-md text-sm">
            Take a photo of each thing, roughly square-on, one thing per photo.
            Lay loose ones on the floor or the bed. Good light matters more
            than a steady hand: you mark the corners afterwards.
          </p>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.title} className="mt-8">
          <div className="rule flex items-baseline justify-between pt-2">
            <h2 className="text-sm">{group.title}</h2>
            <p className="eyebrow">{group.items.length}</p>
          </div>
          {group.hint && <p className="mt-1 text-sm text-muted">{group.hint}</p>}
          <ul className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {group.items.map((thing) => {
              const at = placed.get(thing.id);
              return (
                <li key={thing.id}>
                  <Link href={`/things/${thing.id}`} className="block">
                    <span className="sky flex aspect-square items-center justify-center border border-line p-3">
                      <img
                        src={`/api/media/${thing.id}/thumb?v=${thing.imageRev}`}
                        alt=""
                        className="max-h-full max-w-full border border-ink"
                      />
                    </span>
                    <span className="mt-2 block truncate text-sm">{thing.title ?? "Untitled"}</span>
                    <span className="block text-xs text-muted">
                      {thing.widthMm && thing.heightMm
                        ? `${thing.widthMm / 10} × ${thing.heightMm / 10} cm`
                        : "No size yet"}
                      {at && ` · ${at.state === "up" ? "up on" : "planned for"} ${wallName(at.surfaceId)}`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
