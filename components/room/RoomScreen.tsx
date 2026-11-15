"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import {
  addPlacementAction,
  addPlacementsAction,
  removePlacementAction,
  saveRoomAction,
  setUpAction,
  updatePlacementAction,
} from "@/lib/actions/room";
import { applyTapeAction, removeViewpointAction, saveViewpointAction } from "@/lib/actions/scan";
import { arrange } from "@/lib/room/arrange";
import { inflate, surfaceBounds } from "@/lib/room/geometry";
import {
  orientationFor,
  OWN_SIZE,
  placementSize,
  PRINT_SIZES,
  type Orientation,
} from "@/lib/room/print";
import {
  FIXTURE_KINDS,
  MOUNT_LABELS,
  MOUNTS,
  type Block,
  type Fixture,
  type Mount,
  type RoomDocument,
  type Surface,
} from "@/lib/room/schema";
import { snapRect } from "@/lib/room/snap";
import { obstacleFixtures, wallSpace } from "@/lib/room/space";
import { defaultMount, findFreeSpot, validatePlacement, type PlacedRect } from "@/lib/room/validate";
import type { StageMark, StageMode, StagePick, StageRoom } from "@/lib/room3d/stage";
import { surfaceFrame } from "@/lib/scan/frame";
import { NumberField, TextField } from "./Fields";
import { useStage } from "./useStage";

export type RoomItem = {
  id: string;
  kind: "photo" | "quote" | "reminder" | "thing";
  title: string | null;
  body: string | null;
  attribution: string | null;
  widthPx: number | null;
  heightPx: number | null;
  widthMm: number | null;
  heightMm: number | null;
  imageRev: number;
};

export type RoomPlacement = {
  id: string;
  surfaceId: string;
  content: RoomItem;
  printSizeId: string;
  orientation: Orientation;
  widthMm: number | null;
  heightMm: number | null;
  u: number;
  v: number;
  mount: Mount;
  up: boolean;
};

type Selection =
  | { type: "picture"; id: string }
  | { type: "block"; id: string }
  | { type: "mark"; id: string }
  | null;

type ModeKey = "orbit" | "plan" | "inside" | `wall:${string}`;

/** One colour for each way you can face, shared with the 3D view. */
const WAYS = ["--way-1", "--way-2", "--way-3", "--way-4", "--way-5", "--way-6"];
const VIEW_NAMES = ["Lying in bed", "At the desk", "In the doorway"];
const GAP_MM = 40;

