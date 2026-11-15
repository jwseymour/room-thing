import {
  inflate,
  rectInPolygon,
  rectsOverlap,
  surfaceBounds,
} from "./geometry";
import {
  MOUNT_LABELS,
  type Fixture,
  type Mount,
  type Rect,
  type Surface,
} from "./schema";

export type PlacedRect = { id: string; rect: Rect; mount: Mount };

export type Issue = {
  code:
    | "forbidden_mount"
    | "off_the_surface"
    | "blocks_fixture"
    | "behind_furniture"
    | "overlaps_item"
    | "wall_too_busy";
  /** Errors break a rule of the room. Warnings are the user's call. */
  severity: "error" | "warning";
  message: string;
};

export function validatePlacement(
  placement: PlacedRect,
  surface: Surface,
  fixtures: Fixture[],
  others: PlacedRect[],
): Issue[] {
  const issues: Issue[] = [];

  if (!surface.allowedMounts.includes(placement.mount)) {
    issues.push({
      code: "forbidden_mount",
      severity: "error",
      message: `${MOUNT_LABELS[placement.mount]} aren't allowed on ${surface.name}.`,
    });
  }

  if (!rectInPolygon(placement.rect, surface.polygon)) {
    issues.push({
      code: "off_the_surface",
      severity: "error",
      message: `This runs off the edge of ${surface.name}.`,
    });
  }

  for (const fixture of fixtures) {
    if (fixture.surfaceId !== surface.id) continue;
    const zone = inflate(fixture.rect, fixture.keepClearMm);
    if (!rectsOverlap(placement.rect, zone)) continue;
    const name = fixture.label || fixture.kind;
    issues.push(
      fixture.kind === "furniture" || fixture.kind === "shelf"
        ? {
            code: "behind_furniture",
            severity: "warning",
            message: `This sits behind ${name}.`,
          }
        : {
            code: "blocks_fixture",
            severity: "error",
            message: `This covers ${name}, or the clear space around it.`,
          },
    );
  }

  for (const other of others) {
    if (other.id === placement.id) continue;
    if (rectsOverlap(placement.rect, other.rect)) {
      issues.push({
        code: "overlaps_item",
        severity: "warning",
        message: "This overlaps another item.",
      });
      break;
    }
  }

  return issues;
}

/** The share of a wall's area that can hold pictures, above which it starts to feel cluttered. */
export const BUSY_COVERAGE = 0.3;

export function wallCoverage(
  surface: Surface,
  fixtures: Fixture[],
  placed: PlacedRect[],
): { coverage: number; issue: Issue | null } {
  const { w, h } = surfaceBounds(surface);
  const blocked = fixtures
    .filter((f) => f.surfaceId === surface.id)
    .reduce((sum, f) => sum + f.rect.w * f.rect.h, 0);
  const free = Math.max(w * h - blocked, 1);
  const used = placed.reduce((sum, p) => sum + p.rect.w * p.rect.h, 0);
  const coverage = used / free;
  return {
    coverage,
    issue:
      coverage > BUSY_COVERAGE
        ? {
            code: "wall_too_busy",
            severity: "warning",
            message: `${surface.name} is getting busy. Empty space is part of the design.`,
          }
        : null,
  };
}

export const EYE_LEVEL_MM = 1500;
const SEARCH_STEP_MM = 50;
const SPACING_MM = 40;

/** The clear spot nearest eye level at the wall's centre, for a newly added item. */
export function findFreeSpot(
  size: { w: number; h: number },
  surface: Surface,
  fixtures: Fixture[],
  placed: PlacedRect[],
): { u: number; v: number } {
  const bounds = surfaceBounds(surface);
  const reachesEyeLevel = bounds.h >= EYE_LEVEL_MM + size.h / 2;
  const ideal = {
    u: (bounds.w - size.w) / 2,
    v: (reachesEyeLevel ? EYE_LEVEL_MM : bounds.h / 2) - size.h / 2,
  };

  const zones = [
    ...fixtures
      .filter((f) => f.surfaceId === surface.id)
      .map((f) => inflate(f.rect, f.keepClearMm)),
    ...placed.map((p) => inflate(p.rect, SPACING_MM)),
  ];

  const candidates: { u: number; v: number; distance: number }[] = [];
  for (let u = 0; u + size.w <= bounds.w; u += SEARCH_STEP_MM) {
    for (let v = 0; v + size.h <= bounds.h; v += SEARCH_STEP_MM) {
      const distance = Math.hypot(u - ideal.u, v - ideal.v);
      candidates.push({ u, v, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);

  for (const { u, v } of candidates) {
    const rect = { u, v, ...size };
    if (
      rectInPolygon(rect, surface.polygon) &&
      !zones.some((zone) => rectsOverlap(rect, zone))
    ) {
      return { u, v };
    }
  }
  return { u: Math.max(ideal.u, 0), v: Math.max(ideal.v, 0) };
}

/** The mount to offer first. Never returns one the surface forbids. */
export function defaultMount(surface: Surface): Mount | null {
  return surface.allowedMounts[0] ?? null;
}
