import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import type { Mount, RoomDocument } from "../room/schema";
import type { Orientation } from "../room/print";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  doc: text("doc", { mode: "json" }).$type<RoomDocument>().notNull(),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Every saved version of a room, so a bad edit never loses measurements. */
export const roomVersions = sqliteTable(
  "room_versions",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    doc: text("doc", { mode: "json" }).$type<RoomDocument>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.version] })],
);

export const layouts = sqliteTable("layouts", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status", { enum: ["now", "proposed", "archived"] }).notNull(),
  parentId: text("parent_id"),
  createdAt: createdAt(),
});

export const CONTENT_STATUSES = ["inbox", "keep", "maybe", "no"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** Content belongs to no room, so favourites survive moving to a new one. */
export const content = sqliteTable(
  "content",
  {
    id: text("id").primaryKey(),
    /**
     * A `thing` is something physical you already own: a poster, a postcard,
     * a framed print. It has a real size, and is never printed.
     */
    kind: text("kind", { enum: ["photo", "quote", "reminder", "thing"] }).notNull(),
    status: text("status", { enum: CONTENT_STATUSES })
      .notNull()
      .default("inbox"),
    /** Text of a quote or reminder. */
    body: text("body"),
    attribution: text("attribution"),
    source: text("source", { enum: ["upload", "shortcut", "scan", "find"] }).notNull(),
    /** What a thing is called, or the name of a picture found online. */
    title: text("title"),
    /** Where a found picture or quote came from, to go back to it. */
    sourceUrl: text("source_url"),
    /** A thing's real size, once it's been measured or matched to a paper size. */
    widthMm: integer("width_mm"),
    heightMm: integer("height_mm"),
    filename: text("filename"),
    sha256: text("sha256").unique(),
    mimeType: text("mime_type"),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    /** Goes up each time the picture is re-cut, so browsers fetch the new one. */
    imageRev: integer("image_rev").notNull().default(0),
    createdAt: createdAt(),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("content_status_idx").on(t.status, t.createdAt)],
);

/** Append-only record of reactions. The taste profile is built from this later. */
export const signals = sqliteTable(
  "signals",
  {
    id: text("id").primaryKey(),
    contentId: text("content_id")
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["keep", "maybe", "no", "more_like_this", "placed", "removed"],
    }).notNull(),
    /**
     * How long the item was on screen before a sorting decision. Lingering is
     * a signal of its own, and it can't be recovered later.
     */
    dwellMs: integer("dwell_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("signals_content_idx").on(t.contentId, t.createdAt)],
);

/** A scan-to-room transform, with how the room was found in it. */
export type ScanAlignment = {
  /** Column-major 4×4, scan units to room metres. Includes the tape scale. */
  matrix: number[];
  up: "y+" | "y-" | "z+" | "z-";
  /** Multiplier from a tape-measured distance. 1 until one is entered. */
  tapeScale: number;
  /** False when the scan never caught the ceiling, so the height is a floor on it. */
  ceilingSeen?: boolean;
};

/**
 * A 3D scan of a room: a Gaussian splat file from a scanning app, kept in
 * `data/scans/<id>/`. The newest one for a room is the one in use.
 */
export const scans = sqliteTable(
  "scans",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    /** File extension, which is how the viewer picks a decoder. */
    fileType: text("file_type").notNull(),
    bytes: integer("bytes").notNull(),
    sample: integer("sample", { mode: "boolean" }).notNull().default(false),
    alignment: text("alignment", { mode: "json" }).$type<ScanAlignment>(),
    /** Set once a tape-measured distance has confirmed the scan's scale. */
    tapeCheckedAt: integer("tape_checked_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("scans_room_idx").on(t.roomId, t.createdAt)],
);

export const PLACEMENT_STATES = ["planned", "ordered", "up", "removed"] as const;
export type PlacementState = (typeof PLACEMENT_STATES)[number];

export const wallPlacements = sqliteTable(
  "wall_placements",
  {
    id: text("id").primaryKey(),
    layoutId: text("layout_id")
      .notNull()
      .references(() => layouts.id, { onDelete: "cascade" }),
    surfaceId: text("surface_id").notNull(),
    contentId: text("content_id")
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    printSizeId: text("print_size_id").notNull(),
    orientation: text("orientation").$type<Orientation>().notNull(),
    /** Set for things, which have their own size rather than a print size. */
    widthMm: integer("width_mm"),
    heightMm: integer("height_mm"),
    u: integer("u").notNull(),
    v: integer("v").notNull(),
    mount: text("mount").$type<Mount>().notNull(),
    state: text("state", { enum: PLACEMENT_STATES })
      .notNull()
      .default("planned"),
    createdAt: createdAt(),
    /** Kept when an item comes down, because rotation needs the history. */
    removedAt: integer("removed_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("placements_surface_idx").on(t.layoutId, t.surfaceId)],
);
