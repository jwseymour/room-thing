"use client";

import { useEffect, useRef, useState } from "react";
import { keepImageAction, moreImagesAction, unkeepAction } from "@/lib/actions/find";
import { creditLine, previewUrl, refOf, SOURCE_NAMES, type FoundImage } from "@/lib/find/picture";
import { largestSharpSize } from "@/lib/room/print";
import { useTray } from "./Tray";
import { useWork } from "./WorkTabs";

const sharpSize = (image: FoundImage) =>
  image.widthPx && image.heightPx ? largestSharpSize(image.widthPx, image.heightPx) : null;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/**
 * Found pictures as a wall of tiles. A tile's corner keeps it; the picture
 * itself opens it large, where the arrow keys move along and K keeps.
 */
export function PictureGrid({
  images,
  kept,
  moreOf,
  hasMore = false,
  titles = true,
  lines,
}: {
  images: FoundImage[];
  /** `<source>:<id>` → library id, for the ones kept already. */
  kept: Record<string, string>;
  /** The search these came from, if more of it can be fetched. */
  moreOf?: string;
  hasMore?: boolean;
  /** Whether each tile is named. Stills from one film all have the same name. */
  titles?: boolean;
  /** Lines from the same work, to set over a still. Offers the caption box. */
  lines?: string[];
}) {
  const work = useWork();
  const { refresh } = useTray();
  const [list, setList] = useState(images);
  const [keptIds, setKeptIds] = useState(kept);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<{ ref: string; message: string } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(hasMore);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const setBusyFor = (ref: string, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(ref);
      else next.delete(ref);
      return next;
    });

  async function toggle(image: FoundImage) {
    const ref = refOf(image.source, image.id);
    if (busy.has(ref)) return;
    setBusyFor(ref, true);
    setProblem(null);
    try {
      const id = keptIds[ref];
      if (id) {
        const undone = await unkeepAction(id);
        if (undone.ok) {
          setKeptIds((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== ref)));
        }
        else setProblem({ ref, message: undone.error ?? "Couldn't take that back." });
      } else {
        const result = await keepImageAction(image.source, image.id);
        if (result.ok) setKeptIds((current) => ({ ...current, [ref]: result.id }));
        else setProblem({ ref, message: result.error });
      }
      refresh();
    } catch {
      setProblem({ ref, message: "Couldn't save that. Is the laptop still running?" });
    } finally {
      setBusyFor(ref, false);
    }
  }

  async function loadMore() {
    if (!moreOf || loading) return;
    setLoading(true);
    setNote(null);
    try {
      const next = await moreImagesAction(moreOf, page + 1);
      const have = new Set(list.map((i) => refOf(i.source, i.id)));
      const fresh = next.results.filter((i) => !have.has(refOf(i.source, i.id)));
      setList([...list, ...fresh]);
      setKeptIds((current) => ({ ...current, ...next.kept }));
      setPage(page + 1);
      setMore(next.more && fresh.length > 0);
      if (next.failed.length) setNote(`No answer from ${next.failed.join(" or ")} just now.`);
      else if (fresh.length === 0) setNote("That's all of them.");
    } catch {
      setNote("Couldn't fetch more. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  if (list.length === 0) return null;
  const current = open === null ? null : list[open];

  return (
    <>
      {work?.caption && lines && (
        <div className="mb-3 flex flex-wrap items-center gap-3 border border-ink p-3 text-sm">
          <p className="min-w-0 flex-1">
            Pick a still for <span className="italic">“{work.caption}”</span>
          </p>
          <button type="button" onClick={() => work.setCaption("")} className="text-muted underline underline-offset-4">
            Never mind
          </button>
        </div>
      )}

      <ul className="columns-2 gap-2 sm:columns-3 lg:columns-4">
        {list.map((image, index) => {
          const ref = refOf(image.source, image.id);
          const isKept = ref in keptIds;
          const sharp = sharpSize(image);
          return (
            <li key={ref} className="relative mb-2 break-inside-avoid">
              <button type="button" onClick={() => setOpen(index)} className="block w-full cursor-zoom-in bg-card text-left">
                <img
                  src={image.thumbUrl}
                  alt={image.title}
                  width={image.widthPx ?? undefined}
                  height={image.heightPx ?? undefined}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className={`h-auto w-full ${isKept ? "outline-3 -outline-offset-3 outline-accent" : ""}`}
                />
                {titles && <span className="block truncate px-1 pt-1 pb-0.5 text-xs text-muted">{image.title}</span>}
              </button>
              <button
                type="button"
                disabled={busy.has(ref)}
                aria-pressed={isKept}
                aria-label={isKept ? `Kept: ${image.title}. Press to take it back.` : `Keep ${image.title}`}
                onClick={() => void toggle(image)}
                className={`absolute top-1.5 right-1.5 flex size-10 items-center justify-center border text-lg leading-none ${
                  isKept ? "border-accent bg-accent text-on-accent" : "border-ink bg-paper/90 text-ink"
                } ${busy.has(ref) ? "animate-pulse" : ""}`}
              >
                {busy.has(ref) ? "…" : isKept ? "✓" : "+"}
              </button>
              {image.widthPx && (
                <span className="pointer-events-none absolute top-1.5 left-1.5 bg-paper/90 px-1.5 py-0.5 text-[0.65rem] tracking-wider text-ink uppercase">
                  {sharp ? sharp.label.replace(/\s*\(.*\)/, "") : "Small"}
                </span>
              )}
              {problem?.ref === ref && (
                <p role="alert" className="px-1 text-xs text-danger">
                  {problem.message}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {(more || note) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          {more && (
            <button type="button" disabled={loading} onClick={() => void loadMore()} className="btn">
              {loading ? "Fetching…" : "More"}
            </button>
          )}
          {note && (
            <p role="status" className="text-sm text-muted">
              {note}
            </p>
          )}
        </div>
      )}

      {current && (
        <Viewer
          key={refOf(current.source, current.id)}
          image={current}
          position={`${open! + 1} of ${list.length}`}
          kept={refOf(current.source, current.id) in keptIds}
          busy={busy.has(refOf(current.source, current.id))}
          problem={problem?.ref === refOf(current.source, current.id) ? problem.message : null}
          lines={lines}
          onToggle={() => void toggle(current)}
          onStep={(by) => setOpen((at) => (at === null ? at : Math.min(list.length - 1, Math.max(0, at + by))))}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function Viewer({
  image,
  position,
  kept,
  busy,
  problem,
  lines,
  onToggle,
  onStep,
  onClose,
}: {
  image: FoundImage;
  position: string;
  kept: boolean;
  busy: boolean;
  problem: string | null;
  lines?: string[];
  onToggle: () => void;
  onStep: (by: number) => void;
  onClose: () => void;
}) {
  const work = useWork();
  const { refresh } = useTray();
  const dialog = useRef<HTMLDialogElement>(null);
  const [src, setSrc] = useState(() => previewUrl(image));
  const [caption, setCaption] = useState(lines ? (work?.caption ?? "") : "");
  const [card, setCard] = useState<{ state: "saving" | "kept" | "failed"; message?: string } | null>(null);
  const sharp = sharpSize(image);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const line = caption.trim();
  const words = line.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const suggestions =
    lines && words.length > 0 && !lines.includes(line)
      ? lines.filter((l) => words.every((w) => l.toLowerCase().includes(w))).slice(0, 6)
      : [];

  async function keepCard() {
    if (!line || card?.state === "saving") return;
    setCard({ state: "saving" });
    try {
      const result = await keepImageAction(image.source, image.id, line);
      setCard(result.ok ? { state: "kept" } : { state: "failed", message: result.error });
      if (result.ok) work?.setCaption("");
      refresh();
    } catch {
      setCard({ state: "failed", message: "Couldn't save that. Is the laptop still running?" });
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-label={image.title}
      onClose={onClose}
      onClick={(event) => {
        // A press on the dimmed surround, outside the panel, closes it.
        if (event.target === dialog.current) dialog.current?.close();
      }}
      onKeyDown={(event) => {
        if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === "ArrowRight") onStep(1);
        else if (event.key === "ArrowLeft") onStep(-1);
        else if (event.key === "k" || event.key === "K") onToggle();
        else return;
        event.preventDefault();
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-paper p-0 text-ink backdrop:bg-black/70 sm:m-auto sm:h-[92dvh] sm:w-[min(76rem,94vw)] sm:border sm:border-ink"
    >
      <div className="flex h-full flex-col sm:flex-row">
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-[#0c0d10]">
          <div className="relative">
            <img
              src={src}
              alt={image.title}
              referrerPolicy="no-referrer"
              onError={() => src !== image.thumbUrl && setSrc(image.thumbUrl)}
              className="block max-h-[56dvh] max-w-full object-contain sm:max-h-[calc(92dvh-2px)]"
            />
            {line && (
              <p
                className="absolute inset-x-[5%] bottom-[5%] text-center text-base leading-tight font-semibold text-white sm:text-2xl"
                style={{ textShadow: "0 0 4px #000, 0 0 4px #000, 0 1px 2px #000" }}
              >
                {line}
              </p>
            )}
          </div>
          <button type="button" aria-label="Previous picture" onClick={() => onStep(-1)} className="absolute top-1/2 left-0 flex h-16 w-11 -translate-y-1/2 items-center justify-center bg-black/40 text-2xl text-white">
            ‹
          </button>
          <button type="button" aria-label="Next picture" onClick={() => onStep(1)} className="absolute top-1/2 right-0 flex h-16 w-11 -translate-y-1/2 items-center justify-center bg-black/40 text-2xl text-white">
            ›
          </button>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-line p-4 max-sm:max-h-[44dvh] max-sm:border-t sm:w-80 sm:border-l">
          <div className="flex items-start justify-between gap-3">
            <p className="eyebrow pt-1">{position}</p>
            <button type="button" onClick={() => dialog.current?.close()} className="text-sm text-muted underline underline-offset-4">
              Close
            </button>
          </div>
          <div>
            <p className="text-sm">{image.title}</p>
            <p className="mt-1 text-xs text-muted">{creditLine(image)}</p>
            {image.widthPx && image.heightPx && (
              <p className={`mt-1 text-xs ${sharp ? "text-muted" : "text-caution"}`}>
                {sharp ? `Prints sharp up to ${sharp.label}` : "Small: a postcard at most"}
              </p>
            )}
            <a href={image.pageUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-muted underline underline-offset-4">
              See it at {SOURCE_NAMES[image.source]}
            </a>
          </div>

          <button type="button" disabled={busy} aria-pressed={kept} onClick={onToggle} className={`btn w-full ${kept ? "btn-quiet" : "btn-primary"}`}>
            {busy ? "Fetching…" : kept ? "Kept ✓ (take it back)" : "Keep"}
          </button>
          {problem && (
            <p role="alert" className="text-xs text-danger">
              {problem}
            </p>
          )}

          {lines && (
            <div className="rule pt-3">
              <label className="label" htmlFor="viewer-caption">
                A line over the picture
              </label>
              <textarea
                id="viewer-caption"
                value={caption}
                rows={4}
                maxLength={300}
                onChange={(event) => {
                  setCaption(event.target.value);
                  setCard(null);
                }}
                placeholder={lines.length ? "Type a word to find one of its lines" : "Type the line"}
                className="field resize-none"
              />
              {suggestions.length > 0 && (
                <ul className="mt-1 border border-line">
                  {suggestions.map((suggestion) => (
                    <li key={suggestion} className="border-t border-line first:border-t-0">
                      <button
                        type="button"
                        onClick={() => {
                          setCaption(suggestion);
                          setCard(null);
                        }}
                        className="block w-full px-2 py-1.5 text-left text-sm"
                      >
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {line && (
                <button type="button" disabled={card?.state === "saving" || card?.state === "kept"} onClick={() => void keepCard()} className="btn mt-2 w-full">
                  {card?.state === "saving" ? "Fetching…" : card?.state === "kept" ? "Kept with its line ✓" : "Keep with this line"}
                </button>
              )}
              {card?.state === "failed" && (
                <p role="alert" className="mt-1 text-xs text-danger">
                  {card.message}
                </p>
              )}
            </div>
          )}

          <p className="mt-auto text-xs text-muted max-sm:hidden">← → to move along · K to keep · Esc to close</p>
        </div>
      </div>
    </dialog>
  );
}
