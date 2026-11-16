"use server";

import { z } from "zod";
import { requireSession } from "../auth";
import { captionImage } from "../content/caption";
import { ingestImage, removeMedia, UnsupportedImageError } from "../content/media";
import {
  addText,
  alreadyKept,
  decide,
  deleteContent,
  describeFound,
  findText,
  getContent,
  placementCount,
  setPrinted,
} from "../content/store";
import {
  creditLine,
  downloadImage,
  KEEP_SOURCES,
  refOf,
  resolveImage,
  searchImages,
  type ImageSearch,
} from "../find/images";
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
export async function keepImageAction(
  source: string,
  id: string,
  /** A line to set along the bottom of the picture, like a subtitle. */
  caption = "",
): Promise<KeepResult> {
  await requireSession();
  const ref = imageRef.safeParse({ source, id });
  if (!ref.success) return { ok: false, error: "That picture can't be saved." };
  const line = caption.trim().slice(0, 300);
  // A captioned still is a picture of its own, so only the plain one is looked up.
  const foundRef = line ? null : refOf(ref.data.source, ref.data.id);
  const before = foundRef ? alreadyKept([foundRef], [])[foundRef] : undefined;
  if (before) return { ok: true, id: before, already: true };
  try {
    const image = await resolveImage(ref.data.source, ref.data.id);
    if (!image) return { ok: false, error: "The source no longer lists that picture." };
    const original = await downloadImage(image.downloadUrl);
    const bytes = line ? await captionImage(original, line) : original;
    const saved = await ingestImage(bytes, `${image.title.slice(0, 80)}.jpg`, "upload");
    if (!saved.duplicate) {
      describeFound(saved.id, {
        title: line ? `${image.title}: “${line.slice(0, 80)}”` : image.title,
        attribution: creditLine(image) || null,
        sourceUrl: image.pageUrl,
        foundRef,
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
  body: z.string().trim().min(1).max(900),
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

/**
 * Takes back a Keep made a moment ago. Only for things that came from Find and
 * aren't on a wall: anything else is left for the library to delete.
 */
export async function unkeepAction(contentId: string): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const id = z.uuid().safeParse(contentId);
  const item = id.success ? getContent(id.data) : undefined;
  if (!item) return { ok: true };
  if (item.source !== "find") return { ok: false, error: "That was yours already. Remove it from Prints." };
  if (placementCount(item.id) > 0) return { ok: false, error: "It's on a wall. Remove it from Prints." };
  deleteContent(item.id);
  if (item.kind === "photo") await removeMedia(item.id);
  return { ok: true };
}

export type MoreImages = ImageSearch & { kept: Record<string, string> };

/** The next page of a picture search, to add to the ones already showing. */
export async function moreImagesAction(q: string, page: number): Promise<MoreImages> {
  await requireSession();
  const wanted = z.object({ q: z.string().trim().min(1).max(120), page: z.number().int().min(0).max(40) }).parse({ q, page });
  const found = await searchImages(wanted.q, wanted.page);
  return { ...found, kept: alreadyKept(found.results.map((i) => refOf(i.source, i.id)), []) };
}

export async function setPrintedAction(ids: string[], printed: boolean): Promise<void> {
  await requireSession();
  setPrinted(z.array(z.uuid()).max(200).parse(ids), printed);
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
