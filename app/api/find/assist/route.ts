import { z } from "zod";
import { hasSession } from "@/lib/auth";
import { AssistError, STILLS_SHOWN, suggestFor } from "@/lib/find/assist";
import type { FoundImage } from "@/lib/find/images";
import { loadInterests } from "@/lib/find/interests";
import { readWork } from "@/lib/find/quotes";
import { hasTmdb, searchStills } from "@/lib/find/tmdb";

const body = z.object({
  page: z.string().trim().min(1).max(200),
  q: z.string().trim().max(120).default(""),
  ask: z.string().trim().min(1).max(500),
});

export type AssistReply = {
  note: string;
  quotes: { body: string; attribution: string; where: string; checked: "listed" | "web" | "memory"; sourceUrl: string | null }[];
  scenes: { image: FoundImage; caption: string; why: string }[];
};

/** Asks Claude for lines and scenes from one work. Takes up to a couple of minutes. */
export async function POST(request: Request) {
  if (!(await hasSession())) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Say what you're after." }, { status: 400 });
  const { page, q, ask } = parsed.data;

  try {
    // Both of these were fetched to draw the page, so they come from the cache.
    const work = await readWork(page, q);
    if (!work) return Response.json({ error: "That page has gone." }, { status: 404 });
    const onScreen = work.kind === "film" || work.kind === "tv";
    const stills =
      onScreen && hasTmdb()
        ? (await searchStills(work.title, work.year, work.kind === "tv" ? "tv" : "film").catch(() => [])).slice(0, STILLS_SHOWN)
        : [];
    const interests = loadInterests();
    const tastes = interests.personal ? interests.groups.map((g) => g.name) : [];

    const picked = await suggestFor(work, stills, ask, tastes);
    const isUrl = (value: string) => /^https?:\/\/\S+$/.test(value);
    const reply: AssistReply = {
      note: picked.note,
      quotes: picked.quotes
        .filter((quote) => quote.body.trim())
        .map((quote) => ({
          body: quote.body.trim(),
          attribution: quote.speaker.trim() ? `${quote.speaker.trim()}, ${work.title}` : work.title,
          where: quote.where.trim(),
          checked: quote.checked,
          sourceUrl: isUrl(quote.source_url) ? quote.source_url : quote.checked === "listed" ? work.pageUrl : null,
        })),
      scenes: picked.scenes.flatMap((scene) => {
        const image = stills[scene.still - 1];
        return image ? [{ image, caption: scene.caption.trim(), why: scene.why.trim() }] : [];
      }),
    };
    return Response.json(reply);
  } catch (error) {
    if (error instanceof AssistError) return Response.json({ error: error.message }, { status: 502 });
    console.error(`Asking Claude about "${page}" failed:`, error);
    return Response.json({ error: "Something went wrong asking Claude." }, { status: 500 });
  }
}
