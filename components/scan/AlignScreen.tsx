"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { saveAlignmentAction } from "@/lib/actions/scan";
import { surfaceBounds } from "@/lib/room/geometry";
import type { RoomDocument } from "@/lib/room/schema";
import { adjustedFit, NO_ADJUSTMENT, type Adjustment } from "@/lib/scan/adjust";
import { fitRoom, type RoomFit, type UpAxis } from "@/lib/scan/fit";
import { applyBoxToRoom, surfaceFrame } from "@/lib/scan/frame";
import type { StageSurface, StageView } from "@/lib/scan/stage";
import { statusText, useRoomStage } from "./useRoomStage";

const STEP_M = 0.02;

const UP_LABELS: Record<UpAxis, string> = {
  "y+": "As it is",
  "y-": "Upside down",
  "z+": "On its back",
  "z-": "On its front",
};

type Side = "left" | "right" | "near" | "far" | "floor" | "ceiling";
type TapeTarget = "width" | "depth" | "height";

const metres = (m: number) => `${m.toFixed(2)} m`;

export function stageSurfaces(doc: RoomDocument): StageSurface[] {
  return doc.surfaces.flatMap((surface) => {
    const frame = surfaceFrame(surface);
    if (!frame) return [];
    const { w, h } = surfaceBounds(surface);
    return [{ id: surface.id, name: surface.name, frame, widthMm: w, heightMm: h }];
  });
}

