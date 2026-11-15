"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { QuoteArt } from "@/components/QuoteArt";
import {
  addPlacementAction,
  removePlacementAction,
  updatePlacementAction,
} from "@/lib/actions/room";
import { surfaceBounds } from "@/lib/room/geometry";
import {
  orientationFor,
  PRINT_SIZES,
  printDimensions,
  printQuality,
  type Orientation,
} from "@/lib/room/print";
import {
  MOUNT_LABELS,
  type Fixture,
  type Mount,
  type Surface,
} from "@/lib/room/schema";
import { snapRect, type Guides } from "@/lib/room/snap";
import {
  defaultMount,
  EYE_LEVEL_MM,
  findFreeSpot,
  validatePlacement,
  wallCoverage,
  type PlacedRect,
} from "@/lib/room/validate";

export type TrayItem = {
  id: string;
  kind: "photo" | "quote" | "reminder";
  body: string | null;
  attribution: string | null;
  widthPx: number | null;
  heightPx: number | null;
};

export type EditorPlacement = {
  id: string;
  content: TrayItem;
  printSizeId: string;
  orientation: Orientation;
  u: number;
  v: number;
  mount: Mount;
};

const NO_GUIDES: Guides = { us: [], vs: [] };
const NUDGE_MM = 5;
// 4× makes a 6×4 print on a 3.5 m wall big enough to drag with a thumb.
const ZOOMS = [1, 2, 4];

const toPlaced = (p: EditorPlacement): PlacedRect => ({
  id: p.id,
  mount: p.mount,
  rect: { u: p.u, v: p.v, ...printDimensions(p.printSizeId, p.orientation) },
});

function ppiLabel(placement: EditorPlacement): string | null {
  const { widthPx, heightPx } = placement.content;
  if (!widthPx || !heightPx) return null;
  const quality = printQuality(
    widthPx,
    heightPx,
    printDimensions(placement.printSizeId, placement.orientation),
  );
  return `${quality.ppi} ppi${quality.rating === "good" ? "" : quality.rating === "soft" ? ", a little soft" : ", too small to print well"}`;
}

