"use server";

import { z } from "zod";
import { requireSession } from "../auth";
import { ingestImage, UnsupportedImageError } from "../content/media";
import { addText, decide, describeFound, findText } from "../content/store";
import { creditLine, downloadImage, KEEP_SOURCES, resolveImage } from "../find/images";
import { pinSearch, unpinSearch } from "../find/interests";

export type KeepResult = { ok: true; id: string; already: boolean } | { ok: false; error: string };

// None of these refresh the page: that would run the search again and redraw
// the results under the reader's thumb. Each button shows its own outcome.

const imageRef = z.object({
  source: z.enum(KEEP_SOURCES),
  id: z.string().min(1).max(400),
});

/**
 * Saves a found picture into the print library, already kept. The browser only
 * names the picture; where to download it from is looked up again here.
 */
export async function keepImageAction(source: string, id: string): Promise<KeepResult> {
  await requireSession();
  const ref = imageRef.safeParse({ source, id });
  if (!ref.success) return { ok: false, error: "That picture can't be saved." };
  try {
    const image = await resolveImage(ref.data.source, ref.data.id);
    if (!image) return { ok: false, error: "The source no longer lists that picture." };
    const bytes = await downloadImage(image.downloadUrl);
    const saved = await ingestImage(bytes, `${image.title.slice(0, 80)}.jpg`, "upload");
    if (!saved.duplicate) {
      describeFound(saved.id, {
        title: image.title,
        attribution: creditLine(image) || null,
        sourceUrl: image.pageUrl,
      });
      // You went looking for it, so it's kept from the start, not left to sort.
      decide(saved.id, "keep");
    }
    return { ok: true, id: saved.id, already: saved.duplicate };
  } catch (error) {
    if (error instanceof UnsupportedImageError) return { ok: false, error: error.message };
    console.error(`Keeping ${ref.data.source} ${ref.data.id} failed:`, error);
    return { ok: false, error: "Couldn't fetch that picture. Try again in a moment." };
  }
}

const quote = z.object({
  body: z.string().trim().min(1).max(600),
  attribution: z.string().trim().max(120),
  kind: z.enum(["quote", "reminder"]),
  sourceUrl: z.url().max(600).nullable(),
});

export async function keepQuoteAction(input: {
  body: string;
  attribution: string;
  kind: "quote" | "reminder";
  sourceUrl: string | null;
}): Promise<KeepResult> {
  await requireSession();
  const parsed = quote.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That line can't be saved." };
  const existing = findText(parsed.data.body);
  if (existing) return { ok: true, id: existing.id, already: true };
  const id = addText({
    kind: parsed.data.kind,
    body: parsed.data.body,
    attribution: parsed.data.attribution || null,
    source: "find",
    sourceUrl: parsed.data.sourceUrl,
  });
  decide(id, "keep");
  return { ok: true, id, already: false };
}

const pin = z.object({
  q: z.string().trim().min(1).max(120),
  kind: z.enum(["pictures", "words"]),
});

export async function setPinnedAction(q: string, kind: string, pinned: boolean): Promise<void> {
  await requireSession();
  const parsed = pin.parse({ q, kind });
  if (pinned) pinSearch(parsed.q, parsed.kind);
  else unpinSearch(parsed.q, parsed.kind);
}
