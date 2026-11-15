"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "../auth";
import { removeMedia } from "../content/media";
import {
  addText,
  decide,
  deleteContent,
  undoDecision,
  type Decision,
} from "../content/store";
import { CONTENT_STATUSES, type ContentStatus } from "../db/schema";

const id = z.uuid();
const decision = z.enum(["keep", "maybe", "no", "more_like_this"]);
// Capped at ten minutes: longer than that means the phone was put down.
const dwell = z
  .number()
  .int()
  .min(0)
  .transform((ms) => Math.min(ms, 600_000))
  .optional();

// Swipes skip revalidatePath: the deck tracks its own queue, and refreshing it
// on every card would rebuild the deck mid-swipe.
export async function decideAction(
  contentId: string,
  choice: Decision,
  dwellMs?: number,
) {
  await requireSession();
  decide(id.parse(contentId), decision.parse(choice), dwell.parse(dwellMs));
}

export async function undoAction(contentId: string) {
  await requireSession();
  undoDecision(id.parse(contentId));
}

export async function setStatusAction(contentId: string, status: ContentStatus) {
  await requireSession();
  const parsed = z.enum(CONTENT_STATUSES).parse(status);
  if (parsed === "inbox") {
    undoDecision(id.parse(contentId));
  } else {
    decide(id.parse(contentId), parsed);
  }
  revalidatePath("/", "layout");
}

export async function deleteContentAction(contentId: string) {
  await requireSession();
  const parsed = id.parse(contentId);
  deleteContent(parsed);
  await removeMedia(parsed);
  revalidatePath("/", "layout");
}

const textForm = z.object({
  kind: z.enum(["quote", "reminder"]),
  body: z.string().trim().min(1, "Write something first."),
  attribution: z.string().trim(),
});

export async function addTextAction(
  _previous: string | null,
  form: FormData,
): Promise<string | null> {
  await requireSession();
  const parsed = textForm.safeParse({
    kind: form.get("kind"),
    body: form.get("body"),
    attribution: form.get("attribution") ?? "",
  });
  if (!parsed.success) return parsed.error.issues[0].message;
  addText({
    kind: parsed.data.kind,
    body: parsed.data.body,
    attribution: parsed.data.attribution || null,
    source: "upload",
  });
  revalidatePath("/", "layout");
  return null;
}
