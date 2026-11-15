import type { RoomDocument, Surface } from "../room/schema";
import { rectPolygon } from "../room/schema";

/**
 * Where a surface sits in the room, in metres. `origin` is its bottom-left
 * corner as you face it, `right` runs along it, and `normal` points into the
 * room. The room model stores this as `pose`: x and y on the floor plan in
 * millimetres, and the direction of `right` as a yaw angle.
 */
export type SurfaceFrame = {
  origin: [number, number, number];
  right: [number, number, number];
  normal: [number, number, number];
};

export function surfaceFrame(surface: Surface): SurfaceFrame | null {
  if (!surface.pose) return null;
  const yaw = (surface.pose.yawDeg * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    origin: [surface.pose.x / 1000, 0, surface.pose.y / 1000],
    right: [cos, 0, sin],
    normal: [-sin, 0, cos],
  };
}

/** A point on a surface, `u` and `v` in millimetres, as room metres. */
export function surfacePoint(
  frame: SurfaceFrame,
  uMm: number,
  vMm: number,
  proudM = 0,
): [number, number, number] {
  const u = uMm / 1000;
  return [
    frame.origin[0] + frame.right[0] * u + frame.normal[0] * proudM,
    vMm / 1000 + frame.normal[1] * proudM,
    frame.origin[2] + frame.right[2] * u + frame.normal[2] * proudM,
  ];
}

/**
 * Where a ray meets a surface's plane, as `u` and `v` in millimetres, or null
 * if it's parallel or pointing away. Doesn't check the surface's edges.
 */
export function rayToSurface(
  frame: SurfaceFrame,
  origin: [number, number, number],
  direction: [number, number, number],
): { u: number; v: number; distance: number } | null {
  const n = frame.normal;
  const facing = direction[0] * n[0] + direction[1] * n[1] + direction[2] * n[2];
  // Only hit walls from the room side.
  if (facing > -1e-6) return null;
  const toPlane =
    (frame.origin[0] - origin[0]) * n[0] +
    (frame.origin[1] - origin[1]) * n[1] +
    (frame.origin[2] - origin[2]) * n[2];
  const distance = toPlane / facing;
  if (distance <= 0) return null;
  const hit = [0, 1, 2].map((i) => origin[i] + direction[i] * distance);
  const u =
    (hit[0] - frame.origin[0]) * frame.right[0] +
    (hit[2] - frame.origin[2]) * frame.right[2];
  return { u: u * 1000, v: hit[1] * 1000, distance };
}

export type RoomBox = { widthMm: number; depthMm: number; heightMm: number };

const WALL_NAMES = ["Wall A", "Wall B", "Wall C", "Wall D"];

/**
 * Rewrites the room's four main walls from a scan's box. Existing walls keep
 * their ids, names and mounting rules, so anything already planned on them
 * stays put. Walls the scan adds start with the college's no-mark rule.
 */
export function applyBoxToRoom(doc: RoomDocument, box: RoomBox): RoomDocument {
  const W = Math.round(box.widthMm);
  const D = Math.round(box.depthMm);
  const H = Math.round(box.heightMm);
  // Going round the room clockwise as seen from above, each facing inwards.
  const layout = [
    { x: 0, y: 0, yawDeg: 0, width: W },
    { x: W, y: 0, yawDeg: 90, width: D },
    { x: W, y: D, yawDeg: 180, width: W },
    { x: 0, y: D, yawDeg: 270, width: D },
  ];
  const existing = doc.surfaces.filter((s) => s.kind === "wall");
  const walls: Surface[] = layout.map((slot, i) => {
    const old = existing[i];
    return {
      id: old?.id ?? `wall-${i + 1}`,
      name: old?.name ?? WALL_NAMES[i],
      kind: "wall",
      polygon: rectPolygon(slot.width, H),
      pose: { x: slot.x, y: slot.y, yawDeg: slot.yawDeg },
      allowedMounts: old?.allowedMounts ?? ["removable_strip", "removable_hook"],
      source: "scan",
    };
  });
  const kept = new Set(walls.map((w) => w.id));
  return {
    ...doc,
    ceilingMm: H,
    surfaces: [
      ...walls,
      ...doc.surfaces.filter((s) => !kept.has(s.id) && s.kind !== "wall"),
      // Extra hand-made walls beyond the four stay, but aren't in the scan.
      ...existing.slice(4),
    ],
  };
}

/** Makes one wall the pin board, and takes pins away from the others. */
export function setPinBoard(doc: RoomDocument, surfaceId: string): RoomDocument {
  let spare = 0;
  return {
    ...doc,
    surfaces: doc.surfaces.map((s) => {
      if (s.id === surfaceId) {
        return { ...s, name: "Pin board wall", allowedMounts: ["pin", "string_and_clips"] };
      }
      if (!s.allowedMounts.includes("pin")) return s;
      const name = s.name === "Pin board wall" ? `Wall ${"BCDE"[spare++] ?? ""}`.trim() : s.name;
      return { ...s, name, allowedMounts: ["removable_strip", "removable_hook"] };
    }),
  };
}
