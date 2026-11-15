import Link from "next/link";
import { SwipeDeck } from "@/components/SwipeDeck";
import { requireSession } from "@/lib/auth";
import { inboxBatch, statusCounts } from "@/lib/content/store";

const BATCH_SIZE = 30;

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

export default async function SortPage() {
  await requireSession();

  const batch = inboxBatch(BATCH_SIZE).map(
    ({ id, kind, body, attribution, filename }) => ({
      id,
      kind,
      body,
      attribution,
      filename,
    }),
  );
  const { inbox, keep } = statusCounts();

  if (batch.length === 0) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-3xl">Nothing to sort</h1>
        <p className="mt-2 text-muted">
          {keep > 0
            ? `You've kept ${keep} so far.`
            : "Add some photos or quotes to get started."}
        </p>
        <Link href="/library" className="btn btn-primary mt-6">
          Go to library
        </Link>
      </div>
    );
  }

  // The key starts a fresh deck when the next batch arrives.
  return <SwipeDeck key={batch[0].id} initial={batch} inboxTotal={inbox} />;
}
