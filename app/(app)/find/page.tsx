import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BusyHint } from "@/components/find/Cards";
import { FindBar } from "@/components/find/FindBar";
import { KeepQuote, PinButton } from "@/components/find/KeepButtons";
import { LineList } from "@/components/find/LineList";
import { PictureGrid } from "@/components/find/PictureGrid";
import { RandomPoint } from "@/components/find/RandomPoint";
import { requireSession } from "@/lib/auth";
import { alreadyKept } from "@/lib/content/store";
import { hasContact } from "@/lib/find/http";
import { refOf, searchImages } from "@/lib/find/images";
import { isPinned, loadInterests, type SearchKind } from "@/lib/find/interests";
import { searchQuotes } from "@/lib/find/quotes";

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const href = (q: string, kind: SearchKind, page = 0) =>
  `/find?${new URLSearchParams({ q, kind, ...(page ? { page: String(page) } : {}) })}`;

export default async function FindPage({ searchParams }: PageProps<"/find">) {
  await requireSession();

  const params = await searchParams;
  const q = (first(params.q) ?? "").trim().slice(0, 120);
  // A film or book has a page of its own, with its lines and its pictures together.
  if (q && first(params.kind) === "work") redirect(`/find/work?${new URLSearchParams({ q })}`);
  const kind: SearchKind = first(params.kind) === "words" ? "words" : "pictures";
  const page = Math.min(40, Math.max(0, Number(first(params.page)) || 0));
  const interests = loadInterests();

  return (
    <>
      <h1 className="mb-3 text-2xl">Find</h1>
      <FindBar q={q} kind={q ? kind : null} />

      {q ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <Link href="/find" className="text-sm text-muted">
              ← Starting points
            </Link>
            <PinButton q={q} kind={kind} pinned={isPinned(interests, q, kind)} />
          </div>
          {/* Keyed, so a new search shows the waiting line again and not the old results. */}
          <Suspense
            key={`${kind}:${q}:${page}`}
            fallback={<p role="status" className="py-12 text-center text-muted">Searching…</p>}
          >
            {kind === "pictures" ? <Pictures q={q} /> : <Words q={q} page={page} />}
          </Suspense>
        </>
      ) : (
        <StartingPoints interests={interests} />
      )}
    </>
  );
}

async function Pictures({ q }: { q: string }) {
  const { results, failed, more } = await searchImages(q, 0);
  const kept = alreadyKept(results.map((image) => refOf(image.source, image.id)), []);
  return (
    <>
      {failed.length > 0 && (
        <p className="mb-3 text-sm text-caution">
          No answer from {failed.join(" or ")} just now, so this is from the rest.
          {!hasContact() && failed.includes("Wikimedia Commons") && <BusyHint />}
        </p>
      )}
      {results.length === 0 ? (
        <p className="py-12 text-center text-muted">
          Nothing found. Try fewer words, or a name on its own.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted">
            Press a picture to see it large. The corner keeps it for printing.
          </p>
          <PictureGrid images={results} kept={kept} moreOf={q} hasMore={more} />
        </>
      )}
    </>
  );
}

async function Words({ q, page }: { q: string; page: number }) {
  const { results, pages, failed, more } = await searchQuotes(q, page);
  if (failed) {
    return (
      <p className="py-12 text-center text-caution">
        No answer from Wikiquote just now.{!hasContact() && <BusyHint />}
      </p>
    );
  }
  if (results.length === 0) {
    return (
      <p className="py-12 text-center text-muted">
        Nothing found. Wikiquote is sorted by person, work and theme, so try a
        name, a title or one word.
      </p>
    );
  }
  return (
    <>
      {pages.length > 0 && (
        <p className="mb-2 text-xs text-muted">From Wikiquote&apos;s pages on {pages.join(" and ")}.</p>
      )}
      <LineList quotes={results} kept={alreadyKept([], results.map((quote) => quote.body))} />
      {(page > 0 || more) && (
        <div className="mt-4 flex gap-2">
          {page > 0 && (
            <Link href={href(q, "words", page - 1)} className="btn btn-quiet">
              Back
            </Link>
          )}
          {more && (
            <Link href={href(q, "words", page + 1)} className="btn">
              More
            </Link>
          )}
        </div>
      )}
    </>
  );
}

function Chips({ label, kind, list }: { label: string; kind: SearchKind; list: string[] }) {
  if (list.length === 0) return null;
  return (
    <div className="flex items-baseline gap-3">
      <span className="eyebrow w-16 shrink-0">{label}</span>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {list.map((q) => (
          <Link key={q} href={href(q, kind)} className="py-1 underline decoration-line underline-offset-4 hover:decoration-ink">
            {q}
          </Link>
        ))}
      </div>
    </div>
  );
}

function StartingPoints({ interests }: { interests: ReturnType<typeof loadInterests> }) {
  const everything = [
    ...interests.groups.flatMap((group) => [
      ...group.pictures.map((q) => href(q, "pictures")),
      ...group.words.map((q) => href(q, "words")),
    ]),
  ];
  const pinnedOf = (kind: SearchKind) => interests.pinned.filter((p) => p.kind === kind).map((p) => p.q);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">
          Search for anything, or start from one of these
          {interests.personal ? ", drawn from what you make, do and write about" : ""}. What you keep
          gathers in a tray along the bottom, ready to print.
        </p>
        <RandomPoint hrefs={everything} />
      </div>

      <div className="border-b border-line">
        {interests.pinned.length > 0 && (
          <section className="grid gap-x-6 gap-y-2 border-t border-ink py-4 sm:grid-cols-[13rem_1fr]">
            <h2 className="text-sm tracking-[0.14em]">Pinned</h2>
            <div className="grid gap-1.5 text-sm">
              <Chips label="Pictures" kind="pictures" list={pinnedOf("pictures")} />
              <Chips label="Words" kind="words" list={pinnedOf("words")} />
            </div>
          </section>
        )}
        {interests.groups.map((group) => (
          <section key={group.name} className="grid gap-x-6 gap-y-2 border-t border-line py-4 sm:grid-cols-[13rem_1fr]">
            <div>
              <h2 className="text-sm tracking-[0.14em]">{group.name}</h2>
              {group.why && <p className="mt-1 text-xs text-muted">{group.why}</p>}
            </div>
            <div className="grid content-start gap-1.5 text-sm">
              <Chips label="Pictures" kind="pictures" list={group.pictures} />
              <Chips label="Words" kind="words" list={group.words} />
            </div>
          </section>
        ))}
      </div>

      {interests.ownWords.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm tracking-[0.14em]">In your own words</h2>
          <p className="mt-1 mb-2 text-xs text-muted">
            Lines from your own notes that would work as reminders.
          </p>
          <ul className="max-w-3xl border-b border-line">
            {interests.ownWords.map((line) => (
              <li key={line.body} className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-line py-3 sm:flex-nowrap">
                <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                  <blockquote className="text-[1.05rem] leading-snug">{line.body}</blockquote>
                  {line.attribution && <p className="mt-1 text-xs">{line.attribution}</p>}
                </div>
                <KeepQuote
                  body={line.body}
                  attribution={line.attribution ?? ""}
                  kind={line.kind}
                  sourceUrl={null}
                  keptId={alreadyKept([], [line.body])[line.body]}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
