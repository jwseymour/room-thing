import { randomUUID } from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import { getDb } from "../db";
import {
  content,
  layouts,
  roomVersions,
  rooms,
  signals,
  wallPlacements,
} from "../db/schema";
import type { Orientation } from "./print";
import { defaultRoom, roomDocumentSchema, type Mount, type RoomDocument } from "./schema";

const ROOM_ID = "first-room";

export type StoredRoom = { id: string; version: number; doc: RoomDocument };

export function getRoom(): StoredRoom {
  const db = getDb();
  const row = db.select().from(rooms).where(eq(rooms.id, ROOM_ID)).get();
  // Parsed, so that rooms saved before a field existed pick up its default.
  if (row) return { id: row.id, version: row.version, doc: roomDocumentSchema.parse(row.doc) };

  const doc = defaultRoom();
  db.transaction((tx) => {
    tx.insert(rooms).values({ id: ROOM_ID, doc }).run();
    tx.insert(roomVersions).values({ roomId: ROOM_ID, version: 1, doc }).run();
    tx.insert(layouts)
      .values({
        id: randomUUID(),
        roomId: ROOM_ID,
        name: "Proposed",
        status: "proposed",
      })
      .run();
  });
  return { id: ROOM_ID, version: 1, doc };
}

export function saveRoom(input: unknown): StoredRoom {
  const doc = roomDocumentSchema.parse(input);
  const current = getRoom();
  const version = current.version + 1;
  const db = getDb();
  db.transaction((tx) => {
    tx.update(rooms)
      .set({ doc, version, updatedAt: new Date() })
      .where(eq(rooms.id, current.id))
      .run();
    tx.insert(roomVersions).values({ roomId: current.id, version, doc }).run();
  });
  return { id: current.id, version, doc };
}

export function proposedLayoutId(): string {
  const room = getRoom();
  const layout = getDb()
    .select({ id: layouts.id })
    .from(layouts)
    .where(and(eq(layouts.roomId, room.id), eq(layouts.status, "proposed")))
    .get();
  if (!layout) throw new Error("The room has no proposed layout.");
  return layout.id;
}

export type PlacementWithContent = typeof wallPlacements.$inferSelect & {
  content: typeof content.$inferSelect;
};

export function activePlacements(surfaceId?: string): PlacementWithContent[] {
  const rows = getDb()
    .select()
    .from(wallPlacements)
    .innerJoin(content, eq(wallPlacements.contentId, content.id))
    .where(
      and(
        eq(wallPlacements.layoutId, proposedLayoutId()),
        ne(wallPlacements.state, "removed"),
        surfaceId ? eq(wallPlacements.surfaceId, surfaceId) : undefined,
      ),
    )
    .orderBy(asc(wallPlacements.createdAt))
    .all();
  return rows.map((row) => ({ ...row.wall_placements, content: row.content }));
}

/** What's on the walls that has to be printed: everything but the things you already own. */
export function printPlacements(): PlacementWithContent[] {
  return activePlacements().filter((p) => p.content.kind !== "thing");
}

function assertMountAllowed(surfaceId: string, mount: Mount): void {
  const surface = getRoom().doc.surfaces.find((s) => s.id === surfaceId);
  if (!surface) throw new Error(`Unknown surface: ${surfaceId}`);
  if (!surface.allowedMounts.includes(mount)) {
    throw new Error(`${mount} isn't allowed on ${surface.name}.`);
  }
}

export function addPlacement(input: {
  surfaceId: string;
  contentId: string;
  printSizeId: string;
  orientation: Orientation;
  widthMm?: number | null;
  heightMm?: number | null;
  u: number;
  v: number;
  mount: Mount;
  state?: "planned" | "up";
}): string {
  assertMountAllowed(input.surfaceId, input.mount);
  const id = randomUUID();
  const db = getDb();
  db.transaction((tx) => {
    tx.insert(wallPlacements)
      .values({ id, layoutId: proposedLayoutId(), ...input })
      .run();
    tx.insert(signals)
      .values({ id: randomUUID(), contentId: input.contentId, type: "placed" })
      .run();
  });
  return id;
}

export function updatePlacement(
  id: string,
  patch: Partial<{
    printSizeId: string;
    orientation: Orientation;
    widthMm: number | null;
    heightMm: number | null;
    u: number;
    v: number;
    mount: Mount;
  }>,
): void {
  const db = getDb();
  const existing = db
    .select()
    .from(wallPlacements)
    .where(eq(wallPlacements.id, id))
    .get();
  if (!existing) throw new Error(`Unknown placement: ${id}`);
  if (patch.mount) assertMountAllowed(existing.surfaceId, patch.mount);
  db.update(wallPlacements).set(patch).where(eq(wallPlacements.id, id)).run();
}

export function removePlacement(id: string): void {
  const db = getDb();
  db.transaction((tx) => {
    const placement = tx
      .select()
      .from(wallPlacements)
      .where(eq(wallPlacements.id, id))
      .get();
    if (!placement) return;
    tx.update(wallPlacements)
      .set({ state: "removed", removedAt: new Date() })
      .where(eq(wallPlacements.id, id))
      .run();
    tx.insert(signals)
      .values({
        id: randomUUID(),
        contentId: placement.contentId,
        type: "removed",
      })
      .run();
  });
}

/**
 * Records that an item is physically on the wall, or takes that back. An item
 * that comes back down returns to `ordered`, since the print still exists.
 */
export function setUp(id: string, up: boolean): void {
  getDb()
    .update(wallPlacements)
    .set({ state: up ? "up" : "ordered" })
    .where(and(eq(wallPlacements.id, id), ne(wallPlacements.state, "removed")))
    .run();
}

/** Where a piece of content is on the walls now, if anywhere. */
export function placementOf(contentId: string): PlacementWithContent | undefined {
  return activePlacements().find((p) => p.contentId === contentId);
}

/** Marks everything on one surface as up. Returns how many changed. */
export function markSurfaceUp(surfaceId: string): number {
  const waiting = activePlacements(surfaceId).filter((p) => p.state !== "up");
  const db = getDb();
  db.transaction((tx) => {
    for (const placement of waiting) {
      tx.update(wallPlacements)
        .set({ state: "up" })
        .where(eq(wallPlacements.id, placement.id))
        .run();
    }
  });
  return waiting.length;
}

export function markOrdered(): number {
  // Things you already own are never ordered.
  const planned = activePlacements().filter(
    (p) => p.state === "planned" && p.content.kind !== "thing",
  );
  const db = getDb();
  db.transaction((tx) => {
    for (const placement of planned) {
      tx.update(wallPlacements)
        .set({ state: "ordered" })
        .where(eq(wallPlacements.id, placement.id))
        .run();
    }
  });
  return planned.length;
}
