export type FindKind = "pictures" | "words" | "work";

const KINDS: { kind: FindKind; label: string }[] = [
  { kind: "pictures", label: "Pictures" },
  { kind: "words", label: "Words" },
  { kind: "work", label: "Film or book" },
];

/**
 * One box, and three buttons that each search it a different way. The one in
 * use is filled in, so after a search they double as tabs: press another to
 * see the same words as pictures, as quotes, or as a film or book.
 */
export function FindBar({ q, kind }: { q: string; kind: FindKind | null }) {
  return (
    // A plain form, not next/form: which button was pressed has to be sent.
    <form action="/find" className="mb-5 flex flex-wrap gap-2">
      <input
        name="q"
        type="search"
        defaultValue={q}
        required
        aria-label="Search for"
        placeholder="An artist, a subject, a writer, a film, a book"
        className="field min-w-0 flex-1 basis-72"
      />
      {/* Enter presses a form's first button, so this unseen one repeats the kind in use. */}
      <button type="submit" name="kind" value={kind ?? "pictures"} tabIndex={-1} aria-hidden className="sr-only">
        Search
      </button>
      <div className="flex flex-1 sm:flex-none">
        {KINDS.map((option) => (
          <button
            key={option.kind}
            type="submit"
            name="kind"
            value={option.kind}
            aria-current={kind === option.kind ? "true" : undefined}
            className={`btn -ml-px flex-1 px-3 whitespace-nowrap first:ml-0 max-sm:px-1.5 max-sm:tracking-[0.08em] sm:flex-none ${kind === option.kind ? "btn-primary" : ""}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </form>
  );
}
