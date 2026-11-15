"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { NumberField, TextField } from "@/components/room/Fields";
import { deleteThingAction, updateThingAction } from "@/lib/actions/things";
import { sizesForAspect, THING_SIZES } from "@/lib/room/print";
import { Cropper } from "./Cropper";

export type Thing = {
  id: string;
  title: string | null;
  widthPx: number | null;
  heightPx: number | null;
  widthMm: number | null;
  heightMm: number | null;
  imageRev: number;
  fromScan: boolean;
};

export function ThingEditor({
  thing,
  where,
  walls,
}: {
  thing: Thing;
  where: { surfaceId: string; wall: string; up: boolean } | null;
  walls: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [cropping, setCropping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const save = (task: () => Promise<unknown>) => {
    setError(null);
    startTransition(async () => {
      try {
        await task();
      } catch {
        setError("That didn't save. Is the laptop still on?");
      }
    });
  };

  const aspect = thing.widthPx && thing.heightPx ? thing.widthPx / thing.heightPx : 1;
  const matching = sizesForAspect(aspect);
  const portrait = aspect < 1;
  // When the shape matches no standard paper, offer them all the right way up.
  const offered = matching.length
    ? matching
    : THING_SIZES.map((s) => ({
        label: s.label,
        w: portrait ? s.shortMm : s.longMm,
        h: portrait ? s.longMm : s.shortMm,
      }));
  const sized = Boolean(thing.widthMm && thing.heightMm);

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
      <div>
        {cropping ? (
          <Cropper
            src={`/api/media/${thing.id}/original`}
            onCancel={() => setCropping(false)}
            onDone={async (blob) => {
              const response = await fetch(`/api/things/${thing.id}/image`, { method: "PUT", body: blob });
              if (!response.ok) throw new Error("save failed");
              setCropping(false);
              router.refresh();
            }}
          />
        ) : (
          <>
            <div className="sky flex justify-center border border-ink p-6">
              <img
                src={`/api/media/${thing.id}/card?v=${thing.imageRev}`}
                alt={thing.title ?? "The thing"}
                className="max-h-[55dvh] max-w-full border border-ink shadow-[6px_6px_0_var(--line)]"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className="btn" onClick={() => setCropping(true)}>
                Straighten and crop
              </button>
              <label className="btn btn-quiet">
                {thing.fromScan ? "Add a proper photo" : "Retake"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    save(async () => {
                      const form = new FormData();
                      form.set("file", file);
                      form.set("replace", thing.id);
                      const response = await fetch("/api/upload/thing", { method: "POST", body: form });
                      if (!response.ok) throw new Error("upload failed");
                      router.refresh();
                    });
                  }}
                />
              </label>
              <p className="text-sm text-muted">
                {thing.fromScan
                  ? "This picture was cut from the room scan, so it's rough. A proper photo keeps its place on the wall."
                  : "Mark its four corners and the photo is cut down to just the thing."}
              </p>
            </div>
          </>
        )}
      </div>

      <div className="space-y-6">
        {error && (
          <p role="alert" className="border border-danger p-2 text-sm text-danger">
            {error}
          </p>
        )}

        <TextField
          label="What is it?"
          value={thing.title ?? ""}
          onCommit={(title) => save(() => updateThingAction(thing.id, { title }))}
        />

        <section>
          <p className="eyebrow mb-2">How big is it?</p>
          {!sized && (
            <p className="mb-2 text-sm text-caution">
              It needs a real size before it can go on a wall.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {offered.map((size) => {
              const on = thing.widthMm === size.w && thing.heightMm === size.h;
              return (
                <button
                  key={size.label}
                  type="button"
                  aria-pressed={on}
                  className={`btn ${on ? "btn-primary" : "btn-quiet"}`}
                  onClick={() => save(() => updateThingAction(thing.id, { widthMm: size.w, heightMm: size.h }))}
                >
                  {size.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted">
            {matching.length
              ? "These are the standard sizes that match its shape. Or measure it:"
              : "Its shape isn't a standard paper size, so measure it if you can:"}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <NumberField
              label="Width, cm"
              value={(thing.widthMm ?? 0) / 10}
              min={1}
              onCommit={(v) =>
                save(() =>
                  updateThingAction(thing.id, {
                    widthMm: Math.round(v * 10),
                    // Keep its shape when only one side has been measured.
                    heightMm: thing.heightMm ?? Math.round((v * 10) / aspect),
                  }),
                )
              }
            />
            <NumberField
              label="Height, cm"
              value={(thing.heightMm ?? 0) / 10}
              min={1}
              onCommit={(v) =>
                save(() =>
                  updateThingAction(thing.id, {
                    heightMm: Math.round(v * 10),
                    widthMm: thing.widthMm ?? Math.round(v * 10 * aspect),
                  }),
                )
              }
            />
          </div>
        </section>

        <section>
          <p className="eyebrow mb-2">Where is it?</p>
          {where ? (
            <>
              <p className="text-sm">
                {where.up ? "Up on" : "Planned for"} {where.wall}.
              </p>
              <Link href={`/room?wall=${where.surfaceId}`} className="btn mt-2">
                Show it in the room
              </Link>
            </>
          ) : sized ? (
            <>
              <p className="mb-2 text-sm text-muted">
                Not on a wall yet. Pick a wall to try it on, whether it&apos;s
                already hanging there or you&apos;re still deciding.
              </p>
              <div className="flex flex-wrap gap-2">
                {walls.map((wall) => (
                  <Link key={wall.id} href={`/room?wall=${wall.id}&place=${thing.id}`} className="btn btn-quiet">
                    {wall.name}
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Give it a size first, then choose a wall.</p>
          )}
        </section>

        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            if (!window.confirm("Remove this thing and its photo?")) return;
            save(async () => {
              await deleteThingAction(thing.id);
              router.push("/things");
            });
          }}
        >
          Remove this thing
        </button>
      </div>
    </div>
  );
}
