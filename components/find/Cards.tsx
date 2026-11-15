import { KeepImage, KeepQuote } from "@/components/find/KeepButtons";
import { creditLine, type FoundImage } from "@/lib/find/images";
import type { FoundQuote } from "@/lib/find/quotes";
import { largestSharpSize } from "@/lib/room/print";

/** One found picture: what it is, how large it prints, and a button to keep it. */
export function PictureCard({ image }: { image: FoundImage }) {
  const sharp =
    image.widthPx && image.heightPx ? largestSharpSize(image.widthPx, image.heightPx) : null;
  return (
    <>
      <a href={image.pageUrl} target="_blank" rel="noreferrer">
        <img
          src={image.thumbUrl}
          alt={image.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-full bg-paper"
        />
      </a>
      <div className="p-2">
        <p className="line-clamp-2 text-sm">{image.title}</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted">{creditLine(image)}</p>
        {image.widthPx && image.heightPx && (
          <p className={`mt-0.5 text-xs ${sharp ? "text-muted" : "text-caution"}`}>
            {sharp ? `Sharp up to ${sharp.label}` : "Small: postcard at most"}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <KeepImage source={image.source} id={image.id} />
        </div>
      </div>
    </>
  );
}

/** One found line, or a short exchange with a speaker to each line. */
export function LineCard({ quote }: { quote: FoundQuote }) {
  return (
    <>
      <blockquote className="text-lg leading-snug whitespace-pre-line">{quote.body}</blockquote>
      <p className="mt-2 text-sm">{quote.attribution}</p>
      {quote.detail && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{quote.detail}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <KeepQuote
          body={quote.body}
          attribution={quote.attribution}
          kind="quote"
          sourceUrl={quote.pageUrl}
        />
        <a
          href={quote.pageUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted underline underline-offset-4"
        >
          In context
        </a>
      </div>
    </>
  );
}

/** Shown when Wikimedia turns a search away and no contact has been set. */
export function BusyHint() {
  return (
    <span className="mt-1 block text-muted">
      Wikimedia allows an unnamed app ten searches a minute for everyone on
      your network. Wait a minute, or set FIND_CONTACT in .env.local (see the
      README) to be let through.
    </span>
  );
}
