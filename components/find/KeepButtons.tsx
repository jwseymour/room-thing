"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { keepImageAction, keepQuoteAction, setPinnedAction, type KeepResult } from "@/lib/actions/find";

function useKeep(save: () => Promise<KeepResult>) {
  const [result, setResult] = useState<KeepResult | null>(null);
  const [pending, startTransition] = useTransition();
  const keep = () =>
    startTransition(async () => {
      try {
        setResult(await save());
      } catch {
        setResult({ ok: false, error: "Couldn't save that. Is the laptop still running?" });
      }
    });
  return { result, pending, keep };
}

function KeepState({
  result,
  pending,
  keep,
  busyLabel,
}: ReturnType<typeof useKeep> & { busyLabel: string }) {
  if (result?.ok) {
    return (
      <Link href={`/library/${result.id}`} className="btn btn-quiet">
        {result.already ? "Already kept" : "Kept"} ✓
      </Link>
    );
  }
  return (
    <>
      <button type="button" disabled={pending} onClick={keep} className="btn btn-primary">
        {pending ? busyLabel : "Keep"}
      </button>
      {result && !result.ok && (
        <p role="alert" className="w-full text-xs text-danger">
          {result.error}
        </p>
      )}
    </>
  );
}

export function KeepImage({ source, id }: { source: string; id: string }) {
  const state = useKeep(() => keepImageAction(source, id));
  return <KeepState {...state} busyLabel="Fetching" />;
}

export function KeepQuote(props: {
  body: string;
  attribution: string;
  kind: "quote" | "reminder";
  sourceUrl: string | null;
}) {
  const state = useKeep(() => keepQuoteAction(props));
  return <KeepState {...state} busyLabel="Saving" />;
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
      className="btn btn-quiet"
    >
      {isPinned ? "Pinned ✓" : "Pin this search"}
    </button>
  );
}
