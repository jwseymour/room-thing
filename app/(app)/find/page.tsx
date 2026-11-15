import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BusyHint, LineCard, PictureCard } from "@/components/find/Cards";
import { KeepQuote, PinButton } from "@/components/find/KeepButtons";
import { requireSession } from "@/lib/auth";
import { hasContact } from "@/lib/find/http";
import { searchImages } from "@/lib/find/images";
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
      <h1 className="mb-2 text-2xl">Find</h1>
      <p className="mb-4 max-w-xl text-sm text-muted">
        Pictures and lines that are free to print, from Wikimedia Commons, the
        Met, the Cleveland Museum of Art and Wikiquote. What you keep goes to{" "}
        <Link href="/library?status=keep" className="text-ink underline underline-offset-4">
          Prints
        </Link>
        .
      </p>

      <Form action="/find" className="mb-6 flex flex-wrap gap-2">
        <input
          name="q"
          type="search"
          defaultValue={q}
          required
          aria-label="Search for"
          placeholder="An artist, a subject, a writer, a film"
          className="field min-w-0 flex-1 basis-60"
        />
        {/* Radios, not two submit buttons: the form only sends its fields. */}
        <div className="flex">
          {(["pictures", "words", "work"] as const).map((option) => (
            <label key={option} className="btn -ml-px cursor-pointer first:ml-0 has-checked:bg-ink has-checked:text-paper">
              <input
                type="radio"
                name="kind"
                value={option}
                defaultChecked={kind === option}
                className="sr-only"
              />
              {option === "pictures" ? "Pictures" : option === "words" ? "Words" : "Film or book"}
            </label>
          ))}
        </div>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </Form>

      {q ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg">
              {kind === "pictures" ? "Pictures" : "Words"}: {q}
            </h2>
            <div className="flex gap-2">
              <PinButton q={q} kind={kind} pinned={isPinned(interests, q, kind)} />
              <Link href="/find" className="btn btn-quiet">
                Starting points
              </Link>
            </div>
          </div>
          {/* Keyed, so a new search shows the waiting line again and not the old results. */}
          <Suspense
            key={`${kind}:${q}:${page}`}
            fallback={<p role="status" className="py-12 text-center text-muted">Searching…</p>}
          >
            {kind === "pictures" ? <Pictures q={q} page={page} /> : <Words q={q} page={page} />}
          </Suspense>
        </>
      ) : (
        <StartingPoints interests={interests} />
      )}
    </>
  );
}

function Pager({ q, kind, page, more }: { q: string; kind: SearchKind; page: number; more: boolean }) {
  if (page === 0 && !more) return null;
  return (
    <div className="mt-6 flex justify-center gap-2">
      {page > 0 && (
        <Link href={href(q, kind, page - 1)} className="btn btn-quiet">
          Back
        </Link>
      )}
      {more && (
        <Link href={href(q, kind, page + 1)} className="btn">
          More
        </Link>
      )}
    </div>
  );
}

async function Pictures({ q, page }: { q: string; page: number }) {
  const { results, failed, more } = await searchImages(q, page);
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
        <ul className="columns-2 gap-3 sm:columns-3 md:columns-4">
          {results.map((image) => (
            <li key={`${image.source}:${image.id}`} className="mb-3 break-inside-avoid border border-line bg-card">
              <PictureCard image={image} />
            </li>
          ))}
        </ul>
      )}
      <Pager q={q} kind="pictures" page={page} more={more} />
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
  return (
    <>
      {pages.length > 0 && (
        <p className="mb-3 text-sm text-muted">From Wikiquote&apos;s pages on {pages.join(" and ")}.</p>
      )}
      {results.length === 0 ? (
        <p className="py-12 text-center text-muted">
          Nothing found. Wikiquote is sorted by person, work and theme, so try a
          name, a title or one word.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {results.map((quote) => (
            <li key={quote.body} className="border border-line bg-card p-4">
              <LineCard quote={quote} />
            </li>
          ))}
        </ul>
      )}
      <Pager q={q} kind="words" page={page} more={more} />
    </>
  );
}

function Chip({ q, kind }: { q: string; kind: SearchKind }) {
  return (
    <Link
      href={href(q, kind)}
      className={`inline-flex min-h-10 items-center border px-3 text-sm ${
        kind === "words" ? "border-line italic text-muted" : "border-ink"
      }`}
    >
      {kind === "words" ? `“${q}”` : q}
    </Link>
  );
}

function StartingPoints({ interests }: { interests: ReturnType<typeof loadInterests> }) {
  return (
    <>
      <p className="mb-5 max-w-xl text-sm text-muted">
        {interests.personal
          ? "Starting points drawn from what you make, do and write about. Outlined ones search for pictures, the ones in quotes for words."
          : "Some places to start. Outlined ones search for pictures, the ones in quotes for words."}
      </p>

      {interests.pinned.length > 0 && (
        <section className="mb-6">
          <h2 className="eyebrow mb-2">Pinned</h2>
          <div className="flex flex-wrap gap-2">
            {interests.pinned.map((pin) => (
              <Chip key={`${pin.kind}:${pin.q}`} q={pin.q} kind={pin.kind} />
            ))}
          </div>
        </section>
      )}

      {interests.groups.map((group) => (
        <section key={group.name} className="mb-6">
          <h2 className="eyebrow">{group.name}</h2>
          {group.why && <p className="mt-1 max-w-xl text-sm text-muted">{group.why}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {group.pictures.map((q) => (
              <Chip key={`p:${q}`} q={q} kind="pictures" />
            ))}
            {group.words.map((q) => (
              <Chip key={`w:${q}`} q={q} kind="words" />
            ))}
          </div>
        </section>
      ))}

      {interests.ownWords.length > 0 && (
        <section className="mb-6">
          <h2 className="eyebrow">In your own words</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Lines from your own notes that would work as reminders.
          </p>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {interests.ownWords.map((line) => (
              <li key={line.body} className="border border-line bg-card p-4">
                <blockquote className="text-lg leading-snug">{line.body}</blockquote>
                {line.attribution && <p className="mt-2 text-sm">{line.attribution}</p>}
                <div className="mt-3">
                  <KeepQuote
                    body={line.body}
                    attribution={line.attribution ?? ""}
                    kind={line.kind}
                    sourceUrl={null}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
