"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveRoomAction } from "@/lib/actions/room";
import {
  ACCURACY_TARGET_MM,
  heldOutError,
  modelDistanceMm,
  surfaceBounds,
} from "@/lib/room/geometry";
import {
  FIXTURE_KINDS,
  MOUNT_LABELS,
  MOUNTS,
  rectPolygon,
  roomDocumentSchema,
  type EdgeRef,
  type Fixture,
  type Measurement,
  type Mount,
  type RoomDocument,
  type Source,
  type Surface,
} from "@/lib/room/schema";

const newId = () => crypto.randomUUID();

const SOURCE_LABELS: Record<Source, string> = {
  estimate: "Estimate",
  tape: "Tape",
  scan: "Scan",
};

const KEEP_CLEAR_DEFAULTS: Partial<Record<Fixture["kind"], number>> = {
  radiator: 100,
  socket: 50,
  switch: 50,
  door: 50,
  window: 50,
};

const SIDE_LABELS: Record<EdgeRef["side"], string> = {
  left: "left edge",
  right: "right edge",
  bottom: "bottom edge",
  top: "top edge",
};

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={Number.isFinite(value) ? value : ""}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        className="field"
      />
    </label>
  );
}

export function RoomEditor({
  initial,
  version,
}: {
  initial: RoomDocument;
  version: number;
}) {
  const [doc, setDoc] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [savedVersion, setSavedVersion] = useState(version);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  function change(next: (current: RoomDocument) => RoomDocument) {
    setDoc(next);
    setDirty(true);
    setMessage(null);
  }

  const updateSurface = (id: string, patch: Partial<Surface>) =>
    change((d) => ({
      ...d,
      surfaces: d.surfaces.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));

  const updateFixture = (id: string, patch: Partial<Fixture>) =>
    change((d) => ({
      ...d,
      fixtures: d.fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));

  const removeFixture = (id: string) =>
    change((d) => ({
      ...d,
      fixtures: d.fixtures.filter((f) => f.id !== id),
      measurements: d.measurements.filter(
        (m) => m.refA.target !== id && m.refB.target !== id,
      ),
    }));

  const updateMeasurement = (id: string, patch: Partial<Measurement>) =>
    change((d) => ({
      ...d,
      measurements: d.measurements.map((m) =>
        m.id === id ? { ...m, ...patch } : m,
      ),
    }));

  function save() {
    const parsed = roomDocumentSchema.safeParse(doc);
    if (!parsed.success) {
      setMessage("Some numbers are missing or not valid. Check the empty fields.");
      return;
    }
    startTransition(async () => {
      try {
        const saved = await saveRoomAction(parsed.data);
        setSavedVersion(saved.version);
        setDirty(false);
        setMessage("Saved.");
      } catch {
        setMessage("That didn't save. Is the laptop still on?");
      }
    });
  }

  const accuracy = heldOutError(doc);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/room" className="text-sm text-muted">
        ← Room
      </Link>
      <h1 className="mb-1 text-3xl">Room details</h1>
      <p className="mb-4 text-sm text-muted">
        Wall sizes come from your scan. Add the things pictures must keep
        clear of here: windows, radiators, sockets and switches. All sizes are
        in millimetres, and anything you type in overrides the scan.
      </p>

      <div className="mb-6 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="label">Room name</span>
          <input
            value={doc.name}
            onChange={(event) => {
              const name = event.target.value;
              change((d) => ({ ...d, name }));
            }}
            className="field"
          />
        </label>
        <NumberField
          label="Ceiling height"
          value={doc.ceilingMm}
          onChange={(ceilingMm) => change((d) => ({ ...d, ceilingMm }))}
        />
      </div>

      <div className="space-y-4">
        {doc.surfaces.map((surface) => {
          const { w, h } = surfaceBounds(surface);
          const fixtures = doc.fixtures.filter(
            (f) => f.surfaceId === surface.id,
          );
          return (
            <section
              key={surface.id}
              aria-label={surface.name}
              className="rounded-lg border border-line bg-card p-3"
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="col-span-2 block">
                  <span className="label">Surface</span>
                  <input
                    value={surface.name}
                    onChange={(event) =>
                      updateSurface(surface.id, { name: event.target.value })
                    }
                    className="field"
                  />
                </label>
                <NumberField
                  label="Width"
                  value={w}
                  onChange={(value) =>
                    updateSurface(surface.id, {
                      polygon: rectPolygon(value, h),
                    })
                  }
                />
                <NumberField
                  label="Height"
                  value={h}
                  onChange={(value) =>
                    updateSurface(surface.id, {
                      polygon: rectPolygon(w, value),
                    })
                  }
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <label className="flex items-center gap-2 text-sm">
                  Size from
                  <select
                    value={surface.source}
                    onChange={(event) =>
                      updateSurface(surface.id, {
                        source: event.target.value as Source,
                      })
                    }
                    className="field w-auto"
                  >
                    {(Object.keys(SOURCE_LABELS) as Source[]).map((source) => (
                      <option key={source} value={source}>
                        {SOURCE_LABELS[source]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset className="mt-3">
                <legend className="label">Allowed here</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {MOUNTS.map((mount: Mount) => (
                    <label
                      key={mount}
                      className="flex min-h-9 items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={surface.allowedMounts.includes(mount)}
                        onChange={(event) =>
                          updateSurface(surface.id, {
                            allowedMounts: event.target.checked
                              ? [...surface.allowedMounts, mount]
                              : surface.allowedMounts.filter(
                                  (m) => m !== mount,
                                ),
                          })
                        }
                      />
                      {MOUNT_LABELS[mount]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <h2 className="mt-4 text-lg">On this surface</h2>
              <p className="mb-2 text-xs text-muted">
                Left is measured from the left of the surface as you face it,
                bottom from the floor.
              </p>
              <ul className="space-y-3">
                {fixtures.map((fixture) => (
                  <li
                    key={fixture.id}
                    className="rounded border border-line p-2"
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="label">Type</span>
                        <select
                          value={fixture.kind}
                          onChange={(event) => {
                            const kind = event.target.value as Fixture["kind"];
                            updateFixture(fixture.id, {
                              kind,
                              keepClearMm: KEEP_CLEAR_DEFAULTS[kind] ?? 0,
                            });
                          }}
                          className="field capitalize"
                        >
                          {FIXTURE_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {kind}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="label">Label</span>
                        <input
                          value={fixture.label}
                          onChange={(event) =>
                            updateFixture(fixture.id, {
                              label: event.target.value,
                            })
                          }
                          className="field"
                        />
                      </label>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {(
                        [
                          ["Left", "u"],
                          ["Bottom", "v"],
                          ["Width", "w"],
                          ["Height", "h"],
                        ] as const
                      ).map(([label, key]) => (
                        <NumberField
                          key={key}
                          label={label}
                          value={fixture.rect[key]}
                          onChange={(value) =>
                            updateFixture(fixture.id, {
                              rect: { ...fixture.rect, [key]: value },
                            })
                          }
                        />
                      ))}
                      <NumberField
                        label="Keep clear"
                        value={fixture.keepClearMm}
                        onChange={(keepClearMm) =>
                          updateFixture(fixture.id, { keepClearMm })
                        }
                      />
                      <label className="block">
                        <span className="label">From</span>
                        <select
                          value={fixture.source}
                          onChange={(event) =>
                            updateFixture(fixture.id, {
                              source: event.target.value as Source,
                            })
                          }
                          className="field"
                        >
                          {(Object.keys(SOURCE_LABELS) as Source[]).map(
                            (source) => (
                              <option key={source} value={source}>
                                {SOURCE_LABELS[source]}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFixture(fixture.id)}
                      className="mt-1 min-h-9 text-sm text-danger"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn mt-2"
                onClick={() =>
                  change((d) => ({
                    ...d,
                    fixtures: [
                      ...d.fixtures,
                      {
                        id: newId(),
                        surfaceId: surface.id,
                        kind: "window",
                        rect: { u: 500, v: 900, w: 1000, h: 1000 },
                        keepClearMm: KEEP_CLEAR_DEFAULTS.window ?? 0,
                        label: "",
                        source: "estimate",
                      },
                    ],
                  }))
                }
              >
                Add window, radiator, socket…
              </button>
            </section>
          );
        })}
      </div>

      <button
        type="button"
        className="btn mt-4"
        onClick={() =>
          change((d) => ({
            ...d,
            surfaces: [
              ...d.surfaces,
              {
                id: newId(),
                name: "New surface",
                kind: "wall",
                polygon: rectPolygon(1000, d.ceilingMm),
                pose: null,
                // The college's default: nothing that leaves a mark.
                allowedMounts: ["removable_strip", "removable_hook"],
                source: "estimate",
              },
            ],
          }))
        }
      >
        Add a surface
      </button>
      <p className="mt-1 text-xs text-muted">
        For an alcove, a chimney breast, the side of a wardrobe, or a wall in
        two parts.
      </p>

      <section className="mt-6 rounded-lg border border-line bg-card p-3">
        <h2 className="text-xl">Accuracy checks</h2>
        <p className="mb-2 text-sm text-muted">
          Tape a few distances you didn&apos;t use to build the model. If they
          match to within {ACCURACY_TARGET_MM / 10} cm, the model can be
          trusted for hanging.
        </p>
        {accuracy && (
          <p
            className={`mb-2 text-sm font-medium ${
              accuracy.worstMm <= ACCURACY_TARGET_MM
                ? "text-accent"
                : "text-danger"
            }`}
          >
            Worst error across {accuracy.checks}{" "}
            {accuracy.checks === 1 ? "check" : "checks"}:{" "}
            {Math.round(accuracy.worstMm)} mm
          </p>
        )}
        <ul className="space-y-3">
          {doc.measurements.map((measurement) => {
            const model = modelDistanceMm(measurement, doc);
            const surface = doc.surfaces.find(
              (s) => s.id === measurement.surfaceId,
            );
            const refs: { value: string; label: string }[] = surface
              ? [
                  ...(["left", "right", "bottom", "top"] as const).map(
                    (side) => ({
                      value: `wall:${side}`,
                      label: `Wall ${SIDE_LABELS[side]}`,
                    }),
                  ),
                  ...doc.fixtures
                    .filter((f) => f.surfaceId === surface.id)
                    .flatMap((f) =>
                      (["left", "right", "bottom", "top"] as const).map(
                        (side) => ({
                          value: `${f.id}:${side}`,
                          label: `${f.label || f.kind} ${SIDE_LABELS[side]}`,
                        }),
                      ),
                    ),
                ]
              : [];
            const refSelect = (key: "refA" | "refB", label: string) => (
              <label className="block min-w-0">
                <span className="label">{label}</span>
                <select
                  value={`${measurement[key].target}:${measurement[key].side}`}
                  onChange={(event) => {
                    const [target, side] = event.target.value.split(":");
                    updateMeasurement(measurement.id, {
                      [key]: { target, side: side as EdgeRef["side"] },
                    });
                  }}
                  className="field"
                >
                  {refs.map((ref) => (
                    <option key={ref.value} value={ref.value}>
                      {ref.label}
                    </option>
                  ))}
                </select>
              </label>
            );
            return (
              <li key={measurement.id} className="rounded border border-line p-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="label">Surface</span>
                    <select
                      value={measurement.surfaceId}
                      onChange={(event) =>
                        updateMeasurement(measurement.id, {
                          surfaceId: event.target.value,
                          refA: { target: "wall", side: "left" },
                          refB: { target: "wall", side: "right" },
                        })
                      }
                      className="field"
                    >
                      {doc.surfaces.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {refSelect("refA", "From")}
                  {refSelect("refB", "To")}
                  <NumberField
                    label="Tape says"
                    value={measurement.tapeMm}
                    onChange={(tapeMm) =>
                      updateMeasurement(measurement.id, { tapeMm })
                    }
                  />
                  <div className="self-end pb-2 text-sm text-muted">
                    {model === null
                      ? "Pick two edges along the same direction."
                      : `Model says ${model.toLocaleString("en-GB")} mm`}
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <label className="flex min-h-9 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={measurement.heldOut}
                      onChange={(event) =>
                        updateMeasurement(measurement.id, {
                          heldOut: event.target.checked,
                        })
                      }
                    />
                    Held-out check
                  </label>
                  <button
                    type="button"
                    className="min-h-9 text-sm text-danger"
                    onClick={() =>
                      change((d) => ({
                        ...d,
                        measurements: d.measurements.filter(
                          (m) => m.id !== measurement.id,
                        ),
                      }))
                    }
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className="btn mt-2"
          disabled={doc.surfaces.length === 0}
          onClick={() =>
            change((d) => ({
              ...d,
              measurements: [
                ...d.measurements,
                {
                  id: newId(),
                  surfaceId: d.surfaces[0].id,
                  refA: { target: "wall", side: "left" },
                  refB: { target: "wall", side: "right" },
                  tapeMm: 1000,
                  heldOut: true,
                  method: "tape",
                },
              ],
            }))
          }
        >
          Add a check
        </button>
      </section>

      <div className="sticky bottom-20 z-10 mt-4 flex items-center gap-3 rounded-lg border border-line bg-card p-2 sm:bottom-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="btn btn-primary"
        >
          Save room
        </button>
        <p role="status" className="text-sm text-muted">
          {message ?? (dirty ? "Unsaved changes" : `Version ${savedVersion}`)}
        </p>
      </div>
    </div>
  );
}
