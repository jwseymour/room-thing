import { z } from "zod";

/** Every length in the room model is in millimetres. */
const mm = z.number().finite();
const positiveMm = mm.positive();

export const MOUNTS = [
  "pin",
  "string_and_clips",
  "removable_strip",
  "removable_hook",
] as const;
export const mountSchema = z.enum(MOUNTS);
export type Mount = z.infer<typeof mountSchema>;

export const MOUNT_LABELS: Record<Mount, string> = {
  pin: "Pins",
  string_and_clips: "String and clips",
  removable_strip: "Removable strips",
  removable_hook: "Removable hooks",
};

/** Where a number came from, so estimates are never mistaken for measurements. */
export const sourceSchema = z.enum(["estimate", "tape", "scan"]);
export type Source = z.infer<typeof sourceSchema>;

/** A point on a surface. `u` runs right from the left edge as you face it, `v` runs up from the floor. */
export const pointSchema = z.object({ u: mm, v: mm });
export type Point = z.infer<typeof pointSchema>;

export const rectSchema = z.object({
  u: mm,
  v: mm,
  w: positiveMm,
  h: positiveMm,
});
export type Rect = z.infer<typeof rectSchema>;

export const surfaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["wall", "door_leaf", "furniture_side"]),
  polygon: z.array(pointSchema).min(3),
  /** Placement in the floor plan. Null until the floor plan exists. */
  pose: z.object({ x: mm, y: mm, yawDeg: z.number() }).nullable(),
  allowedMounts: z.array(mountSchema),
  source: sourceSchema,
});
export type Surface = z.infer<typeof surfaceSchema>;

export const FIXTURE_KINDS = [
  "door",
  "window",
  "radiator",
  "socket",
  "switch",
  "shelf",
  "furniture",
  "other",
] as const;

export const fixtureSchema = z.object({
  id: z.string().min(1),
  surfaceId: z.string().min(1),
  kind: z.enum(FIXTURE_KINDS),
  rect: rectSchema,
  keepClearMm: mm.nonnegative(),
  label: z.string(),
  source: sourceSchema,
});
export type Fixture = z.infer<typeof fixtureSchema>;

export const furnitureSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  label: z.string(),
  size: z.object({ w: positiveMm, d: positiveMm, h: positiveMm }),
  movable: z.boolean(),
  source: sourceSchema,
});
export type Furniture = z.infer<typeof furnitureSchema>;

/**
 * A piece of furniture as a plain box standing on the floor plan. `x` and `y`
 * are its corner nearest the room's origin, `w` runs along x and `d` along y.
 */
export const BLOCK_KINDS = ["bed", "desk", "tall", "low", "unit", "chair"] as const;
export const blockSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  kind: z.enum(BLOCK_KINDS),
  x: mm,
  y: mm,
  w: positiveMm,
  d: positiveMm,
  bottom: mm.nonnegative(),
  top: positiveMm,
  /** Its colour in the scan, as #rrggbb. */
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  /** True when you can see the floor under it, as with a desk. */
  open: z.boolean(),
  source: sourceSchema,
});
export type Block = z.infer<typeof blockSchema>;

export const viewpointSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Anchored to furniture so "lying in bed" survives moving the bed. */
  anchorFurnitureId: z.string().nullable(),
  offset: z.object({ x: mm, y: mm, z: mm }),
  yawDeg: z.number(),
  pitchDeg: z.number(),
  fovDeg: z.number(),
  purpose: z.string(),
});
export type Viewpoint = z.infer<typeof viewpointSchema>;

/** An edge of the wall, or of a fixture on it, used as a measuring reference. */
export const edgeRefSchema = z.object({
  target: z.string().min(1), // "wall" or a fixture id
  side: z.enum(["left", "right", "bottom", "top"]),
});
export type EdgeRef = z.infer<typeof edgeRefSchema>;

export const measurementSchema = z.object({
  id: z.string().min(1),
  surfaceId: z.string().min(1),
  refA: edgeRefSchema,
  refB: edgeRefSchema,
  tapeMm: positiveMm,
  /** Held-out distances are never used to build the model, only to check it. */
  heldOut: z.boolean(),
  method: z.enum(["tape", "laser"]),
});
export type Measurement = z.infer<typeof measurementSchema>;

export const roomDocumentSchema = z.object({
  name: z.string().min(1),
  northBearing: z.number().nullable(),
  ceilingMm: positiveMm,
  surfaces: z.array(surfaceSchema),
  fixtures: z.array(fixtureSchema),
  furniture: z.array(furnitureSchema),
  /** Furniture found in the scan, or drawn by hand, for the 3D room. */
  blocks: z.array(blockSchema).default([]),
  viewpoints: z.array(viewpointSchema),
  measurements: z.array(measurementSchema),
});
export type RoomDocument = z.infer<typeof roomDocumentSchema>;

export function rectPolygon(widthMm: number, heightMm: number): Point[] {
  return [
    { u: 0, v: 0 },
    { u: widthMm, v: 0 },
    { u: widthMm, v: heightMm },
    { u: 0, v: heightMm },
  ];
}

/**
 * The starting room. These sizes are guesses, marked `estimate` so the app can
 * keep asking for real measurements. The mounting rules are the real ones.
 */
export function defaultRoom(): RoomDocument {
  const noMark: Mount[] = ["removable_strip", "removable_hook"];
  const wall = (
    id: string,
    name: string,
    widthMm: number,
    allowedMounts: Mount[],
  ): Surface => ({
    id,
    name,
    kind: "wall",
    polygon: rectPolygon(widthMm, 2500),
    pose: null,
    allowedMounts,
    source: "estimate",
  });

  return {
    name: "College room",
    northBearing: null,
    ceilingMm: 2500,
    surfaces: [
      wall("pinboard", "Pin board wall", 3500, ["pin", "string_and_clips"]),
      wall("wall-b", "Wall B", 3000, noMark),
      wall("wall-c", "Wall C", 3500, noMark),
      wall("wall-d", "Wall D", 3000, noMark),
      {
        id: "door-back",
        name: "Back of the door",
        kind: "door_leaf",
        polygon: rectPolygon(800, 2000),
        pose: null,
        allowedMounts: noMark,
        source: "estimate",
      },
    ],
    fixtures: [],
    furniture: [],
    blocks: [],
    viewpoints: [],
    measurements: [],
  };
}
