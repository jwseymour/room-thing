import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DATA_DIR } from "../config";

/**
 * Starting points for a search. The built-in ones suit anybody. Your own live
 * in `data/interests.json`, which stays on this laptop with the rest of `data/`.
 */

const group = z.object({
  name: z.string().min(1),
  /** Why this is here, in a line. */
  why: z.string().optional(),
  pictures: z.array(z.string().min(1)).default([]),
  words: z.array(z.string().min(1)).default([]),
});

const ownLine = z.object({
  body: z.string().min(1),
  kind: z.enum(["quote", "reminder"]).default("reminder"),
  attribution: z.string().optional(),
});

const pin = z.object({
  q: z.string().min(1),
  kind: z.enum(["pictures", "words"]),
});

const interestsFile = z.object({
  groups: z.array(group).default([]),
  /** Lines of your own, ready to add as they are. */
  ownWords: z.array(ownLine).default([]),
  /** Searches you chose to keep. */
  pinned: z.array(pin).default([]),
});

export type Interests = z.infer<typeof interestsFile>;
export type InterestGroup = z.infer<typeof group>;
export type SearchKind = "pictures" | "words";

const BUILT_IN: InterestGroup[] = [
  {
    name: "Landscape",
    pictures: ["Hiroshige landscape", "Turner watercolour", "Hokusai Mount Fuji", "Caspar David Friedrich"],
    words: ["Nature", "Mountains", "Sea"],
  },
  {
    name: "Maps and plans",
    pictures: ["antique city map", "celestial chart", "geological map", "botanical illustration"],
    words: ["Maps", "Travel"],
  },
  {
    name: "Pattern and colour",
    pictures: ["William Morris pattern", "Paul Klee", "Kandinsky composition", "Art Nouveau poster"],
    words: ["Colour", "Art", "Beauty"],
  },
  {
    name: "Home and making",
    pictures: ["still life", "interior painting", "woodcut"],
    words: ["Home", "Creativity", "Craft"],
  },
];

function filePath(): string {
  return path.join(DATA_DIR, "interests.json");
}

export function loadInterests(): Interests & { personal: boolean } {
  try {
    const parsed = interestsFile.parse(JSON.parse(fs.readFileSync(filePath(), "utf8")));
    return {
      ...parsed,
      groups: parsed.groups.length ? parsed.groups : BUILT_IN,
      personal: parsed.groups.length > 0,
    };
  } catch {
    // No file yet, or one that doesn't parse: fall back to the built-in set.
    return { groups: BUILT_IN, ownWords: [], pinned: [], personal: false };
  }
}

function update(change: (current: Interests) => Interests): void {
  let current: Interests = { groups: [], ownWords: [], pinned: [] };
  try {
    current = interestsFile.parse(JSON.parse(fs.readFileSync(filePath(), "utf8")));
  } catch {
    // Starting a new file.
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${filePath()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(change(current), null, 2)}\n`);
  fs.renameSync(temp, filePath());
}

const same = (a: { q: string; kind: SearchKind }, q: string, kind: SearchKind) =>
  a.kind === kind && a.q.toLowerCase() === q.toLowerCase();

export function pinSearch(q: string, kind: SearchKind): void {
  update((current) =>
    current.pinned.some((p) => same(p, q, kind))
      ? current
      : { ...current, pinned: [...current.pinned, { q, kind }] },
  );
}

export function unpinSearch(q: string, kind: SearchKind): void {
  update((current) => ({
    ...current,
    pinned: current.pinned.filter((p) => !same(p, q, kind)),
  }));
}

export function isPinned(interests: Interests, q: string, kind: SearchKind): boolean {
  return interests.pinned.some((p) => same(p, q, kind));
}