/** The next unused id of the form `prefix-n`. */
const nextId = (prefix: string, taken: string[]) => {
  let n = taken.length + 1;
  while (taken.includes(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
};
const metres = (mm: number) => `${(mm / 1000).toFixed(2)} m`;
const cm = (mm: number) => `${Math.round(mm / 10)} cm`;
const clampTo = (value: number, max: number) =>
  Math.round(Math.min(Math.max(value, 0), Math.max(max, 0)));
const imageOf = (item: RoomItem, variant: "thumb" | "card") =>
  item.kind === "photo" || item.kind === "thing"
    ? `/api/media/${item.id}/${variant}?v=${item.imageRev}`
    : null;
const nameOf = (item: RoomItem) =>
  item.title || (item.kind === "thing" ? "Untitled thing" : item.body?.slice(0, 40) || "Photo");
const toPlaced = (p: RoomPlacement): PlacedRect => ({
  id: p.id,
  mount: p.mount,
  rect: { u: p.u, v: p.v, ...placementSize(p) },
});
const markKind = (kind: Fixture["kind"]): StageMark["kind"] =>
  kind === "door" || kind === "window" || kind === "shelf" || kind === "furniture" ? kind : "other";

export function RoomScreen({
  scan,
  doc: savedDoc,
  initialPlacements,
  tray,
  wallImages,
  start,
}: {
  scan: { id: string; fileType: string; matrix: number[]; ceilingSeen: boolean; tapeChecked: boolean } | null;
  doc: RoomDocument;
  initialPlacements: RoomPlacement[];
  tray: RoomItem[];
  /** Ids of the walls that have a picture from the scan. */
  wallImages: string[];
  start: { wall: string | null; place: string | null };
}) {
  const router = useRouter();
  const [doc, setDoc] = useState(savedDoc);
  const [placements, setPlacements] = useState(initialPlacements);
  const [selection, setSelection] = useState<Selection>(null);
  const [mode, setMode] = useState<ModeKey>(start.wall ? `wall:${start.wall}` : "orbit");
  // The scan's picture of a wall helps when working on that wall, and gets in
  // the way of the plain model otherwise. Until it's switched by hand, it follows.
  const [chosen, setChosen] = useState<{ photo: boolean | null; space: boolean; scan: boolean }>({
    photo: null,
    space: true,
    scan: false,
  });
  const [scanState, setScanState] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastArranged, setLastArranged] = useState<string[]>([]);
  // The 3D view needs real colour values, not the names of CSS variables.
  // They're only used for drawing, so reading them here can't upset hydration.
  const [colours] = useState<string[]>(() => {
    if (typeof document === "undefined") return [];
    const style = getComputedStyle(document.documentElement);
    return WAYS.map((name) => style.getPropertyValue(name).trim() || "#3d6fd9");
  });
  const [, startTransition] = useTransition();
  // The latest room, for handlers the 3D view calls between renders.
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  const walls = useMemo(() => doc.surfaces.filter((s) => s.kind === "wall" && s.pose), [doc]);
  const wallId = mode.startsWith("wall:") ? mode.slice(5) : null;
  const show = { ...chosen, photo: chosen.photo ?? (wallId !== null || mode === "inside") };
  const wall = walls.find((w) => w.id === wallId) ?? null;
  const wayOf = (surfaceId: string) => WAYS[Math.max(0, walls.findIndex((w) => w.id === surfaceId)) % WAYS.length];

  const run = (task: () => Promise<unknown>) => {
    setError(null);
    startTransition(async () => {
      try {
        await task();
      } catch {
        setError("That didn't save. Is the laptop still on?");
      }
    });
  };
  /** Changes the room and saves it. */
  const commit = (next: RoomDocument) => {
    setDoc(next);
    run(() => saveRoomAction(next));
  };
  const patchPlacement = (id: string, change: Partial<RoomPlacement>) =>
    setPlacements((all) => all.map((p) => (p.id === id ? { ...p, ...change } : p)));

  // ------------------------------------------------------------ the 3D view

  function onTap(pick: StagePick) {
    setNote(null);
    if (pick?.type === "picture") setSelection({ type: "picture", id: pick.id });
    else if (pick?.type === "block") setSelection({ type: "block", id: pick.id });
    else if (pick?.type === "wall" && !wallId && mode !== "inside") {
      // Tapping a wall turns the room to face it.
      setSelection(null);
      setMode(`wall:${pick.surfaceId}`);
    } else setSelection(null);
  }

  function onPictureDrag(id: string, u: number, v: number) {
    const moving = placements.find((p) => p.id === id);
    const surface = moving && doc.surfaces.find((s) => s.id === moving.surfaceId);
    if (!moving || !surface) return;
    const others = placements
      .filter((p) => p.surfaceId === moving.surfaceId && p.id !== id)
      .map((p) => toPlaced(p).rect);
    const snapped = snapRect({ u, v, ...placementSize(moving) }, others, surfaceBounds(surface));
    setSelection({ type: "picture", id });
    patchPlacement(id, { u: Math.round(snapped.u), v: Math.round(snapped.v) });
  }

  function onPictureDrop(id: string) {
    const moved = placements.find((p) => p.id === id);
    if (moved) run(() => updatePlacementAction(id, { u: moved.u, v: moved.v }));
  }

  function onBlockDrag(id: string, x: number, y: number) {
    const current = docRef.current;
    const block = current.blocks.find((b) => b.id === id);
    if (!block) return;
    const xs = walls.map((w) => w.pose!.x);
    const ys = walls.map((w) => w.pose!.y);
    const grid = (value: number) => Math.round(value / 20) * 20;
    // Within a hand's width of a wall, sit flush against it.
    const settle = (value: number, lo: number, hi: number) => {
      const held = Math.min(Math.max(grid(value), lo), hi);
      return held - lo < 60 ? lo : hi - held < 60 ? hi : held;
    };
    const next = {
      ...current,
      blocks: current.blocks.map((b) =>
        b.id === id
          ? {
              ...b,
              x: settle(x, Math.min(...xs), Math.max(...xs) - b.w),
              y: settle(y, Math.min(...ys), Math.max(...ys) - b.d),
              source: "estimate" as const,
            }
          : b,
      ),
    };
    docRef.current = next;
    setSelection({ type: "block", id });
    setDoc(next);
  }

  const { containerRef, stage, failed } = useStage({
    onTap,
    onPictureDrag,
    onPictureDrop,
    onBlockDrag,
    onBlockDrop: () => run(() => saveRoomAction(docRef.current)),
    onScanProgress: (fraction) => setScanState(`Loading the scan, ${Math.round(fraction * 100)}%`),
    onScanState: (state) =>
      setScanState(
        state === "ready" ? null : state === "error" ? "The scan couldn't be shown." : "Loading the scan",
      ),
  });

  const stageRoom: StageRoom | null = useMemo(() => {
    if (!colours.length || walls.length < 3) return null;
    return {
      corners: walls.map((w) => [w.pose!.x / 1000, w.pose!.y / 1000] as [number, number]),
      heightM: doc.ceilingMm / 1000,
      walls: walls.map((w, i) => ({
        id: w.id,
        name: w.name,
        frame: surfaceFrame(w)!,
        widthMm: surfaceBounds(w).w,
        heightMm: surfaceBounds(w).h,
        accent: colours[i % colours.length],
        imageUrl: scan && wallImages.includes(w.id) ? `/api/scan/${scan.id}/wall/${w.id}` : null,
      })),
      blocks: doc.blocks,
      marks: doc.fixtures.map((f) => ({
        id: f.id,
        surfaceId: f.surfaceId,
        kind: markKind(f.kind),
        label: f.label,
        ...f.rect,
      })),
    };
  }, [doc, walls, colours, scan, wallImages]);

  useEffect(() => {
    if (stage && stageRoom) stage.setRoom(stageRoom);
  }, [stage, stageRoom]);

  useEffect(() => {
    stage?.setPictures(
      placements.map((p) => ({
        id: p.id,
        surfaceId: p.surfaceId,
        u: p.u,
        v: p.v,
        ...placementSize(p),
        imageUrl: imageOf(p.content, "card"),
        body: p.content.body,
        attribution: p.content.attribution,
        up: p.up,
      })),
    );
  }, [stage, placements, stageRoom]);

  useEffect(() => {
    stage?.setSelected(selection?.type === "picture" || selection?.type === "block" ? selection.id : null);
  }, [stage, selection]);

  useEffect(() => {
    if (!stage) return;
    const next: StageMode = wallId
      ? { type: "wall", surfaceId: wallId }
      : mode === "plan"
        ? { type: "plan" }
        : mode === "inside"
          ? { type: "inside", ...stage.getInsidePose() }
          : { type: "orbit" };
    stage.setMode(next);
    // Only when the view changes: the pose is read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, mode]);

  useEffect(() => {
    stage?.setPhotos(show.photo);
  }, [stage, show.photo, stageRoom]);

  useEffect(() => {
    if (!stage || !scan) return;
    void stage.setScan(show.scan, {
      url: `/api/scan/${scan.id}/file`,
      fileType: scan.fileType,
      matrix: scan.matrix,
    });
  }, [stage, show.scan, scan]);

  // ------------------------------------------------------------- wall space

  const spaces = useMemo(
    () =>
      new Map(
        walls.map((w) => [
          w.id,
          wallSpace(
            doc,
            w,
            placements.filter((p) => p.surfaceId === w.id).map((p) => inflate(toPlaced(p).rect, GAP_MM)),
          ),
        ]),
      ),
    [doc, walls, placements],
  );

  useEffect(() => {
    if (!stage) return;
    if (!show.space || mode === "inside") {
      stage.setFree([]);
      return;
    }
    stage.setFree(
      walls
        .filter((w) => !wallId || w.id === wallId)
        .map((w) => ({
          surfaceId: w.id,
          region: spaces.get(w.id)!.region,
          best: wallId ? spaces.get(w.id)!.free.slice(0, 1) : [],
        })),
    );
  }, [stage, show.space, mode, wallId, walls, spaces, stageRoom]);

  // ------------------------------------------------------- putting things up

  const onAWall = new Set(placements.map((p) => p.content.id));
  const waiting = tray.filter((item) => !onAWall.has(item.id));
  const sizeFor = (item: RoomItem) => {
    if (item.kind === "thing") {
      if (!item.widthMm || !item.heightMm) return null;
      return {
        printSizeId: OWN_SIZE,
        orientation: (item.widthMm >= item.heightMm ? "landscape" : "portrait") as Orientation,
        widthMm: item.widthMm,
        heightMm: item.heightMm,
      };
    }
    return {
      printSizeId: item.kind === "photo" ? "6x4" : "a5",
      orientation:
        item.widthPx && item.heightPx ? orientationFor(item.widthPx, item.heightPx) : ("landscape" as Orientation),
      widthMm: null,
      heightMm: null,
    };
  };

  function addToWall(item: RoomItem, surface: Surface) {
    const mount = defaultMount(surface);
    const size = sizeFor(item);
    if (!mount || !size) return;
    const dims = placementSize(size);
    const spot = findFreeSpot(
      dims,
      surface,
      obstacleFixtures(doc, surface),
      placements.filter((p) => p.surfaceId === surface.id).map(toPlaced),
    );
    const bounds = surfaceBounds(surface);
    const u = clampTo(spot.u, bounds.w - dims.w);
    const v = clampTo(spot.v, bounds.h - dims.h);
    setError(null);
    startTransition(async () => {
      try {
        const id = await addPlacementAction({ surfaceId: surface.id, contentId: item.id, ...size, u, v, mount });
        setPlacements((all) => [...all, { id, surfaceId: surface.id, content: item, ...size, u, v, mount, up: false }]);
        setSelection({ type: "picture", id });
      } catch {
        setError("That didn't save. Is the laptop still on?");
      }
    });
  }

  function arrangeWall(surface: Surface) {
    const mount = defaultMount(surface);
    const space = spaces.get(surface.id);
    if (!mount || !space) return;
    const ready = waiting.flatMap((item) => {
      const size = sizeFor(item);
      return size && item.kind === "thing" ? [{ item, size, ...placementSize(size) }] : [];
    });
    const { placed, left } = arrange(
      ready.map((r) => ({ id: r.item.id, w: r.w, h: r.h })),
      space.free,
    );
    if (!placed.length) {
      setNote("Nothing fits in the clear space on this wall.");
      return;
    }
    const inputs = placed.map((spot) => {
      const r = ready.find((x) => x.item.id === spot.id)!;
      return { surfaceId: surface.id, contentId: r.item.id, ...r.size, u: Math.max(0, spot.u), v: Math.max(0, spot.v), mount };
    });
    setError(null);
    startTransition(async () => {
      try {
        const ids = await addPlacementsAction(inputs);
        setPlacements((all) => [
          ...all,
          ...inputs.map((input, i) => ({
            ...input,
            id: ids[i],
            content: ready.find((x) => x.item.id === input.contentId)!.item,
            up: false,
          })),
        ]);
        setLastArranged(ids);
        setNote(
          left.length
            ? `Arranged ${placed.length}. ${left.length} didn't fit: try another wall.`
            : `Arranged ${placed.length}. Drag any of them to adjust.`,
        );
      } catch {
        setError("That didn't save. Is the laptop still on?");
      }
    });
  }

  function undoArrange() {
    const ids = lastArranged;
    setPlacements((all) => all.filter((p) => !ids.includes(p.id)));
    setLastArranged([]);
    setNote(null);
    run(async () => {
      for (const id of ids) await removePlacementAction(id);
    });
  }

  // ------------------------------------------------------------- what's shown

  const picture = selection?.type === "picture" ? placements.find((p) => p.id === selection.id) : undefined;
  const pictureWall = picture && doc.surfaces.find((s) => s.id === picture.surfaceId);
  const block = selection?.type === "block" ? doc.blocks.find((b) => b.id === selection.id) : undefined;
  const mark = selection?.type === "mark" ? doc.fixtures.find((f) => f.id === selection.id) : undefined;
  const issues =
    picture && pictureWall
      ? validatePlacement(
          toPlaced(picture),
          pictureWall,
          obstacleFixtures(doc, pictureWall),
          placements.filter((p) => p.surfaceId === pictureWall.id).map(toPlaced),
        )
      : [];
  // From the walls rather than the 3D view's copy, so the server renders the same text.
  const size = walls.length
    ? {
        w: (Math.max(...walls.map((w) => w.pose!.x)) - Math.min(...walls.map((w) => w.pose!.x))) / 1000,
        d: (Math.max(...walls.map((w) => w.pose!.y)) - Math.min(...walls.map((w) => w.pose!.y))) / 1000,
      }
    : null;
  const dims = wall
    ? `${metres(surfaceBounds(wall).w)} × ${metres(surfaceBounds(wall).h)}`
    : size
      ? `${metres(size.w * 1000)} × ${metres(size.d * 1000)} × ${metres(doc.ceilingMm)}`
      : "";
  const shellStyle = { "--way": `var(${wall ? wayOf(wall.id) : "--ink"})` } as CSSProperties;

  const patchBlock = (id: string, change: Partial<Block>) =>
    commit({ ...doc, blocks: doc.blocks.map((b) => (b.id === id ? { ...b, ...change, source: "estimate" } : b)) });
  const patchMark = (id: string, change: Partial<Fixture>) =>
    commit({ ...doc, fixtures: doc.fixtures.map((f) => (f.id === id ? { ...f, ...change, source: "estimate" } : f)) });
  const patchWall = (id: string, change: Partial<Surface>) =>
    commit({ ...doc, surfaces: doc.surfaces.map((s) => (s.id === id ? { ...s, ...change } : s)) });

  function addMark(surface: Surface, kind: Fixture["kind"]) {
    const bounds = surfaceBounds(surface);
    const rect =
      kind === "door"
        ? { u: bounds.w / 2 - 400, v: 0, w: 800, h: 2000 }
        : kind === "window"
          ? { u: bounds.w / 2 - 500, v: 900, w: 1000, h: 1000 }
          : { u: bounds.w / 2 - 300, v: 1000, w: 600, h: 600 };
    const id = nextId("mark", doc.fixtures.map((f) => f.id));
    commit({
      ...doc,
      fixtures: [
        ...doc.fixtures,
        { id, surfaceId: surface.id, kind, rect, keepClearMm: 0, label: kind[0].toUpperCase() + kind.slice(1), source: "estimate" },
      ],
    });
    setSelection({ type: "mark", id });
  }

  function addBlock() {
    const id = nextId("block", doc.blocks.map((b) => b.id));
    const xs = walls.map((w) => w.pose!.x);
    const ys = walls.map((w) => w.pose!.y);
    commit({
      ...doc,
      blocks: [
        ...doc.blocks,
        {
          id, label: "New piece", kind: "unit",
          x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2 - 300),
          y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2 - 300),
          w: 600, d: 600, bottom: 0, top: 700, color: "#b9b2a6", open: false, source: "estimate",
        },
      ],
    });
    setSelection({ type: "block", id });
    setMode("plan");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]" style={shellStyle}>
      <div className="lg:sticky lg:top-4 lg:self-start">
        {/* On a phone the name sits above the view, clear of the controls. */}
        <div className="mb-2 flex items-baseline justify-between gap-3 sm:sr-only">
          <h1 className="truncate text-lg">{wall ? wall.name : doc.name}</h1>
          <p className="eyebrow shrink-0">{dims}</p>
        </div>
        <div className="sky relative overflow-hidden border border-ink">
          <div ref={containerRef} className="h-[60dvh] w-full select-none lg:h-[calc(100dvh-8.5rem)]" />

          <div className="pointer-events-none absolute top-3 left-3 max-w-[55%] max-sm:hidden">
            <p className="text-xl leading-tight font-light tracking-[0.14em] uppercase">{wall ? wall.name : doc.name}</p>
            <p className="eyebrow mt-1">{dims}</p>
          </div>

          <div role="group" aria-label="Show" className="hud absolute top-3 right-3 flex">
            {(
              [
                ["photo", "Photo", "Show the scan's picture of each wall"],
                ["space", "Space", "Shade the clear wall space"],
                ...(scan ? [["scan", "Scan", "Show the scan itself, to check the model against"]] : []),
              ] as [keyof typeof show, string, string][]
            ).map(([key, label, title]) => (
              <button
                key={key}
                type="button"
                title={title}
                aria-pressed={show[key]}
                onClick={() => setChosen((s) => ({ ...s, [key]: !show[key] }))}
                className="hud-btn"
                style={{ "--way": "var(--ink)" } as CSSProperties}
              >
                {label}
              </button>
            ))}
          </div>

          {(failed || scanState) && (
            <p role="status" className="hud absolute top-16 right-3 px-3 py-2 text-xs">
              {failed ?? scanState}
            </p>
          )}

          <div className="absolute inset-x-3 bottom-3 flex flex-col items-start gap-2">
            <div role="group" aria-label="View" className="hud flex">
              {(
                [
                  ["orbit", "Room"],
                  ["plan", "Plan"],
                  ["inside", "Inside"],
                ] as [ModeKey, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={mode === key}
                  onClick={() => {
                    setMode(key);
                    setSelection(null);
                  }}
                  className="hud-btn"
                  style={{ "--way": "var(--ink)" } as CSSProperties}
                >
                  {label}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Face a wall" className="hud flex max-w-full overflow-x-auto">
              {walls.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  aria-pressed={wallId === w.id}
                  onClick={() => {
                    setMode(`wall:${w.id}`);
                    setSelection(null);
                  }}
                  className="hud-btn shrink-0 whitespace-nowrap"
                  style={{ "--way": `var(${wayOf(w.id)})` } as CSSProperties}
                >
                  <span className="swatch" style={wallId === w.id ? { background: "var(--paper)" } : undefined} />
                  {w.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="min-w-0 pb-6">
        {error && (
          <p role="alert" className="mb-3 border border-danger p-2 text-sm text-danger">
            {error}
          </p>
        )}
        {note && (
          <p role="status" className="mb-3 flex items-center justify-between gap-3 border border-ink p-2 text-sm">
            <span>{note}</span>
            {lastArranged.length > 0 && (
              <button type="button" className="btn btn-quiet shrink-0" onClick={undoArrange}>
                Undo
              </button>
            )}
          </p>
        )}

        {picture && pictureWall ? (
          <PicturePanel
            picture={picture}
            wall={pictureWall}
            way={wayOf(pictureWall.id)}
            issues={issues.map((i) => ({ text: i.message, bad: i.severity === "error" }))}
            onClose={() => setSelection(null)}
            onMove={(change) => {
              patchPlacement(picture.id, change);
              run(() => updatePlacementAction(picture.id, change));
            }}
            onPrint={(change) => {
              patchPlacement(picture.id, change);
              run(() => updatePlacementAction(picture.id, change));
            }}
            onUp={(up) => {
              patchPlacement(picture.id, { up });
              run(() => setUpAction(picture.id, up));
            }}
            onRemove={() => {
              setPlacements((all) => all.filter((p) => p.id !== picture.id));
              setSelection(null);
              run(() => removePlacementAction(picture.id));
            }}
          />
        ) : block ? (
          <section>
            <PanelHead title={block.label || "Furniture"} eyebrow="Furniture" onClose={() => setSelection(null)} />
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <TextField label="Name" value={block.label} onCommit={(label) => patchBlock(block.id, { label })} />
              </div>
              <NumberField label="Width, cm" value={block.w / 10} min={5} onCommit={(v) => patchBlock(block.id, { w: v * 10 })} />
              <NumberField label="Depth, cm" value={block.d / 10} min={5} onCommit={(v) => patchBlock(block.id, { d: v * 10 })} />
              <NumberField label="Height, cm" value={block.top / 10} min={5} onCommit={(v) => patchBlock(block.id, { top: Math.max(v * 10, block.bottom + 20) })} />
              <label className="flex items-end gap-2 pb-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--ink)]"
                  checked={block.open}
                  onChange={(event) => patchBlock(block.id, { open: event.target.checked })}
                />
                Open underneath
              </label>
            </div>
            <p className="mt-3 text-sm text-muted">
              {mode === "plan" ? "Drag it across the floor to move it." : "Switch to Plan to drag it across the floor."}{" "}
              The clear wall space updates as it moves.
            </p>
            <button
              type="button"
              className="btn btn-danger mt-4"
              onClick={() => {
                commit({ ...doc, blocks: doc.blocks.filter((b) => b.id !== block.id) });
                setSelection(null);
              }}
            >
              Remove from the room
            </button>
          </section>
        ) : mark ? (
          <section>
            <PanelHead title={mark.label || mark.kind} eyebrow="Marked on the wall" onClose={() => setSelection(null)} />
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <TextField label="Name" value={mark.label} onCommit={(label) => patchMark(mark.id, { label })} />
              </div>
              <label className="col-span-2">
                <span className="label">What it is</span>
                <select
                  className="field"
                  value={mark.kind}
                  onChange={(event) => patchMark(mark.id, { kind: event.target.value as Fixture["kind"] })}
                >
                  {FIXTURE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k[0].toUpperCase() + k.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <NumberField label="From the left, cm" value={mark.rect.u / 10} onCommit={(v) => patchMark(mark.id, { rect: { ...mark.rect, u: v * 10 } })} />
              <NumberField label="From the floor, cm" value={mark.rect.v / 10} onCommit={(v) => patchMark(mark.id, { rect: { ...mark.rect, v: v * 10 } })} />
              <NumberField label="Width, cm" value={mark.rect.w / 10} min={2} onCommit={(v) => patchMark(mark.id, { rect: { ...mark.rect, w: v * 10 } })} />
              <NumberField label="Height, cm" value={mark.rect.h / 10} min={2} onCommit={(v) => patchMark(mark.id, { rect: { ...mark.rect, h: v * 10 } })} />
              <NumberField label="Keep clear around it, cm" value={mark.keepClearMm / 10} onCommit={(v) => patchMark(mark.id, { keepClearMm: v * 10 })} />
            </div>
            <button
              type="button"
              className="btn btn-danger mt-4"
              onClick={() => {
                commit({ ...doc, fixtures: doc.fixtures.filter((f) => f.id !== mark.id) });
                setSelection(null);
              }}
            >
              Remove this mark
            </button>
          </section>
        ) : wall ? (
          <WallPanel
            wall={wall}
            way={wayOf(wall.id)}
            space={spaces.get(wall.id)!}
            marks={doc.fixtures.filter((f) => f.surfaceId === wall.id)}
            placements={placements.filter((p) => p.surfaceId === wall.id)}
            waiting={waiting}
            canPlace={(item) => sizeFor(item) !== null}
            highlight={start.place}
            onRename={(name) => patchWall(wall.id, { name })}
            onTape={(realWidthMm) =>
              run(async () => {
                await applyTapeAction(wall.id, realWidthMm);
                // Every size in the room has changed, so start again from the saved room.
                router.refresh();
              })
            }
            onMounts={(allowedMounts) => patchWall(wall.id, { allowedMounts })}
            onAdd={(item) => addToWall(item, wall)}
            onArrange={() => arrangeWall(wall)}
            onSelect={setSelection}
            onAddMark={(kind) => addMark(wall, kind)}
          />
        ) : mode === "inside" ? (
          <section>
            <PanelHead title="Inside" eyebrow="Standing in the room" />
            <p className="text-sm text-muted">
              Drag to look around. Tap the floor to walk there. Save where you
              stand, to check how a wall reads from where you actually sit.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {VIEW_NAMES.map((label) => (
                <button
                  key={label}
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    const pose = stage?.getInsidePose();
                    if (!pose) return;
                    run(() =>
                      saveViewpointAction({
                        label,
                        position: { x: pose.position[0] * 1000, y: pose.position[1] * 1000, z: pose.position[2] * 1000 },
                        yawDeg: pose.yawDeg,
                        pitchDeg: pose.pitchDeg,
                      }),
                    );
                    setNote(`Saved this view as “${label}”.`);
                  }}
                >
                  Save as {label.toLowerCase()}
                </button>
              ))}
            </div>
            {savedDoc.viewpoints.length > 0 && (
              <ul className="mt-4">
                {savedDoc.viewpoints.map((view) => (
                  <li key={view.id} className="row">
                    <button
                      type="button"
                      className="flex-1 text-left text-sm"
                      onClick={() =>
                        stage?.setMode({
                          type: "inside",
                          position: [view.offset.x / 1000, view.offset.y / 1000, view.offset.z / 1000],
                          yawDeg: view.yawDeg,
                          pitchDeg: view.pitchDeg,
                        })
                      }
                    >
                      {view.label}
                    </button>
                    <button
                      type="button"
                      className="eyebrow"
                      aria-label={`Forget ${view.label}`}
                      onClick={() => run(() => removeViewpointAction(view.id))}
                    >
                      Forget
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section>
            <p className="eyebrow mb-2">Walls</p>
            <ul>
              {walls.map((w) => {
                const space = spaces.get(w.id)!;
                const here = placements.filter((p) => p.surfaceId === w.id);
                return (
                  <li key={w.id}>
                    <button type="button" className="row" onClick={() => setMode(`wall:${w.id}`)}>
                      <span className="swatch" style={{ "--way": `var(${wayOf(w.id)})` } as CSSProperties} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{w.name}</span>
                        <span className="block text-xs text-muted">
                          {metres(surfaceBounds(w).w)} wide · {space.freeAreaM2.toFixed(1)} m² clear
                          {here.length > 0 && ` · ${here.length} up or planned`}
                        </span>
                      </span>
                      <span aria-hidden className="h-1.5 w-14 shrink-0 border border-line">
                        <span
                          className="block h-full"
                          style={{ width: `${Math.round(space.freeShare * 100)}%`, background: `var(${wayOf(w.id)})` }}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <p className="eyebrow mt-6 mb-2">Furniture</p>
            <ul>
              {doc.blocks.map((b) => (
                <li key={b.id}>
                  <button type="button" className="row" onClick={() => setSelection({ type: "block", id: b.id })}>
                    <span className="swatch border border-ink" style={{ background: b.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{b.label}</span>
                      <span className="block text-xs text-muted">
                        {cm(b.w)} × {cm(b.d)}, {cm(b.top)} high
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn btn-quiet" onClick={addBlock}>
                Add a piece
              </button>
              {mode !== "plan" && (
                <button type="button" className="btn btn-quiet" onClick={() => setMode("plan")}>
                  Move furniture
                </button>
              )}
            </div>

            <p className="eyebrow mt-6 mb-2">Things</p>
            <p className="text-sm text-muted">
              {placements.filter((p) => p.up).length} up, {placements.filter((p) => !p.up).length} planned,{" "}
              {waiting.filter((i) => i.kind === "thing").length} not on a wall yet.{" "}
              <Link href="/things" className="text-ink underline underline-offset-4">
                Add photos of your things
              </Link>
            </p>

            {scan && (
              <p className="rule mt-6 pt-3 text-xs text-muted">
                Sizes come from your scan
                {scan.tapeChecked ? ", checked with a tape." : ". "}
                {!scan.ceilingSeen &&
                  "The scan didn't catch the ceiling, so the height is the top of what it did see. "}
                {!scan.tapeChecked && "To check them, face a wall, choose Edit, and enter its width by tape. "}
                <Link href="/room/scan" className="text-ink underline underline-offset-4">
                  New scan
                </Link>
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function PanelHead({ title, eyebrow, onClose }: { title: string; eyebrow: string; onClose?: () => void }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="truncate text-base">{title}</h2>
      </div>
      {onClose && (
        <button type="button" className="eyebrow shrink-0 py-2" onClick={onClose}>
          Close
        </button>
      )}
    </div>
  );
}

function Thumb({ item, size = "size-14" }: { item: RoomItem; size?: string }) {
  const src = imageOf(item, "thumb");
  return src ? (
    <img src={src} alt="" className={`${size} shrink-0 border border-line object-cover`} />
  ) : (
    <span className={`${size} flex shrink-0 items-center overflow-hidden border border-line bg-card p-1 text-[0.55rem] leading-tight`}>
      {item.body}
    </span>
  );
}

function WallPanel({
  wall, way, space, marks, placements, waiting, canPlace, highlight,
  onRename, onTape, onMounts, onAdd, onArrange, onSelect, onAddMark,
}: {
  wall: Surface;
  way: string;
  space: ReturnType<typeof wallSpace>;
  marks: Fixture[];
  placements: RoomPlacement[];
  waiting: RoomItem[];
  canPlace: (item: RoomItem) => boolean;
  highlight: string | null;
  onRename: (name: string) => void;
  onTape: (realWidthMm: number) => void;
  onMounts: (mounts: Mount[]) => void;
  onAdd: (item: RoomItem) => void;
  onArrange: () => void;
  onSelect: (selection: Selection) => void;
  onAddMark: (kind: Fixture["kind"]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const best = space.free[0];
  const things = waiting.filter((i) => i.kind === "thing");
  const prints = waiting.filter((i) => i.kind !== "thing");
  const ready = things.filter(canPlace);
  // The thing you came here to place goes first.
  const ordered = [...things].sort((a, b) => Number(b.id === highlight) - Number(a.id === highlight));

  return (
    <section style={{ "--way": `var(${way})` } as CSSProperties}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-2">
            <span className="swatch" /> Facing
          </p>
          <h2 className="truncate text-base">{wall.name}</h2>
        </div>
        <button type="button" className="eyebrow shrink-0 py-2" onClick={() => setEditing((e) => !e)}>
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {editing && (
        <div className="mb-4 space-y-3 border border-line p-3">
          <TextField label="Name" value={wall.name} onCommit={onRename} />
          <div>
            <NumberField
              label="Width by tape measure, cm"
              value={surfaceBounds(wall).w / 10}
              min={50}
              onCommit={(v) => onTape(Math.round(v * 10))}
            />
            <p className="mt-1 text-xs text-muted">
              {wall.source === "tape"
                ? "Checked with a tape."
                : "From the scan. Measure this wall once and the whole room is corrected to match."}
            </p>
          </div>
          <fieldset>
            <legend className="label">What can go on it</legend>
            {MOUNTS.map((m) => (
              <label key={m} className="flex min-h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--ink)]"
                  checked={wall.allowedMounts.includes(m)}
                  onChange={(event) =>
                    onMounts(
                      event.target.checked
                        ? [...wall.allowedMounts, m]
                        : wall.allowedMounts.filter((x) => x !== m),
                    )
                  }
                />
                {MOUNT_LABELS[m]}
              </label>
            ))}
          </fieldset>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-line py-3">
        <div>
          <dt className="eyebrow">Clear space</dt>
          <dd className="text-lg font-light">
            {space.freeAreaM2.toFixed(1)} m² <span className="text-sm text-muted">{Math.round(space.freeShare * 100)}%</span>
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Biggest clear space</dt>
          <dd className="text-lg font-light">{best ? `${cm(best.w)} × ${cm(best.h)}` : "None"}</dd>
        </div>
        <div className="col-span-2">
          <dt className="eyebrow">Fixings</dt>
          <dd className="text-sm">
            {wall.allowedMounts.length ? wall.allowedMounts.map((m) => MOUNT_LABELS[m]).join(", ") : "Nothing allowed"}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex items-baseline justify-between">
        <p className="eyebrow">Not up yet</p>
        <Link href="/things" className="eyebrow underline underline-offset-4">
          Add things
        </Link>
      </div>
      {things.length === 0 && prints.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Everything you&apos;ve added is on a wall. Photograph more of your things to place them here.
        </p>
      ) : (
        <>
          <ul className="mt-2 flex gap-2 overflow-x-auto pb-2">
            {ordered.map((item) => {
              const ok = canPlace(item);
              return (
                <li key={item.id} className="shrink-0">
                  {ok ? (
                    <button
                      type="button"
                      onClick={() => onAdd(item)}
                      aria-label={`Put ${nameOf(item)} on ${wall.name}`}
                      className={`block ${item.id === highlight ? "outline outline-2 outline-offset-2 outline-[var(--way)]" : ""}`}
                    >
                      <Thumb item={item} size="size-20" />
                      <span className="mt-1 block w-20 truncate text-left text-xs">{nameOf(item)}</span>
                      <span className="block text-left text-[0.65rem] text-muted">
                        {cm(item.widthMm!)} × {cm(item.heightMm!)}
                      </span>
                    </button>
                  ) : (
                    <Link href={`/things/${item.id}`} className="block">
                      <Thumb item={item} size="size-20" />
                      <span className="mt-1 block w-20 truncate text-xs">{nameOf(item)}</span>
                      <span className="block text-[0.65rem] text-caution">Needs a size</span>
                    </Link>
                  )}
                </li>
              );
            })}
            {prints.map((item) => (
              <li key={item.id} className="shrink-0">
                <button type="button" onClick={() => onAdd(item)} aria-label={`Put this ${item.kind} on ${wall.name}`}>
                  <Thumb item={item} size="size-20" />
                  <span className="mt-1 block w-20 truncate text-left text-xs text-muted">To print</span>
                </button>
              </li>
            ))}
          </ul>
          {ready.length > 1 && (
            <button type="button" className="btn btn-primary mt-2 w-full" onClick={onArrange}>
              Arrange all {ready.length} here for me
            </button>
          )}
        </>
      )}

      <p className="eyebrow mt-6 mb-1">On this wall</p>
      {placements.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet. Tap something above to put it here.</p>
      ) : (
        <ul>
          {placements.map((p) => (
            <li key={p.id}>
              <button type="button" className="row" onClick={() => onSelect({ type: "picture", id: p.id })}>
                <Thumb item={p.content} size="size-10" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{nameOf(p.content)}</span>
                  <span className="block text-xs text-muted">
                    {cm(placementSize(p).w)} × {cm(placementSize(p).h)}
                  </span>
                </span>
                <span className="chip" style={p.up ? { borderColor: "var(--ink)" } : undefined}>
                  {p.up ? "Up" : "Planned"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="eyebrow mt-6 mb-1">Marked on this wall</p>
      <ul>
        {marks.map((f) => (
          <li key={f.id}>
            <button type="button" className="row" onClick={() => onSelect({ type: "mark", id: f.id })}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{f.label || f.kind}</span>
                <span className="block text-xs text-muted">
                  {cm(f.rect.w)} × {cm(f.rect.h)}, {cm(f.rect.u)} from the left
                </span>
              </span>
            </button>
          </li>
        ))}
        {space.obstacles
          .filter((o) => o.kind === "furniture" && !marks.some((f) => f.label === o.label))
          .map((o, i) => (
            <li key={`${o.label}-${i}`} className="row text-sm text-muted">
              <span className="flex-1">{o.label}, standing against it</span>
            </li>
          ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["door", "window", "shelf", "other"] as const).map((kind) => (
          <button key={kind} type="button" className="btn btn-quiet" onClick={() => onAddMark(kind)}>
            Mark a {kind === "other" ? "keep-clear area" : kind}
          </button>
        ))}
      </div>
    </section>
  );
}

function PicturePanel({
  picture, wall, way, issues, onClose, onMove, onPrint, onUp, onRemove,
}: {
  picture: RoomPlacement;
  wall: Surface;
  way: string;
  issues: { text: string; bad: boolean }[];
  onClose: () => void;
  onMove: (change: { u?: number; v?: number; mount?: Mount }) => void;
  onPrint: (change: { printSizeId?: string; orientation?: Orientation }) => void;
  onUp: (up: boolean) => void;
  onRemove: () => void;
}) {
  const size = placementSize(picture);
  const bounds = surfaceBounds(wall);
  const isThing = picture.content.kind === "thing";
  return (
    <section style={{ "--way": `var(${way})` } as CSSProperties}>
      <PanelHead title={nameOf(picture.content)} eyebrow={`On ${wall.name}`} onClose={onClose} />
      <div className="flex gap-3">
        <Thumb item={picture.content} size="size-24" />
        <dl className="min-w-0 flex-1 text-sm">
          <dt className="eyebrow">Size</dt>
          <dd>
            {cm(size.w)} × {cm(size.h)}
          </dd>
          <dt className="eyebrow mt-2">Top edge</dt>
          <dd>{cm(picture.v + size.h)} from the floor</dd>
        </dl>
      </div>

      {issues.length > 0 && (
        <ul className="mt-3 space-y-1">
          {issues.map((issue) => (
            <li key={issue.text} className={`text-sm ${issue.bad ? "text-danger" : "text-caution"}`}>
              {issue.text}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <NumberField
          label="From the left, cm"
          value={picture.u / 10}
          onCommit={(v) => onMove({ u: clampTo(v * 10, bounds.w - size.w) })}
        />
        <NumberField
          label="From the floor, cm"
          value={picture.v / 10}
          onCommit={(v) => onMove({ v: clampTo(v * 10, bounds.h - size.h) })}
        />
        {!isThing && (
          <>
            <label>
              <span className="label">Print size</span>
              <select
                className="field"
                value={picture.printSizeId}
                onChange={(event) => onPrint({ printSizeId: event.target.value })}
              >
                {PRINT_SIZES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Turned</span>
              <select
                className="field"
                value={picture.orientation}
                onChange={(event) => onPrint({ orientation: event.target.value as Orientation })}
              >
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </label>
          </>
        )}
        <label className="col-span-2">
          <span className="label">Fixed with</span>
          <select
            className="field"
            value={picture.mount}
            onChange={(event) => onMove({ mount: event.target.value as Mount })}
          >
            {wall.allowedMounts.map((m) => (
              <option key={m} value={m}>
                {MOUNT_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div role="group" aria-label="Is it up?" className="mt-4 flex border border-ink">
        {[
          [false, "Planned"],
          [true, "Already up"],
        ].map(([value, label]) => (
          <button
            key={String(label)}
            type="button"
            aria-pressed={picture.up === value}
            onClick={() => onUp(value as boolean)}
            className="hud-btn flex-1"
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        Drag it on the wall to move it. It lines up with its neighbours and the wall&apos;s centre.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {isThing && (
          <Link href={`/things/${picture.content.id}`} className="btn btn-quiet">
            Edit this thing
          </Link>
        )}
        <button type="button" className="btn btn-danger" onClick={onRemove}>
          Take it off the wall
        </button>
      </div>
    </section>
  );
}