export function WallEditor({
  surface,
  fixtures,
  initialPlacements,
  tray,
}: {
  surface: Surface;
  fixtures: Fixture[];
  initialPlacements: EditorPlacement[];
  tray: TrayItem[];
}) {
  const { w: W, h: H } = surfaceBounds(surface);
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    offsetU: number;
    offsetV: number;
    moved: boolean;
  } | null>(null);

  const [placements, setPlacements] = useState(initialPlacements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guides>(NO_GUIDES);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // iOS Safari doesn't reliably honour touch-action inside an SVG, so dragging
  // an item would scroll the page. Only touches on items are blocked, which
  // leaves the bare wall free to scroll when zoomed in.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const blockScroll = (event: TouchEvent) => {
      if ((event.target as Element).closest("[data-placement]")) {
        event.preventDefault();
      }
    };
    svg.addEventListener("touchstart", blockScroll, { passive: false });
    return () => svg.removeEventListener("touchstart", blockScroll);
  }, []);

  // Zooming in would otherwise leave you looking at the wall's empty top-left
  // corner. Keep the selected item in view, or failing that the items already
  // up, or the middle of the wall at eye level.
  const focusRef = useRef({ u: W / 2, v: Math.min(EYE_LEVEL_MM, H / 2) });
  useEffect(() => {
    const centres = placements
      .filter((p) => (selectedId ? p.id === selectedId : true))
      .map((p) => {
        const size = printDimensions(p.printSizeId, p.orientation);
        return { u: p.u + size.w / 2, v: p.v + size.h / 2 };
      });
    if (centres.length === 0) return;
    focusRef.current = {
      u: centres.reduce((sum, c) => sum + c.u, 0) / centres.length,
      v: centres.reduce((sum, c) => sum + c.v, 0) / centres.length,
    };
  }, [placements, selectedId]);
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const { u, v } = focusRef.current;
    box.scrollLeft = (u / W) * box.scrollWidth - box.clientWidth / 2;
    box.scrollTop = ((H - v) / H) * box.scrollHeight - box.clientHeight / 2;
  }, [zoom, W, H]);

  const selected = placements.find((p) => p.id === selectedId) ?? null;
  const placedRects = useMemo(() => placements.map(toPlaced), [placements]);
  const issuesById = useMemo(
    () =>
      new Map(
        placedRects.map((p) => [
          p.id,
          validatePlacement(p, surface, fixtures, placedRects),
        ]),
      ),
    [placedRects, surface, fixtures],
  );
  const coverage = wallCoverage(surface, fixtures, placedRects);
  const selectedIssues = selectedId ? (issuesById.get(selectedId) ?? []) : [];
  const onWall = new Set(placements.map((p) => p.content.id));
  const available = tray.filter((item) => !onWall.has(item.id));

  const save = useCallback((task: () => Promise<unknown>) => {
    setError(null);
    startTransition(async () => {
      try {
        await task();
      } catch {
        setError("That didn't save. Is the laptop still on?");
      }
    });
  }, []);

  function patch(id: string, change: Partial<EditorPlacement>) {
    setPlacements((all) =>
      all.map((p) => (p.id === id ? { ...p, ...change } : p)),
    );
  }

  function addToWall(item: TrayItem) {
    const mount = defaultMount(surface);
    if (!mount) {
      setError(`Nothing can be mounted on ${surface.name}. Check its rules.`);
      return;
    }
    const orientation =
      item.widthPx && item.heightPx
        ? orientationFor(item.widthPx, item.heightPx)
        : "landscape";
    const printSizeId = item.kind === "photo" ? "6x4" : "a5";
    const spot = findFreeSpot(
      printDimensions(printSizeId, orientation),
      surface,
      fixtures,
      placedRects,
    );
    const u = Math.round(spot.u);
    const v = Math.round(spot.v);

    setError(null);
    startTransition(async () => {
      try {
        const id = await addPlacementAction({
          surfaceId: surface.id,
          contentId: item.id,
          printSizeId,
          orientation,
          u,
          v,
          mount,
        });
        setPlacements((all) => [
          ...all,
          { id, content: item, printSizeId, orientation, u, v, mount },
        ]);
        setSelectedId(id);
      } catch {
        setError("That didn't save. Is the laptop still on?");
      }
    });
  }

  function removeSelected() {
    if (!selected) return;
    const { id } = selected;
    setPlacements((all) => all.filter((p) => p.id !== id));
    setSelectedId(null);
    save(() => removePlacementAction(id));
  }

  function wallPoint(event: PointerEvent): { u: number; v: number } {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!matrix) return { u: 0, v: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    return { u: point.x, v: H - point.y };
  }

  function onItemDown(event: PointerEvent, placement: EditorPlacement) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = wallPoint(event);
    dragRef.current = {
      id: placement.id,
      offsetU: point.u - placement.u,
      offsetV: point.v - placement.v,
      moved: false,
    };
    setSelectedId(placement.id);
  }

  function onItemMove(event: PointerEvent, placement: EditorPlacement) {
    const drag = dragRef.current;
    if (!drag || drag.id !== placement.id) return;
    const point = wallPoint(event);
    const size = printDimensions(placement.printSizeId, placement.orientation);
    const others = placedRects
      .filter((p) => p.id !== placement.id)
      .map((p) => p.rect);
    const snapped = snapRect(
      { u: point.u - drag.offsetU, v: point.v - drag.offsetV, ...size },
      others,
      { w: W, h: H },
    );
    drag.moved = true;
    setGuides(snapped.guides);
    patch(placement.id, { u: Math.round(snapped.u), v: Math.round(snapped.v) });
  }

  function onItemUp(placement: EditorPlacement) {
    const drag = dragRef.current;
    dragRef.current = null;
    setGuides(NO_GUIDES);
    if (!drag?.moved) return;
    const { id, u, v } = placement;
    save(() => updatePlacementAction(id, { u, v }));
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!selected) return;
    const moves: Record<string, { u: number; v: number }> = {
      ArrowLeft: { u: -NUDGE_MM, v: 0 },
      ArrowRight: { u: NUDGE_MM, v: 0 },
      ArrowUp: { u: 0, v: NUDGE_MM },
      ArrowDown: { u: 0, v: -NUDGE_MM },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const u = Math.max(0, selected.u + move.u);
    const v = Math.max(0, selected.v + move.v);
    patch(selected.id, { u, v });
    save(() => updatePlacementAction(selected.id, { u, v }));
  }

  const portrait = H > W;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/walls" className="text-sm text-muted">
            ← Walls
          </Link>
          <h1 className="text-2xl">{surface.name}</h1>
          <p className="text-sm text-muted">
            {W.toLocaleString("en-GB")} × {H.toLocaleString("en-GB")} mm
            {surface.source === "estimate" && (
              <>
                {" "}
                ·{" "}
                <Link href="/room" className="text-caution underline">
                  estimated, measure this
                </Link>
              </>
            )}
          </p>
        </div>
        <div role="group" aria-label="Zoom" className="flex gap-1">
          {ZOOMS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={zoom === level}
              onClick={() => setZoom(level)}
              className={`btn ${zoom === level ? "btn-primary" : ""}`}
            >
              {level}×
            </button>
          ))}
        </div>
      </div>

      {/* grid-cols-1 and min-w-0 stop the tray's long row of thumbnails from
          widening the whole page, which makes a phone zoom out to fit it. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          <div
            ref={scrollRef}
            className="max-h-[70dvh] overflow-auto rounded-lg border border-line bg-paper"
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              tabIndex={0}
              role="application"
              aria-label={`${surface.name}, drawn to scale. Select an item, then move it by dragging or with the arrow keys.`}
              onKeyDown={onKeyDown}
              onPointerDown={() => setSelectedId(null)}
              className="block max-w-none outline-none"
              style={
                portrait
                  ? { height: `${zoom * 62}dvh`, width: "auto", margin: "0 auto" }
                  : { width: `${zoom * 100}%` }
              }
            >
              <rect width={W} height={H} fill="var(--card)" />
              <polygon
                points={surface.polygon
                  .map((p) => `${p.u},${H - p.v}`)
                  .join(" ")}
                fill="none"
                stroke="var(--line)"
                strokeWidth={6}
              />
              {H > EYE_LEVEL_MM && (
                <g>
                  <line
                    x1={0}
                    x2={W}
                    y1={H - EYE_LEVEL_MM}
                    y2={H - EYE_LEVEL_MM}
                    stroke="var(--line)"
                    strokeWidth={4}
                    strokeDasharray="30 30"
                  />
                  <text
                    x={20}
                    y={H - EYE_LEVEL_MM - 15}
                    fontSize={Math.max(W, H) / 70}
                    fill="var(--muted)"
                  >
                    Eye level
                  </text>
                </g>
              )}

              {fixtures.map((fixture) => (
                <FixtureShape key={fixture.id} fixture={fixture} wallHeight={H} />
              ))}

              {placements.map((placement) => {
                const { w, h } = printDimensions(
                  placement.printSizeId,
                  placement.orientation,
                );
                const y = H - placement.v - h;
                const issues = issuesById.get(placement.id) ?? [];
                const hasError = issues.some((i) => i.severity === "error");
                const stroke = hasError
                  ? "var(--danger)"
                  : issues.length
                    ? "var(--caution)"
                    : placement.id === selectedId
                      ? "var(--accent)"
                      : "var(--muted)";
                return (
                  <g
                    key={placement.id}
                    data-placement={placement.id}
                    style={{ cursor: "grab", touchAction: "none" }}
                    onPointerDown={(e) => onItemDown(e, placement)}
                    onPointerMove={(e) => onItemMove(e, placement)}
                    onPointerUp={() => onItemUp(placement)}
                    onPointerCancel={() => onItemUp(placement)}
                  >
                    {placement.content.kind === "photo" ? (
                      <image
                        href={`/api/media/${placement.content.id}/card`}
                        x={placement.u}
                        y={y}
                        width={w}
                        height={h}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    ) : (
                      <svg x={placement.u} y={y} width={w} height={h}>
                        <QuoteArt
                          body={placement.content.body ?? ""}
                          attribution={placement.content.attribution}
                          w={w}
                          h={h}
                        />
                      </svg>
                    )}
                    <rect
                      x={placement.u}
                      y={y}
                      width={w}
                      height={h}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={placement.id === selectedId || issues.length ? 8 : 2}
                    />
                  </g>
                );
              })}

              {guides.us.map((u) => (
                <line key={`u${u}`} x1={u} x2={u} y1={0} y2={H} stroke="var(--accent)" strokeWidth={4} />
              ))}
              {guides.vs.map((v) => (
                <line key={`v${v}`} x1={0} x2={W} y1={H - v} y2={H - v} stroke="var(--accent)" strokeWidth={4} />
              ))}
            </svg>
          </div>

          <p className="mt-2 text-sm text-muted">
            {Math.round(coverage.coverage * 100)}% of the free wall covered
          </p>
          {coverage.issue && (
            <p className="text-sm text-caution">{coverage.issue.message}</p>
          )}
          {error && (
            <p role="alert" className="mt-1 text-sm text-danger">
              {error}
            </p>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          {selected ? (
            <section className="space-y-3 rounded-lg border border-line bg-card p-3">
              <div>
                <label htmlFor="print-size" className="label">
                  Print size
                </label>
                <select
                  id="print-size"
                  className="field"
                  value={selected.printSizeId}
                  onChange={(event) => {
                    const printSizeId = event.target.value;
                    patch(selected.id, { printSizeId });
                    save(() =>
                      updatePlacementAction(selected.id, { printSizeId }),
                    );
                  }}
                >
                  {PRINT_SIZES.map((size) => (
                    <option key={size.id} value={size.id}>
                      {size.label}
                    </option>
                  ))}
                </select>
              </div>

              <div role="group" aria-label="Orientation" className="grid grid-cols-2 gap-1">
                {(["landscape", "portrait"] as const).map((orientation) => (
                  <button
                    key={orientation}
                    type="button"
                    aria-pressed={selected.orientation === orientation}
                    onClick={() => {
                      patch(selected.id, { orientation });
                      save(() =>
                        updatePlacementAction(selected.id, { orientation }),
                      );
                    }}
                    className={`btn capitalize ${selected.orientation === orientation ? "btn-primary" : ""}`}
                  >
                    {orientation}
                  </button>
                ))}
              </div>

              <div>
                <label htmlFor="mount" className="label">
                  Mounted with
                </label>
                <select
                  id="mount"
                  className="field"
                  value={selected.mount}
                  onChange={(event) => {
                    const mount = event.target.value as Mount;
                    patch(selected.id, { mount });
                    save(() => updatePlacementAction(selected.id, { mount }));
                  }}
                >
                  {/* Only allowed mounts are offered, so a rule can't be broken here. */}
                  {surface.allowedMounts.map((mount) => (
                    <option key={mount} value={mount}>
                      {MOUNT_LABELS[mount]}
                    </option>
                  ))}
                </select>
              </div>

              <dl className="space-y-0.5 text-sm text-muted">
                <div className="flex justify-between">
                  <dt>From left of wall</dt>
                  <dd>{selected.u.toLocaleString("en-GB")} mm</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Bottom edge from floor</dt>
                  <dd>{selected.v.toLocaleString("en-GB")} mm</dd>
                </div>
                {ppiLabel(selected) && (
                  <div className="flex justify-between">
                    <dt>Print quality</dt>
                    <dd>{ppiLabel(selected)}</dd>
                  </div>
                )}
              </dl>

              {selectedIssues.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {selectedIssues.map((issue) => (
                    <li
                      key={issue.message}
                      className={
                        issue.severity === "error"
                          ? "text-danger"
                          : "text-caution"
                      }
                    >
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}

              <button
                type="button"
                onClick={removeSelected}
                className="btn btn-danger w-full"
              >
                Take off the wall
              </button>
            </section>
          ) : (
            <p className="text-sm text-muted">
              Tap something you&apos;ve kept to add it, then drag it into place.
            </p>
          )}

          <section>
            <h2 className="mb-2 text-lg">Kept, not on this wall</h2>
            {available.length === 0 ? (
              <p className="text-sm text-muted">
                {tray.length === 0 ? (
                  <>
                    Nothing kept yet.{" "}
                    <Link href="/sort" className="underline">
                      Sort some items
                    </Link>
                    .
                  </>
                ) : (
                  "Everything you've kept is on this wall."
                )}
              </p>
            ) : (
              <ul className="flex gap-1 overflow-x-auto pb-1 lg:grid lg:grid-cols-3 lg:overflow-visible">
                {available.map((item) => (
                  <li key={item.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => addToWall(item)}
                      aria-label={`Add ${item.kind} to the wall`}
                      className="block size-20 overflow-hidden rounded bg-card lg:size-full lg:aspect-square"
                    >
                      {item.kind === "photo" ? (
                        <img
                          src={`/api/media/${item.id}/thumb`}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center overflow-hidden p-1 text-center font-serif text-[0.65rem] leading-tight">
                          {item.body}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function FixtureShape({
  fixture,
  wallHeight,
}: {
  fixture: Fixture;
  wallHeight: number;
}) {
  const { u, v, w, h } = fixture.rect;
  const clear = fixture.keepClearMm;
  const y = wallHeight - v - h;
  return (
    <g pointerEvents="none">
      {clear > 0 && (
        <rect
          x={u - clear}
          y={y - clear}
          width={w + clear * 2}
          height={h + clear * 2}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={3}
          strokeDasharray="16 16"
        />
      )}
      <rect
        x={u}
        y={y}
        width={w}
        height={h}
        fill="var(--line)"
        stroke="var(--muted)"
        strokeWidth={4}
      />
      <text
        x={u + w / 2}
        y={y + h / 2}
        fontSize={Math.max(32, Math.min(w, h) / 6)}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="var(--muted)"
      >
        {fixture.label || fixture.kind}
      </text>
    </g>
  );
}
