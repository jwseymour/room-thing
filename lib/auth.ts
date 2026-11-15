import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isValidSessionToken, SESSION_COOKIE } from "./session-token";

export async function hasSession(): Promise<boolean> {
  // Everything after this runs at request time only. Without it, Next.js may
  // render ahead of a request and keep the result: SQLite reads are synchronous,
  // so it can't tell they're live data, and checking the session's expiry
  // against the clock isn't allowed there at all.
  await connection();
  const jar = await cookies();
  return isValidSessionToken(jar.get(SESSION_COOKIE)?.value);
}

/**
 * Call first in every page and Server Function. The proxy alone isn't enough,
 * because Server Functions can fall outside its matcher. It also keeps the page
 * out of prerendering, so SQLite is never queried during the build and pages
 * always show the current data.
 */
export async function requireSession(): Promise<void> {
  if (!(await hasSession())) redirect("/login");
}
