/**
 * How the search names itself to its sources. By default that's a generic name
 * with nothing that says whose laptop this is. Wikimedia allows such a client
 * only ten requests a minute, counted per network address, so on a shared
 * network the allowance is often already spent. Setting `FIND_CONTACT` in
 * `.env.local` to an email address or a web page of yours adds it to the name,
 * which is what Wikimedia asks for and raises the allowance to 200 a minute.
 */
function headers(): Record<string, string> {
  const contact = process.env.FIND_CONTACT?.trim();
  return {
    "User-Agent": contact
      ? `wall-planner-bot/0.1 (${contact})`
      : "wall-planner/0.1 (local personal app)",
  };
}

export const hasContact = () => Boolean(process.env.FIND_CONTACT?.trim());

/**
 * Fetches, trying again if the source says it's busy. Wikimedia does that when
 * requests land together, which keeping two pictures in a row does. A search
 * only waits a moment, since the other sources can answer without it. A
 * download is worth waiting longer for.
 */
export async function request(
  url: string | URL,
  timeoutMs: number,
  patient = false,
): Promise<Response> {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok) return response;
    const busy = response.status === 429 || response.status >= 500;
    if (!busy || attempt >= (patient ? 2 : 1)) throw new Error(`${response.status} from ${host}`);
    await response.body?.cancel();
    const asked = Number(response.headers.get("retry-after")) || 1 + attempt * 2;
    await new Promise((resolve) => setTimeout(resolve, Math.min(asked, patient ? 8 : 1) * 1000));
  }
}

const KEEP_MS = 60 * 60 * 1000;
const KEEP_AT_MOST = 300;
// On globalThis so dev reloads don't empty it.
const store = globalThis as unknown as { findCache?: Map<string, { at: number; data: unknown }> };
const cache = (store.findCache ??= new Map());

/**
 * JSON from a source, remembered for an hour. Going back to a search, or on to
 * its next page, then asks the source nothing, which keeps well inside what
 * these free services allow.
 */
export async function getJson(url: string, timeoutMs = 7000): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.data;
  const data = await (await request(url, timeoutMs)).json();
  cache.set(url, { at: Date.now(), data });
  // A Map keeps the order things went in, so the first key is the oldest.
  if (cache.size > KEEP_AT_MOST) cache.delete(cache.keys().next().value!);
  return data;
}
