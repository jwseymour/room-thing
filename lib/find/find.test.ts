import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "room-find-test-"));
vi.stubEnv("DATA_DIR", dataDir);

const { creditLine, interleave, plainText } = await import("./images");
const { distanceFrom, leadingName, parseDialogue, parseQuotes, toFound, toWork } = await import("./quotes");
const { isPinned, loadInterests, pinSearch, unpinSearch } = await import("./interests");

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const PAGE = `
<h2 id="Quotes">Quotes</h2>
<figure><figcaption><ul><li>A caption, not a quote</li></ul></figcaption></figure>
<ul><li>A line is a dot that went for a <a href="/wiki/Walk">walk</a>.
<ul><li>Pedagogical Sketchbook (1925)</li><li>A second note</li></ul></li>
<li>Art does not reproduce the visible;<br />rather, it makes visible.<sup>[1]</sup></li></ul>
<h3>1920s</h3>
<ul><li>Colour &amp; I are one.<ul><li>Diary, 1914</li></ul></li></ul>
<h2 id="Quotes_about_Klee">Quotes about Klee</h2>
<ul><li>He was a fine painter.<ul><li>Somebody Else</li></ul></li></ul>
<h3>Later</h3>
<ul><li>Still about him.</li></ul>
<h2>External links</h2>
<ul><li>A link</li></ul>`;

describe("reading a Wikiquote page", () => {
  it("takes each top-level item as a quote, with its first source line", () => {
    expect(parseQuotes(PAGE)).toEqual([
      { body: "A line is a dot that went for a walk.", detail: "Pedagogical Sketchbook (1925)", section: "Quotes" },
      { body: "Art does not reproduce the visible; rather, it makes visible.", detail: null, section: "Quotes" },
      { body: "Colour & I are one.", detail: "Diary, 1914", section: "1920s" },
    ]);
  });

  it("credits the person on their own page, and each author on a theme page", () => {
    const raw = { body: "Creativity takes courage, and then some more.", detail: "Henri Matisse, as quoted in a letter" };
    expect(toFound(raw, "Henri Matisse", true)?.attribution).toBe("Henri Matisse");
    expect(toFound(raw, "Creativity", false)?.attribution).toBe("Henri Matisse");
    expect(toFound({ ...raw, detail: "Chapter 3" }, "Invisible Cities", false)?.attribution).toBe(
      "Invisible Cities",
    );
  });

  it("finds the name a source line opens with", () => {
    expect(leadingName("Aristotle, Metaphysics")).toBe("Aristotle");
    expect(leadingName("Vincent van Gogh in a letter to Theo (1882)")).toBe("Vincent van Gogh");
    expect(leadingName("As quoted in The Times")).toBeNull();
    expect(leadingName(null)).toBeNull();
  });

  it("tells a page on the subject from one that only mentions it", () => {
    expect(distanceFrom("Edsger W. Dijkstra", "edsger dijkstra")).toBe(0);
    expect(distanceFrom("Mountain", "Mountains")).toBe(0);
    expect(distanceFrom("Allegheny Mountains", "Mountains")).toBe(1);
    expect(distanceFrom("Uncertainty", "Rowing")).toBeNull();
    expect(distanceFrom("Fuck (film)", "Film")).toBeNull();
  });

  it("leaves out lines too long for a wall, and lines of dialogue", () => {
    expect(toFound({ body: "x".repeat(400), detail: null }, "A", true)).toBeNull();
    expect(toFound({ body: "Deckard: I've seen things you wouldn't believe.", detail: null }, "A", false)).toBeNull();
  });
});

const FILM = `
<h2 id="Roy_Batty">Roy Batty</h2>
<ul><li>All those moments will be lost in time, like tears in rain. <i>[pause]</i> Time to die.</li>
<li>Quite an experience to live in fear, isn't it?</li></ul>
<h2 id="Others">Others</h2>
<ul><li>It's too bad she won't live! But then again, who does?</li></ul>
<h2 id="Dialogue">Dialogue</h2>
<dl><dd><b>Holden</b>: Describe your mother.</dd>
<dd><b>Leon</b>: Let me tell you about my mother! <i>[shoots Holden]</i></dd></dl>
<hr />
<dl><dd><b>Tyrell</b>: ${"A very long speech. ".repeat(30)}</dd><dd><b>Roy</b>: Yes.</dd></dl>
<h2 id="Taglines">Taglines</h2>
<ul><li>Man has made his match... now it's his problem.</li></ul>
<dl><dd><b>A</b>: Not from the film.</dd><dd><b>B</b>: Indeed not.</dd></dl>`;

