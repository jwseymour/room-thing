"use client";

import { useState } from "react";
import type { AssistReply } from "@/app/api/find/assist/route";
import { KeepImage, KeepQuote } from "@/components/find/KeepButtons";

const IDEAS: Record<"screen" | "book", string[]> = {
  screen: [
    "The lines people quote most",
    "Quiet lines that stand on their own",
    "Its best-known scenes, as scene cards",
    "The memes",
  ],
  book: [
    "The passages readers quote most",
    "Short lines that stand on their own",
    "The opening and the ending",
    "One passage that sums it up",
  ],
};

const CHECKED = {
  listed: { label: "On Wikiquote", tone: "text-muted" },
  web: { label: "Checked online", tone: "text-muted" },
  memory: { label: "From memory: check before printing", tone: "text-caution" },
} as const;

/** Asks Claude for lines and scenes from the work on this page. */
export function Assistant({ page, q, title, onScreen }: { page: string; q: string; title: string; onScreen: boolean }) {
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<AssistReply | null>(null);

  async function send(text: string) {
    const wanted = text.trim();
    if (!wanted || busy) return;
    setAsk(wanted);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/find/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, q, ask: wanted }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
      setReply(data as AssistReply);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-3xl">
      <p className="mb-3 max-w-xl text-sm text-muted">
        Say what you&apos;re after from {title}. Claude reads what&apos;s on this page
        {onScreen ? ", looks at the stills," : ""} and searches the web for more. It takes
        a minute or two.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(ask);
        }}
      >
        <input
          value={ask}
          onChange={(event) => setAsk(event.target.value)}
          aria-label="What you're after"
          placeholder={onScreen ? "The scene on the rooftop, with its line" : "Lines about the sea"}
          maxLength={500}
          className="field min-w-0 flex-1 basis-60"
        />
        <button type="submit" disabled={busy || !ask.trim()} className="btn btn-primary">
          {busy ? "Looking…" : "Ask"}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        {IDEAS[onScreen ? "screen" : "book"].map((idea) => (
          <button
            key={idea}
            type="button"
            disabled={busy}
            onClick={() => void send(idea)}
            className="inline-flex min-h-10 items-center border border-line px-3 text-sm"
          >
            {idea}
          </button>
        ))}
      </div>

      {busy && (
        <p role="status" className="mt-4 text-sm text-muted">
          Reading, looking and searching. Leave this page open.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}

      {reply && !busy && (
        <div className="mt-5">
          <p className="mb-4 max-w-xl text-sm">{reply.note}</p>

          {reply.scenes.length > 0 && (
            <ul className="mb-4 grid gap-3 sm:grid-cols-2">
              {reply.scenes.map((scene) => (
                <li key={`${scene.image.id}:${scene.caption}`} className="border border-line bg-card">
                  <Scene scene={scene} />
                </li>
              ))}
            </ul>
          )}

          {reply.quotes.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {reply.quotes.map((quote) => (
                <li key={quote.body} className="border border-line bg-card p-4">
                  <blockquote className="text-lg leading-snug whitespace-pre-line">{quote.body}</blockquote>
                  <p className="mt-2 text-sm">{quote.attribution}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {quote.where && `${quote.where} · `}
                    <span className={CHECKED[quote.checked].tone}>{CHECKED[quote.checked].label}</span>
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <KeepQuote
                      body={quote.body}
                      attribution={quote.attribution}
                      kind="quote"
                      sourceUrl={quote.sourceUrl}
                    />
                    {quote.sourceUrl && (
                      <a
                        href={quote.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-muted underline underline-offset-4"
                      >
                        Where it&apos;s from
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** A still Claude picked, with a caption that can be changed or cleared before keeping. */
function Scene({ scene }: { scene: AssistReply["scenes"][number] }) {
  const [caption, setCaption] = useState(scene.caption);
  return (
    <>
      <div className="relative">
        <img
          src={scene.image.thumbUrl}
          alt={scene.why}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-full bg-paper"
        />
        {caption.trim() && (
          <p
            className="absolute inset-x-3 bottom-3 text-center text-sm font-semibold text-white"
            style={{ textShadow: "0 0 3px #000, 0 0 3px #000, 0 1px 2px #000" }}
          >
            {caption}
          </p>
        )}
      </div>
      <div className="p-2">
        <p className="text-sm">{scene.why}</p>
        <label className="label mt-2" htmlFor={`caption-${scene.image.id}`}>
          Caption, set over the picture
        </label>
        <input
          id={`caption-${scene.image.id}`}
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          placeholder="None"
          maxLength={300}
          className="field"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Keyed by the caption, so changing it after keeping offers a fresh Keep. */}
          <KeepImage key={caption} source={scene.image.source} id={scene.image.id} caption={caption} />
        </div>
      </div>
    </>
  );
}
