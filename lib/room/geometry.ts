import type {
  EdgeRef,
  Fixture,
  Measurement,
  Point,
  Rect,
  RoomDocument,
  Surface,
} from "./schema";

export function surfaceBounds(surface: Surface): { w: number; h: number } {
  return {
    w: Math.max(...surface.polygon.map((p) => p.u)),
    h: Math.max(...surface.polygon.map((p) => p.v)),
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.u < b.u + b.w && b.u < a.u + a.w && a.v < b.v + b.h && b.v < a.v + a.h
  );
}

export function inflate(rect: Rect, by: number): Rect {
  return {
    u: rect.u - by,
    v: rect.v - by,
    w: rect.w + by * 2,
    h: rect.h + by * 2,
  };
}

/** Ray casting. Points exactly on an edge count as inside. */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const cross =
      (b.u - a.u) * (point.v - a.v) - (b.v - a.v) * (point.u - a.u);
    const onSegment =
      cross === 0 &&
      point.u >= Math.min(a.u, b.u) &&
      point.u <= Math.max(a.u, b.u) &&
      point.v >= Math.min(a.v, b.v) &&
      point.v <= Math.max(a.v, b.v);
    if (onSegment) return true;
    const crosses =
      a.v > point.v !== b.v > point.v &&
      point.u < ((b.u - a.u) * (point.v - a.v)) / (b.v - a.v) + a.u;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function rectInPolygon(rect: Rect, polygon: Point[]): boolean {
  return [
    { u: rect.u, v: rect.v },
    { u: rect.u + rect.w, v: rect.v },
    { u: rect.u + rect.w, v: rect.v + rect.h },
    { u: rect.u, v: rect.v + rect.h },
  ].every((corner) => pointInPolygon(corner, polygon));
}

/** Position of an edge along its axis: `u` for left and right, `v` for bottom and top. */
function edgePosition(
  ref: EdgeRef,
  surface: Surface,
  fixtures: Fixture[],
): number | null {
  let rect: Rect;
  if (ref.target === "wall") {
    const { w, h } = surfaceBounds(surface);
    rect = { u: 0, v: 0, w, h };
  } else {
    const fixture = fixtures.find((f) => f.id === ref.target);
    if (!fixture) return null;
    rect = fixture.rect;
  }
  if (ref.side === "left") return rect.u;
  if (ref.side === "right") return rect.u + rect.w;
  if (ref.side === "bottom") return rect.v;
  return rect.v + rect.h;
}

function axisOf(ref: EdgeRef): "u" | "v" {
  return ref.side === "left" || ref.side === "right" ? "u" : "v";
}

/** The model's value for a taped distance, or null if it can't be compared. */
export function modelDistanceMm(
  measurement: Measurement,
  doc: RoomDocument,
): number | null {
  const surface = doc.surfaces.find((s) => s.id === measurement.surfaceId);
  if (!surface || axisOf(measurement.refA) !== axisOf(measurement.refB)) {
    return null;
  }
  const fixtures = doc.fixtures.filter((f) => f.surfaceId === surface.id);
  const a = edgePosition(measurement.refA, surface, fixtures);
  const b = edgePosition(measurement.refB, surface, fixtures);
  if (a === null || b === null) return null;
  return Math.abs(a - b);
}

export const ACCURACY_TARGET_MM = 20;

/** Worst error across held-out checks. Null until there's a check to report. */
export function heldOutError(doc: RoomDocument): {
  checks: number;
  worstMm: number;
} | null {
  const errors = doc.measurements
    .filter((m) => m.heldOut)
    .map((m) => {
      const model = modelDistanceMm(m, doc);
      return model === null ? null : Math.abs(model - m.tapeMm);
    })
    .filter((e): e is number => e !== null);
  if (errors.length === 0) return null;
  return { checks: errors.length, worstMm: Math.max(...errors) };
}
