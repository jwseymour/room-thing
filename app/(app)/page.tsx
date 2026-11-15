import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { statusCounts } from "@/lib/content/store";
import { activePlacements, getRoom } from "@/lib/room/store";

const KEPT_GOAL = 30;
const WALLS_GOAL = 2;
const ITEMS_FOR_A_PLANNED_WALL = 2;

// Every page here shows live data from the laptop's database, so it waits for
// the request rather than showing a placeholder first. See lib/auth.ts.
export const instant = false;

export default async function TodayPage() {
  await requireSession();

  const { doc } = getRoom();
  const counts = statusCounts();
  const placements = activePlacements();

  const perWall = new Map<string, number>();
  for (const placement of placements) {
    perWall.set(
      placement.surfaceId,
      (perWall.get(placement.surfaceId) ?? 0) + 1,
    );
  }
  const plannedWalls = [...perWall.values()].filter(
    (n) => n >= ITEMS_FOR_A_PLANNED_WALL,
  ).length;

  // Only the surfaces you're actually using need a tape measure, and only
  // before ordering, so rough sizes are fine while collecting and planning.
  const inUse = doc.surfaces.filter((s) => perWall.has(s.id));
  const measured = inUse.filter((s) => s.source !== "estimate").length;
  const ordered =
    placements.length > 0 && placements.every((p) => p.state !== "planned");
  const up = placements.filter((p) => p.state === "up").length;

  const steps = [
    {
      title: "Collect and sort",
      detail: `${counts.keep} of ${KEPT_GOAL} kept${
        counts.inbox ? `, ${counts.inbox} waiting to sort` : ""
      }`,
      href: counts.inbox ? "/sort" : "/library",
      done: counts.keep >= KEPT_GOAL,
    },
    {
      title: "Plan two walls",
      detail: `${plannedWalls} of ${WALLS_GOAL} walls planned. Rough sizes are fine for now`,
      href: "/walls",
      done: plannedWalls >= WALLS_GOAL,
    },
    {
      title: "Measure those walls",
      detail:
        inUse.length === 0
          ? "Tape-measure the walls you've planned, before ordering"
          : `${measured} of ${inUse.length} planned ${
              inUse.length === 1 ? "surface" : "surfaces"
            } measured with a tape`,
      href: "/room",
      done: inUse.length > 0 && measured === inUse.length,
    },
    {
      title: "Order the prints",
      detail: ordered
        ? "Ordered"
        : `${placements.filter((p) => p.state === "planned").length} to order`,
      href: "/print",
      done: ordered,
    },
    {
      title: "Hang them",
      detail: `${up} of ${placements.length} up`,
      href: "/hang",
      done: placements.length > 0 && up === placements.length,
    },
  ];
  const nextIndex = steps.findIndex((step) => !step.done);

  return (
    <>
      <h1 className="text-3xl">
        {nextIndex === -1 ? "Your walls are up" : steps[nextIndex].title}
      </h1>
      <p className="mt-1 mb-6 text-muted">
        {nextIndex === -1
          ? "Live with them for a few weeks, then swap in something new."
          : "Your first walls, one small step at a time."}
      </p>

      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={step.title}>
            <Link
              href={step.href}
              className={`flex items-center gap-3 rounded-lg border p-4 ${
                index === nextIndex
                  ? "border-accent bg-card"
                  : "border-line bg-card"
              }`}
            >
              <span
                aria-hidden
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm ${
                  step.done
                    ? "bg-accent text-on-accent"
                    : "border border-line text-muted"
                }`}
              >
                {step.done ? "✓" : index + 1}
              </span>
              <span>
                <span className="block font-medium">{step.title}</span>
                <span className="block text-sm text-muted">{step.detail}</span>
              </span>
              {step.done && <span className="sr-only">Done</span>}
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
