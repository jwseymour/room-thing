/**
 * Picture search over collections that publish their images freely: Wikimedia
 * Commons, the Met and the Cleveland Museum of Art. None needs a key. Only the
 * search words leave the laptop.
 */

import { getJson, request } from "./http";
import { resolveTmdb } from "./tmdb";

export * from "./picture";
import { SOURCE_NAMES, IMAGE_SOURCES, type FoundImage, type ImageSource } from "./picture";

export type ResolvedImage = FoundImage & { downloadUrl: string };

export type ImageSearch = {
  results: FoundImage[];
  /** Sources that didn't answer, by name. */
  failed: string[];
  more: boolean;
};

const PER_SOURCE = 8;
/** Commons only makes thumbnails at set widths. This is the largest, and plenty for A4. */
const COMMONS_SAVE_WIDTH = 3840;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Plain text from a scrap of HTML, as Commons gives for names and dates. */
export function plainText(html: string | undefined | null): string {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<(div|span)[^>]*display:\s*none[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

// ── Wikimedia Commons ───────────────────────────────────────────────────────

type CommonsPage = {
  title: string;
  index?: number;
  imageinfo?: {
    width: number;
    height: number;
    mime: string;
    url: string;
    thumburl?: string;
    descriptionurl: string;
    extmetadata?: Record<string, { value: string }>;
  }[];
};

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const COMMONS_FIELDS = {
  action: "query",
  format: "json",
  formatversion: "2",
  prop: "imageinfo",
  iiprop: "url|size|mime|extmetadata",
  iiextmetadatafilter: "Artist|LicenseShortName|ObjectName|DateTimeOriginal",
};

function fromCommons(page: CommonsPage): ResolvedImage | null {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  const vector = info.mime === "image/svg+xml";
  // A drawing prints at any size. A small bitmap doesn't print at all.
  if (!vector && Math.max(info.width, info.height) < 1000) return null;
  const meta = info.extmetadata ?? {};
  const fileName = page.title.replace(/^File:/, "").replace(/\.\w+$/, "").replace(/_/g, " ");
  const scale = vector ? 1 : Math.min(1, COMMONS_SAVE_WIDTH / info.width);
  return {
    source: "commons",
    id: page.title,
    title: clip(plainText(meta.ObjectName?.value) || fileName, 140),
    creator: clip(plainText(meta.Artist?.value), 80) || null,
    date: clip(plainText(meta.DateTimeOriginal?.value), 40) || null,
    licence: plainText(meta.LicenseShortName?.value) || null,
    thumbUrl: info.thumburl ?? info.url,
    downloadUrl: info.thumburl ?? info.url,
    pageUrl: info.descriptionurl,
    widthPx: vector ? null : Math.round(info.width * scale),
    heightPx: vector ? null : Math.round(info.height * scale),
  };
}

async function searchCommons(q: string, page: number): Promise<ResolvedImage[]> {
  const params = new URLSearchParams({
    ...COMMONS_FIELDS,
    generator: "search",
    gsrsearch: `${q} filetype:bitmap|drawing`,
    gsrnamespace: "6",
    gsrlimit: String(PER_SOURCE + 4),
    gsroffset: String(page * (PER_SOURCE + 4)),
    iiurlwidth: "500",
  });
  const data = (await getJson(`${COMMONS_API}?${params}`)) as {
    query?: { pages?: CommonsPage[] };
  };
  return (data.query?.pages ?? [])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(fromCommons)
    .filter((found) => found !== null)
    .slice(0, PER_SOURCE);
}

async function resolveCommons(title: string): Promise<ResolvedImage | null> {
  const params = new URLSearchParams({
    ...COMMONS_FIELDS,
    titles: title,
    iiurlwidth: String(COMMONS_SAVE_WIDTH),
  });
  const data = (await getJson(`${COMMONS_API}?${params}`)) as {
    query?: { pages?: CommonsPage[] };
  };
  const page = data.query?.pages?.[0];
  return page ? fromCommons(page) : null;
}

// ── The Met ─────────────────────────────────────────────────────────────────

type MetObject = {
  objectID: number;
  isPublicDomain: boolean;
  primaryImage: string;
  primaryImageSmall: string;
  title: string;
  artistDisplayName: string;
  objectDate: string;
  objectURL: string;
};

const MET_API = "https://collectionapi.metmuseum.org/public/collection";

function fromMet(object: MetObject): ResolvedImage | null {
  if (!object.isPublicDomain || !object.primaryImage) return null;
  return {
    source: "met",
    id: String(object.objectID),
    title: clip(object.title || "Untitled", 140),
    creator: object.artistDisplayName || null,
    date: object.objectDate || null,
    licence: "Public domain",
    thumbUrl: object.primaryImageSmall || object.primaryImage,
    downloadUrl: object.primaryImage,
    pageUrl: object.objectURL,
    widthPx: null,
    heightPx: null,
  };
}

async function resolveMet(id: string): Promise<ResolvedImage | null> {
  if (!/^\d+$/.test(id)) return null;
  return fromMet((await getJson(`${MET_API}/v1/objects/${id}`)) as MetObject);
}

async function searchMet(q: string, page: number): Promise<ResolvedImage[]> {
  const params = new URLSearchParams({
    q,
    hasImages: "true",
    isPublicDomain: "true",
    limit: String(PER_SOURCE),
    offset: String(page * PER_SOURCE),
  });
  const data = (await getJson(`${MET_API}/v1.1/search?${params}`)) as {
    objectIDs?: number[] | null;
  };
  const objects = await Promise.allSettled(
    (data.objectIDs ?? []).slice(0, PER_SOURCE).map((id) => resolveMet(String(id))),
  );
  return objects.flatMap((o) => (o.status === "fulfilled" && o.value ? [o.value] : []));
}

// ── Cleveland Museum of Art ─────────────────────────────────────────────────

type ClevelandArtwork = {
  id: number;
  title: string;
  creation_date: string | null;
  url: string;
  creators?: { description: string }[];
  images?: {
    web?: { url: string };
    print?: { url: string; width: string; height: string };
  } | null;
};

const CLEVELAND_API = "https://openaccess-api.clevelandart.org/api/artworks";

function fromCleveland(work: ClevelandArtwork): ResolvedImage | null {
  const print = work.images?.print;
  const web = work.images?.web;
  if (!print?.url || !web?.url) return null;
  return {
    source: "cleveland",
    id: String(work.id),
    title: clip(work.title || "Untitled", 140),
    creator: work.creators?.[0]?.description ?? null,
    date: work.creation_date,
    licence: "CC0",
    thumbUrl: web.url,
    downloadUrl: print.url,
    pageUrl: work.url,
    widthPx: Number(print.width) || null,
    heightPx: Number(print.height) || null,
  };
}

async function searchCleveland(q: string, page: number): Promise<ResolvedImage[]> {
  const params = new URLSearchParams({
    q,
    cc0: "1",
    has_image: "1",
    limit: String(PER_SOURCE),
    skip: String(page * PER_SOURCE),
  });
  const data = (await getJson(`${CLEVELAND_API}/?${params}`)) as { data?: ClevelandArtwork[] };
  return (data.data ?? []).map(fromCleveland).filter((found) => found !== null);
}

async function resolveCleveland(id: string): Promise<ResolvedImage | null> {
  if (!/^\d+$/.test(id)) return null;
  const data = (await getJson(`${CLEVELAND_API}/${id}`)) as { data?: ClevelandArtwork };
  return data.data ? fromCleveland(data.data) : null;
}

// ── All together ────────────────────────────────────────────────────────────

const SEARCHERS: Record<
  (typeof IMAGE_SOURCES)[number],
  (q: string, page: number) => Promise<ResolvedImage[]>
> = {
  commons: searchCommons,
  met: searchMet,
  cleveland: searchCleveland,
};

const RESOLVERS: Record<ImageSource, (id: string) => Promise<ResolvedImage | null>> = {
  commons: resolveCommons,
  met: resolveMet,
  cleveland: resolveCleveland,
  tmdb: resolveTmdb,
};

/** One from each source in turn, so no collection crowds out the others. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) if (i < list.length) out.push(list[i]);
  }
  return out;
}

export function withoutDownload(image: ResolvedImage): FoundImage {
  const { downloadUrl, ...found } = image;
  void downloadUrl;
  return found;
}

/** Commons alone, for pictures to go with one named work. */
export async function searchCommonsFor(q: string): Promise<FoundImage[]> {
  return (await searchCommons(q, 0)).map(withoutDownload);
}

export async function searchImages(q: string, page = 0): Promise<ImageSearch> {
  const settled = await Promise.allSettled(IMAGE_SOURCES.map((s) => SEARCHERS[s](q, page)));
  const lists: FoundImage[][] = [];
  const failed: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      // The download address stays on the server: saving looks it up afresh.
      lists.push(result.value.map(withoutDownload));
    } else {
      console.error(`${SOURCE_NAMES[IMAGE_SOURCES[index]]} search for "${q}" failed:`, result.reason);
      failed.push(SOURCE_NAMES[IMAGE_SOURCES[index]]);
    }
  });
  return {
    results: interleave(lists),
    failed,
    more: lists.some((list) => list.length >= PER_SOURCE),
  };
}

/**
 * Looks one picture up again at its source. Saving goes through here, so the
 * browser names a picture and never an address to download from.
 */
export function resolveImage(source: ImageSource, id: string): Promise<ResolvedImage | null> {
  return RESOLVERS[source](id);
}

const DOWNLOAD_HOSTS = new Set([
  "upload.wikimedia.org",
  "thumb.wikimedia.org",
  "images.metmuseum.org",
  "openaccess-cdn.clevelandart.org",
  "image.tmdb.org",
]);
const MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024;

export async function downloadImage(url: string): Promise<Buffer> {
  const target = new URL(url);
  if (target.protocol !== "https:" || !DOWNLOAD_HOSTS.has(target.host)) {
    throw new Error(`Won't download from ${target.host}.`);
  }
  const response = await request(target, 60_000, true);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error("That file is too large.");
  return bytes;
}
