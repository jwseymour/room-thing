import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentControls } from "@/components/ContentControls";
import { requireSession } from "@/lib/auth";
import { getContent, placementCount } from "@/lib/content/store";
import {
  orientationFor,
  PRINT_SIZES,
  printDimensions,
  printQuality,
} from "@/lib/room/print";

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

export default async function ContentPage({
  params,
}: PageProps<"/library/[id]">) {
  await requireSession();

  const { id } = await params;
  const item = getContent(id);
  if (!item) notFound();

  const sizes =
    item.widthPx && item.heightPx
      ? PRINT_SIZES.map((size) => {
          const orientation = orientationFor(item.widthPx!, item.heightPx!);
          return {
            size,
            quality: printQuality(
              item.widthPx!,
              item.heightPx!,
              printDimensions(size.id, orientation),
            ),
          };
        })
      : [];

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/library" className="text-sm text-muted">
        ← Library
      </Link>

      {item.kind === "photo" ? (
        <img
          src={`/api/media/${item.id}/card`}
          alt={item.filename ?? "Photo"}
          className="mt-3 max-h-[60dvh] w-full rounded-lg bg-black object-contain"
        />
      ) : (
        <blockquote className="mt-3 rounded-lg border border-line bg-card p-8 text-center">
          <p className="font-serif text-2xl leading-snug">{item.body}</p>
          {item.attribution && (
            <footer className="mt-3 text-sm text-muted">
              {item.attribution}
            </footer>
          )}
        </blockquote>
      )}

      <ContentControls
        id={item.id}
        status={item.status}
        placed={placementCount(item.id)}
      />

      {sizes.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-xl">How large can it print?</h2>
          <p className="mb-2 text-sm text-muted">
            {item.widthPx} × {item.heightPx} pixels
          </p>
          <ul className="divide-y divide-line rounded-lg border border-line bg-card">
            {sizes.map(({ size, quality }) => (
              <li
                key={size.id}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <span>{size.label}</span>
                <span
                  className={
                    quality.rating === "good"
                      ? "text-muted"
                      : quality.rating === "soft"
                        ? "text-caution"
                        : "text-danger"
                  }
                >
                  {quality.ppi} ppi
                  {quality.rating === "soft" && ", a little soft"}
                  {quality.rating === "too_small" && ", too small"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