describe("reading one film", () => {
  const work = toWork("Blade Runner (1982 film)", FILM, ["1982_American_films", "Neo-noir"]);

  it("knows what it is from the page's name and categories", () => {
    expect(work).toMatchObject({ title: "Blade Runner", kind: "film", year: "1982" });
    expect(toWork("Invisible Cities", "", ["1972_novels"])).toMatchObject({ kind: "book", year: "1972" });
  });

  it("credits a line to its character, and leaves out stage directions and taglines", () => {
    expect(work.lines.map((l) => [l.body, l.attribution])).toEqual([
      ["All those moments will be lost in time, like tears in rain. Time to die.", "Roy Batty, Blade Runner"],
      ["Quite an experience to live in fear, isn't it?", "Roy Batty, Blade Runner"],
      ["It's too bad she won't live! But then again, who does?", "Blade Runner"],
    ]);
  });

  it("picks a book out of its author's page", () => {
    const page = `<h2>Quotes</h2><ul><li>An early line that is not from it at all.</li></ul>
      <h3><i>Invisible Cities</i> (1972)</h3>
      <ul><li>Cities, like dreams, are made of desires and fears.</li></ul>
      <h3>Later</h3><ul><li>Another line from somewhere else entirely.</li></ul>`;
    const book = toWork("Italo Calvino", page, ["1923_births"], "invisible cities");
    expect(book).toMatchObject({ title: "Invisible Cities", kind: "book", year: "1972" });
    expect(book.lines.map((l) => [l.body, l.attribution])).toEqual([
      ["Cities, like dreams, are made of desires and fears.", "Italo Calvino"],
    ]);
    expect(toWork("Italo Calvino", page, ["1923_births"], "Calvino").lines).toHaveLength(3);
  });

  it("sets long stretches aside as passages", () => {
    const long = `It was ${"a long sentence about the city, and ".repeat(9)}the end.`;
    const book = toWork("A Book", `<h2>Chapter 1</h2><ul><li>${long}</li><li>A short line from the book.</li></ul>`, ["1972_novels"]);
    expect(book.lines.map((l) => l.body)).toEqual(["A short line from the book."]);
    expect(book.passages).toHaveLength(1);
    expect(book.passages[0].detail).toBe("Chapter 1");
  });

  it("keeps short exchanges, one speaker to a line", () => {
    expect(parseDialogue(FILM)).toHaveLength(2);
    expect(work.exchanges.map((e) => e.body)).toEqual([
      "Holden: Describe your mother.\nLeon: Let me tell you about my mother!",
    ]);
  });
});

describe("asking Claude", () => {
  it("sends the work, the request, the lines found and each still with its number", async () => {
    const { buildRequest } = await import("./assist");
    const work = toWork("Blade Runner (1982 film)", FILM, ["1982_American_films"]);
    const still = {
      source: "tmdb" as const, id: "movie:78:/a.jpg", title: "Still", creator: null, date: "1982", licence: null,
      thumbUrl: "https://image.tmdb.org/t/p/w780/a.jpg", pageUrl: "https://www.themoviedb.org/movie/78", widthPx: 3840, heightPx: 2160,
    };
    const content = buildRequest(work, [still, still], "the quiet lines", ["Impossible spaces"]);
    const text = content[0].type === "text" ? content[0].text : "";
    expect(text).toContain("Blade Runner (1982), a film");
    expect(text).toContain("What they asked for: the quiet lines");
    expect(text).toContain("tears in rain. Time to die. [Roy Batty, Blade Runner]");
    expect(text).toContain("Holden: Describe your mother. / Leon:");
    expect(text).toContain("Impossible spaces");
    expect(content.map((block) => block.type)).toEqual(["text", "text", "image", "text", "image"]);
    expect(content[2]).toMatchObject({ source: { type: "url", url: "https://image.tmdb.org/t/p/w300/a.jpg" } });
  });
});

describe("picture results", () => {
  it("turns Commons' HTML into plain text, dropping what's hidden", () => {
    expect(
      plainText('<div class="fn"><i>Carceri &amp; more</i></div><div style="display: none;">title QS:P1476</div>'),
    ).toBe("Carceri & more");
  });

  it("takes one from each source in turn", () => {
    expect(interleave([[1, 2, 3], [10], [20, 21]])).toEqual([1, 10, 20, 2, 21, 3]);
  });

  it("writes a credit line from what's known", () => {
    expect(creditLine({ creator: "Hiroshige", date: "1837", source: "met", licence: "Public domain" })).toBe(
      "Hiroshige, 1837 · The Met · Public domain",
    );
    expect(creditLine({ creator: null, date: null, source: "commons", licence: null })).toBe(
      "Wikimedia Commons",
    );
  });
});

describe("starting points", () => {
  it("uses the built-in set until there's a file, then yours", () => {
    expect(loadInterests().personal).toBe(false);
    expect(loadInterests().groups.length).toBeGreaterThan(0);

    fs.writeFileSync(
      path.join(dataDir, "interests.json"),
      JSON.stringify({ groups: [{ name: "Mine", pictures: ["tessellation"] }] }),
    );
    const mine = loadInterests();
    expect(mine.personal).toBe(true);
    expect(mine.groups).toEqual([{ name: "Mine", pictures: ["tessellation"], words: [] }]);
  });

  it("pins and unpins a search without touching the rest", () => {
    pinSearch("Hokusai", "pictures");
    pinSearch("hokusai", "pictures");
    expect(loadInterests().pinned).toEqual([{ q: "Hokusai", kind: "pictures" }]);
    expect(isPinned(loadInterests(), "HOKUSAI", "pictures")).toBe(true);
    expect(isPinned(loadInterests(), "Hokusai", "words")).toBe(false);
    unpinSearch("Hokusai", "pictures");
    expect(loadInterests().pinned).toEqual([]);
    expect(loadInterests().groups[0].name).toBe("Mine");
  });
});
