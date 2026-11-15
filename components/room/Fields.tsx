"use client";

import { useState } from "react";

/**
 * Fields that save when you leave them or press Return, rather than on every
 * keystroke: each save writes a new version of the room.
 */

export function TextField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  // Follow the saved value when it changes from outside.
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        className="field"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function NumberField({
  label,
  value,
  min = 0,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  onCommit: (value: number) => void;
}) {
  const shown = String(Math.round(value * 10) / 10);
  const [draft, setDraft] = useState(shown);
  const [seen, setSeen] = useState(shown);
  if (seen !== shown) {
    setSeen(shown);
    setDraft(shown);
  }
  const commit = () => {
    const next = Number(draft.replace(",", "."));
    if (Number.isFinite(next) && next >= min && String(next) !== shown) onCommit(next);
    else setDraft(shown);
  };
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        className="field"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}
