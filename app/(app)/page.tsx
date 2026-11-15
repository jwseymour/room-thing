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

  const measured = doc.surfaces.filter((s) => s.source !== "estimate").length;
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
  const ordered = placements.some((p) => p.state !== "planned");

  const steps = [
    {
      title: "Measure the room",
      detail: `${measured} of ${doc.surfaces.length} surfaces measured with a tape`,
      href: "/room",
      done: measured === doc.surfaces.length,
    },
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
      detail: `${plannedWalls} of ${WALLS_GOAL} walls planned`,
      href: "/walls",
      done: plannedWalls >= WALLS_GOAL,
    },
    {
      title: "Order the prints",
      detail: ordered
        ? "Ordered"
        : `${placements.length} ${placements.length === 1 ? "item" : "items"} planned`,
      href: "/print",
      done: ordered,
    },
  ];
  const nextIndex = steps.findIndex((step) => !step.done);

  return (
    <>
      <h1 className="text-3xl">
        {nextIndex === -1 ? "Time to hang them" : steps[nextIndex].title}
      </h1>
      <p className="mt-1 mb-6 text-muted">
        {nextIndex === -1
          ? "Your prints are on the way."
          : "Your first wall, one small step at a time."}
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
