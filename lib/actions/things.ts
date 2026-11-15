"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "../auth";
import { removeMedia } from "../content/media";
import { deleteContent, getContent, updateThing } from "../content/store";
import { getDb } from "../db";
import { wallPlacements } from "../db/schema";

const patch = z.object({
  title: z.string().trim().max(80).nullable().optional(),
  widthMm: z.number().int().min(10).max(5000).nullable().optional(),
  heightMm: z.number().int().min(10).max(5000).nullable().optional(),
});

/** Names a thing or sets its real size. Anywhere it's on a wall takes the new size. */
export async function updateThingAction(id: string, input: z.input<typeof patch>) {
  await requireSession();
  const thingId = z.uuid().parse(id);
  const item = getContent(thingId);
  if (!item || item.kind !== "thing") throw new Error("Unknown thing");
  const change = patch.parse(input);
  updateThing(thingId, { ...change, title: change.title === "" ? null : change.title });
  const widthMm = change.widthMm ?? item.widthMm;
  const heightMm = change.heightMm ?? item.heightMm;
  if (widthMm && heightMm && (change.widthMm || change.heightMm)) {
    getDb()
      .update(wallPlacements)
      .set({ widthMm, heightMm, orientation: widthMm >= heightMm ? "landscape" : "portrait" })
      .where(and(eq(wallPlacements.contentId, thingId), ne(wallPlacements.state, "removed")))
      .run();
  }
  revalidatePath("/", "layout");
}

export async function deleteThingAction(id: string) {
  await requireSession();
  const thingId = z.uuid().parse(id);
  deleteContent(thingId);
  await removeMedia(thingId);
  revalidatePath("/", "layout");
}
