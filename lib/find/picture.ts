/**
 * What a found picture is, and the few things worked out from it. Kept apart
 * from the searching so the browser can use it too.
 */

export const IMAGE_SOURCES = ["commons", "met", "cleveland"] as const;
/** Sources a picture can be kept from: the three searched, and stills from TMDB. */
export const KEEP_SOURCES = [...IMAGE_SOURCES, "tmdb"] as const;
export type ImageSource = (typeof KEEP_SOURCES)[number];

export const SOURCE_NAMES: Record<ImageSource, string> = {
  tmdb: "TMDB",
  commons: "Wikimedia Commons",
  met: "The Met",
  cleveland: "Cleveland Museum of Art",
};

export type FoundImage = {
  source: ImageSource;
  /** What the source calls it: a file title on Commons, an object number elsewhere. */
  id: string;
  title: string;
  creator: string | null;
  date: string | null;
  licence: string | null;
  thumbUrl: string;
  pageUrl: string;
  /** Size of the file that would be saved, where the source says. */
  widthPx: number | null;
  heightPx: number | null;
};

/** How the library names a found picture, to tell later that it's been kept. */
export const refOf = (source: string, id: string) => `${source}:${id}`;

/**
 * A larger copy to look at before keeping. Commons makes its thumbnails at set
 * widths, so the address of a wider one can be worked out from the small one.
 */
export function previewUrl(image: Pick<FoundImage, "source" | "thumbUrl" | "widthPx">): string {
  if (image.source === "commons" && (image.widthPx ?? 0) > 1280) {
    return image.thumbUrl.replace(/\/500px-/, "/1280px-");
  }
  if (image.source === "tmdb") return image.thumbUrl.replace("/w780/", "/w1280/");
  return image.thumbUrl;
}

/** "Hiroshige, c. 1837 · The Met · Public domain": one line to show under a picture. */
export function creditLine(image: Pick<FoundImage, "creator" | "date" | "source" | "licence">): string {
  const who = [image.creator, image.date].filter(Boolean).join(", ");
  return [who, SOURCE_NAMES[image.source], image.licence].filter(Boolean).join(" · ");
}
