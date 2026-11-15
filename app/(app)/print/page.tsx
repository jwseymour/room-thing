import Link from "next/link";
import { MarkOrderedButton } from "@/components/MarkOrderedButton";
import { requireSession } from "@/lib/auth";
import {
  PRINT_SIZES,
  printDimensions,
  printQuality,
} from "@/lib/room/print";
import { MOUNT_LABELS } from "@/lib/room/schema";
import { activePlacements, getRoom } from "@/lib/room/store";
import { validatePlacement, type PlacedRect } from "@/lib/room/validate";

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

export default async function PrintPage() {
  await requireSession();

  const { doc } = getRoom();
  const placements = activePlacements();

  const placed = new Map<string, PlacedRect[]>();
  for (const p of placements) {
    const rect = { u: p.u, v: p.v, ...printDimensions(p.printSizeId, p.orientation) };
    placed.set(p.surfaceId, [
      ...(placed.get(p.surfaceId) ?? []),
      { id: p.id, mount: p.mount, rect },
    ]);
  }

  const rows = placements.map((placement) => {
    const surface = doc.surfaces.find((s) => s.id === placement.surfaceId);
    const onSurface = placed.get(placement.surfaceId) ?? [];
    const self = onSurface.find((p) => p.id === placement.id);
    const issues =
      surface && self
        ? validatePlacement(self, surface, doc.fixtures, onSurface)
        : [];
    const { widthPx, heightPx } = placement.content;
    const quality =
      widthPx && heightPx
        ? printQuality(
            widthPx,
            heightPx,
            printDimensions(placement.printSizeId, placement.orientation),
          )
        : null;
    return { placement, surface, issues, quality };
  });

  const summary = PRINT_SIZES.map((size) => ({
    size,
    count: placements.filter((p) => p.printSizeId === size.id).length,
  })).filter((row) => row.count > 0);

  const ruleBreaks = rows.filter((row) =>
    row.issues.some((issue) => issue.severity === "error"),
  ).length;
  const toOrder = placements.filter((p) => p.state === "planned").length;

  if (placements.length === 0) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-3xl">Nothing to print yet</h1>
        <p className="mt-2 text-muted">
          Put something on a wall and it&apos;ll show up here.
        </p>
        <Link href="/walls" className="btn btn-primary mt-6">
          Go to walls
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-3xl">Print list</h1>
      <p className="mt-1 mb-4 text-muted">
        {summary.map(({ size, count }) => `${count} × ${size.label}`).join(" · ")}
      </p>

      {ruleBreaks > 0 && (
        <p role="alert" className="mb-3 rounded-lg border border-danger p-3 text-sm text-danger">
          {ruleBreaks} {ruleBreaks === 1 ? "item breaks" : "items break"} a
          rule of the room. Fix {ruleBreaks === 1 ? "it" : "them"} on the wall
          before printing.
        </p>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        {toOrder > 0 ? (
          <a href="/api/print" download className="btn btn-primary">
            Download {toOrder} print {toOrder === 1 ? "file" : "files"}
          </a>
        ) : (
          <Link href="/hang" className="btn btn-primary">
            Hanging guide
          </Link>
        )}
        <MarkOrderedButton count={toOrder} />
        {toOrder < placements.length && (
          <a href="/api/print?all=1" download className="btn">
            Download all {placements.length} again
          </a>
        )}
      </div>
      {toOrder > 0 && toOrder < placements.length && (
        <p className="-mt-4 mb-6 text-sm text-muted">
          The download holds only the {toOrder} you haven&apos;t ordered yet.
        </p>
      )}

      <ul className="divide-y divide-line rounded-lg border border-line bg-card">
        {rows.map(({ placement, surface, issues, quality }) => (
          <li key={placement.id} className="flex gap-3 p-3">
            <div className="size-16 shrink-0 overflow-hidden rounded bg-paper">
              {placement.content.kind === "photo" ? (
                <img
                  src={`/api/media/${placement.content.id}/thumb`}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <span className="flex size-full items-center justify-center overflow-hidden p-1 text-center font-serif text-[0.6rem] leading-tight">
                  {placement.content.body}
                </span>
              )}
            </div>
            <div className="min-w-0 text-sm">
              <p className="font-medium">
                {PRINT_SIZES.find((s) => s.id === placement.printSizeId)?.label},{" "}
                {placement.orientation}
              </p>
              <p className="text-muted">
                {surface?.name ?? "Unknown surface"} ·{" "}
                {MOUNT_LABELS[placement.mount]}
                {placement.state !== "planned" && ` · ${placement.state}`}
              </p>
              {quality && (
                <p
                  className={
                    quality.rating === "good"
                      ? "text-muted"
                      : quality.rating === "soft"
                        ? "text-caution"
                        : "text-danger"
                  }
                >
                  {quality.ppi} ppi
                  {quality.rating === "soft" && ", a little soft at this size"}
                  {quality.rating === "too_small" && ", too small to print well"}
                  {quality.cropped > 0.1 &&
                    `, ${Math.round(quality.cropped * 100)}% cropped`}
                </p>
              )}
              {issues.map((issue, index) => (
                <p
                  key={index}
                  className={
                    issue.severity === "error" ? "text-danger" : "text-caution"
                  }
                >
                  {issue.message}
                </p>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
