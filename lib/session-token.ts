import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "room_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 90;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is missing. Run `npm run setup`.");
  return value;
}

function sign(expires: string): string {
  return createHmac("sha256", secret()).update(expires).digest("base64url");
}

export function createSessionToken(now = Date.now()): string {
  const expires = String(now + SESSION_MAX_AGE_S * 1000);
  return `${expires}.${sign(expires)}`;
}

export function isValidSessionToken(
  token: string | undefined,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const [expires, mac] = token.split(".");
  if (!expires || !mac || Number(expires) <= now) return false;
  return safeEqual(mac, sign(expires));
}

/** Hashes first, so the comparison doesn't reveal the expected length. */
export function safeEqual(a: string, b: string): boolean {
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(a), hash(b));
}
