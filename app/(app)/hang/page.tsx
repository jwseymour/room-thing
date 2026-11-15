import Link from "next/link";
import { MarkWallUpButton, UpToggle } from "@/components/HangControls";
import { requireSession } from "@/lib/auth";
import { surfaceBounds } from "@/lib/room/geometry";
import { hangingSteps, supplies } from "@/lib/room/hanging";
import { PRINT_SIZES } from "@/lib/room/print";
import { obstacleFixtures } from "@/lib/room/space";
import { MOUNT_LABELS } from "@/lib/room/schema";
import { activePlacements, getRoom } from "@/lib/room/store";
import { currentScan } from "@/lib/scan/store";

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

const mm = (value: number) => `${Math.round(value).toLocaleString("en-GB")} mm`;

export default async function HangPage() {
  await requireSession();

  const { doc } = getRoom();
  const placements = activePlacements();
  const tapeChecked = Boolean(currentScan()?.tapeCheckedAt);

  if (placements.length === 0) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-3xl">Nothing to hang yet</h1>
        <p className="mt-2 text-muted">
          Put something on a wall and its position will show up here.
        </p>
        <Link href="/room" className="btn btn-primary mt-6">
          Go to the room
        </Link>
      </div>
    );
  }

  const walls = doc.surfaces
    .map((surface) => ({
      surface,
      steps: hangingSteps(placements.filter((p) => p.surfaceId === surface.id)),
    }))
    .filter((wall) => wall.steps.length > 0);
  const needed = supplies(placements.filter((p) => p.state !== "up"));
  const up = placements.filter((p) => p.state === "up").length;

  return (
    <>
      <h1 className="text-3xl">Hanging guide</h1>
      <p className="mt-1 mb-4 text-muted">
        {up} of {placements.length} up. Work left to right: mark the top edge
        in pencil, check it with a level, then fix it in place.
      </p>

      {needed.length > 0 && (
        <section className="mb-6 rounded-lg border border-line bg-card p-3">
          <h2 className="mb-1 text-lg">Have ready</h2>
          <ul className="space-y-1 text-sm">
            {needed.map((supply) => (
              <li key={supply.label}>
                <span className="font-medium">
                  {supply.quantity} × {supply.label.toLowerCase()}
                </span>
                {supply.note && (
                  <span className="text-muted"> · {supply.note}</span>
                )}
              </li>
            ))}
            <li className="text-muted">
              A tape measure, a pencil and a spirit level (the iPhone&apos;s
              Measure app has one).
            </li>
          </ul>
        </section>
      )}

      <div className="space-y-6">
        {walls.map(({ surface, steps }) => {
          const { w: W, h: H } = surfaceBounds(surface);
          const waiting = steps.filter((s) => s.item.state !== "up").length;
          const label = Math.max(W, H) / 28;
          return (
            <section key={surface.id} aria-label={surface.name}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl">{surface.name}</h2>
                <MarkWallUpButton surfaceId={surface.id} count={waiting} />
              </div>

              {surface.source === "estimate" && (
                <p
                  role="alert"
                  className="mb-2 rounded-lg border border-caution p-3 text-sm text-caution"
                >
                  This surface&apos;s size is still an estimate, so these
                  positions may not fit.{" "}
                  <Link href="/room/scan" className="underline">
                    Scan the room first
                  </Link>
                  .
                </p>
              )}

              {surface.source === "scan" && !tapeChecked && (
                <p className="mb-2 rounded-lg border border-line p-3 text-sm text-muted">
                  These positions come from the scan, which is usually right
                  to within two or three centimetres.{" "}
                  <Link href={`/room?wall=${surface.id}`} className="underline">
                    Measure this wall with a tape
                  </Link>{" "}
                  (face it, then Edit)
                  to tighten that up.
                </p>
              )}

              <svg
                viewBox={`0 0 ${W} ${H}`}
                role="img"
                aria-label={`${surface.name} with each item numbered`}
                className="mb-2 block max-h-[45dvh] w-full rounded-lg border border-line bg-card"
              >
                {obstacleFixtures(doc, surface).map((f) => (
                    <rect
                      key={f.id}
                      x={f.rect.u}
                      y={H - f.rect.v - f.rect.h}
                      width={f.rect.w}
                      height={f.rect.h}
                      fill="var(--line)"
                    />
                  ))}
                {steps.map((step) => {
                  const done = step.item.state === "up";
                  return (
                    <g key={step.item.id}>
                      <rect
                        x={step.fromLeftMm}
                        y={H - step.topFromFloorMm}
                        width={step.w}
                        height={step.h}
                        fill={done ? "var(--accent)" : "var(--paper)"}
                        stroke="var(--accent)"
                        strokeWidth={6}
                      />
                      <text
                        x={step.fromLeftMm + step.w / 2}
                        y={H - step.topFromFloorMm - label * 0.35}
                        fontSize={label}
                        textAnchor="middle"
                        fill="var(--ink)"
                      >
                        {step.number}
                      </text>
                    </g>
                  );
                })}
              </svg>

              <ol className="divide-y divide-line rounded-lg border border-line bg-card">
                {steps.map((step) => {
                  const { item } = step;
                  return (
                    <li key={item.id} className="flex items-center gap-3 p-3">
                      <span
                        aria-hidden
                        className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line text-sm"
                      >
                        {step.number}
                      </span>
                      <div className="size-14 shrink-0 overflow-hidden rounded bg-paper">
                        {item.content.kind === "photo" || item.content.kind === "thing" ? (
                          <img
                            src={`/api/media/${item.content.id}/thumb?v=${item.content.imageRev}`}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          <span className="flex size-full items-center justify-center overflow-hidden p-1 text-center font-serif text-[0.55rem] leading-tight">
                            {item.content.body}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-medium">
                          Left edge: {mm(step.fromLeftMm)} from wall&apos;s left
                        </p>
                        <p className="font-medium">
                          Top edge: {mm(step.topFromFloorMm)} from floor
                        </p>
                        <p className="text-muted">
                          {item.content.kind === "thing"
                            ? `${item.content.title ?? "Thing"}, ${Math.round(step.w / 10)} × ${Math.round(step.h / 10)} cm`
                            : `${PRINT_SIZES.find((s) => s.id === item.printSizeId)?.label}, ${item.orientation}`}{" "}
                          · {MOUNT_LABELS[item.mount]}
                          {item.state === "planned" && item.content.kind !== "thing" && " · not ordered yet"}
                        </p>
                      </div>
                      <UpToggle id={item.id} up={item.state === "up"} />
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </>
  );
}
