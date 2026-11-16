"use client";

import { useEffect, useMemo, useState } from "react";
import { setPrintedAction } from "@/lib/actions/find";
import { A4, PAPER_SIZES } from "@/lib/room/print";
import { packSheets, sheetRect, type Placed, type SheetMode } from "@/lib/room/sheets";

export type PaperItem = {
  id: string;
  kind: string;
  label: string;
  widthPx: number | null;
  heightPx: number | null;
  sizeId: string;
  /** Long edge of the largest size this still prints sharply at, if it's a picture. */
  sharpLongMm: number | null;
  printed: boolean;
};

/** Where "printed" used to be remembered, per device. Moved into the library once. */
const OLD_PRINTED_KEY = "room.printedOnPaper";

export function PaperPrint({ items }: { items: PaperItem[] }) {
  const [sizes, setSizes] = useState(() => new Map(items.map((i) => [i.id, i.sizeId])));
  const [printed, setPrinted] = useState(() => new Set(items.filter((i) => i.printed).map((i) => i.id)));
  const [picked, setPicked] = useState(() => new Set(items.filter((i) => !i.printed).map((i) => i.id)));
  const [mode, setMode] = useState<SheetMode>("whole");
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(OLD_PRINTED_KEY) ?? "[]");
      localStorage.removeItem(OLD_PRINTED_KEY);
      const known = new Set(items.map((i) => i.id));
      const ids = Array.isArray(stored) ? stored.filter((id): id is string => known.has(id)) : [];
      if (ids.length === 0) return;
      void setPrintedAction(ids, true);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrinted((current) => new Set([...current, ...ids]));
      setPicked((current) => new Set([...current].filter((id) => !ids.includes(id))));
    } catch {
      // Nothing remembered, or nowhere to remember it.
    }
  }, [items]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const chosen = useMemo(
    () => items.filter((i) => picked.has(i.id)).map((i) => ({ item: i, sizeId: sizes.get(i.id)! })),
    [items, picked, sizes],
  );
  const sheets = useMemo(
    () => packSheets(chosen.map(({ item, sizeId }) => ({ id: item.id, ...sheetRect(item, sizeId, mode) }))),
    [chosen, mode],
  );
  const href = `/api/print/sheets?${new URLSearchParams([
    ["mode", mode],
    ...chosen.map(({ item, sizeId }) => ["item", `${item.id}:${sizeId}`]),
  ])}`;

  const toggle = (id: string) => {
    setDownloaded(false);
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const markPrinted = () => {
    const ids = chosen.map(({ item }) => item.id);
    void setPrintedAction(ids, true);
    setPrinted((current) => new Set([...current, ...ids]));
    setPicked(new Set());
    setDownloaded(false);
  };

  const fresh = items.filter((i) => !printed.has(i.id));
  const before = items.filter((i) => printed.has(i.id));

  const row = (item: PaperItem) => {
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
          {soft && <p className="text-xs text-caution">A little soft at this size</p>}
        </div>
        <select
          value={sizeId}
          aria-label={`Size for ${item.label}`}
          onChange={(event) => {
            setDownloaded(false);
            setSizes((current) => new Map(current).set(item.id, event.target.value));
          }}
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
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex">
            {(["whole", "fill"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => {
                  setMode(option);
                  setDownloaded(false);
                }}
                className={`btn -ml-px first:ml-0 ${mode === option ? "btn-primary" : ""}`}
              >
                {option === "whole" ? "Whole picture" : "Crop to fill"}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            {mode === "whole"
              ? "Each picture keeps its own shape, fitted inside the size."
              : "Each picture is trimmed to exactly the size."}
          </p>
        </div>

        {fresh.length > 0 ? (
          <ul className="border-b border-line">{fresh.map(row)}</ul>
        ) : (
          <p className="rule py-6 text-sm text-muted">Everything you&apos;ve kept has been printed.</p>
        )}

        {before.length > 0 && (
          <details className="mt-4" open={fresh.length === 0}>
            <summary className="cursor-pointer py-2 text-sm text-muted">
              Printed before ({before.length}). Tick any to print again.
            </summary>
            <ul className="border-b border-line">{before.map(row)}</ul>
          </details>
        )}
      </div>

      {/* First on a phone, where the list below can run long. Alongside on a wide screen. */}
      <div className="border border-line bg-paper p-3 max-lg:order-first lg:sticky lg:top-4">
        <p className="mb-2 text-sm" role="status">
          {chosen.length === 0
            ? "Tick something to print."
            : `${chosen.length} ${chosen.length === 1 ? "item" : "items"} on ${sheets.length} ${sheets.length === 1 ? "sheet" : "sheets"} of A4`}
        </p>
        {sheets.length > 0 && (
          <ol className="mb-3 flex gap-2 overflow-x-auto lg:grid lg:grid-cols-2 lg:overflow-visible">
            {sheets.map((sheet, index) => (
              <li key={index} className="w-20 shrink-0 lg:w-auto">
                <SheetPreview sheet={sheet} byId={byId} mode={mode} />
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {chosen.length > 0 ? (
            <a href={href} download onClick={() => setDownloaded(true)} className="btn btn-primary">
              Download PDF
            </a>
          ) : (
            <button type="button" disabled className="btn btn-primary">
              Download PDF
            </button>
          )}
          {downloaded && (
            <button type="button" onClick={markPrinted} className="btn">
              Printed: clear these
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted max-lg:hidden">
          Print at 100%, or &ldquo;actual size&rdquo;, and cut along the grey lines.
        </p>
      </div>
    </div>
  );
}

/** One sheet of A4 in small, drawn from the same layout the PDF uses. */
function SheetPreview({ sheet, byId, mode }: { sheet: Placed[]; byId: Map<string, PaperItem>; mode: SheetMode }) {
  return (
    <svg viewBox={`0 0 ${A4.w} ${A4.h}`} role="img" aria-label="A sheet as it will print" className="block w-full border border-line bg-white">
      {sheet.map((at) => {
        const item = byId.get(at.id);
        if (!item) return null;
        // Drawn upright at its own size, then turned if the layout turned it.
        const w = at.rotated ? at.h : at.w;
        const h = at.rotated ? at.w : at.h;
        return (
          <g key={at.id} transform={at.rotated ? `translate(${at.x} ${at.y + at.h}) rotate(-90)` : `translate(${at.x} ${at.y})`}>
            {item.kind === "photo" ? (
              <image
                href={`/api/media/${item.id}/thumb`}
                width={w}
                height={h}
                preserveAspectRatio={mode === "fill" ? "xMidYMid slice" : "xMidYMid meet"}
              />
            ) : (
              <foreignObject width={w} height={h}>
                <div
                  style={{ fontSize: Math.min(w, h) / 9, lineHeight: 1.25, padding: Math.min(w, h) / 10 }}
                  className="flex size-full items-center justify-center overflow-hidden text-center text-black"
                >
                  {item.label.length > 120 ? `${item.label.slice(0, 120)}…` : item.label}
                </div>
              </foreignObject>
            )}
            <rect width={w} height={h} fill="none" stroke="#999" strokeWidth={0.5} />
          </g>
        );
      })}
    </svg>
  );
}
