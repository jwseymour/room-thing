"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { decideAction, undoAction } from "@/lib/actions/content";
import type { Decision } from "@/lib/content/store";

export type DeckCard = {
  id: string;
  kind: "photo" | "quote" | "reminder";
  body: string | null;
  attribution: string | null;
  filename: string | null;
};

const SWIPE_DISTANCE = 90;
const EXIT_MS = 170;

const CHOICES: {
  decision: Decision;
  label: string;
  hint: string;
  exit: string;
}[] = [
  { decision: "no", label: "No", hint: "←", exit: "translateX(-130%) rotate(-12deg)" },
  { decision: "maybe", label: "Maybe", hint: "↑", exit: "translateY(-130%)" },
  { decision: "more_like_this", label: "More", hint: "↓", exit: "translateY(130%)" },
  { decision: "keep", label: "Keep", hint: "→", exit: "translateX(130%) rotate(12deg)" },
];

function decisionFor(x: number, y: number): Decision | null {
  if (Math.abs(x) >= Math.abs(y)) {
    if (x >= SWIPE_DISTANCE) return "keep";
    if (x <= -SWIPE_DISTANCE) return "no";
    return null;
  }
  if (y <= -SWIPE_DISTANCE) return "maybe";
  if (y >= SWIPE_DISTANCE) return "more_like_this";
  return null;
}

export function SwipeDeck({
  initial,
  inboxTotal,
}: {
  initial: DeckCard[];
  inboxTotal: number;
}) {
  const router = useRouter();
  const [queue, setQueue] = useState(initial);
  const [undoStack, setUndoStack] = useState<DeckCard[]>([]);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [exiting, setExiting] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const current = queue[0];
  const sorted = undoStack.length;

  const commit = useCallback(
    (decision: Decision) => {
      if (!current || exiting) return;
      setExiting(decision);
      setError(null);
      const isLast = queue.length === 1;

      window.setTimeout(() => {
        setQueue((q) => q.slice(1));
        setUndoStack((stack) => [current, ...stack].slice(0, 50));
        setExiting(null);
        setDrag({ x: 0, y: 0 });
        startTransition(async () => {
          try {
            await decideAction(current.id, decision);
            if (isLast) router.refresh();
          } catch {
            setError("That didn't save. Is the laptop still on?");
          }
        });
      }, EXIT_MS);
    },
    [current, exiting, queue.length, router],
  );

  const undo = useCallback(() => {
    const [last, ...rest] = undoStack;
    if (!last || exiting) return;
    setUndoStack(rest);
    setQueue((q) => [last, ...q]);
    startTransition(async () => {
      try {
        await undoAction(last.id);
      } catch {
        setError("That didn't save. Is the laptop still on?");
      }
    });
  }, [exiting, undoStack]);

  useEffect(() => {
    const keys: Record<string, Decision> = {
      ArrowRight: "keep",
      ArrowLeft: "no",
      ArrowUp: "maybe",
      ArrowDown: "more_like_this",
    };
    function onKey(event: KeyboardEvent) {
      if (event.key === "z") undo();
      const decision = keys[event.key];
      if (decision) {
        event.preventDefault();
        commit(decision);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, undo]);

  if (!current) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-3xl">Nice work</h1>
        <p className="mt-2 text-muted">
          {sorted} sorted. Saving the last one and looking for more.
        </p>
      </div>
    );
  }

  const leaning = decisionFor(drag.x, drag.y);
  const exit = CHOICES.find((c) => c.decision === exiting)?.exit;
  const transform =
    exit ?? `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 18}deg)`;

  return (
    <div className="mx-auto flex max-w-md flex-col">
      <p className="mb-2 text-center text-sm text-muted">
        {inboxTotal - sorted} left to sort
      </p>

      <div className="relative h-[62dvh] select-none">
        {/* Rendering the next card now means it's already loaded on arrival. */}
        {queue[1] && (
          <div className="absolute inset-0 scale-[0.97] overflow-hidden rounded-xl border border-line bg-card">
            <CardFace card={queue[1]} />
          </div>
        )}
        {queue[2]?.kind === "photo" && (
          <link rel="preload" as="image" href={`/api/media/${queue[2].id}/card`} />
        )}

        <div
          role="group"
          aria-label="Current item. Swipe right to keep, left for no, up for maybe, down for more like this."
          className="absolute inset-0 touch-none overflow-hidden rounded-xl border border-line bg-card shadow-md"
          style={{
            transform,
            transition:
              dragging && !exiting ? "none" : `transform ${EXIT_MS}ms ease-out`,
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragStart.current = { x: event.clientX, y: event.clientY };
            setDragging(true);
            setDrag({ x: 0, y: 0 });
          }}
          onPointerMove={(event) => {
            const start = dragStart.current;
            if (!start) return;
            setDrag({ x: event.clientX - start.x, y: event.clientY - start.y });
          }}
          onPointerUp={() => {
            dragStart.current = null;
            setDragging(false);
            if (leaning) commit(leaning);
            else setDrag({ x: 0, y: 0 });
          }}
          onPointerCancel={() => {
            dragStart.current = null;
            setDragging(false);
            setDrag({ x: 0, y: 0 });
          }}
        >
          <CardFace card={current} />
          {leaning && (
            <span className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1 text-sm font-medium text-white">
              {CHOICES.find((c) => c.decision === leaning)?.label}
            </span>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 grid grid-cols-4 gap-2">
        {CHOICES.map((choice) => (
          <button
            key={choice.decision}
            type="button"
            onClick={() => commit(choice.decision)}
            className={`btn ${choice.decision === "keep" ? "btn-primary" : ""}`}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={undo}
        disabled={undoStack.length === 0}
        className="mt-2 min-h-11 text-sm text-muted disabled:opacity-40"
      >
        Undo
      </button>
    </div>
  );
}

function CardFace({ card }: { card: DeckCard }) {
  if (card.kind === "photo") {
    return (
      <img
        src={`/api/media/${card.id}/card`}
        alt={card.filename ?? "Photo"}
        draggable={false}
        className="size-full bg-black object-contain"
      />
    );
  }
  return (
    <div className="flex size-full flex-col items-center justify-center overflow-auto p-8 text-center">
      <p className="font-serif text-2xl leading-snug">{card.body}</p>
      {card.attribution && (
        <p className="mt-4 text-sm text-muted">{card.attribution}</p>
      )}
    </div>
  );
}
