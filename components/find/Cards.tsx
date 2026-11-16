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
