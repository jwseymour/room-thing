"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "../auth";
import { OWN_SIZE, PRINT_SIZES } from "../room/print";
import { mountSchema, type Mount } from "../room/schema";
import {
  addPlacement,
  markOrdered,
  markSurfaceUp,
  removePlacement,
  saveRoom,
  setUp,
  updatePlacement,
} from "../room/store";

const printSizeId = z.enum([...PRINT_SIZES.map((s) => s.id), OWN_SIZE]);
const sizeMm = z.number().int().min(10).max(5000).nullable().optional();
const orientation = z.enum(["landscape", "portrait"]);
const position = z.number().int().min(0);

export async function saveRoomAction(doc: unknown) {
  await requireSession();
  const saved = saveRoom(doc);
  revalidatePath("/", "layout");
  return { version: saved.version };
}

const newPlacement = z.object({
  surfaceId: z.string().min(1),
  contentId: z.uuid(),
  printSizeId,
  orientation,
  widthMm: sizeMm,
  heightMm: sizeMm,
  u: position,
  v: position,
  mount: mountSchema,
  state: z.enum(["planned", "up"]).optional(),
});

export async function addPlacementAction(input: {
  surfaceId: string;
  contentId: string;
  printSizeId: string;
  orientation: "landscape" | "portrait";
  widthMm?: number | null;
  heightMm?: number | null;
  u: number;
  v: number;
  mount: Mount;
  state?: "planned" | "up";
}): Promise<string> {
  await requireSession();
  const id = addPlacement(newPlacement.parse(input));
  revalidatePath("/", "layout");
  return id;
}

/** Puts several things up at once, as when a wall is arranged in one go. */
export async function addPlacementsAction(
  inputs: z.input<typeof newPlacement>[],
): Promise<string[]> {
  await requireSession();
  const ids = z.array(newPlacement).max(60).parse(inputs).map((input) => addPlacement(input));
  revalidatePath("/", "layout");
  return ids;
}

const placementPatch = z.object({
  printSizeId: printSizeId.optional(),
  orientation: orientation.optional(),
  widthMm: sizeMm,
  heightMm: sizeMm,
  u: position.optional(),
  v: position.optional(),
  mount: mountSchema.optional(),
});

export async function updatePlacementAction(
  id: string,
  patch: z.input<typeof placementPatch>,
) {
  await requireSession();
  updatePlacement(z.uuid().parse(id), placementPatch.parse(patch));
  revalidatePath("/", "layout");
}

export async function removePlacementAction(id: string) {
  await requireSession();
  removePlacement(z.uuid().parse(id));
  revalidatePath("/", "layout");
}

export async function markOrderedAction() {
  await requireSession();
  markOrdered();
  revalidatePath("/", "layout");
}

export async function setUpAction(id: string, up: boolean) {
  await requireSession();
  setUp(z.uuid().parse(id), z.boolean().parse(up));
  revalidatePath("/", "layout");
}

export async function markSurfaceUpAction(surfaceId: string) {
  await requireSession();
  markSurfaceUp(z.string().min(1).parse(surfaceId));
  revalidatePath("/", "layout");
}
