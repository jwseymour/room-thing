"use client";

import { useTransition } from "react";
import { markOrderedAction } from "@/lib/actions/room";

export function MarkOrderedButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending || count === 0}
      onClick={() => startTransition(() => markOrderedAction())}
      className="btn"
    >
      {count === 0 ? "All ordered" : `Mark ${count} as ordered`}
    </button>
  );
}
