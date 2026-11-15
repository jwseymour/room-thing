import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { BusyHint, LineCard, PictureCard } from "@/components/find/Cards";
import { requireSession } from "@/lib/auth";
import { hasContact } from "@/lib/find/http";
import { searchCommonsFor, type FoundImage } from "@/lib/find/images";
import { findWorks, readWork, type Work } from "@/lib/find/quotes";
import { hasTmdb, searchStills } from "@/lib/find/tmdb";

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const KIND_NAMES = { film: "Film", tv: "Series", book: "Book", other: "" } as const;
const SHOWN_AT_FIRST = 40;

export default async function WorkPage({ searchParams }: PageProps<"/find/work">) {
  await requireSession();

  const params = await searchParams;
  const q = (first(params.q) ?? "").trim().slice(0, 120);
  const chosen = (first(params.page) ?? "").trim().slice(0, 200);
  const all = first(params.all) === "1";

  return (
    <>
      <Link href="/find" className="text-sm text-muted">
        ← Find
      </Link>
      <h1 className="mt-2 mb-2 text-2xl">A film or book</h1>
      <p className="mb-4 max-w-xl text-sm text-muted">
        Name one, and this gathers its lines from Wikiquote and pictures to go
        with them.
      </p>
      <Form action="/find/work" className="mb-6 flex flex-wrap gap-2">
        <input
          name="q"
          type="search"
          defaultValue={q}
          required
          aria-label="Title"
          placeholder="A film, a series, a novel, a play"
          className="field min-w-0 flex-1 basis-60"
        />
        <button type="submit" className="btn btn-primary">
          Look it up
        </button>
      </Form>

      {q && (
        <Suspense
          key={`${q}:${chosen}:${all}`}
          fallback={<p role="status" className="py-12 text-center text-muted">Looking it up…</p>}
        >
          <Found q={q} chosen={chosen} all={all} />
        </Suspense>
      )}
    </>
  );
}

async function Found({ q, chosen, all }: { q: string; chosen: string; all: boolean }) {
  let titles: string[];
  let work: Work | null;
  try {
    titles = await findWorks(q);
    work = titles.length || chosen ? await readWork(chosen || titles[0], q) : null;
  } catch (error) {
    console.error(`Looking up "${q}" failed:`, error);
    return (
      <p className="py-12 text-center text-caution">
        No answer from Wikiquote just now.{!hasContact() && <BusyHint />}
      </p>
    );
  }
  if (!work) {
    return (
      <p className="py-12 text-center text-muted">
        Wikiquote has no page for that. Try the title on its own, without the
        author or the year.
      </p>
    );
  }

  const others = titles.filter((title) => title !== work.pageTitle);
  const link = (extra: Record<string, string>) =>
    `/find/work?${new URLSearchParams({ q, page: work.pageTitle, ...extra })}`;
  const lines = all ? work.lines : work.lines.slice(0, SHOWN_AT_FIRST);

  return (
    <>
      <h2 className="text-lg">{work.title}</h2>
      <p className="mb-3 text-sm text-muted">
        {[KIND_NAMES[work.kind], work.year].filter(Boolean).join(", ")}
        {(work.kind !== "other" || work.year) && " · "}
        <a href={work.pageUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
          Its page on Wikiquote
        </a>
      </p>
      {others.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="eyebrow">Not this one?</span>
          {others.map((title) => (
            <Link
              key={title}
              href={`/find/work?${new URLSearchParams({ q, page: title })}`}
              className="inline-flex min-h-10 items-center border border-line px-3 text-sm"
            >
              {title}
            </Link>
          ))}
        </div>
      )}

      <section className="mb-8">
        <h3 className="eyebrow mb-2">Scenes</h3>
        <Suspense fallback={<p role="status" className="py-6 text-sm text-muted">Finding pictures…</p>}>
          <Scenes work={work} />
        </Suspense>
      </section>

      <section className="mb-8">
        <h3 className="eyebrow mb-2">Lines</h3>
        {work.lines.length === 0 ? (
          <p className="text-sm text-muted">No single lines short enough for a wall on its page.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {lines.map((quote) => (
              <li key={quote.body} className="border border-line bg-card p-4">
                <LineCard quote={quote} />
              </li>
            ))}
          </ul>
        )}
        {!all && work.lines.length > SHOWN_AT_FIRST && (
          <Link href={link({ all: "1" })} className="btn mt-4">
            All {work.lines.length} lines
          </Link>
        )}
      </section>

      {work.exchanges.length > 0 && (
        <section className="mb-8">
          <h3 className="eyebrow mb-2">Exchanges</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {(all ? work.exchanges : work.exchanges.slice(0, SHOWN_AT_FIRST)).map((quote) => (
              <li key={quote.body} className="border border-line bg-card p-4">
                <LineCard quote={quote} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Grid({ images }: { images: FoundImage[] }) {
  return (
    <ul className="columns-2 gap-3 sm:columns-3 md:columns-4">
      {images.map((image) => (
        <li key={`${image.source}:${image.id}`} className="mb-3 break-inside-avoid border border-line bg-card">
          <PictureCard image={image} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Stills from TMDB for a film or series, if a key is set. Wikimedia Commons as
 * well: stills from films old enough to be free, and illustrations for books.
 */
async function Scenes({ work }: { work: Work }) {
  const onScreen = work.kind === "film" || work.kind === "tv";
  const commonsQuery = onScreen
    ? `${work.title} ${work.year ?? ""} film`.replace(/\s+/g, " ")
    : `${work.title} illustration`;
  const [stills, free] = await Promise.allSettled([
    onScreen && hasTmdb()
      ? searchStills(work.title, work.year, work.kind === "tv" ? "tv" : "film")
      : Promise.resolve([]),
    searchCommonsFor(commonsQuery),
  ]);
  const fromTmdb = stills.status === "fulfilled" ? stills.value : [];
  const fromCommons = free.status === "fulfilled" ? free.value : [];
  if (stills.status === "rejected") console.error(`TMDB stills for "${work.title}" failed:`, stills.reason);

  return (
    <>
      {fromTmdb.length > 0 && (
        <>
          <Grid images={fromTmdb} />
          <p className="mb-4 text-xs text-muted">
            Stills come from TMDB, which this app isn&apos;t endorsed by. They
            belong to the film&apos;s makers, so they&apos;re for your own wall.
          </p>
        </>
      )}
      {onScreen && !hasTmdb() && (
        <p className="mb-3 max-w-xl text-sm text-muted">
          For stills from the film itself, add a free TMDB key to .env.local as
          TMDB_API_KEY (see the README). Until then, this is what Wikimedia
          Commons has, which is mostly films old enough to be out of copyright.
        </p>
      )}
      {stills.status === "rejected" && (
        <p className="mb-3 text-sm text-caution">No answer from TMDB just now. Check the key.</p>
      )}
      {fromCommons.length > 0 ? (
        <>
          {fromTmdb.length > 0 && <p className="eyebrow mb-2">Free to use, from Wikimedia Commons</p>}
          <Grid images={fromCommons} />
        </>
      ) : (
        fromTmdb.length === 0 && (
          <p className="text-sm text-muted">
            {free.status === "rejected"
              ? "No answer from Wikimedia Commons just now."
              : "No pictures found for it."}
          </p>
        )
      )}
    </>
  );
}
