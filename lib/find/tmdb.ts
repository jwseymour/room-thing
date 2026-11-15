import { getJson } from "./http";
import type { FoundImage, ResolvedImage } from "./images";

/**
 * Stills from films and series, from The Movie Database. Unlike the other
 * sources this one needs a key, which is free: put it in `.env.local` as
 * `TMDB_API_KEY`. Without it, the app only offers what Wikimedia Commons has.
 * These are the studios' pictures, so they're for your own wall and no further.
 */

const API = "https://api.themoviedb.org/3";
const IMAGES = "https://image.tmdb.org/t/p";
const MAX_STILLS = 30;

export const hasTmdb = () => Boolean(process.env.TMDB_API_KEY?.trim());

function call(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const key = process.env.TMDB_API_KEY?.trim();
  if (!key) throw new Error("No TMDB key set.");
  return getJson(`${API}${path}?${new URLSearchParams({ ...params, api_key: key })}`);
}

type Media = "movie" | "tv";
type Hit = {
  id: number;
  media_type: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
};
type Still = { file_path: string; width: number; height: number; vote_average: number };

const yearOf = (hit: Hit) => (hit.release_date ?? hit.first_air_date ?? "").slice(0, 4) || null;
const nameOf = (hit: Hit) => hit.title ?? hit.name ?? "Untitled";

function fromStill(media: Media, hit: Hit, still: Still): ResolvedImage {
  return {
    source: "tmdb",
    id: `${media}:${hit.id}:${still.file_path}`,
    title: `Still from ${nameOf(hit)}`,
    creator: null,
    date: yearOf(hit),
    licence: null,
    thumbUrl: `${IMAGES}/w780${still.file_path}`,
    downloadUrl: `${IMAGES}/original${still.file_path}`,
    pageUrl: `https://www.themoviedb.org/${media}/${hit.id}`,
    widthPx: still.width,
    heightPx: still.height,
  };
}

/** Stills for the film or series with this name, the best-liked first. */
export async function searchStills(
  title: string,
  year: string | null,
  wanted: "film" | "tv" | null,
): Promise<FoundImage[]> {
  const found = (await call("/search/multi", { query: title, include_adult: "false" })) as {
    results?: Hit[];
  };
  const hits = (found.results ?? []).filter((h) => h.media_type === "movie" || h.media_type === "tv");
  const media: Media | null = wanted === "film" ? "movie" : wanted === "tv" ? "tv" : null;
  // The right year and kind if there is one, or else TMDB's own best match.
  const hit =
    hits.find((h) => (!media || h.media_type === media) && year !== null && yearOf(h) === year) ??
    hits.find((h) => !media || h.media_type === media) ??
    hits[0];
  if (!hit) return [];
  const kind = hit.media_type as Media;
  const images = (await call(`/${kind}/${hit.id}/images`, {
    include_image_language: "en,null",
  })) as { backdrops?: Still[] };
  return (images.backdrops ?? [])
    .sort((a, b) => b.vote_average - a.vote_average)
    .slice(0, MAX_STILLS)
    .map((still) => {
      const { downloadUrl, ...rest } = fromStill(kind, hit, still);
      void downloadUrl;
      return rest;
    });
}

export async function resolveTmdb(id: string): Promise<ResolvedImage | null> {
  const m = /^(movie|tv):(\d+):(\/[\w-]+\.(?:jpg|png))$/.exec(id);
  if (!m) return null;
  const media = m[1] as Media;
  const hit = (await call(`/${media}/${m[2]}`)) as Hit;
  return fromStill(media, { ...hit, id: Number(m[2]) }, {
    file_path: m[3],
    width: 0,
    height: 0,
    vote_average: 0,
  });
}
