"use server";

import { setTimeout as sleep } from "node:timers/promises";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createSessionToken,
  safeEqual,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
} from "@/lib/session-token";

export async function login(
  _previous: string | null,
  form: FormData,
): Promise<string | null> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return "No password is set. Run `npm run setup`.";

  if (!safeEqual(String(form.get("password") ?? ""), expected)) {
    await sleep(600);
    return "That's not the password.";
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
    // The phone reaches the laptop over plain http on the local network, so a
    // `secure` cookie would never be sent back.
    secure: false,
  });
  redirect("/");
}
