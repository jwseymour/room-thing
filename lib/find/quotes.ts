import { getJson as fetchJson } from "./http";
import { decodeEntities } from "./images";

/**
 * Quote search over Wikiquote, which sorts quotes by who said them, by the
 * work they're from, and by theme, each with its source. No key needed.
 */

export type FoundQuote = {
  body: string;
  /** Who to credit on the print. */
  attribution: string;
  /** The source line as Wikiquote gives it: the book, letter or year. */
  detail: string | null;
  pageTitle: string;
  pageUrl: string;
};

export type QuoteSearch = {
  results: FoundQuote[];
  /** The Wikiquote pages the results came from. */
  pages: string[];
  failed: boolean;
  more: boolean;
};

const API = "https://en.wikiquote.org/w/api.php";
const PAGE_SIZE = 24;
/** Longer than this won't read from across a room. */
const MAX_LENGTH = 300;
const MIN_LENGTH = 15;

/** Sections that hold something other than the subject's own words. */
const SKIP_SECTION =
  /about|misattributed|disputed|attributed|see also|external links|references|sources|cast|taglines|notes|bibliography|further reading/i;

const text = (html: string) =>
  decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, ""))
    .replace(/\[\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export type RawQuote = {
  body: string;
  detail: string | null;
  /** The heading it sits under: a year on a person's page, a character on a film's. */
  section: string | null;
};

/**
 * Pulls the quotes out of a Wikiquote page. Each is a top-level list item, and
 * its source is a list nested inside it. Works on the page's HTML as a stream of
 * tags, since that one convention is all there is to rely on.
 */
export function parseQuotes(html: string): RawQuote[] {
  const quotes: RawQuote[] = [];
  const tag = /<(\/?)(ul|ol|li|h2|h3|h4|table|figure|dl)\b[^>]*>/gi;
  let depth = 0;
  /** Lists inside tables, captions and definition lists aren't quotes. */
  let boxed = 0;
  let skipping = false;
  let section: string | null = null;
  let headingFrom = -1;
  let bodyFrom = -1;
  let body = "";
  let detailFrom = -1;
  let detail: string | null = null;
  let open = false;

  const finish = () => {
    if (open && body && !skipping) quotes.push({ body, detail, section });
    open = false;
    body = "";
    detail = null;
    bodyFrom = -1;
    detailFrom = -1;
  };

  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const at = m.index;
    const after = at + m[0].length;

    if (name === "h2" || name === "h3" || name === "h4") {
      if (!closing) {
        headingFrom = after;
      } else if (headingFrom >= 0) {
        const heading = text(html.slice(headingFrom, at));
        section = heading || null;
        // A subsection inside a skipped section stays skipped.
        if (name === "h2" || !skipping) skipping = SKIP_SECTION.test(heading);
        else if (SKIP_SECTION.test(heading)) skipping = true;
        headingFrom = -1;
      }
      continue;
    }
    if (name === "table" || name === "figure" || name === "dl") {
      boxed += closing ? -1 : 1;
      continue;
    }
    if (boxed > 0) continue;

    if (name === "ul" || name === "ol") {
      if (!closing) {
        // The quote's own text ends where its nested source list starts.
        if (depth === 1 && open && bodyFrom >= 0) {
          body = text(html.slice(bodyFrom, at));
          bodyFrom = -1;
        }
        depth++;
      } else {
        depth = Math.max(0, depth - 1);
      }
      continue;
    }

    // <li>
    if (!closing) {
      if (depth === 1) {
        finish();
        open = true;
        bodyFrom = after;
      } else if (depth === 2 && open && detail === null) {
        detailFrom = after;
      }
    } else if (depth === 1) {
      if (open && bodyFrom >= 0) body = text(html.slice(bodyFrom, at));
      finish();
    } else if (depth === 2 && detailFrom >= 0) {
      detail = text(html.slice(detailFrom, at)) || null;
      detailFrom = -1;
    }
  }
  finish();
  return quotes;
}

/**
 * Exchanges between characters, which Wikiquote sets as a definition list with
 * one line each, the speaker in bold. Stage directions in square brackets go.
 */
export function parseDialogue(html: string): string[][] {
  const exchanges: string[][] = [];
  const block = /<h2\b[^>]*>([\s\S]*?)<\/h2>|<dl>([\s\S]*?)<\/dl>/gi;
  let skipping = false;
  for (let m = block.exec(html); m; m = block.exec(html)) {
    if (m[1] !== undefined) {
      skipping = SKIP_SECTION.test(text(m[1]));
      continue;
    }
    if (skipping) continue;
    const lines = [...m[2].matchAll(/<dd>([\s\S]*?)<\/dd>/gi)]
      .map((dd) => text(dd[1].replace(/<i>\s*[\[(][\s\S]*?[\])]\s*<\/i>/gi, "")).replace(/\s*\[[^\]]*\]/g, "").trim())
      .filter((line) => /^[^:]{1,40}:\s*\S/.test(line));
    if (lines.length >= 2) exchanges.push(lines);
  }
  return exchanges;
}

