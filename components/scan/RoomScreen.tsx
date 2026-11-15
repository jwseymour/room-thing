"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  addPlacementAction,
  removePlacementAction,
  updatePlacementAction,
} from "@/lib/actions/room";
import {
  removeViewpointAction,
  saveViewpointAction,
  setPinBoardAction,
} from "@/lib/actions/scan";
import { surfaceBounds } from "@/lib/room/geometry";
import {
  orientationFor,
  PRINT_SIZES,
  printDimensions,
  type Orientation,
} from "@/lib/room/print";
import { MOUNT_LABELS, type Mount, type RoomDocument } from "@/lib/room/schema";
import { snapRect } from "@/lib/room/snap";
import { defaultMount, validatePlacement, type PlacedRect } from "@/lib/room/validate";
import type { StagePick, StagePicture, StageView } from "@/lib/scan/stage";
import { stageSurfaces } from "./AlignScreen";
import { statusText, useRoomStage } from "./useRoomStage";

export type RoomItem = {
  id: string;
  kind: "photo" | "quote" | "reminder";
  body: string | null;
  attribution: string | null;
  widthPx: number | null;
  heightPx: number | null;
};

export type RoomPlacement = {
  id: string;
  surfaceId: string;
  content: RoomItem;
  printSizeId: string;
  orientation: Orientation;
  u: number;
  v: number;
  mount: Mount;
};

type Selection =
  | { type: "wall"; surfaceId: string; u: number; v: number }
  | { type: "picture"; id: string }
  | null;

const VIEW_NAMES = ["Lying in bed", "At the desk", "In the doorway"];

const sizeOf = (p: RoomPlacement) => printDimensions(p.printSizeId, p.orientation);
const toPlaced = (p: RoomPlacement): PlacedRect => ({
  id: p.id,
  mount: p.mount,
  rect: { u: p.u, v: p.v, ...sizeOf(p) },
});
const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(value, 0), Math.max(max, 0)));