export function AlignScreen({
  scan,
  doc,
  savedTapeScale,
}: {
  scan: { id: string; fileType: string; filename: string };
  doc: RoomDocument;
  savedTapeScale: number;
}) {
  const router = useRouter();
  const { containerRef, stage, status } = useRoomStage(scan, {});
  const [centres, setCentres] = useState<Float32Array | null>(null);
  const [up, setUp] = useState<UpAxis | undefined>(undefined);
  const [adjust, setAdjust] = useState<Adjustment>({
    ...NO_ADJUSTMENT,
    tapeScale: savedTapeScale,
  });
  const [view, setView] = useState<StageView>("above");
  const [tape, setTape] = useState<{ target: TapeTarget; mm: string }>({
    target: "width",
    mm: "",
  });
  const [tapeChecked, setTapeChecked] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!stage || status.state !== "ready") return;
    let cancelled = false;
    stage.centres().then((points) => {
      if (!cancelled) setCentres(points);
    });
    return () => {
      cancelled = true;
    };
  }, [stage, status.state]);

  const fit: RoomFit | null = useMemo(
    () => (centres && centres.length >= 300 ? fitRoom(centres, up) : null),
    [centres, up],
  );
  const final = useMemo(() => (fit ? adjustedFit(fit, adjust) : null), [fit, adjust]);
  const fittedDoc = useMemo(
    () =>
      final
        ? applyBoxToRoom(doc, {
            widthMm: final.w * 1000,
            depthMm: final.d * 1000,
            heightMm: final.h * 1000,
          })
        : null,
    [doc, final],
  );
  const walls = fittedDoc?.surfaces.filter((s) => s.kind === "wall") ?? [];

  useEffect(() => {
    if (!stage || !final || !fittedDoc) return;
    stage.setAlignment(final.matrix, { w: final.w, d: final.d, h: final.h });
    stage.setSurfaces(stageSurfaces(fittedDoc));
  }, [stage, final, fittedDoc]);

  useEffect(() => {
    stage?.setView(view);
  }, [stage, view]);

  const nudge = (side: Side, by: number) =>
    setAdjust((a) => ({ ...a, [side]: a[side] + by }));

  function applyTape() {
    if (!fit) return;
    const mm = Number(tape.mm);
    if (!Number.isFinite(mm) || mm < 500) {
      setError("Enter the distance in millimetres, for example 3420.");
      return;
    }
    const unscaled = adjustedFit(fit, { ...adjust, tapeScale: 1 });
    const model = { width: unscaled.w, depth: unscaled.d, height: unscaled.h }[tape.target];
    const tapeScale = mm / 1000 / model;
    if (tapeScale < 0.8 || tapeScale > 1.25) {
      setError(
        "That's more than 20% away from the scan, which usually means the wrong wall, or walls that need moving first.",
      );
      return;
    }
    setError(null);
    setAdjust((a) => ({ ...a, tapeScale }));
    setTapeChecked(true);
  }

  async function save() {
    if (!stage || !fit || !final || !fittedDoc) return;
    setError(null);
    setSaving("Saving the room");
    try {
      await saveAlignmentAction(scan.id, {
        alignment: { matrix: final.matrix, up: fit.up, tapeScale: adjust.tapeScale },
        box: { widthMm: final.w * 1000, depthMm: final.d * 1000, heightMm: final.h * 1000 },
        tapeChecked,
      });
      // A flat picture of each wall, for planning on.
      const surfaces = stageSurfaces(fittedDoc);
      for (const [index, surface] of surfaces.entries()) {
        setSaving(`Drawing wall ${index + 1} of ${surfaces.length}`);
        const image = await stage.captureWall(surface);
        await fetch(`/api/scan/${scan.id}/wall/${encodeURIComponent(surface.id)}`, {
          method: "PUT",
          body: image,
        });
      }
      router.push("/room");
    } catch {
      setSaving(null);
      setError("That didn't save. Is the laptop still on?");
    }
  }

  const loading = statusText(status);
  const unsure = fit && (fit.confidence.walls < 0.08 || fit.confidence.floor < 0.15);
  const sides: { side: Side; label: string }[] = [
    { side: "near", label: walls[0]?.name ?? "Wall A" },
    { side: "right", label: walls[1]?.name ?? "Wall B" },
    { side: "far", label: walls[2]?.name ?? "Wall C" },
    { side: "left", label: walls[3]?.name ?? "Wall D" },
    { side: "floor", label: "Floor" },
    { side: "ceiling", label: "Ceiling" },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/room/scan" className="text-sm text-muted">
        ← Scan
      </Link>
      <h1 className="text-3xl">Line up the room</h1>
      <p className="mt-1 mb-3 text-muted">
        The green outline is where the app thinks your walls are. If it sits on
        the walls in the scan, you&apos;re done.
      </p>

      <div className="relative overflow-hidden rounded-lg border border-line bg-black">
        <div ref={containerRef} className="h-[52dvh] w-full select-none" />
        {(loading || (status.state === "ready" && !fit)) && (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white"
          >
            {loading ?? "Finding the walls"}
          </p>
        )}
        <div role="group" aria-label="View" className="absolute top-2 left-2 flex gap-1">
          {(["above", "inside"] as const).map((v) => (
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

      {final && (
        <p className="mt-2 text-sm">
          <span className="font-medium">
            {metres(final.w)} × {metres(final.d)}, {metres(final.h)} high
          </span>
          <span className="text-muted">
            {" "}
            · {tapeChecked || savedTapeScale !== 1 ? "checked with a tape" : "from the scan alone"}
          </span>
        </p>
      )}
      {unsure && (
        <p className="mt-1 text-sm text-caution">
          The walls weren&apos;t clear in this scan, so check the outline
          carefully. A slower scan that reaches every corner helps.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!final || saving !== null}
          onClick={save}
        >
          {saving ?? "Looks right, use it"}
        </button>
      </div>

      <details className="mt-4 rounded-lg border border-line bg-card">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">
          Check it against a tape measure
        </summary>
        <div className="space-y-2 p-3 pt-0 text-sm">
          <p className="text-muted">
            A phone scan is usually right to within two or three centimetres
            across a room. Measure one distance and the whole room is corrected
            to match.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="label">I measured</span>
              <select
                className="field"
                value={tape.target}
                onChange={(event) =>
                  setTape((t) => ({ ...t, target: event.target.value as TapeTarget }))
                }
              >
                <option value="width">
                  {walls[0]?.name ?? "Wall A"}, corner to corner
                </option>
                <option value="depth">
                  {walls[1]?.name ?? "Wall B"}, corner to corner
                </option>
                <option value="height">Floor to ceiling</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Millimetres</span>
              <input
                className="field w-32"
                inputMode="numeric"
                value={tape.mm}
                onChange={(event) => setTape((t) => ({ ...t, mm: event.target.value }))}
              />
            </label>
            <button type="button" className="btn" onClick={applyTape} disabled={!fit}>
              Apply
            </button>
          </div>
        </div>
      </details>

      <details className="mt-2 rounded-lg border border-line bg-card">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">
          The outline is off
        </summary>
        <div className="space-y-4 p-3 pt-0 text-sm">
          <div>
            <p className="label">The scan is</p>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                aria-pressed={up === undefined}
                onClick={() => setUp(undefined)}
                className={`btn ${up === undefined ? "btn-primary" : ""}`}
              >
                Work it out
              </button>
              {(Object.keys(UP_LABELS) as UpAxis[]).map((axis) => (
                <button
                  key={axis}
                  type="button"
                  aria-pressed={up === axis}
                  onClick={() => setUp(axis)}
                  className={`btn ${up === axis ? "btn-primary" : ""}`}
                >
                  {UP_LABELS[axis]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label">Move a surface, 2 cm at a time</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {sides.map(({ side, label }) => (
                <li key={side} className="flex items-center justify-between gap-2">
                  <span>{label}</span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Move ${label} in`}
                      onClick={() => nudge(side, -STEP_M)}
                    >
                      In
                    </button>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Move ${label} out`}
                      onClick={() => nudge(side, STEP_M)}
                    >
                      Out
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span>Turn the outline</span>
            <span className="flex gap-1">
              <button
                type="button"
                className="btn"
                onClick={() => setAdjust((a) => ({ ...a, turnDeg: a.turnDeg - 0.5 }))}
              >
                ↺ ½°
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setAdjust((a) => ({ ...a, turnDeg: a.turnDeg + 0.5 }))}
              >
                ↻ ½°
              </button>
            </span>
          </div>

          <button
            type="button"
            className="min-h-9 text-muted underline"
            onClick={() => setAdjust({ ...NO_ADJUSTMENT, tapeScale: adjust.tapeScale })}
          >
            Undo these changes
          </button>
        </div>
      </details>

      <p className="mt-3 text-xs text-muted">{scan.filename}</p>
    </div>
  );
}
