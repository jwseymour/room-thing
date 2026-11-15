import Link from "next/link";
import { PaperPrint, type PaperItem } from "@/components/PaperPrint";
import { requireSession } from "@/lib/auth";
import { listContent } from "@/lib/content/store";
import { largestSharpSize, PAPER_SIZES } from "@/lib/room/print";
import { printPlacements } from "@/lib/room/store";

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

export default async function PaperPage() {
  await requireSession();

  // Anything already planned on a wall prints at the size it was planned at.
  const planned = new Map(printPlacements().map((p) => [p.content.id, p.printSizeId]));
  const onPaper = (id: string | undefined) => PAPER_SIZES.find((s) => s.id === id)?.id;

  const items: PaperItem[] = listContent("keep").map((item) => {
    const sharp =
      item.widthPx && item.heightPx ? largestSharpSize(item.widthPx, item.heightPx) : null;
    // A5 unless the picture is too small to stay sharp at it.
    const fallback =
      item.kind !== "photo" || !sharp ? "postcard" : sharp.longMm < 210 ? sharp.id : "a5";
    return {
      id: item.id,
      kind: item.kind,
      label: item.title ?? item.body ?? item.filename ?? "Photo",
      widthPx: item.widthPx,
      heightPx: item.heightPx,
      sizeId: onPaper(planned.get(item.id)) ?? fallback,
      sharpLongMm: sharp?.longMm ?? null,
    };
  });

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-3xl">Nothing kept yet</h1>
        <p className="mt-2 text-muted">
          Keep some pictures or lines first, then come back to print them.
        </p>
        <Link href="/find" className="btn btn-primary mt-6">
          Find some
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/library" className="text-sm text-muted">
        ← Prints
      </Link>
      <h1 className="mt-2 text-2xl">Print on paper</h1>
      <p className="mt-1 mb-4 text-sm text-muted">
        Everything you&apos;ve kept, laid out on sheets of A4 to print in colour
        and cut out along the grey lines. Print at 100%, or &ldquo;actual
        size&rdquo;, so the sizes come out true. Most printers leave a few
        millimetres blank round the edge of the sheet.
      </p>
      <PaperPrint items={items} />
    </div>
  );
}
