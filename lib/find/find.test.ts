import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "room-find-test-"));
vi.stubEnv("DATA_DIR", dataDir);

const { creditLine, interleave, plainText } = await import("./images");
const { distanceFrom, leadingName, parseQuotes, toFound } = await import("./quotes");
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
      { body: "A line is a dot that went for a walk.", detail: "Pedagogical Sketchbook (1925)" },
      { body: "Art does not reproduce the visible; rather, it makes visible.", detail: null },
      { body: "Colour & I are one.", detail: "Diary, 1914" },
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
