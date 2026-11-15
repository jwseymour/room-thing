"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "../auth";
import { getRoom, saveRoom } from "../room/store";
import { setPinBoard } from "../scan/frame";
import { applyTapeMeasure, deleteScan, saveAlignment } from "../scan/store";

const alignment = z.object({
  matrix: z.array(z.number().finite()).length(16),
  up: z.enum(["y+", "y-", "z+", "z-"]),
  tapeScale: z.number().positive().max(5),
});
// A room, not a cupboard or a hall: catches a fit that has gone wrong.
const side = z.number().min(1000).max(20000);
const box = z.object({
  widthMm: side,
  depthMm: side,
  heightMm: z.number().min(1500).max(6000),
});

export async function saveAlignmentAction(
  scanId: string,
  input: { alignment: z.input<typeof alignment>; box: z.input<typeof box>; tapeChecked: boolean },
) {
  await requireSession();
  saveAlignment(
    z.uuid().parse(scanId),
    alignment.parse(input.alignment),
    box.parse(input.box),
    z.boolean().parse(input.tapeChecked),
  );
  revalidatePath("/", "layout");
}

/** One wall's width, measured with a tape, corrects the scale of the whole room. */
export async function applyTapeAction(surfaceId: string, realWidthMm: number) {
  await requireSession();
  applyTapeMeasure(z.string().min(1).parse(surfaceId), z.number().min(500).max(20000).parse(realWidthMm));
  revalidatePath("/", "layout");
}

export async function setPinBoardAction(surfaceId: string) {
  await requireSession();
  saveRoom(setPinBoard(getRoom().doc, z.string().min(1).parse(surfaceId)));
  revalidatePath("/", "layout");
}

export async function deleteScanAction(scanId: string) {
  await requireSession();
  deleteScan(z.uuid().parse(scanId));
  revalidatePath("/", "layout");
}

const viewpoint = z.object({
  label: z.string().trim().min(1).max(40),
  position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  yawDeg: z.number(),
  pitchDeg: z.number(),
});

/** Saves where you're standing and looking, in room millimetres. */
export async function saveViewpointAction(input: z.input<typeof viewpoint>) {
  await requireSession();
  const v = viewpoint.parse(input);
  const { doc } = getRoom();
  saveRoom({
    ...doc,
    viewpoints: [
      ...doc.viewpoints.filter((p) => p.label !== v.label),
      {
        id: randomUUID(),
        label: v.label,
        anchorFurnitureId: null,
        offset: v.position,
        yawDeg: v.yawDeg,
        pitchDeg: v.pitchDeg,
        fovDeg: 70,
        purpose: "",
      },
    ],
  });
  revalidatePath("/", "layout");
}

export async function removeViewpointAction(id: string) {
  await requireSession();
  const { doc } = getRoom();
  saveRoom({ ...doc, viewpoints: doc.viewpoints.filter((p) => p.id !== id) });
  revalidatePath("/", "layout");
}
