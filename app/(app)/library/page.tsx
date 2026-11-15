import Link from "next/link";
import { TextForm } from "@/components/TextForm";
import { Uploader } from "@/components/Uploader";
import { requireSession } from "@/lib/auth";
import { listContent, statusCounts } from "@/lib/content/store";
import { CONTENT_STATUSES, type ContentStatus } from "@/lib/db/schema";

const FILTER_LABELS: Record<ContentStatus, string> = {
  inbox: "To sort",
  keep: "Kept",
  maybe: "Maybe",
  no: "No",
};

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

export default async function LibraryPage({
  searchParams,
}: PageProps<"/library">) {
  await requireSession();

  const { status } = await searchParams;
  const filter = CONTENT_STATUSES.find((s) => s === status);
  const items = listContent(filter);
  const counts = statusCounts();
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-2xl">Prints</h1>
        <Uploader />
      </div>
      <p className="mb-4 max-w-xl text-sm text-muted">
        Photos and quotes you&apos;d like printed for the walls. Things you
        already own go under <Link href="/things" className="text-ink underline underline-offset-4">Things</Link>.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/sort" className={`btn ${counts.inbox ? "btn-primary" : "btn-quiet"}`}>
          Sort{counts.inbox ? ` ${counts.inbox} new` : ""}
        </Link>
        <Link href="/find" className="btn btn-quiet">
          Find more
        </Link>
        <Link href="/print/paper" className={`btn ${counts.keep ? "" : "btn-quiet"}`}>
          Print on paper
        </Link>
        <Link href="/print" className="btn btn-quiet">
          Print list
        </Link>
      </div>

      <TextForm />

      <div className="my-4 flex gap-1 overflow-x-auto">
        <FilterLink href="/library" active={!filter}>
          All {total}
        </FilterLink>
        {CONTENT_STATUSES.map((s) => (
          <FilterLink key={s} href={`/library?status=${s}`} active={filter === s}>
            {FILTER_LABELS[s]} {counts[s]}
          </FilterLink>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="py-12 text-center text-muted">
          Nothing here yet. Add some photos, or a line you like.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-1 sm:grid-cols-5 md:grid-cols-6">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/library/${item.id}`}
                className="block aspect-square overflow-hidden rounded bg-card"
              >
                {item.kind === "photo" ? (
                  <img
                    src={`/api/media/${item.id}/thumb`}
                    alt={item.title ?? item.filename ?? "Photo"}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="flex size-full items-center justify-center overflow-hidden p-2 text-center font-serif text-xs leading-snug">
                    {item.body}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-10 shrink-0 items-center rounded-full px-3 text-sm ${
        active ? "bg-accent text-on-accent" : "text-muted"
      }`}
    >
      {children}
    </Link>
  );
}