export function RoomScreen({
  scan,
  matrix,
  doc,
  initialPlacements,
  tray,
}: {
  scan: { id: string; fileType: string; sample: boolean; tapeChecked: boolean };
  matrix: number[];
  doc: RoomDocument;
  initialPlacements: RoomPlacement[];
  tray: RoomItem[];
}) {
  const [placements, setPlacements] = useState(initialPlacements);
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<StageView>("inside");
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [, startTransition] = useTransition();

  const surfaces = useMemo(() => stageSurfaces(doc), [doc]);
  const walls = doc.surfaces.filter((s) => s.kind === "wall" && s.pose);
  const box = useMemo(
    () => ({
      w: walls[0] ? surfaceBounds(walls[0]).w / 1000 : 4,
      d: walls[1] ? surfaceBounds(walls[1]).w / 1000 : 4,
      h: doc.ceilingMm / 1000,
    }),
    // The walls come from `doc`, which is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc],
  );

  const save = (task: () => Promise<unknown>) => {
    setError(null);
    startTransition(async () => {
      try {
        await task();
      } catch {
        setError("That didn't save. Is the laptop still on?");
      }
    });
  };
  const patch = (id: string, change: Partial<RoomPlacement>) =>
    setPlacements((all) => all.map((p) => (p.id === id ? { ...p, ...change } : p)));

  function onTap(pick: StagePick) {
    if (pick?.type === "picture") setSelection({ type: "picture", id: pick.id });
    else if (pick?.type === "surface") setSelection({ ...pick, type: "wall" });
    else setSelection(null);
  }

  function onPictureDrag(id: string, u: number, v: number) {
    const moving = placements.find((p) => p.id === id);
    const surface = moving && doc.surfaces.find((s) => s.id === moving.surfaceId);
    if (!moving || !surface) return;
    const others = placements
      .filter((p) => p.surfaceId === moving.surfaceId && p.id !== id)
      .map((p) => toPlaced(p).rect);
    const snapped = snapRect({ u, v, ...sizeOf(moving) }, others, surfaceBounds(surface));
    setSelection({ type: "picture", id });
    patch(id, { u: Math.round(snapped.u), v: Math.round(snapped.v) });
  }

  function onPictureDrop(id: string) {
    const moved = placements.find((p) => p.id === id);
    if (moved) save(() => updatePlacementAction(id, { u: moved.u, v: moved.v }));
  }

  const { containerRef, stage, status } = useRoomStage(scan, {
    onTap,
    onPictureDrag,
    onPictureDrop,
  });

  useEffect(() => {
    if (!stage) return;
    stage.setAlignment(matrix, box);
    stage.setSurfaces(surfaces);
  }, [stage, matrix, box, surfaces]);

  useEffect(() => {
    if (!stage) return;
    const pictures: StagePicture[] = placements.map((p) => ({
      id: p.id,
      surfaceId: p.surfaceId,
      u: p.u,
      v: p.v,
      ...sizeOf(p),
      imageUrl: p.content.kind === "photo" ? `/api/media/${p.content.id}/card` : null,
      body: p.content.body,
      attribution: p.content.attribution,
    }));
    stage.setPictures(pictures, selection?.type === "picture" ? selection.id : null);
  }, [stage, placements, selection]);

  useEffect(() => {
    stage?.setView(view);
  }, [stage, view]);

  const selectedPicture =
    selection?.type === "picture" ? placements.find((p) => p.id === selection.id) : undefined;
  const selectedWall =
    selection?.type === "wall" ? doc.surfaces.find((s) => s.id === selection.surfaceId) : undefined;
  const pictureSurface =
    selectedPicture && doc.surfaces.find((s) => s.id === selectedPicture.surfaceId);
  const issues =
    selectedPicture && pictureSurface
      ? validatePlacement(
          toPlaced(selectedPicture),
          pictureSurface,
          doc.fixtures,
          placements.filter((p) => p.surfaceId === pictureSurface.id).map(toPlaced),
        )
      : [];
  const onAWall = new Set(placements.map((p) => p.content.id));
  const available = tray.filter((item) => !onAWall.has(item.id));

  function addToWall(item: RoomItem) {
    if (selection?.type !== "wall" || !selectedWall) return;
    const mount = defaultMount(selectedWall);
    if (!mount) {
      setError(`Nothing can be mounted on ${selectedWall.name}.`);
      return;
    }
    const orientation =
      item.widthPx && item.heightPx ? orientationFor(item.widthPx, item.heightPx) : "landscape";
    const printSizeId = item.kind === "photo" ? "6x4" : "a5";
    const size = printDimensions(printSizeId, orientation);
    const bounds = surfaceBounds(selectedWall);
    // Centred on the spot that was tapped.
    const u = clamp(selection.u - size.w / 2, bounds.w - size.w);
    const v = clamp(selection.v - size.h / 2, bounds.h - size.h);
    const surfaceId = selectedWall.id;
    setError(null);
    startTransition(async () => {
      try {
        const id = await addPlacementAction({
          surfaceId, contentId: item.id, printSizeId, orientation, u, v, mount,
        });
        setPlacements((all) => [
          ...all,
          { id, surfaceId, content: item, printSizeId, orientation, u, v, mount },
        ]);
        setSelection({ type: "picture", id });
      } catch {
        setError("That didn't save. Is the laptop still on?");
      }
    });
  }

  function saveView(label: string) {
    if (!stage) return;
    const pose = stage.getPose();
    setNaming(false);
    save(() =>
      saveViewpointAction({
        label,
        position: {
          x: pose.position[0] * 1000,
          y: pose.position[1] * 1000,
          z: pose.position[2] * 1000,
        },
        yawDeg: pose.yawDeg,
        pitchDeg: pose.pitchDeg,
      }),
    );
  }

  const loading = statusText(status);

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-line bg-black">
        <div ref={containerRef} className="h-[58dvh] w-full select-none" />
        {loading && (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white"
          >
            {loading}
          </p>
        )}
        <div role="group" aria-label="View" className="absolute top-2 left-2 flex gap-1">
          {(["inside", "above"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`btn ${view === v ? "btn-primary" : ""}`}
            >
              {v === "above" ? "From above" : "Inside"}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-sm text-muted">
        Drag to look around, tap the floor to walk there, and pinch to move
        forwards or back. Tap a wall to put something on it.
      </p>
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}

      {selectedWall && selection?.type === "wall" && (
        <section className="mt-3 rounded-lg border border-accent bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg">{selectedWall.name}</h2>
              <p className="text-sm text-muted">
                {(surfaceBounds(selectedWall).w / 1000).toFixed(2)} m wide ·{" "}
                {selectedWall.allowedMounts.map((m) => MOUNT_LABELS[m]).join(", ")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!selectedWall.allowedMounts.includes("pin") && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => save(() => setPinBoardAction(selectedWall.id))}
                >
                  This is the pin board
                </button>
              )}
              <Link href={`/walls/${selectedWall.id}`} className="btn">
                Plan it flat
              </Link>
            </div>
          </div>
          <h3 className="mt-3 mb-1 text-sm font-medium">Put here</h3>
          {available.length === 0 ? (
            <p className="text-sm text-muted">
              {tray.length === 0 ? (
                <>
                  Nothing kept yet.{" "}
                  <Link href="/library" className="underline">
                    Add some photos
                  </Link>{" "}
                  and sort them.
                </>
              ) : (
                "Everything you've kept is already up."
              )}
            </p>
          ) : (
            <ul className="flex gap-1 overflow-x-auto pb-1">
              {available.map((item) => (
                <li key={item.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => addToWall(item)}
                    aria-label={`Put this ${item.kind} on ${selectedWall.name}`}
                    className="block size-20 overflow-hidden rounded bg-paper"
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
      )}

      {selectedPicture && pictureSurface && (
        <section className="mt-3 space-y-3 rounded-lg border border-accent bg-card p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="label">Print size</span>
              <select
                className="field"
                value={selectedPicture.printSizeId}
                onChange={(event) => {
                  const printSizeId = event.target.value;
                  patch(selectedPicture.id, { printSizeId });
                  save(() => updatePlacementAction(selectedPicture.id, { printSizeId }));
                }}
              >
                {PRINT_SIZES.map((size) => (
                  <option key={size.id} value={size.id}>
                    {size.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const orientation: Orientation =
                  selectedPicture.orientation === "landscape" ? "portrait" : "landscape";
                patch(selectedPicture.id, { orientation });
                save(() => updatePlacementAction(selectedPicture.id, { orientation }));
              }}
            >
              Turn
            </button>
            <Link href={`/walls/${pictureSurface.id}`} className="btn">
              Plan it flat
            </Link>
            <button
              type="button"
              className="btn btn-danger ml-auto"
              onClick={() => {
                const { id } = selectedPicture;
                setPlacements((all) => all.filter((p) => p.id !== id));
                setSelection(null);
                save(() => removePlacementAction(id));
              }}
            >
              Take down
            </button>
          </div>
          <p className="text-sm text-muted">
            On {pictureSurface.name}, {selectedPicture.u.toLocaleString("en-GB")} mm from its left
            and {selectedPicture.v.toLocaleString("en-GB")} mm up. Drag it to move it.
          </p>
          {issues.map((issue, index) => (
            <p
              key={index}
              className={`text-sm ${issue.severity === "error" ? "text-danger" : "text-caution"}`}
            >
              {issue.message}
            </p>
          ))}
        </section>
      )}

      <section className="mt-4">
        <h2 className="mb-1 text-lg">See it from</h2>
        <div className="flex flex-wrap gap-1">
          {doc.viewpoints.map((point) => (
            <span key={point.id} className="flex">
              <button
                type="button"
                className="btn rounded-r-none"
                onClick={() => {
                  setView("inside");
                  stage?.lookFrom(
                    [point.offset.x / 1000, point.offset.y / 1000, point.offset.z / 1000],
                    point.yawDeg,
                    point.pitchDeg,
                  );
                }}
              >
                {point.label}
              </button>
              <button
                type="button"
                aria-label={`Forget ${point.label}`}
                className="btn rounded-l-none border-l-0 px-2 text-muted"
                onClick={() => save(() => removeViewpointAction(point.id))}
              >
                ×
              </button>
            </span>
          ))}
          {naming ? (
            <form
              className="flex flex-wrap gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                const label = String(new FormData(event.currentTarget).get("label") ?? "").trim();
                if (label) saveView(label);
              }}
            >
              {VIEW_NAMES.filter((n) => !doc.viewpoints.some((p) => p.label === n)).map((name) => (
                <button key={name} type="button" className="btn" onClick={() => saveView(name)}>
                  {name}
                </button>
              ))}
              <input name="label" aria-label="Name this view" placeholder="Or name it" className="field w-36" />
              <button type="submit" className="btn btn-primary">
                Save
              </button>
            </form>
          ) : (
            <button type="button" className="btn" disabled={!stage} onClick={() => setNaming(true)}>
              Save where I&apos;m standing
            </button>
          )}
        </div>
      </section>

      <section className="mt-5">
        <h2 className="mb-1 text-lg">Walls</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {doc.surfaces.map((surface) => {
            const count = placements.filter((p) => p.surfaceId === surface.id).length;
            return (
              <li
                key={surface.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-line bg-card p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{surface.name}</p>
                  <p className="text-sm text-muted">
                    {(surfaceBounds(surface).w / 1000).toFixed(2)} m · {count}{" "}
                    {count === 1 ? "item" : "items"} ·{" "}
                    {surface.allowedMounts.includes("pin") ? "pins" : "no marks"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {surface.pose && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setView("inside");
                        stage?.faceSurface(surface.id);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Look
                    </button>
                  )}
                  <Link href={`/walls/${surface.id}`} className="btn">
                    Flat
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <Link href="/room/align" className="underline">
          {scan.tapeChecked ? "Adjust the line-up" : "Check the scan with a tape"}
        </Link>
        <Link href="/room/scan" className="underline">
          {scan.sample ? "Add your own scan" : "Replace the scan"}
        </Link>
        <Link href="/room/edit" className="underline">
          Windows, radiators and sockets
        </Link>
      </p>
    </div>
  );
}
