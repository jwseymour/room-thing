import Link from "next/link";
import { Suspense } from "react";
import { Assistant } from "@/components/find/Assistant";
import { BusyHint } from "@/components/find/Cards";
import { FindBar } from "@/components/find/FindBar";
import { LineList } from "@/components/find/LineList";
import { PictureGrid } from "@/components/find/PictureGrid";
import { WorkTabs, type WorkTab } from "@/components/find/WorkTabs";
import { requireSession } from "@/lib/auth";
import { alreadyKept } from "@/lib/content/store";
import { hasAssistant } from "@/lib/find/assist";
import { hasContact } from "@/lib/find/http";
import { refOf, searchCommonsFor } from "@/lib/find/images";
import { findWorks, readWork, type Work } from "@/lib/find/quotes";
import { hasTmdb, searchStills } from "@/lib/find/tmdb";

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const KIND_NAMES = { film: "Film", tv: "Series", book: "Book", other: "" } as const;

export default async function WorkPage({ searchParams }: PageProps<"/find/work">) {
  await requireSession();

  const params = await searchParams;
  const q = (first(params.q) ?? "").trim().slice(0, 120);
  const chosen = (first(params.page) ?? "").trim().slice(0, 200);
  const tab = first(params.tab) ?? "";

  return (
    <>
      <h1 className="mb-3 text-2xl">Find</h1>
      <FindBar q={q} kind="work" />
      {q ? (
        <Suspense
          key={`${q}:${chosen}`}
          fallback={<p role="status" className="py-12 text-center text-muted">Looking it up…</p>}
        >
          <Found q={q} chosen={chosen} tab={tab} />
        </Suspense>
      ) : (
        <p className="py-12 text-center text-muted">
          Type the name of a film, a series, a novel or a play above.
        </p>
      )}
    </>
  );
}

async function Found({ q, chosen, tab }: { q: string; chosen: string; tab: string }) {
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
  const onScreen = work.kind === "film" || work.kind === "tv";
  const kept = alreadyKept(
    [],
    [...work.lines, ...work.passages, ...work.exchanges].map((quote) => quote.body),
  );
  const captions = work.lines.map((quote) => quote.body);

  const tabs: WorkTab[] = [
    {
      id: "pictures",
      label: onScreen ? "Stills" : "Pictures",
      panel: (
        <Suspense fallback={<p role="status" className="py-8 text-sm text-muted">Finding pictures…</p>}>
          <Scenes work={work} captions={captions} />
        </Suspense>
      ),
    },
    {
      id: "lines",
      label: "Lines",
      count: work.lines.length,
      panel: <LineList quotes={work.lines} kept={kept} title={work.title} empty="No short lines on its page." />,
    },
    ...(work.passages.length
      ? [
          {
            id: "passages",
            label: "Passages",
            count: work.passages.length,
            panel: (
              <>
                <p className="mb-2 text-xs text-muted">Longer stretches, for a sheet of their own.</p>
                <LineList quotes={work.passages} kept={kept} title={work.title} />
              </>
            ),
          },
        ]
      : []),
    ...(work.exchanges.length
      ? [
          {
            id: "exchanges",
            label: "Exchanges",
            count: work.exchanges.length,
            panel: <LineList quotes={work.exchanges} kept={kept} />,
          },
        ]
      : []),
    {
      id: "ask",
      label: "Ask Claude",
      panel: hasAssistant() ? (
        <Assistant page={work.pageTitle} q={q} title={work.title} onScreen={onScreen} />
      ) : (
        <p className="max-w-xl py-4 text-sm text-muted">
          Claude can pick lines and scenes for you here, and search the web for
          more than this page found: say &ldquo;the quiet lines&rdquo; or
          &ldquo;the memes&rdquo; and it does the looking. It isn&apos;t switched
          on yet. Add a Claude API key to .env.local as ANTHROPIC_API_KEY and
          restart (see the README).
        </p>
      ),
    },
  ];
  // A film opens on its stills when there are some to show. A book opens on its lines.
  const opensOn = onScreen && hasTmdb() ? "pictures" : "lines";

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xl">{work.title}</h2>
        <p className="text-sm text-muted">
          {[KIND_NAMES[work.kind], work.year].filter(Boolean).join(", ")}
          {(work.kind !== "other" || work.year) && " · "}
          <a href={work.pageUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            Wikiquote
          </a>
        </p>
      </div>
      {others.length > 0 && (
        <p className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <span className="text-muted">Not the one you meant?</span>
          {others.map((title) => (
            <Link
              key={title}
              href={`/find/work?${new URLSearchParams({ q, page: title })}`}
              className="py-1 underline decoration-line underline-offset-4 hover:decoration-ink"
            >
              {title}
            </Link>
          ))}
        </p>
      )}
      <WorkTabs tabs={tabs} initial={tab || opensOn} stillsTab={onScreen && hasTmdb() ? "pictures" : null} />
    </>
  );
}

/**
 * Stills from TMDB for a film or series, if a key is set. Wikimedia Commons as
 * well: stills from films old enough to be free, and illustrations for books.
 */
async function Scenes({ work, captions }: { work: Work; captions: string[] }) {
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
  const kept = alreadyKept([...fromTmdb, ...fromCommons].map((image) => refOf(image.source, image.id)), []);

  return (
    <>
      {fromTmdb.length > 0 && (
        <>
          <p className="mb-2 text-xs text-muted">
            Press a still to see it large and set a line over it. The corner keeps it as it is.
          </p>
          <PictureGrid images={fromTmdb} kept={kept} titles={false} lines={captions} />
          <p className="mt-1 mb-6 text-xs text-muted">
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
          <PictureGrid images={fromCommons} kept={kept} lines={captions} />
        </>
      ) : (
        fromTmdb.length === 0 && (
          <p className="py-8 text-sm text-muted">
            {free.status === "rejected"
              ? "No answer from Wikimedia Commons just now."
              : "No pictures found for it."}
          </p>
        )
      )}
    </>
  );
}
