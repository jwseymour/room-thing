"use client";

import { useEffect, useMemo, useState } from "react";
import { PAPER_SIZES } from "@/lib/room/print";
import { packSheets, sheetRect, type SheetMode } from "@/lib/room/sheets";

export type PaperItem = {
  id: string;
  kind: string;
  label: string;
  widthPx: number | null;
  heightPx: number | null;
  sizeId: string;
  /** Long edge of the largest size this still prints sharply at, if it's a picture. */
  sharpLongMm: number | null;
};

const PRINTED_KEY = "room.printedOnPaper";

function readPrinted(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(PRINTED_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function PaperPrint({ items }: { items: PaperItem[] }) {
  const [sizes, setSizes] = useState(() => new Map(items.map((i) => [i.id, i.sizeId])));
  const [picked, setPicked] = useState(() => new Set(items.map((i) => i.id)));
  const [printed, setPrinted] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<SheetMode>("whole");

  // What's been printed is remembered on this device, so the next batch starts
  // with only the new things ticked. It's read after the first draw because
  // the server can't see it.
  useEffect(() => {
    const before = new Set(readPrinted());
    if (before.size === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrinted(before);
    setPicked((current) => new Set([...current].filter((id) => !before.has(id))));
  }, []);

  const chosen = useMemo(
    () => items.filter((i) => picked.has(i.id)).map((i) => ({ item: i, sizeId: sizes.get(i.id)! })),
    [items, picked, sizes],
  );
  const sheets = useMemo(
    () =>
      packSheets(chosen.map(({ item, sizeId }) => ({ id: item.id, ...sheetRect(item, sizeId, mode) })))
        .length,
    [chosen, mode],
  );
  const href = `/api/print/sheets?${new URLSearchParams([
    ["mode", mode],
    ...chosen.map(({ item, sizeId }) => ["item", `${item.id}:${sizeId}`]),
  ])}`;

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const markPrinted = () => {
    const all = new Set([...printed, ...chosen.map(({ item }) => item.id)]);
    setPrinted(all);
    try {
      localStorage.setItem(PRINTED_KEY, JSON.stringify([...all]));
    } catch {
      // Private browsing: it just won't be remembered.
    }
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={mode === "whole"}
          onClick={() => setMode("whole")}
          className={`btn ${mode === "whole" ? "btn-primary" : "btn-quiet"}`}
        >
          Whole picture
        </button>
        <button
          type="button"
          aria-pressed={mode === "fill"}
          onClick={() => setMode("fill")}
          className={`btn ${mode === "fill" ? "btn-primary" : "btn-quiet"}`}
        >
          Crop to fill
        </button>
        <p className="text-xs text-muted">
          {mode === "whole"
            ? "Each picture keeps its own shape, fitted inside the size."
            : "Each picture is trimmed to exactly the size."}
        </p>
      </div>

      <ul className="mb-4 border-b border-line">
        {items.map((item) => {
          const sizeId = sizes.get(item.id)!;
          const size = PAPER_SIZES.find((s) => s.id === sizeId)!;
          const soft =
            item.kind === "photo" &&
            item.widthPx !== null &&
            (item.sharpLongMm === null || size.longMm > item.sharpLongMm);
          return (
            <li key={item.id} className="row">
              <input
                type="checkbox"
                checked={picked.has(item.id)}
                onChange={() => toggle(item.id)}
                aria-label={`Print ${item.label}`}
                className="size-5 shrink-0 accent-[var(--ink)]"
              />
              <div className="size-12 shrink-0 overflow-hidden bg-card">
                {item.kind === "photo" ? (
                  <img src={`/api/media/${item.id}/thumb`} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center overflow-hidden p-0.5 text-center text-[0.45rem] leading-tight">
                    {item.label}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate">{item.label}</p>
                <p className="text-xs text-muted">
                  {printed.has(item.id) && "Printed before"}
                  {printed.has(item.id) && soft && " · "}
                  {soft && <span className="text-caution">A little soft at this size</span>}
                </p>
              </div>
              <select
                value={sizeId}
                aria-label={`Size for ${item.label}`}
                onChange={(event) => setSizes((current) => new Map(current).set(item.id, event.target.value))}
                className="field w-auto max-w-36 shrink-0"
              >
                {PAPER_SIZES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-16 flex flex-wrap items-center gap-3 border border-line bg-paper p-3 sm:bottom-2">
        {chosen.length > 0 ? (
          <a href={href} download onClick={markPrinted} className="btn btn-primary">
            Download PDF
          </a>
        ) : (
          <button type="button" disabled className="btn btn-primary">
            Download PDF
          </button>
        )}
        <p className="text-sm text-muted" role="status">
          {chosen.length === 0
            ? "Tick something to print."
            : `${chosen.length} ${chosen.length === 1 ? "item" : "items"} on ${sheets} ${sheets === 1 ? "sheet" : "sheets"} of A4`}
        </p>
      </div>
    </>
  );
}
