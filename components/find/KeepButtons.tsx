"use client";

import { useState, useTransition } from "react";
import {
  keepImageAction,
  keepQuoteAction,
  setPinnedAction,
  unkeepAction,
  type KeepResult,
} from "@/lib/actions/find";
import { useTray } from "./Tray";

/**
 * Keeping as a switch: once to keep, again to take it back. `keptId` is the
 * library's id for it, if it's kept already.
 */
export function useKeep(save: () => Promise<KeepResult>, keptId: string | null = null) {
  const [id, setId] = useState(keptId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { refresh } = useTray();

  const toggle = () =>
    startTransition(async () => {
      setError(null);
      try {
        if (id) {
          const undone = await unkeepAction(id);
          if (undone.ok) setId(null);
          else setError(undone.error ?? "Couldn't take that back.");
        } else {
          const result = await save();
          if (result.ok) setId(result.id);
          else setError(result.error);
        }
        refresh();
      } catch {
        setError("Couldn't save that. Is the laptop still running?");
      }
    });
  return { id, kept: id !== null, pending, error, toggle };
}

/** The switch as a button with words on it. */
export function KeepSwitch({
  kept,
  pending,
  error,
  toggle,
  busyLabel = "Saving",
}: ReturnType<typeof useKeep> & { busyLabel?: string }) {
  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-pressed={kept}
        onClick={toggle}
        title={kept ? "Kept. Press to take it back." : undefined}
        className={`btn shrink-0 ${kept ? "btn-quiet" : "btn-primary"}`}
      >
        {pending ? busyLabel : kept ? "Kept ✓" : "Keep"}
      </button>
      {error && (
        <p role="alert" className="w-full text-xs text-danger">
          {error}
        </p>
      )}
    </>
  );
}

export function KeepImage({ source, id, caption }: { source: string; id: string; caption?: string }) {
  const state = useKeep(() => keepImageAction(source, id, caption));
  return <KeepSwitch {...state} busyLabel="Fetching" />;
}

export function KeepQuote({
  keptId,
  ...quote
}: {
  body: string;
  attribution: string;
  kind: "quote" | "reminder";
  sourceUrl: string | null;
  keptId?: string | null;
}) {
  const state = useKeep(() => keepQuoteAction(quote), keptId ?? null);
  return <KeepSwitch {...state} />;
}

export function PinButton({ q, kind, pinned }: { q: string; kind: string; pinned: boolean }) {
  const [isPinned, setIsPinned] = useState(pinned);
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={isPinned}
      onClick={() =>
        startTransition(async () => {
          await setPinnedAction(q, kind, !isPinned);
          setIsPinned(!isPinned);
        })
      }
      className="text-sm text-muted underline underline-offset-4"
    >
      {isPinned ? "Pinned to your starting points ✓" : "Pin this search"}
    </button>
  );
}
