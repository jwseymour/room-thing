import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { FoundImage } from "./images";
import type { Work } from "./quotes";

/**
 * The assistant on a film or book's page. Given the work, what's already been
 * found for it and what the reader is after, Claude picks lines and scenes,
 * searching the web where the pages found fall short, which for books is most
 * of the time. It needs `ANTHROPIC_API_KEY` in `.env.local`, and it's the one
 * part of the app that sends anything to a hosted model.
 */

export const hasAssistant = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());

const MODEL = process.env.FIND_MODEL?.trim() || "claude-opus-5-5";
/** Stills Claude is shown. Each costs tokens, and past this they repeat. */
export const STILLS_SHOWN = 16;
const LINES_SHOWN = 120;

const suggestion = z.object({
  note: z
    .string()
    .describe("One or two plain sentences to the reader: what you went for, and anything they should know, such as a line you couldn't confirm."),
  quotes: z.array(
    z.object({
      body: z.string().describe("The words exactly as written or spoken. For an exchange, one speaker to a line, as 'Name: words'."),
      speaker: z.string().describe("The character who says it, or an empty string for narration or a book's own voice."),
      where: z.string().describe("Where in the work it comes, in a few words: 'Chapter 3', 'the rooftop, near the end'. Empty if unknown."),
      checked: z
        .enum(["listed", "web", "memory"])
        .describe("'listed' if it is on the list you were given, 'web' if you confirmed the wording on a page you read, 'memory' if you could not confirm it."),
      source_url: z.string().describe("The page you confirmed it on, or an empty string."),
    }),
  ),
  scenes: z.array(
    z.object({
      still: z.number().int().describe("The number of the still, from the ones you were shown."),
      caption: z.string().describe("A line from the work to set over the still like a subtitle, or an empty string to leave the picture bare."),
      why: z.string().describe("What the picture shows and why it answers the request, in a few words."),
    }),
  ),
});

export type Suggestion = z.infer<typeof suggestion>;

const SYSTEM = `You are helping someone choose things to print and put on their bedroom wall. They use a small app that runs on their own laptop: they name a film, series or book, the app gathers what it can find, and you choose from it and add to it. Whatever you suggest appears as a card with a Keep button; what they keep gets printed on paper, usually at postcard to A4 size, and pinned up. They will see it every day, so a pick has to earn that.

Each request gives you the work, what they asked for, the lines the app already found on Wikiquote, and for films and series a numbered set of stills you can look at.

Choosing lines:
- Go for what answers their request, not a general best-of. If they ask for quiet lines, leave out the famous loud one.
- A line has to stand without its scene. Something that only lands if you remember what came before it is a poor thing to pin to a wall.
- Short is better: a sentence or two reads from across a room. A longer passage is fine when the request is for one, up to about 600 characters; cut a long passage down to its best stretch and mark the cut with an ellipsis.
- The list you're given is a starting point and often thin, especially for books. Search the web for more: the work's best-known passages, lines readers quote, a scene they describe. Read the page before you trust a wording, since quote sites repeat each other's mistakes; prefer pages that give the surrounding text.
- Be exact. These go on a wall under the author's name. If you could not confirm a wording, you can still offer it, marked 'memory', and say so in the note. Never tidy or improve a line.
- For anything running as a joke online (a meme), give the line as people actually quote it, and if that differs from what is said in the work, say which is which in 'where'.

Choosing scenes:
- Look at the stills and pick the ones that match the request, by number. Say plainly what each shows. If none fits, pick none and say so; do not stretch.
- A caption turns a still into a scene card, the frame with its line underneath like a subtitle. Add one only when you can tell the line belongs to that moment, or when the request is for memes, where the pairing is the point. Otherwise leave the caption empty.
- Books have no stills. Leave scenes empty for them.

Offer between four and twelve lines and up to eight scenes, fewer if fewer are good. When you have them, call the suggest tool once with everything; that is how the reader sees your picks. After it, reply with a single short sentence.`;

/** A smaller copy of a TMDB still, which is plenty to see what's in the frame. */
const smaller = (url: string) => url.replace("/t/p/w780/", "/t/p/w300/");

export function buildRequest(work: Work, stills: FoundImage[], ask: string, tastes: string[]) {
  const kind = { film: "a film", tv: "a series", book: "a book", other: "a work" }[work.kind];
  const listed = [...work.lines, ...work.exchanges].slice(0, LINES_SHOWN);
  const shown = stills.slice(0, STILLS_SHOWN);
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: "text",
      text: [
        `The work: ${work.title}${work.year ? ` (${work.year})` : ""}, ${kind}.`,
        `What they asked for: ${ask}`,
        tastes.length
          ? `For a sense of their taste, the themes they collect pictures and lines under: ${tastes.join("; ")}.`
          : "",
        listed.length
          ? `Lines already found on Wikiquote (${work.pageUrl}):\n${listed
              .map((line) => `- ${line.body.replace(/\n/g, " / ")} [${line.attribution}]`)
              .join("\n")}`
          : "Wikiquote had no usable lines for it, so everything will come from your own searching.",
        shown.length ? `${shown.length} stills follow, each after its number.` : "There are no stills for it.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
  shown.forEach((still, index) => {
    content.push({ type: "text", text: `Still ${index + 1}:` });
    content.push({ type: "image", source: { type: "url", url: smaller(still.thumbUrl) } });
  });
  return content;
}

export class AssistError extends Error {}

export async function suggestFor(
  work: Work,
  stills: FoundImage[],
  ask: string,
  tastes: string[] = [],
): Promise<Suggestion> {
  if (!hasAssistant()) throw new AssistError("No Claude API key is set.");
  // Searching and reading pages takes a while; the default of ten minutes is more than a page should wait.
  const client = new Anthropic({ timeout: 240_000, maxRetries: 1 });

  let picked: Suggestion | null = null;
  const suggest = betaZodTool({
    name: "suggest",
    description:
      "Show the reader your picks. Call this once, when you have finished choosing, with every line and scene you want to offer.",
    inputSchema: suggestion,
    run: async (input) => {
      picked = input;
      return "Shown to the reader.";
    },
  });

  let final: Anthropic.Beta.BetaMessage;
  try {
    final = await client.beta.messages
      .toolRunner({
        model: MODEL,
        max_tokens: 16000,
        // If the model declines a request, the API tries its stand-in before giving up.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        tools: [
          suggest,
          { type: "web_search_20260209", name: "web_search", max_uses: 8 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
        ],
        messages: [{ role: "user", content: buildRequest(work, stills, ask, tastes) }],
        max_iterations: 8,
      })
      .runUntilDone();
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AssistError("The Claude API key in .env.local was refused.");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AssistError("Claude is busy just now. Try again in a minute.");
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new AssistError("Couldn't reach Claude. Check the laptop is online.");
    }
    if (error instanceof Anthropic.APIError) {
      throw new AssistError(`Claude returned an error (${error.status ?? "unknown"}).`);
    }
    throw error;
  }

  if (picked) return picked;
  if (final.stop_reason === "refusal") throw new AssistError("Claude declined that request.");
  throw new AssistError("Claude didn't come back with any picks. Try asking another way.");
}
