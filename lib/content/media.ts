import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import sharp, { type Metadata } from "sharp";
import { DATA_DIR } from "../config";
import { getDb } from "../db";
import { content } from "../db/schema";

const run = promisify(execFile);

export const VARIANTS = ["thumb", "card", "original"] as const;
export type Variant = (typeof VARIANTS)[number];

const VARIANT_WIDTH = { thumb: 480, card: 1600 } as const;

const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  tiff: "image/tiff",
};

function mediaDir(id: string): string {
  return path.join(DATA_DIR, "media", id);
}

export function variantPath(id: string, variant: Variant): string {
  return path.join(mediaDir(id), `${variant}.bin`);
}

/** The stored type, or undefined for anything sharp can't turn into pixels. */
function mimeTypeOf(meta: Metadata): string | undefined {
  // Sharp reports AVIF and HEIC both as `heif`, and can only decode the AV1 kind.
  if (meta.format === "heif") {
    return meta.compression === "av1" ? "image/avif" : undefined;
  }
  return meta.format ? MIME_BY_FORMAT[meta.format] : undefined;
}

/**
 * Sharp's prebuilt binaries can't decode iPhone HEIC files, so those go through
 * macOS's own `sips`. Sharp can still read a HEIC's header, so a successful
 * `metadata()` call doesn't mean the pixels are readable. Safari usually
 * converts to JPEG on upload, so this is mainly for files added from the laptop.
 */
async function toDecodable(bytes: Buffer): Promise<Buffer> {
  try {
    if (mimeTypeOf(await sharp(bytes).metadata())) return bytes;
  } catch {
    // Not something sharp recognises at all. Let sips try.
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "room-ingest-"));
  try {
    const input = path.join(dir, "input");
    const output = path.join(dir, "output.jpg");
    await fs.writeFile(input, bytes);
    // This JPEG becomes the print master, so keep its quality high.
    await run("sips", [
      "-s", "format", "jpeg",
      "-s", "formatOptions", "92",
      input,
      "--out", output,
    ]);
    return await fs.readFile(output);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export class UnsupportedImageError extends Error {}

export async function ingestImage(
  bytes: Buffer,
  filename: string,
  source: "upload" | "shortcut" | "scan",
  /** Things skip sorting: you already own them, so they're kept from the start. */
  kind: "photo" | "thing" = "photo",
): Promise<{ id: string; duplicate: boolean }> {
  const db = getDb();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = db
    .select({ id: content.id })
    .from(content)
    .where(eq(content.sha256, sha256))
    .get();
  if (existing) return { id: existing.id, duplicate: true };

  let decodable: Buffer;
  try {
    decodable = await toDecodable(bytes);
  } catch {
    throw new UnsupportedImageError(`Can't read ${filename} as an image.`);
  }

  const meta = await sharp(decodable).metadata();
  const mimeType = mimeTypeOf(meta);
  if (!mimeType || !meta.width || !meta.height) {
    throw new UnsupportedImageError(`Can't read ${filename} as an image.`);
  }
  // EXIF orientations 5 to 8 turn the image on its side.
  const sideways = (meta.orientation ?? 1) >= 5;
  const widthPx = sideways ? meta.height : meta.width;
  const heightPx = sideways ? meta.width : meta.height;

  const id = randomUUID();
  await fs.mkdir(mediaDir(id), { recursive: true });
  await fs.writeFile(variantPath(id, "original"), decodable);
  await Promise.all(
    (["thumb", "card"] as const).map((variant) =>
      sharp(decodable)
        .autoOrient()
        .resize({ width: VARIANT_WIDTH[variant], withoutEnlargement: true })
        .webp({ quality: 78 })
        .toFile(variantPath(id, variant)),
    ),
  );

  db.insert(content)
    .values({
      id,
      kind,
      status: kind === "thing" ? "keep" : "inbox",
      decidedAt: kind === "thing" ? new Date() : null,
      source,
      filename,
      sha256,
      mimeType,
      widthPx,
      heightPx,
    })
    .run();
  return { id, duplicate: false };
}

/**
 * Replaces the picture shown for an item with a straightened, cropped one.
 * The original photo is kept, so it can be cut again.
 */
export async function replaceShownImage(id: string, bytes: Buffer): Promise<void> {
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) throw new UnsupportedImageError("Can't read that image.");
  await fs.mkdir(mediaDir(id), { recursive: true });
  await Promise.all(
    (["thumb", "card"] as const).map((variant) =>
      sharp(bytes)
        .autoOrient()
        .resize({ width: VARIANT_WIDTH[variant], withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(variantPath(id, variant)),
    ),
  );
  const db = getDb();
  const row = db.select({ rev: content.imageRev }).from(content).where(eq(content.id, id)).get();
  db.update(content)
    .set({ widthPx: meta.width, heightPx: meta.height, imageRev: (row?.rev ?? 0) + 1 })
    .where(eq(content.id, id))
    .run();
}

/**
 * Swaps in a new photo of the same thing, keeping its name, size and place
 * on the wall. Used when a rough picture cut from the scan gets a proper one.
 */
export async function replacePhoto(id: string, bytes: Buffer, filename: string): Promise<void> {
  let decodable: Buffer;
  try {
    decodable = await toDecodable(bytes);
  } catch {
    throw new UnsupportedImageError(`Can't read ${filename} as an image.`);
  }
  const meta = await sharp(decodable).metadata();
  const mimeType = mimeTypeOf(meta);
  if (!mimeType) throw new UnsupportedImageError(`Can't read ${filename} as an image.`);
  await fs.mkdir(mediaDir(id), { recursive: true });
  await fs.writeFile(variantPath(id, "original"), decodable);
  await replaceShownImage(id, await sharp(decodable).autoOrient().toBuffer());
  getDb()
    .update(content)
    .set({
      filename,
      mimeType,
      source: "upload",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
    .where(eq(content.id, id))
    .run();
}

export async function removeMedia(id: string): Promise<void> {
  await fs.rm(mediaDir(id), { recursive: true, force: true });
}
