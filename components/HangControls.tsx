"use client";

import { useTransition } from "react";
import { markSurfaceUpAction, setUpAction } from "@/lib/actions/room";

export function UpToggle({ id, up }: { id: string; up: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={up}
      onClick={() => startTransition(() => setUpAction(id, !up))}
      className={`btn shrink-0 ${up ? "btn-primary" : ""}`}
    >
      {up ? "Up ✓" : "Mark up"}
    </button>
  );
}

export function MarkWallUpButton({
  surfaceId,
  count,
}: {
  surfaceId: string;
  count: number;
}) {
  const [pending, startTransition] = useTransition();
  if (count === 0) return null;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => markSurfaceUpAction(surfaceId))}
      className="btn"
    >
      Mark all {count} as up
    </button>
  );
}
