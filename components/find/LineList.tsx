"use client";

import { useMemo, useState } from "react";
import type { FoundQuote } from "@/lib/find/quotes";
import { KeepQuote } from "./KeepButtons";
import { useWork } from "./WorkTabs";

const STEP = 40;
const MAX_SPEAKERS = 10;

/** "Roy Batty, Blade Runner" is Roy Batty's. A line credited to the work alone is nobody's. */
const speakerOf = (quote: FoundQuote, title: string | undefined) => {
  if (!title || quote.attribution === title) return null;
  return quote.attribution.endsWith(`, ${title}`) ? quote.attribution.slice(0, -title.length - 2) : null;
};

/**
 * Found lines as a list to read down, with a box to narrow them and, for a
 * film, the characters to pick between.
 */
export function LineList({
  quotes,
  kept,
  title,
  empty = "Nothing here.",
}: {
  quotes: FoundQuote[];
  /** Line → library id, for the ones kept already. */
  kept: Record<string, string>;
  /** The work these are from, if they're all from one. */
  title?: string;
  empty?: string;
}) {
  const work = useWork();
  const [filter, setFilter] = useState("");
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [shown, setShown] = useState(STEP);

  const speakers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const quote of quotes) {
      const who = speakerOf(quote, title);
      if (who) counts.set(who, (counts.get(who) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, MAX_SPEAKERS);
  }, [quotes, title]);

  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const matching = quotes.filter((quote) => {
    if (speaker && speakerOf(quote, title) !== speaker) return false;
    const text = `${quote.body} ${quote.attribution} ${quote.detail ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });

  if (quotes.length === 0) return <p className="py-8 text-sm text-muted">{empty}</p>;

  return (
    <div className="max-w-3xl">
      {quotes.length > 8 && (
        <div className="mb-3">
          <input
            type="search"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setShown(STEP);
            }}
            aria-label="Narrow these lines"
            placeholder={`Narrow these ${quotes.length}: a word, a name`}
            className="field"
          />
          {speakers.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {speakers.map(([who, n]) => (
                <button
                  key={who}
                  type="button"
                  aria-pressed={speaker === who}
                  onClick={() => {
                    setSpeaker(speaker === who ? null : who);
                    setShown(STEP);
                  }}
                  className={`inline-flex min-h-9 items-center gap-1.5 border px-2.5 text-sm ${
                    speaker === who ? "border-ink bg-ink text-paper" : "border-line"
                  }`}
                >
                  {who} <span className="text-xs opacity-60">{n}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {matching.length === 0 ? (
        <p className="py-8 text-sm text-muted">None of them match that.</p>
      ) : (
        <ul className="border-b border-line">
          {matching.slice(0, shown).map((quote) => (
            <li key={quote.body} className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-line py-3 sm:flex-nowrap">
              <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                <blockquote className="text-[1.05rem] leading-snug whitespace-pre-line">{quote.body}</blockquote>
                <p className="mt-1 text-xs text-muted">
                  <span className="text-ink">{quote.attribution}</span>
                  {quote.detail && quote.detail !== quote.attribution && ` · ${quote.detail}`}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted">
                  <a href={quote.pageUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                    In context
                  </a>
                  {work?.hasStills && quote.body.length <= 300 && !quote.body.includes("\n") && (
                    <button type="button" onClick={() => work.putOnStill(quote.body)} className="underline underline-offset-4">
                      Put it on a still
                    </button>
                  )}
                </p>
              </div>
              <KeepQuote
                body={quote.body}
                attribution={quote.attribution}
                kind="quote"
                sourceUrl={quote.pageUrl}
                keptId={kept[quote.body]}
              />
            </li>
          ))}
        </ul>
      )}
      {matching.length > shown && (
        <button type="button" onClick={() => setShown(shown + STEP)} className="btn mt-4">
          Show more of {matching.length}
        </button>
      )}
    </div>
  );
}
