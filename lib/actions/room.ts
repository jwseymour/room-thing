"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "../auth";
import { PRINT_SIZES } from "../room/print";
import { mountSchema, type Mount } from "../room/schema";
import {
  addPlacement,
  markOrdered,
  removePlacement,
  saveRoom,
  updatePlacement,
} from "../room/store";

const printSizeId = z.enum(PRINT_SIZES.map((s) => s.id));
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
  u: position,
  v: position,
  mount: mountSchema,
});

export async function addPlacementAction(input: {
  surfaceId: string;
  contentId: string;
  printSizeId: string;
  orientation: "landscape" | "portrait";
  u: number;
  v: number;
  mount: Mount;
}): Promise<string> {
  await requireSession();
  const id = addPlacement(newPlacement.parse(input));
  revalidatePath("/", "layout");
  return id;
}

const placementPatch = z.object({
  printSizeId: printSizeId.optional(),
  orientation: orientation.optional(),
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