const NOT_A_NAME =
  /^(chapter|book|part|act|page|line|section|letter|preface|introduction|season|episode|volume|vol|ch|p|pp|as quoted|quoted|from|in|the|a|an|variant|translation|source|interview|speech|lecture)$/i;

/** The name a theme page's source line opens with: "Paul Klee, in his diary (1902)". */
export function leadingName(detail: string | null): string | null {
  if (!detail) return null;
  const m = /^((?:[A-Z][\p{L}.'’-]*)(?:\s+(?:[A-Z][\p{L}.'’-]*|de|del|van|von|der|da|di|la|le|of|ibn|al))*)(?=\s*(?:,|\(|:|;|\s[-–—]\s|\sin\s|$))/u.exec(
    detail,
  );
  if (!m) return null;
  const name = m[1].trim();
  if (name.length > 40 || NOT_A_NAME.test(name.split(/\s+/)[0])) return null;
  return name;
}

/**
 * Who to credit. On a person's page that's the person; on a theme page each
 * quote names its own author; on a page for a book or film it's the work.
 */
export function toFound(
  raw: Pick<RawQuote, "body" | "detail">,
  pageTitle: string,
  isPerson: boolean,
): FoundQuote | null {
  // Wikiquote marks a trimmed start with dots. On a wall the line stands by itself.
  const body = raw.body
    .replace(/^[\s.…]+/, "")
    .replace(/^["“”'‘]+|["“”'’]+$/g, "")
    .trim();
  if (body.length < MIN_LENGTH || body.length > MAX_LENGTH) return null;
  // Lines of dialogue ("Neo: ...") need their scene, so they don't stand alone.
  if (/^[A-Z][\w .'-]{0,24}:\s/.test(body)) return null;
  return {
    body,
    attribution: isPerson ? pageTitle : (leadingName(raw.detail) ?? pageTitle),
    detail: raw.detail && raw.detail.length <= 200 ? raw.detail : null,
    pageTitle,
    pageUrl: `https://en.wikiquote.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`,
  };
}

function getJson(params: Record<string, string>): Promise<unknown> {
  return fetchJson(`${API}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`, 9000);
}

async function pageQuotes(title: string): Promise<FoundQuote[]> {
  const data = (await getJson({
    action: "parse",
    page: title,
    prop: "text|categories",
    redirects: "1",
    disabletoc: "1",
    disableeditsection: "1",
  })) as { parse?: { title: string; text: string; categories?: { category: string }[] } };
  if (!data.parse) return [];
  const isPerson = (data.parse.categories ?? []).some((c) =>
    /_births$|_deaths$|^Living_people$|_from_/i.test(c.category),
  );
  return parseQuotes(data.parse.text)
    .map((raw) => toFound(raw, data.parse!.title, isPerson))
    .filter((found) => found !== null);
}

/** Dates and lists are pages too, and never what a search for quotes is after. */
const NOT_A_SUBJECT =
  /^(January|February|March|April|May|June|July|August|September|October|November|December) \d+$|^List of /;

/** Words to match on, with a plural's "s" dropped so "Mountains" finds "Mountain". */
const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

/**
 * How far a page's title is from what was searched for: 0 when it's exactly
 * the subject, more for each extra word, and null when the page isn't on the
 * subject at all. Wikiquote's search also returns pages that only mention the
 * words, and a bracketed label such as "(film)" says what kind of thing a page
 * is, not what it's about.
 */
export function distanceFrom(title: string, q: string): number | null {
  const inTitle = wordsOf(title.replace(/\([^)]*\)/g, ""));
  const asked = wordsOf(q);
  if (asked.length === 0 || !asked.every((w) => inTitle.includes(w))) return null;
  return inTitle.length - asked.length;
}

/**
 * Finds the Wikiquote pages on the subject and reads the quotes off the top
 * two. If there's no page on it, takes the lines that mention it from the pages
 * that came closest. Short lines come first, since those work on a wall.
 */
export async function searchQuotes(q: string, page = 0): Promise<QuoteSearch> {
  try {
    const search = (await getJson({
      action: "query",
      list: "search",
      srsearch: q,
      srlimit: "8",
    })) as { query?: { search?: { title: string }[] } };
    const hits = (search.query?.search ?? [])
      .map((hit) => hit.title)
      .filter((title) => !NOT_A_SUBJECT.test(title));
    const about = hits
      .map((title, index) => ({ title, index, distance: distanceFrom(title, q) }))
      .filter((hit) => hit.distance !== null)
      .sort((a, b) => a.distance! - b.distance! || a.index - b.index)
      .slice(0, 2)
      .map((hit) => hit.title);
    const titles = about.length ? about : hits.slice(0, 4);
    const lists = await Promise.all(titles.map((title) => pageQuotes(title).catch(() => [])));

    const words = wordsOf(q);
    const seen = new Set<string>();
    const all = lists
      .flat()
      .filter((quote) => {
        if (seen.has(quote.body)) return false;
        seen.add(quote.body);
        return true;
      })
      .map((quote, index) => {
        const lower = quote.body.toLowerCase();
        const mentions = words.filter((w) => lower.includes(w)).length;
        // Editors' insertions, cut-out middles and line breaks all read badly in print.
        const untidy = /\[|\.\.|…| \/ /.test(quote.body) ? 40 : 0;
        // Short lines first, then the page's own order.
        return { quote, mentions, score: mentions * 40 - untidy - quote.body.length / 4 - index * 0.3 };
      })
      // From a page that isn't on the subject, only lines that mention it belong.
      .filter(({ mentions }) => about.length > 0 || mentions > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ quote }) => quote);

    return {
      results: all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
      pages: [...new Set(all.map((quote) => quote.pageTitle))].slice(0, 4),
      failed: false,
      more: all.length > (page + 1) * PAGE_SIZE,
    };
  } catch (error) {
    console.error(`Wikiquote search for "${q}" failed:`, error);
    return { results: [], pages: [], failed: true, more: false };
  }
}

// ── One work: a film, a series or a book ────────────────────────────────────

export type WorkKind = "film" | "tv" | "book" | "other";

export type Work = {
  /** The Wikiquote page, e.g. "Solaris (1972 film)". */
  pageTitle: string;
  /** The name alone: "Solaris". */
  title: string;
  kind: WorkKind;
  year: string | null;
  pageUrl: string;
  /** Single lines, in the page's order. */
  lines: FoundQuote[];
  /** Short exchanges between characters, one speaker to a line. */
  exchanges: FoundQuote[];
};

const withoutLabel = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, "").trim();
const urlOf = (title: string) =>
  `https://en.wikiquote.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

/** Headings that sort a page without naming who is speaking. */
const NOT_A_CHARACTER =
  /^(quotes?|others?|misc|dialogue|voice-?overs?|unsourced|sourced|narrat|opening|closing|season|series|episode|chapter|part|book|act|volume|prologue|epilogue|\d)/i;

const EXCHANGE_MAX_LINES = 6;
const EXCHANGE_MAX_LENGTH = 360;

/** Pages whose titles match, best first: the choices when several works share a name. */
export async function findWorks(q: string): Promise<string[]> {
  const search = (await getJson({
    action: "query",
    list: "search",
    srsearch: q,
    srlimit: "10",
  })) as { query?: { search?: { title: string }[] } };
  const hits = (search.query?.search ?? [])
    .map((hit) => hit.title)
    .filter((title) => !NOT_A_SUBJECT.test(title));
  const about = hits
    .map((title, index) => ({ title, index, distance: distanceFrom(title, q) }))
    .filter((hit) => hit.distance !== null)
    .sort((a, b) => a.distance! - b.distance! || a.index - b.index)
    .map((hit) => hit.title);
  return (about.length ? about : hits).slice(0, 6);
}

/** Sorts a page's quotes into single lines and exchanges, crediting characters. */
export function toWork(
  pageTitle: string,
  html: string,
  categories: string[],
  /** What was asked for, to pick one book out of its author's page. */
  q = "",
): Work {
  const kind: WorkKind = categories.some((c) => /films?(_|$)/i.test(c))
    ? "film"
    : categories.some((c) => /television|TV_series|_series$|anime/i.test(c))
      ? "tv"
      : categories.some((c) => /novels|books|plays|poems|literature|short_stories/i.test(c))
        ? "book"
        : "other";
  const year =
    /\((\d{4})\b/.exec(pageTitle)?.[1] ??
    categories.map((c) => /^(\d{4})_/.exec(c)?.[1]).find(Boolean) ??
    null;
  const title = withoutLabel(pageTitle);
  const pageUrl = urlOf(pageTitle);
  const onScreen = kind === "film" || kind === "tv";

  const seen = new Set<string>();
  const lines: FoundQuote[] = [];
  for (const raw of parseQuotes(html)) {
    const body = raw.body
      .replace(/\s*\[[^\]]*\]/g, "")
      .replace(/^[\s.…]+/, "")
      .replace(/^["“”'‘]+|["“”'’]+$/g, "")
      .trim();
    if (body.length < MIN_LENGTH || body.length > MAX_LENGTH || seen.has(body)) continue;
    seen.add(body);
    const character =
      onScreen && raw.section && !NOT_A_CHARACTER.test(raw.section) ? raw.section : null;
    lines.push({
      body,
      attribution: character ? `${character}, ${title}` : title,
      detail: character ? null : raw.section,
      pageTitle,
      pageUrl,
    });
  }

  const exchanges: FoundQuote[] = [];
  for (const spoken of parseDialogue(html)) {
    const body = spoken.join("\n");
    if (spoken.length > EXCHANGE_MAX_LINES || body.length > EXCHANGE_MAX_LENGTH || seen.has(body)) continue;
    seen.add(body);
    exchanges.push({ body, attribution: title, detail: null, pageTitle, pageUrl });
  }

  // A book often has no page of its own, only a section on its author's. Then
  // the lines wanted are the ones under that section, credited to the author.
  if (categories.some((c) => /_births$|_deaths$|^Living_people$/i.test(c))) {
    const under = lines.filter((line) => line.detail && distanceFrom(line.detail, q) !== null);
    if (under.length > 0) {
      const section = under[0].detail!;
      return {
        pageTitle,
        title: withoutLabel(section),
        kind: "book",
        year: /\((\d{4})\b/.exec(section)?.[1] ?? null,
        pageUrl,
        lines: under.map((line) => ({ ...line, attribution: title, detail: withoutLabel(section) })),
        exchanges: [],
      };
    }
    return { pageTitle, title, kind: "other", year: null, pageUrl, lines, exchanges };
  }
  return { pageTitle, title, kind, year, pageUrl, lines, exchanges };
}

export async function readWork(pageTitle: string, q = ""): Promise<Work | null> {
  const data = (await getJson({
    action: "parse",
    page: pageTitle,
    prop: "text|categories",
    redirects: "1",
    disabletoc: "1",
    disableeditsection: "1",
  })) as { parse?: { title: string; text: string; categories?: { category: string }[] } };
  if (!data.parse) return null;
  return toWork(
    data.parse.title,
    data.parse.text,
    (data.parse.categories ?? []).map((c) => c.category),
    q,
  );
}
